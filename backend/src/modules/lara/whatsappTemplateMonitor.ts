/**
 * WhatsApp Template Monitor
 *
 * Roda a cada hora e verifica o status dos 10 templates da Lara na Meta.
 * Se encontrar algum REJECTED, exclui e reenvia automaticamente com a
 * definição corrigida (allow_category_change: true + texto limpo).
 *
 * Padrão: igual ao dailySyncScheduler — tick a cada 60s, controle de estado.
 */

import { env } from "../../config/env.js";
import {
  isWhatsAppConfigured,
  listTemplates,
  LARA_TEMPLATES,
  WaTemplateRecord,
  WaTemplateCreateResponse,
} from "./whatsappTemplateManager.js";
import { laraOperationalStore } from "./operationalStore.js";

type LoggerLike = {
  info?:  (payload: Record<string, unknown>, message?: string) => void;
  warn?:  (payload: Record<string, unknown>, message?: string) => void;
  error?: (payload: Record<string, unknown>, message?: string) => void;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const TICK_MS            = 60_000;           // tick a cada minuto
const CHECK_INTERVAL_MS  = 60 * 60 * 1000;  // executa a cada 1 hora
const MAX_FIX_ATTEMPTS   = 3;               // máximo de tentativas por template
const DELETE_WAIT_MS     = 8_000;           // aguarda propagação da exclusão

const LARA_TEMPLATE_NAMES = new Set(LARA_TEMPLATES.map((t) => t.name));

// ─── Helpers da Graph API (local, para suportar hsm_id na exclusão) ───────────

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${path}`;
}

async function graphDelete(path: string): Promise<{ success: boolean }> {
  const resp = await fetch(graphUrl(path), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const body = await resp.json() as Record<string, unknown>;
  if (!resp.ok) {
    const err = (body.error as Record<string, unknown>) ?? {};
    throw new Error(`Meta DELETE ${resp.status}: ${err.message ?? JSON.stringify(body)}`);
  }
  return body as { success: boolean };
}

async function graphPost<T>(path: string, data: unknown): Promise<T> {
  const resp = await fetch(graphUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  const body = await resp.json() as Record<string, unknown>;
  if (!resp.ok) {
    const err = (body.error as Record<string, unknown>) ?? {};
    throw new Error(`Meta POST ${resp.status} (${err.error_subcode ?? ""}): ${err.error_user_msg ?? err.message ?? JSON.stringify(body)}`);
  }
  return body as T;
}

// ─── Lógica de correção ───────────────────────────────────────────────────────

const fixAttempts = new Map<string, number>();

async function fixAndResubmit(
  rejected: WaTemplateRecord,
  logger?: LoggerLike,
): Promise<void> {
  const name     = rejected.name;
  const attempts = fixAttempts.get(name) ?? 0;

  if (attempts >= MAX_FIX_ATTEMPTS) {
    logger?.warn?.(
      { modulo: "wa-template-monitor", template: name, attempts, rejected_reason: rejected.rejected_reason },
      "Template rejeitado: limite de tentativas atingido — intervencao manual necessaria",
    );
    return;
  }

  const def = LARA_TEMPLATES.find((t) => t.name === name);
  if (!def) {
    logger?.warn?.({ modulo: "wa-template-monitor", template: name }, "Definicao do template nao encontrada em LARA_TEMPLATES");
    return;
  }

  logger?.info?.(
    { modulo: "wa-template-monitor", template: name, rejected_reason: rejected.rejected_reason, attempt: attempts + 1 },
    "Iniciando correcao automatica de template rejeitado",
  );

  fixAttempts.set(name, attempts + 1);

  try {
    // 1. Excluir template rejeitado (usando name + hsm_id para garantir)
    const deletePath = `/${env.WHATSAPP_WABA_ID}/message_templates?name=${encodeURIComponent(name)}&hsm_id=${rejected.id}`;
    await graphDelete(deletePath);
    logger?.info?.({ modulo: "wa-template-monitor", template: name }, "Template rejeitado excluido");

    // 2. Aguardar propagação da exclusão no lado do Meta
    await new Promise((r) => setTimeout(r, DELETE_WAIT_MS));

    // 3. Reenviar com allow_category_change: true (permite que a Meta corrija a categoria se necessário)
    const fixedDef = { ...def, allow_category_change: true };
    const result = await graphPost<WaTemplateCreateResponse>(
      `/${env.WHATSAPP_WABA_ID}/message_templates`,
      fixedDef,
    );

    logger?.info?.(
      { modulo: "wa-template-monitor", template: name, newStatus: result.status, newCategory: result.category, id: result.id, attempt: attempts + 1 },
      "Template corrigido e reenviado com sucesso",
    );

    await laraOperationalStore.addIntegrationLog({
      integracao:        "whatsapp-meta",
      tipo:              "template-auto-fix",
      request_json:      { template: name, rejected_reason: rejected.rejected_reason, attempt: attempts + 1 },
      response_json:     result as unknown as Record<string, unknown>,
      status_operacao:   "corrigido",
      idempotency_key:   `wa-template-fix:${name}:${attempts + 1}:${Date.now()}`,
    });

    // Reset contador de tentativas em caso de sucesso
    fixAttempts.delete(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error?.(
      { modulo: "wa-template-monitor", template: name, erro: message, attempt: attempts + 1 },
      "Falha ao corrigir e reenviar template",
    );

    await laraOperationalStore.addIntegrationLog({
      integracao:        "whatsapp-meta",
      tipo:              "template-auto-fix",
      request_json:      { template: name, rejected_reason: rejected.rejected_reason, attempt: attempts + 1 },
      status_operacao:   "erro",
      erro_resumo:       message.slice(0, 900),
      idempotency_key:   `wa-template-fix-erro:${name}:${attempts + 1}:${Date.now()}`,
    });
  }
}

// ─── Verificação completa ─────────────────────────────────────────────────────

async function runCheck(logger?: LoggerLike): Promise<void> {
  if (!isWhatsAppConfigured()) return;

  let all: WaTemplateRecord[];
  try {
    all = await listTemplates();
  } catch (err) {
    logger?.error?.(
      { modulo: "wa-template-monitor", erro: err instanceof Error ? err.message : String(err) },
      "Falha ao listar templates da Meta",
    );
    return;
  }

  const laraTemplates = all.filter((t) => LARA_TEMPLATE_NAMES.has(t.name));

  const summary = {
    total:    LARA_TEMPLATE_NAMES.size,
    approved: laraTemplates.filter((t) => t.status === "APPROVED").length,
    pending:  laraTemplates.filter((t) => t.status === "PENDING").length,
    rejected: laraTemplates.filter((t) => t.status === "REJECTED").length,
    missing:  LARA_TEMPLATE_NAMES.size - laraTemplates.length,
  };

  logger?.info?.(
    { modulo: "wa-template-monitor", ...summary },
    "Verificacao de templates WhatsApp concluida",
  );

  // Corrigir todos os rejeitados
  const rejected = laraTemplates.filter((t) => t.status === "REJECTED");
  for (const tmpl of rejected) {
    await fixAndResubmit(tmpl, logger);
  }

  // Alertar sobre templates faltando (nunca foram criados)
  if (summary.missing > 0) {
    const existingNames = new Set(laraTemplates.map((t) => t.name));
    const missing = [...LARA_TEMPLATE_NAMES].filter((n) => !existingNames.has(n));
    logger?.warn?.(
      { modulo: "wa-template-monitor", missing },
      "Templates da Lara ausentes no WABA — execute submitLaraTemplates() para recriar",
    );
  }

  // Log estruturado de status de cada template
  await laraOperationalStore.addIntegrationLog({
    integracao:      "whatsapp-meta",
    tipo:            "template-monitor-check",
    request_json:    { timestamp: new Date().toISOString() },
    response_json:   {
      summary,
      templates: laraTemplates.map((t) => ({
        name:     t.name,
        status:   t.status,
        category: t.category,
        rejected_reason: t.rejected_reason ?? null,
      })),
    } as unknown as Record<string, unknown>,
    status_operacao: rejected.length > 0 ? "alerta" : "ok",
    idempotency_key: `wa-template-check:${Date.now()}`,
  });
}

// ─── Scheduler público ────────────────────────────────────────────────────────

export function startWhatsAppTemplateMonitor(logger?: LoggerLike): () => void {
  let stopped   = false;
  let running   = false;
  let lastRunAt = 0;

  const runTick = async (): Promise<void> => {
    if (stopped || running) return;
    if (!isWhatsAppConfigured()) return;

    const elapsed = Date.now() - lastRunAt;
    if (elapsed < CHECK_INTERVAL_MS) return;

    running   = true;
    lastRunAt = Date.now();

    try {
      await runCheck(logger);
    } catch (err) {
      logger?.error?.(
        { modulo: "wa-template-monitor", erro: err instanceof Error ? err.message : String(err) },
        "Excecao inesperada no monitor de templates",
      );
    } finally {
      running = false;
    }
  };

  // Executa imediatamente ao iniciar (verifica estado atual dos templates)
  void runTick();

  const timer = setInterval(() => {
    void runTick();
  }, TICK_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
