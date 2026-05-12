/**
 * Lara — Abandonment Predictor (Survival Analysis)
 *
 * Modela o tempo até resposta usando distribuição exponencial:
 *   P(responde em até T horas) = 1 - exp(-lambda * T)
 *
 * lambda é estimado por MLE dos tempos de resposta reais em LARA_OUTCOME_TRACKING.
 * Lambda diferente por (etapa, risco, hora_bloco) para capturar padrões contextuais.
 *
 * Uso:
 *   - Prever quando abandonar a espera de uma resposta
 *   - Calcular urgência do próximo follow-up
 *   - Decidir se vale reenviar mensagem ou mudar canal
 */

import { laraOperationalStore } from "./operationalStore.js";
import type { OutcomeRecord } from "./outcomeTracker.js";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type AbandonmentPrediction = {
  p_respond_by: Record<string, number>; // ex: {"4h": 0.34, "8h": 0.55, "24h": 0.81}
  expected_response_hours: number;      // E[T] = 1/lambda
  should_followup_in_hours: number;     // T onde P(responder) = 0.5 (mediana)
  should_abandon: boolean;              // P(responder em 48h) < threshold
  lambda: number;                       // taxa estimada (respostas/hora)
  confidence: "high" | "medium" | "low";
};

type SurvivalParams = {
  lambda: number;
  n_samples: number;
  last_updated: string;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const MIN_SAMPLES = 10;
const DEFAULT_LAMBDA = 0.04;        // ~25h esperado se sem dados
const ABANDON_THRESHOLD = 0.25;     // P(resp em 48h) < 25% → abandon
const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const HORIZONS_H = [2, 4, 8, 12, 24, 48];

// ─── Estado ────────────────────────────────────────────────────────────────────

const _paramCache = new Map<string, SurvivalParams>();
let _lastSyncAt = 0;

// ─── MLE para Exponencial ───────────────────────────────────────────────────────

function estimateLambda(responseTimes: number[]): number {
  if (responseTimes.length === 0) return DEFAULT_LAMBDA;
  // MLE: lambda = n / sum(t_i)
  const sumT = responseTimes.reduce((s, t) => s + t, 0);
  return sumT > 0 ? responseTimes.length / sumT : DEFAULT_LAMBDA;
}

function contextKey(etapa: string, risco: string, horaBloco: number): string {
  return `${etapa.toLowerCase()}:${risco.toLowerCase()}:${horaBloco}`;
}

function getHoraBloco(hora: number): number {
  if (hora >= 0 && hora < 6) return 0;   // madrugada
  if (hora >= 6 && hora < 12) return 1;  // manhã
  if (hora >= 12 && hora < 18) return 2; // tarde
  return 3;                               // noite
}

// ─── Sincronização ─────────────────────────────────────────────────────────────

async function maybeSync(): Promise<void> {
  if (Date.now() - _lastSyncAt < SYNC_INTERVAL_MS) return;

  const records = await laraOperationalStore.listOutcomeRecords(60).catch(() => [] as OutcomeRecord[]);
  _lastSyncAt = Date.now();

  // Agrupa por contexto
  const byContext = new Map<string, number[]>();
  for (const r of records) {
    if (!r.resolved_at || r.outcome === "ignorou") continue;
    const resolvedAt = new Date(r.resolved_at).getTime();
    const createdAt = new Date(r.created_at).getTime();
    const hoursToRespond = (resolvedAt - createdAt) / 3_600_000;
    if (hoursToRespond <= 0 || hoursToRespond > 168) continue; // ignora outliers > 7 dias

    const horaBloco = getHoraBloco(r.hora_envio);
    const key = contextKey(r.etapa, r.risco, horaBloco);
    const list = byContext.get(key) ?? [];
    list.push(hoursToRespond);
    byContext.set(key, list);

    // Também agregado global
    const globalKey = "global:global:0";
    const gList = byContext.get(globalKey) ?? [];
    gList.push(hoursToRespond);
    byContext.set(globalKey, gList);
  }

  for (const [key, times] of byContext.entries()) {
    if (times.length < MIN_SAMPLES) continue;
    _paramCache.set(key, {
      lambda: estimateLambda(times),
      n_samples: times.length,
      last_updated: new Date().toISOString(),
    });
  }
}

// ─── Probabilidade de sobrevivência ────────────────────────────────────────────

function pSurviveT(lambda: number, t: number): number {
  return Math.exp(-lambda * t);
}

function pRespondByT(lambda: number, t: number): number {
  return 1 - pSurviveT(lambda, t);
}

function medianResponseTime(lambda: number): number {
  // P(T <= t) = 0.5 → t = ln(2) / lambda
  return Math.log(2) / lambda;
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Prevê a probabilidade de abandono para um cliente no contexto atual.
 * @param horasEsperando Quantas horas já se passaram sem resposta
 */
export async function predictAbandonment(params: {
  etapa: string;
  risco: string;
  hora_envio: number;
  horas_esperando?: number;
}): Promise<AbandonmentPrediction> {
  await maybeSync();

  const horaBloco = getHoraBloco(params.hora_envio);
  const key = contextKey(params.etapa, params.risco, horaBloco);

  const ctxParams = _paramCache.get(key)
    ?? _paramCache.get(`${params.etapa.toLowerCase()}:global:0`)
    ?? _paramCache.get("global:global:0");

  const lambda = ctxParams?.lambda ?? DEFAULT_LAMBDA;
  const nSamples = ctxParams?.n_samples ?? 0;

  const horasEsperando = params.horas_esperando ?? 0;
  const p_respond_by: Record<string, number> = {};
  for (const h of HORIZONS_H) {
    const remaining = Math.max(0, h - horasEsperando);
    p_respond_by[`${h}h`] = Math.round(pRespondByT(lambda, remaining) * 10000) / 10000;
  }

  const mediana = medianResponseTime(lambda);
  const p48h = pRespondByT(lambda, Math.max(0, 48 - horasEsperando));
  const shouldFollowupInHours = Math.max(0, mediana - horasEsperando);

  const confidence: "high" | "medium" | "low" =
    nSamples >= 50 ? "high" : nSamples >= MIN_SAMPLES ? "medium" : "low";

  return {
    p_respond_by,
    expected_response_hours: Math.round((1 / lambda) * 10) / 10,
    should_followup_in_hours: Math.round(shouldFollowupInHours * 10) / 10,
    should_abandon: p48h < ABANDON_THRESHOLD,
    lambda: Math.round(lambda * 10000) / 10000,
    confidence,
  };
}

/**
 * Retorna o número de horas ideal para o próximo follow-up.
 * Usa o ponto onde P(ainda não respondeu) = 0.5 (mediana de sobrevivência).
 */
export async function getOptimalFollowupDelay(params: {
  etapa: string;
  risco: string;
  hora_envio: number;
}): Promise<number> {
  const prediction = await predictAbandonment({ ...params, horas_esperando: 0 });
  // Retorna entre 2h e 48h
  return Math.max(2, Math.min(48, prediction.should_followup_in_hours));
}

export function getAbandonmentModelStats(): {
  n_contexts: number;
  global_lambda: number | null;
} {
  const global = _paramCache.get("global:global:0");
  return {
    n_contexts: _paramCache.size,
    global_lambda: global?.lambda ?? null,
  };
}
