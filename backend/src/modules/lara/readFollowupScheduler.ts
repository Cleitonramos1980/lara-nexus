/**
 * Lara — Scheduler de Follow-up de Leitura
 *
 * Se uma mensagem da régua foi enviada mas o cliente não respondeu em 4h,
 * envia uma segunda mensagem curta no mesmo canal — lembrando sem ser agressivo.
 *
 * Lógica:
 *  1. A cada 30 min verifica mensagens OUTBOUND de origem "regua-consolidado"
 *     enviadas entre 4h e 12h atrás.
 *  2. Para cada uma, verifica se houve alguma resposta INBOUND do mesmo wa_id
 *     depois do envio.
 *  3. Se não houve resposta, envia um follow-up curto e marca idempotência.
 */

import { laraOperationalStore } from "./operationalStore.js";
import { dateToIsoDateTime, makeIdempotencyKey } from "./utils.js";
import { sendTextMessage, isWhatsAppConfigured } from "./whatsappTemplateManager.js";
import { sendText as uazapiSendText, isUazapiConfigured } from "./uazapiService.js";
import { isPilotAllowed } from "../../config/env.js";

type LoggerLike = {
  info?:  (p: Record<string, unknown>, msg?: string) => void;
  warn?:  (p: Record<string, unknown>, msg?: string) => void;
  error?: (p: Record<string, unknown>, msg?: string) => void;
};

const TICK_MS              = 30 * 60 * 1000; // roda a cada 30 minutos
const FOLLOWUP_AFTER_MS    = 4 * 60 * 60 * 1000;  // 4 horas sem resposta
const FOLLOWUP_CUTOFF_MS   = 12 * 60 * 60 * 1000; // não faz follow-up após 12h
const ORIGENS_REGUA        = new Set(["regua-consolidado"]);

// Mensagens de follow-up variadas (evita parecer bot repetitivo)
const FOLLOWUP_MSGS = [
  "Oi! So passando para checar se voce viu nossa mensagem. Posso te ajudar a regularizar seu titulo de forma facil e rapida. Responda *PIX* ou *BOLETO* a qualquer momento!",
  "Ola! Notei que ainda nao regularizamos seu titulo. Caso tenha duvidas ou precise de outra opcao de pagamento, e so responder aqui!",
  "Oi! Seu titulo ainda esta em aberto. Se preferir, posso enviar o codigo PIX agora mesmo — e so responder *PIX* 🙂",
];

function selectFollowupMsg(waId: string): string {
  let h = 5381;
  for (let i = 0; i < waId.length; i++) h = ((h << 5) + h) ^ waId.charCodeAt(i);
  return FOLLOWUP_MSGS[Math.abs(h) % FOLLOWUP_MSGS.length];
}

async function runFollowupCheck(logger?: LoggerLike): Promise<void> {
  if (!isUazapiConfigured() && !isWhatsAppConfigured()) return;

  const now = Date.now();
  const cutoffOld = new Date(now - FOLLOWUP_CUTOFF_MS); // mais de 12h → ignora
  const cutoffNew = new Date(now - FOLLOWUP_AFTER_MS);  // menos de 4h → ainda cedo

  // Busca todas as mensagens recentes (limite 3000 para não pesar demais)
  const allMsgs = await laraOperationalStore.listAllMessages(3000);

  // Filtra apenas OUTBOUND da régua dentro da janela 4h–12h
  const candidatos = allMsgs.filter((m) => {
    if (String(m.direction).toUpperCase() !== "OUTBOUND") return false;
    if (!ORIGENS_REGUA.has(m.origem)) return false;
    const sentTs = new Date(m.sent_at || m.created_at);
    if (!Number.isFinite(sentTs.getTime())) return false;
    return sentTs <= cutoffNew && sentTs >= cutoffOld;
  });

  if (candidatos.length === 0) return;

  // Índice de mensagens INBOUND por wa_id (para checagem rápida)
  const inboundByWaId = new Map<string, Date>();
  for (const m of allMsgs) {
    if (String(m.direction).toUpperCase() !== "INBOUND") continue;
    const ts = new Date(m.received_at || m.created_at);
    if (!Number.isFinite(ts.getTime())) continue;
    const existing = inboundByWaId.get(m.wa_id);
    if (!existing || ts > existing) inboundByWaId.set(m.wa_id, ts);
  }

  let enviados = 0;
  let ignorados = 0;

  for (const msg of candidatos) {
    const waId = msg.wa_id;
    if (!waId) { ignorados++; continue; }

    const codcli = Number(msg.codcli ?? 0);
    if (codcli > 0 && !isPilotAllowed(codcli)) { ignorados++; continue; }

    // Verificar idempotência
    const idemKey = makeIdempotencyKey(["read-followup", waId, msg.idempotency_key || msg.id]);
    const alreadySent = await laraOperationalStore.findIntegrationByIdempotency(idemKey).catch(() => null);
    if (alreadySent) { ignorados++; continue; }

    // Verificar se o cliente já respondeu depois do envio
    const sentAt = new Date(msg.sent_at || msg.created_at);
    const lastInbound = inboundByWaId.get(waId);
    if (lastInbound && lastInbound > sentAt) {
      // Cliente já respondeu — não precisa de follow-up
      ignorados++;
      continue;
    }

    // Verificar opt-out
    const optout = await laraOperationalStore.findActiveOptoutByWaId(waId).catch(() => null);
    if (optout?.ativo) { ignorados++; continue; }

    // Enviar follow-up
    const followupMsg = selectFollowupMsg(waId);
    try {
      if (isUazapiConfigured()) {
        await uazapiSendText(waId, followupMsg);
      } else {
        await sendTextMessage(waId, followupMsg);
      }

      await laraOperationalStore.addIntegrationLog({
        integracao:      "read-followup",
        tipo:            "followup-leitura",
        request_json:    { wa_id: waId, codcli, sent_at: msg.sent_at, original_msg_id: msg.id },
        response_json:   { followup_at: dateToIsoDateTime(new Date()), msg: followupMsg.slice(0, 100) },
        status_operacao: "enviado",
        idempotency_key: idemKey,
      });

      await laraOperationalStore.addMessageLog({
        wa_id:           waId,
        codcli:          codcli || null,
        cliente:         msg.cliente || "",
        telefone:        msg.telefone || "",
        message_text:    followupMsg,
        direction:       "OUTBOUND",
        origem:          "read-followup",
        etapa:           msg.etapa || "",
        duplics:         msg.duplics || "",
        valor_total:     msg.valor_total || 0,
        payload_json:    JSON.stringify({ acao: "followup_leitura", original_msg_id: msg.id }),
        status:          "enviado",
        sent_at:         dateToIsoDateTime(new Date()),
        received_at:     "",
        message_type:    "texto",
        operator_name:   "Lara Automacao",
        idempotency_key: idemKey + ":msg",
      });

      enviados++;
    } catch (err) {
      logger?.error?.({
        modulo:  "read-followup",
        wa_id:   waId,
        codcli,
        erro:    String(err),
      }, "Falha ao enviar follow-up de leitura");
      ignorados++;
    }
  }

  if (enviados > 0) {
    logger?.info?.({
      modulo:    "read-followup",
      enviados,
      ignorados,
      candidatos: candidatos.length,
    }, "Follow-up de leitura executado");
  }
}

export function startLaraReadFollowupScheduler(logger?: LoggerLike): () => void {
  let stopped = false;
  let running = false;

  const runTick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const enabled = await laraOperationalStore.getConfiguracao("LARA_READ_FOLLOWUP_ATIVO").catch(() => null);
      if (enabled === "0" || enabled === "false" || enabled === "off") return;
      await runFollowupCheck(logger);
    } catch (err) {
      logger?.error?.({
        modulo: "read-followup",
        erro:   String(err),
      }, "Falha no scheduler de follow-up de leitura");
    } finally {
      running = false;
    }
  };

  // Primeira execução após 5 min (aguarda sistema inicializar)
  const initialTimer = setTimeout(() => void runTick(), 5 * 60 * 1000);
  const timer = setInterval(() => void runTick(), TICK_MS);

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(timer);
  };
}
