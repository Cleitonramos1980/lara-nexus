/**
 * Lara — Scheduler Autônomo da Régua de Cobrança
 *
 * Roda diariamente na hora configurada, percorre todos os clientes elegíveis
 * e dispara UMA mensagem consolidada por cliente (todos os títulos em aberto
 * numa única mensagem, ou o template da etapa quando há apenas um título).
 *
 * Toda a lógica de negócio fica aqui — sem n8n externo.
 */

import { laraService } from "./service.js";
import { laraOperationalStore } from "./operationalStore.js";
import { dateToIsoDate, dateToIsoDateTime, makeIdempotencyKey } from "./utils.js";
import { isWhatsAppConfigured } from "./whatsappTemplateManager.js";

type LoggerLike = {
  info?:  (p: Record<string, unknown>, msg?: string) => void;
  warn?:  (p: Record<string, unknown>, msg?: string) => void;
  error?: (p: Record<string, unknown>, msg?: string) => void;
};

type ReguaSettings = {
  enabled:    boolean;
  hour:       number;
  minute:     number;
  timeZone:   string;
  delayMs:    number; // pausa entre envios (ms) — evita throttle da Meta
  etapas:     Set<string>;
};

// Janela de supressão por etapa: não reenvia para o mesmo cliente na mesma etapa
// enquanto não expirar o período (evita spam em caso de reexecução no mesmo dia).
const SUPRESSAO_DIAS: Record<string, number> = {
  "D-3":  1,
  "D0":   1,
  "D+3":  6,
  "D+7":  6,
  "D+15": 13,
  "D+30": 28,
};

const TICK_MS           = 60_000;
const RETRY_AFTER_MS    = 15 * 60 * 1000;
const ETAPAS_DEFAULT    = new Set(["D-3", "D0", "D+3", "D+7", "D+15", "D+30"]);

function parseBool(v: string | null | undefined, fallback: boolean): boolean {
  if (!v) return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "sim", "yes", "on"].includes(s)) return true;
  if (["0", "false", "nao", "no", "off"].includes(s)) return false;
  return fallback;
}

function parseInt2(v: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getDateParts(now: Date, tz: string): { hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = new Map(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    hour:    Number(parts.get("hour")   ?? "0"),
    minute:  Number(parts.get("minute") ?? "0"),
    dateKey: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
  };
}

async function loadSettings(): Promise<ReguaSettings> {
  const cfgs = await laraOperationalStore.listConfiguracoes().catch(() => [] as { chave: string; valor: string }[]);
  const m = new Map(cfgs.map((c) => [String(c.chave).toUpperCase(), String(c.valor)]));

  const etapasRaw = m.get("LARA_REGUA_ETAPAS");
  const etapas = etapasRaw
    ? new Set(etapasRaw.split(",").map((e) => e.trim()).filter(Boolean))
    : ETAPAS_DEFAULT;

  return {
    enabled:  parseBool(m.get("LARA_REGUA_ATIVO"), true),
    hour:     parseInt2(m.get("LARA_REGUA_HORA"),   8,  0, 23),
    minute:   parseInt2(m.get("LARA_REGUA_MINUTO"), 0,  0, 59),
    timeZone: m.get("LARA_SYNC_DAILY_TIMEZONE") ?? "America/Sao_Paulo",
    delayMs:  parseInt2(m.get("LARA_REGUA_DELAY_MS"), 200, 0, 5000),
    etapas,
  };
}

/** Chave de supressão: impede reenvio para o mesmo cliente/etapa dentro da janela configurada. */
function supressaoKey(codcli: string | number, etapa: string): string {
  const diasJanela = SUPRESSAO_DIAS[etapa] ?? 6;
  const msJanela   = diasJanela * 24 * 60 * 60 * 1000;
  const janela     = Math.floor(Date.now() / msJanela);
  return makeIdempotencyKey(["regua-scheduler", String(codcli), etapa, String(janela)]);
}

async function executarRegua(logger?: LoggerLike): Promise<void> {
  if (!isWhatsAppConfigured()) {
    logger?.warn?.({ modulo: "regua-scheduler" }, "WhatsApp nao configurado — régua ignorada.");
    return;
  }

  const settings = await loadSettings();
  const etapasAtivas = settings.etapas;

  // Carrega todos os clientes com títulos em aberto
  const clientes = await laraService.listClientes({});

  let enviado = 0;
  let pulado  = 0;
  let optout  = 0;
  let semWa   = 0;
  let erros   = 0;

  const MAX_TITULOS_POR_CLIENTE = await laraOperationalStore
    .getConfiguracao("LARA_REGUA_MAX_TITULOS")
    .then((v) => Math.max(1, Math.min(500, Number(v ?? 20))))
    .catch(() => 20);

  for (const cliente of clientes) {
    // Filtra por etapa configurada
    if (!etapasAtivas.has(cliente.etapa_regua)) {
      pulado++;
      continue;
    }

    if (cliente.optout) {
      optout++;
      continue;
    }

    if (!cliente.wa_id && !cliente.telefone) {
      semWa++;
      continue;
    }

    // Clientes com muitos títulos são pulados (carteiras grandes, empresas, etc.)
    if ((cliente.qtd_titulos ?? 0) > MAX_TITULOS_POR_CLIENTE) {
      pulado++;
      continue;
    }

    // Supressão por janela: já foi enviado nesta janela de tempo para esta etapa?
    const key = supressaoKey(cliente.codcli, cliente.etapa_regua);
    const jaEnviado = await laraOperationalStore.findIntegrationByIdempotency(key).catch(() => null);
    if (jaEnviado) {
      pulado++;
      continue;
    }

    try {
      const result = await laraService.dispararReguaClienteConsolidado({ codcli: Number(cliente.codcli) });

      if (result.status === "ok") {
        enviado++;
        await laraOperationalStore.addIntegrationLog({
          integracao:       "regua-scheduler",
          tipo:             "disparo-regua",
          request_json:     { codcli: cliente.codcli, etapa: result.etapa, wa_id: result.wa_id },
          response_json:    { wamid: result.wamid, titulos_count: result.titulos_count, mensagem: result.mensagem?.slice(0, 200) },
          status_operacao:  "enviado",
          idempotency_key:  key,
        });
      } else if (result.status === "optout") {
        optout++;
      } else if (result.status === "sem_wa_id") {
        semWa++;
      } else {
        pulado++;
      }
    } catch (err) {
      erros++;
      logger?.error?.({
        modulo:  "regua-scheduler",
        codcli:  cliente.codcli,
        etapa:   cliente.etapa_regua,
        erro:    String(err),
      }, "Erro ao disparar regua para cliente");
    }

    // Pausa entre envios para respeitar rate limit da Meta
    if (settings.delayMs > 0) {
      await new Promise((r) => setTimeout(r, settings.delayMs));
    }
  }

  const totalElegivel = clientes.filter((c) => etapasAtivas.has(c.etapa_regua)).length;

  // Registra sumário de execução
  await laraOperationalStore.addReguaExecucao({
    etapa:             Array.from(etapasAtivas).join(","),
    elegivel:          totalElegivel,
    disparada:         enviado,
    respondida:        0,
    convertida:        0,
    erro:              erros,
    bloqueado_optout:  optout,
    valor_impactado:   0,
    status:            erros > 0 ? "concluido_com_erros" : "concluido",
    detalhes_json:     { pulado, sem_wa: semWa, total_clientes: clientes.length },
  });

  logger?.info?.({
    modulo:    "regua-scheduler",
    enviado,
    pulado,
    optout,
    sem_wa:    semWa,
    erros,
    elegivel:  totalElegivel,
  }, "Regua de cobranca executada");
}

export function startLaraReguaScheduler(logger?: LoggerLike): () => void {
  let stopped      = false;
  let running      = false;
  let retryAfterMs = 0;
  let lastDateKey  = "";

  const runTick = async (reason: "startup" | "timer"): Promise<void> => {
    if (stopped || running) return;
    if (Date.now() < retryAfterMs) return;

    let settings: ReguaSettings;
    try {
      settings = await loadSettings();
    } catch {
      return;
    }

    if (!settings.enabled) return;

    let parts: ReturnType<typeof getDateParts>;
    try {
      parts = getDateParts(new Date(), settings.timeZone);
    } catch {
      parts = getDateParts(new Date(), "UTC");
    }

    const reachedSchedule = parts.hour > settings.hour
      || (parts.hour === settings.hour && parts.minute >= settings.minute);

    if (!reachedSchedule) return;

    // Uma execução por dia (a chave muda à meia-noite)
    if (lastDateKey === parts.dateKey) return;

    running = true;
    lastDateKey = parts.dateKey;
    try {
      await executarRegua(logger);
      retryAfterMs = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      retryAfterMs = Date.now() + RETRY_AFTER_MS;
      lastDateKey = ""; // permite nova tentativa após RETRY_AFTER_MS
      logger?.error?.({ modulo: "regua-scheduler", erro: msg }, "Falha na execucao da regua de cobranca");
    } finally {
      running = false;
    }
  };

  void runTick("startup");
  const timer = setInterval(() => void runTick("timer"), TICK_MS);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
