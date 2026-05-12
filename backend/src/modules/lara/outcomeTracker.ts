/**
 * Lara — Outcome Tracker
 *
 * Registra o resultado real de cada ação tomada pela Lara (enviou PIX → cliente pagou?
 * registrou promessa → cumpriu?). É a fonte primária de verdade para o learningEngine
 * calcular quais padrões realmente funcionam.
 *
 * Tabela Oracle: LARA_OUTCOME_TRACKING
 * Fallback: memória (array em processo)
 */

import { laraOperationalStore } from "./operationalStore.js";
import { generateLaraId, dateToIsoDateTime } from "./utils.js";

export type OutcomeType =
  | "pagou"              // cliente confirmou pagamento (PIX webhook / boleto confirmado)
  | "prometeu_cumpriu"   // promessa de pagamento foi cumprida
  | "prometeu_nao_cumpriu" // promessa não foi cumprida no prazo
  | "respondeu"          // cliente respondeu (mas não pagou ainda)
  | "respondeu_diferente"  // cliente pediu ação diferente da classificada (sinal de erro NLU)
  | "ignorou"            // sem resposta após 24h
  | "escalou"            // encaminhou para humano
  | "optout";            // cliente pediu para não receber mais mensagens

export type OutcomeRecord = {
  id: string;
  wa_id: string;
  codcli: number | null;
  etapa: string;
  risco: string;
  intent_classified: string;
  confidence: number;
  action_taken: string;
  hora_envio: number;     // 0-23
  dia_semana: number;     // 0=Dom … 6=Sab
  outcome: OutcomeType;
  correlation_id: string;
  created_at: string;
  resolved_at: string | null;
};

// ─── Memória fallback ──────────────────────────────────────────────────────────
const _memOutcomes: OutcomeRecord[] = [];
const MAX_MEM_OUTCOMES = 5000;

// ─── Pendentes não resolvidos (in-flight) ────────────────────────────────────
// Mantém em memória para lookup rápido ao resolver outcomes assíncronos
const _pendingByWaId = new Map<string, OutcomeRecord[]>();

// ─── Hook de resolução (evita circular dep com onlineLearner) ─────────────────
type ResolvedHook = (record: OutcomeRecord) => void;
let _resolvedHook: ResolvedHook | null = null;

export function setOutcomeResolvedHook(fn: ResolvedHook): void {
  _resolvedHook = fn;
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Registra uma nova ação tomada pela Lara. Fica "pendente" até ser resolvida
 * com um resultado concreto via `resolveOutcome()`.
 */
export async function trackAction(params: {
  wa_id: string;
  codcli?: number | null;
  etapa: string;
  risco: string;
  intent_classified: string;
  confidence: number;
  action_taken: string;
  correlation_id?: string;
}): Promise<string> {
  const now = new Date();
  const record: OutcomeRecord = {
    id: generateLaraId("OTK"),
    wa_id: params.wa_id,
    codcli: params.codcli ?? null,
    etapa: params.etapa || "desconhecida",
    risco: params.risco || "desconhecido",
    intent_classified: params.intent_classified || "neutro",
    confidence: Number(params.confidence.toFixed(4)),
    action_taken: params.action_taken,
    hora_envio: now.getHours(),
    dia_semana: now.getDay(),
    outcome: "ignorou", // default até resolução
    correlation_id: params.correlation_id || "",
    created_at: dateToIsoDateTime(now),
    resolved_at: null,
  };

  // Persiste no Oracle (ou cai em memória)
  await laraOperationalStore.insertOutcomeRecord(record).catch(() => {
    // Fallback para memória se Oracle indisponível
    _memOutcomes.unshift(record);
    if (_memOutcomes.length > MAX_MEM_OUTCOMES) _memOutcomes.length = MAX_MEM_OUTCOMES;
  });

  // Indexa em memória para lookup rápido
  const pending = _pendingByWaId.get(params.wa_id) ?? [];
  pending.push(record);
  _pendingByWaId.set(params.wa_id, pending);

  return record.id;
}

/**
 * Resolve o outcome de uma ação previamente rastreada.
 * Usa `correlation_id` para identificação precisa, ou o registro mais recente do wa_id.
 */
export async function resolveOutcome(params: {
  wa_id: string;
  outcome: OutcomeType;
  correlation_id?: string;
  resolved_at?: Date;
}): Promise<void> {
  const resolvedAt = dateToIsoDateTime(params.resolved_at ?? new Date());

  // Captura o registro pendente antes de resolver (para disparar o hook)
  const pending = _pendingByWaId.get(params.wa_id) ?? [];
  const target = params.correlation_id
    ? pending.find((r) => r.correlation_id === params.correlation_id)
    : pending[pending.length - 1];

  await laraOperationalStore.resolveOutcomeRecord({
    wa_id: params.wa_id,
    outcome: params.outcome,
    correlation_id: params.correlation_id,
    resolved_at: resolvedAt,
  }).catch(() => {
    if (target) {
      target.outcome = params.outcome;
      target.resolved_at = resolvedAt;
    }
  });

  // Dispara hook de aprendizado online (onlineLearner registra via setOutcomeResolvedHook)
  if (target && _resolvedHook) {
    const resolved: OutcomeRecord = { ...target, outcome: params.outcome, resolved_at: resolvedAt };
    try { _resolvedHook(resolved); } catch { /* nunca bloquear o fluxo principal */ }
  }

  // Remove do mapa de pendentes
  if (params.correlation_id) {
    const list = _pendingByWaId.get(params.wa_id);
    if (list) {
      const idx = list.findIndex((r) => r.correlation_id === params.correlation_id);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) _pendingByWaId.delete(params.wa_id);
    }
  }
}

/**
 * Atalho: registra que o cliente pagou (webhook PIX ou boleto confirmado).
 * Resolve todos os outcomes pendentes do wa_id como "pagou".
 */
export async function markAsPaid(wa_id: string, correlation_id?: string): Promise<void> {
  await resolveOutcome({ wa_id, outcome: "pagou", correlation_id });
}

/**
 * Atalho: o cliente respondeu com uma intenção diferente da classificada.
 * Sinal de erro de NLU — registra para o learningEngine ajustar lexicon.
 */
export async function markAsWrongClassification(params: {
  wa_id: string;
  original_action: string;
  corrected_intent: string;
  message_text: string;
  correlation_id?: string;
}): Promise<void> {
  await resolveOutcome({
    wa_id: params.wa_id,
    outcome: "respondeu_diferente",
    correlation_id: params.correlation_id,
  });

  // Registra para ajuste do lexicon via operationalStore
  await laraOperationalStore.insertNluCorrection({
    wa_id: params.wa_id,
    original_action: params.original_action,
    corrected_intent: params.corrected_intent,
    message_text: params.message_text.slice(0, 500),
  }).catch(() => {});
}

/**
 * Atalho: promessa de pagamento foi cumprida (detectada via webhook PIX ou sync).
 */
export async function markPromiseFulfilled(wa_id: string, correlation_id?: string): Promise<void> {
  await resolveOutcome({ wa_id, outcome: "prometeu_cumpriu", correlation_id });
}

/**
 * Atalho: promessa não foi cumprida no prazo (chamada pelo promiseFollowupScheduler).
 */
export async function markPromiseBroken(wa_id: string, correlation_id?: string): Promise<void> {
  await resolveOutcome({ wa_id, outcome: "prometeu_nao_cumpriu", correlation_id });
}

/**
 * Atalho: cliente ignorou a mensagem após janela de 24h.
 * Chamado pelo scheduler de timeout de resposta.
 */
export async function markAsIgnored(wa_id: string, older_than_hours = 24): Promise<void> {
  await laraOperationalStore.resolveTimedOutOutcomes(wa_id, older_than_hours).catch(() => {
    // Fallback memória
    const pending = _pendingByWaId.get(wa_id) ?? [];
    const cutoff = Date.now() - older_than_hours * 60 * 60 * 1000;
    for (const r of pending) {
      if (!r.resolved_at && new Date(r.created_at).getTime() < cutoff) {
        r.outcome = "ignorou";
        r.resolved_at = dateToIsoDateTime(new Date());
      }
    }
  });
}

/**
 * Retorna outcomes recentes para análise (usada pelo learningEngine).
 */
export async function listRecentOutcomes(diasRetroativos = 30): Promise<OutcomeRecord[]> {
  return laraOperationalStore.listOutcomeRecords(diasRetroativos).catch(() => {
    const cutoff = new Date(Date.now() - diasRetroativos * 24 * 60 * 60 * 1000).toISOString();
    return _memOutcomes.filter((r) => r.created_at >= cutoff);
  });
}
