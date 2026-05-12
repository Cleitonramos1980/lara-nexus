/**
 * Lara — Multi-Objective Optimizer (Pareto)
 *
 * Otimiza simultaneamente 4 objetivos conflitantes ao escolher uma ação:
 *
 *   1. Maximizar taxa de conversão (pagamento)
 *   2. Minimizar taxa de opt-out
 *   3. Minimizar mensagens por pagamento (eficiência operacional)
 *   4. Maximizar taxa de resposta (engajamento)
 *
 * Implementação:
 *   - Calcula scores de cada ação em cada objetivo
 *   - Encontra a fronteira de Pareto
 *   - Usa função de utilidade ponderada para selecionar a melhor ação
 *
 * Dados: últimas 30 dias de LARA_OUTCOME_TRACKING agregados por (etapa, risco, action).
 */

import { laraOperationalStore } from "./operationalStore.js";
import type { OutcomeRecord } from "./outcomeTracker.js";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ObjectiveVector = {
  conversion_rate: number;    // 0–1 (maximizar)
  optout_rate: number;        // 0–1 (minimizar)
  messages_per_payment: number; // ≥1 (minimizar)
  response_rate: number;      // 0–1 (maximizar)
};

export type ActionObjectiveScore = {
  action: string;
  objectives: ObjectiveVector;
  utility: number;            // escore combinado final
  pareto_rank: number;        // 1 = fronteira de Pareto, >1 = dominado
  sample_count: number;
};

export type MultiObjectiveRecommendation = {
  best_action: string;
  utility: number;
  pareto_rank: number;
  alternatives: ActionObjectiveScore[];
  context_key: string;
};

// ─── Pesos dos objetivos (soma = 1.0) ─────────────────────────────────────────
// Valores calibrados para cobrança B2C: conversão é o objetivo primário.

const OBJECTIVE_WEIGHTS = {
  conversion_rate: 0.45,
  optout_rate_inv: 0.25,    // invertido: (1 - optout_rate)
  efficiency: 0.15,         // invertido: 1/messages_per_payment
  response_rate: 0.15,
} as const;

const MIN_SAMPLES = 5;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

// ─── Cache ─────────────────────────────────────────────────────────────────────

type AggregatedStats = {
  action: string;
  total: number;
  paid: number;
  optout: number;
  responded: number;       // qualquer resposta
  paid_or_responded: number;
};

const _statsCache = new Map<string, { data: AggregatedStats[]; ts: number }>();
let _lastSyncAt = 0;
let _allOutcomes: OutcomeRecord[] = [];

// ─── Agregação ─────────────────────────────────────────────────────────────────

async function maybeSync(): Promise<void> {
  if (Date.now() - _lastSyncAt < SYNC_INTERVAL_MS) return;
  _allOutcomes = await laraOperationalStore.listOutcomeRecords(30).catch(() => []);
  _lastSyncAt = Date.now();
  _statsCache.clear();
}

function aggregateByContext(
  outcomes: OutcomeRecord[],
  etapa: string,
  risco: string,
): AggregatedStats[] {
  const byAction = new Map<string, AggregatedStats>();

  for (const r of outcomes) {
    if (r.etapa !== etapa || r.risco !== risco) continue;
    const s = byAction.get(r.action_taken) ?? {
      action: r.action_taken,
      total: 0, paid: 0, optout: 0, responded: 0, paid_or_responded: 0,
    };
    s.total++;
    if (r.outcome === "pagou" || r.outcome === "prometeu_cumpriu") s.paid++;
    if (r.outcome === "optout") s.optout++;
    if (r.outcome !== "ignorou") s.responded++;
    if (r.outcome !== "ignorou" && r.outcome !== "optout") s.paid_or_responded++;
    byAction.set(r.action_taken, s);
  }

  return Array.from(byAction.values()).filter((s) => s.total >= MIN_SAMPLES);
}

function toObjectiveVector(s: AggregatedStats, allStats: AggregatedStats[]): ObjectiveVector {
  const totalPaid = allStats.reduce((sum, x) => sum + x.paid, 0) || 1;
  const conversion_rate = s.paid / s.total;
  const optout_rate = s.optout / s.total;
  const response_rate = s.responded / s.total;
  // messages_per_payment: média de contatos necessários para converter
  // (inverte a escala: menos = melhor)
  const messages_per_payment = s.paid > 0 ? s.total / s.paid : 20;
  void totalPaid;
  return { conversion_rate, optout_rate, messages_per_payment, response_rate };
}

// ─── Pareto ────────────────────────────────────────────────────────────────────

function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  // a domina b se a é pelo menos tão bom em todos os objetivos e melhor em pelo menos um
  const bConv = b.conversion_rate <= a.conversion_rate;
  const bOptout = b.optout_rate >= a.optout_rate;
  const bMsgPay = b.messages_per_payment >= a.messages_per_payment;
  const bResp = b.response_rate <= a.response_rate;
  const anyStrictlyBetter =
    a.conversion_rate > b.conversion_rate ||
    a.optout_rate < b.optout_rate ||
    a.messages_per_payment < b.messages_per_payment ||
    a.response_rate > b.response_rate;
  return bConv && bOptout && bMsgPay && bResp && anyStrictlyBetter;
}

function computeParetoRanks(items: ActionObjectiveScore[]): void {
  for (let i = 0; i < items.length; i++) {
    let dominated = false;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (dominates(items[j].objectives, items[i].objectives)) {
        dominated = true;
        break;
      }
    }
    items[i].pareto_rank = dominated ? 2 : 1;
  }
}

function computeUtility(obj: ObjectiveVector): number {
  const efficiency = obj.messages_per_payment > 0 ? 1 / obj.messages_per_payment : 0;
  return (
    OBJECTIVE_WEIGHTS.conversion_rate * obj.conversion_rate +
    OBJECTIVE_WEIGHTS.optout_rate_inv * (1 - obj.optout_rate) +
    OBJECTIVE_WEIGHTS.efficiency * Math.min(1, efficiency) +
    OBJECTIVE_WEIGHTS.response_rate * obj.response_rate
  );
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Retorna a melhor ação por Pareto + utilidade para o contexto dado.
 * Retorna null se não há dados suficientes.
 */
export async function getMultiObjectiveRecommendation(
  etapa: string,
  risco: string,
  candidateActions?: string[],
): Promise<MultiObjectiveRecommendation | null> {
  await maybeSync();

  const contextKey = `${etapa}:${risco}`;
  const cached = _statsCache.get(contextKey);
  let stats: AggregatedStats[];

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    stats = cached.data;
  } else {
    stats = aggregateByContext(_allOutcomes, etapa, risco);
    _statsCache.set(contextKey, { data: stats, ts: Date.now() });
  }

  // Filtra para as ações candidatas se fornecidas
  const filtered = candidateActions && candidateActions.length > 0
    ? stats.filter((s) => candidateActions.includes(s.action))
    : stats;

  if (filtered.length < 2) return null;

  const scored: ActionObjectiveScore[] = filtered.map((s) => {
    const objectives = toObjectiveVector(s, filtered);
    return {
      action: s.action,
      objectives,
      utility: computeUtility(objectives),
      pareto_rank: 1, // será calculado abaixo
      sample_count: s.total,
    };
  });

  computeParetoRanks(scored);

  // Dentro da fronteira de Pareto, escolhe pelo maior utility
  const paretoFront = scored.filter((s) => s.pareto_rank === 1);
  const best = (paretoFront.length > 0 ? paretoFront : scored)
    .sort((a, b) => b.utility - a.utility)[0];

  return {
    best_action: best.action,
    utility: Math.round(best.utility * 10000) / 10000,
    pareto_rank: best.pareto_rank,
    alternatives: scored.sort((a, b) => b.utility - a.utility),
    context_key: contextKey,
  };
}

/**
 * Retorna todas as estatísticas de objetivos para análise/monitoramento.
 */
export async function getObjectiveStats(etapa: string, risco: string): Promise<ActionObjectiveScore[]> {
  await maybeSync();
  const stats = aggregateByContext(_allOutcomes, etapa, risco);
  return stats.map((s) => {
    const objectives = toObjectiveVector(s, stats);
    return {
      action: s.action,
      objectives,
      utility: computeUtility(objectives),
      pareto_rank: 1,
      sample_count: s.total,
    };
  });
}
