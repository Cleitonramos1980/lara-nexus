import { laraOperationalStore } from "./operationalStore.js";
import { laraService } from "./service.js";
import { dateToIsoDate, dateToIsoDateTime, makeIdempotencyKey } from "./utils.js";
import { sendTextMessage, isWhatsAppConfigured } from "./whatsappTemplateManager.js";
import { markPromiseBroken, resolveOutcome } from "./outcomeTracker.js";
import { isPilotAllowed, getPilotCodclis } from "../../config/env.js";

type LoggerLike = {
  info?: (payload: Record<string, unknown>, message?: string) => void;
  warn?: (payload: Record<string, unknown>, message?: string) => void;
  error?: (payload: Record<string, unknown>, message?: string) => void;
};

type PromiseFollowupSettings = {
  enabled: boolean;
  intervalMin: number;
};

const DEFAULT_INTERVAL_MIN = 10;
const TICK_MS = 60_000;

function parseBooleanConfig(value: string | null | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumberConfig(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const int = Math.trunc(parsed);
  return Math.max(min, Math.min(max, int));
}

function formatMoneyBr(value: number): string {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBr(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  // Parse YYYY-MM-DD without timezone shift
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleDateString("pt-BR");
}

async function loadSettings(): Promise<PromiseFollowupSettings> {
  const [enabledCfg, intervalCfg] = await Promise.all([
    laraOperationalStore.getConfiguracao("LARA_PROMESSA_FOLLOWUP_ATIVO"),
    laraOperationalStore.getConfiguracao("LARA_PROMESSA_FOLLOWUP_INTERVAL_MIN"),
  ]);
  return {
    enabled: parseBooleanConfig(enabledCfg, true),
    intervalMin: parseNumberConfig(intervalCfg, DEFAULT_INTERVAL_MIN, 1, 180),
  };
}

function isOpenPromiseStatus(status: string): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return true;
  return !["paga", "cancelada", "acordo_fechado", "encerrada", "followup_realizado"].includes(normalized);
}

async function dispatchPaymentForPromise(
  promessa: {
    id: string;
    wa_id: string;
    codcli: number | null;
    cliente: string;
    duplicatas: string;
    valor_total: number;
    data_prometida: string | Date | null;
  },
  logger?: LoggerLike,
): Promise<"enviado" | "sem_wa" | "erro"> {
  const codcli = Number(promessa.codcli ?? 0);

  // Modo piloto: bloqueia envio para codcli não autorizado
  if (!isPilotAllowed(codcli)) {
    logger?.info?.({
      modulo: "lara-promessa-followup",
      promessa_id: promessa.id,
      codcli,
      pilot_codclis: Array.from(getPilotCodclis()),
    }, "[PILOTO] Follow-up bloqueado — codcli não autorizado no modo piloto");
    return "sem_wa";
  }

  const cliente = codcli > 0 ? await laraService.getCliente(codcli) : null;
  const clienteNome = cliente?.cliente || promessa.cliente || "cliente";
  const waId = promessa.wa_id || cliente?.wa_id || "";

  // Não disparar PIX se cliente não tem saldo em aberto (títulos já quitados)
  if (codcli > 0 && cliente && (cliente.total_aberto ?? 0) <= 0) {
    logger?.info?.({
      modulo: "lara-promessa-followup",
      promessa_id: promessa.id,
      codcli,
    }, "Promessa encerrada: cliente sem saldo em aberto");
    await laraOperationalStore.updatePromessaStatus(promessa.id, "encerrada").catch(() => {});
    return "enviado";
  }

  if (!waId || !isWhatsAppConfigured()) {
    await laraService.createCase({
      wa_id: waId,
      codcli: codcli > 0 ? codcli : undefined,
      cliente: clienteNome,
      tipo_case: "PROMESSA_VENCIDA_FOLLOWUP",
      etapa: cliente?.etapa_regua || "",
      duplicatas: promessa.duplicatas || "",
      valor_total: Number(promessa.valor_total ?? 0),
      forma_pagamento: "",
      detalhe: `Follow-up automatico de promessa vencida (promessa ${promessa.id}).`,
      origem: "scheduler-promessa",
      responsavel: "Lara Scheduler",
      status: "pendente",
    });
    return "sem_wa";
  }

  const duplicatasList = promessa.duplicatas
    ? String(promessa.duplicatas).split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  try {
    const payload = await laraService.enviarPagamento("pix", {
      wa_id: waId,
      codcli,
      duplicatas: duplicatasList.length ? duplicatasList : undefined,
      origem: "scheduler-promessa",
      solicitante: "Lara Scheduler",
    });

    const nome = clienteNome.split(" ")[0];
    const totalFmt = formatMoneyBr(payload.total);

    let mensagemTexto: string;
    let codigoPagamento = "";

    if (payload.tipo === "pix") {
      mensagemTexto = `Ola ${nome}! Chegou o dia que voce havia agendado para efetuar o pagamento. Segue o PIX no valor de ${totalFmt}:\n\nPIX copia e cola:`;
      codigoPagamento = payload.pix_copia_cola || "";
    } else if (payload.tipo === "bolepix") {
      mensagemTexto = `Ola ${nome}! Chegou o dia que voce havia agendado para efetuar o pagamento. Segue o BolePix no valor de ${totalFmt}:\n\nPIX copia e cola:`;
      codigoPagamento = payload.pix_copia_cola || payload.linha_digitavel || "";
    } else {
      mensagemTexto = `Ola ${nome}! Chegou o dia que voce havia agendado para efetuar o pagamento. Segue o boleto no valor de ${totalFmt}:\n\nLinha digitavel:`;
      codigoPagamento = payload.linha_digitavel || "";
      if (payload.url_boleto) mensagemTexto += `\nURL: ${payload.url_boleto}`;
    }

    await sendTextMessage(waId, mensagemTexto);
    if (codigoPagamento) {
      await new Promise((r) => setTimeout(r, 800));
      await sendTextMessage(waId, codigoPagamento);
    }
    await laraOperationalStore.updatePromessaStatus(promessa.id, "followup_realizado");
    return "enviado";

  } catch (pixErr) {
    logger?.error?.({
      modulo: "lara-promessa-followup",
      promessa_id: promessa.id,
      erro: String(pixErr),
    }, "Falha ao gerar pagamento para follow-up, enviando lembrete de fallback");

    // Fallback: send reminder asking client to choose payment method
    const nome = clienteNome.split(" ")[0];
    const valorFmt = formatMoneyBr(Number(promessa.valor_total ?? 0));
    const dataFmt = formatDateBr(dateToIsoDate(promessa.data_prometida));
    const fallbackMsg = `Ola ${nome}! Chegou o dia ${dataFmt} que voce havia agendado para efetuar o pagamento. O valor em aberto e ${valorFmt}. Responda com "PIX" ou "boleto" para receber o codigo de pagamento.`;

    try {
      await sendTextMessage(waId, fallbackMsg);
      await laraOperationalStore.updatePromessaStatus(promessa.id, "followup_realizado");
      return "enviado";
    } catch (sendErr) {
      logger?.error?.({
        modulo: "lara-promessa-followup",
        promessa_id: promessa.id,
        erro: String(sendErr),
      }, "Falha ao enviar mensagem de fallback de promessa");
      return "erro";
    }
  }
}

export function startLaraPromiseFollowupScheduler(logger?: LoggerLike): () => void {
  let stopped = false;
  let running = false;
  let lastRunAtMs = 0;

  const runTick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const settings = await loadSettings();
      if (!settings.enabled) return;
      if (Date.now() - lastRunAtMs < settings.intervalMin * 60_000) return;

      const today = dateToIsoDate(new Date());
      const promessas = await laraOperationalStore.listPromessas();
      const duePromises = promessas.filter((item) => {
        if (!isOpenPromiseStatus(item.status)) return false;
        const dataPrometida = dateToIsoDate(item.data_prometida);
        return Boolean(dataPrometida) && dataPrometida <= today;
      });

      let processed = 0;
      let skipped = 0;
      let semWa = 0;
      let erros = 0;

      for (const promessa of duePromises) {
        const idempotencyKey = `promessa-followup:${promessa.id}`;
        const alreadyProcessed = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
        if (alreadyProcessed) {
          skipped += 1;
          continue;
        }

        const result = await dispatchPaymentForPromise(promessa, logger);

        if (result === "enviado") {
          processed += 1;
          if (promessa.wa_id) {
            void resolveOutcome({
              wa_id: promessa.wa_id,
              outcome: "respondeu",
              correlation_id: promessa.id,
            }).catch(() => {});
          }
        } else if (result === "sem_wa") {
          semWa += 1;
        } else {
          erros += 1;
        }

        // Só grava idempotency se processado com sucesso ou sem_wa (sem retry possível).
        // Em caso de erro (falha de rede/API), NÃO grava — permite nova tentativa no próximo tick.
        if (result !== "erro") {
          await laraOperationalStore.addIntegrationLog({
            integracao: "lara-promessas",
            tipo: "promessa-followup",
            request_json: {
              promessa_id: promessa.id,
              codcli: Number(promessa.codcli ?? 0) || null,
              data_prometida: dateToIsoDate(promessa.data_prometida),
              duplicatas: promessa.duplicatas || "",
            },
            response_json: {
              status: result,
              dispatched_at: dateToIsoDateTime(new Date()),
            },
            status_operacao: "processado",
            idempotency_key: idempotencyKey,
          });
        }
      }

      // Identifica promessas já vencidas há 2+ dias e que ainda não foram pagas — marcada como não cumprida
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const twoDaysAgoStr = dateToIsoDate(twoDaysAgo);
      const allOpenPromessas = await laraOperationalStore.listPromessas();
      for (const p of allOpenPromessas) {
        if (!isOpenPromiseStatus(p.status)) continue;
        const dataPrometida = dateToIsoDate(p.data_prometida);
        if (!dataPrometida || dataPrometida > twoDaysAgoStr) continue;
        // Promessa vencida há mais de 2 dias sem confirmação de pagamento → não cumprida
        if (p.wa_id) {
          void markPromiseBroken(p.wa_id, p.id).catch(() => {});
        }
        await laraOperationalStore.updatePromessaStatus(p.id, "nao_cumprida").catch(() => {});
      }

      lastRunAtMs = Date.now();
      if (processed > 0 || skipped > 0 || semWa > 0 || erros > 0) {
        logger?.info?.(
          {
            modulo: "lara-promessa-followup",
            processed,
            skipped,
            sem_wa: semWa,
            erros,
            total_due: duePromises.length,
            executed_at: dateToIsoDateTime(new Date()),
          },
          "Scheduler de follow-up de promessas executado",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error?.(
        {
          modulo: "lara-promessa-followup",
          erro: message,
        },
        "Falha no scheduler de follow-up de promessas",
      );
    } finally {
      running = false;
    }
  };

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
