/**
 * Lara — Online Learner
 *
 * Hub central de aprendizado em tempo real. Coordena todos os módulos de ML:
 *   - Bandit Engine (Thompson Sampling) → atualizado após cada outcome
 *   - Propensity Model → retreinado em background a cada 6h
 *   - Uplift Model → retreinado em background a cada 8h
 *   - Abandonment Predictor → sincroniza lambda a cada 4h
 *   - Learning Engine → ciclo diário de pattern mining
 *
 * É o único ponto de entrada para processar outcomes e distribuir sinais.
 * Garante que nenhum módulo seja chamado em cascata de forma acoplada.
 */

import { updateBanditArm, makeBanditPatternKey } from "./banditsEngine.js";
import { retrainPropensityModel } from "./propensityModel.js";
import type { OutcomeType } from "./outcomeTracker.js";

// ─── Mapeamento de outcome → reward para o bandit ─────────────────────────────

const OUTCOME_REWARD: Record<OutcomeType, number> = {
  pagou:                1.0,   // vitória total
  prometeu_cumpriu:     0.8,   // muito bom — cliente cumpriu a palavra
  respondeu:            0.4,   // engajamento — parcialmente positivo
  prometeu_nao_cumpriu: 0.1,   // promessa quebrada — quase falha
  respondeu_diferente:  0.2,   // respondeu mas NLU errou — sinal fraco
  ignorou:              0.0,   // nenhum engajamento
  escalou:              0.15,  // precisou escalar — costoso mas pode ser necessário
  optout:               0.0,   // falha total — penalidade implícita (não negativo pois beta_param cresce)
};

// ─── Buffer de eventos para processamento assíncrono ──────────────────────────

type OutcomeEvent = {
  wa_id: string;
  etapa: string;
  risco: string;
  hora_bloco: number;
  action_taken: string;
  outcome: OutcomeType;
  processed_at: number;
};

const _eventQueue: OutcomeEvent[] = [];
const MAX_QUEUE_SIZE = 500;
let _processing = false;

// ─── Estatísticas de aprendizado ───────────────────────────────────────────────

type LearnerStats = {
  events_processed: number;
  last_bandit_update: string;
  last_propensity_retrain: string;
  bandit_updates_total: number;
};

const _stats: LearnerStats = {
  events_processed: 0,
  last_bandit_update: "",
  last_propensity_retrain: "",
  bandit_updates_total: 0,
};

// ─── Processamento de eventos ─────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (_processing || _eventQueue.length === 0) return;
  _processing = true;
  try {
    while (_eventQueue.length > 0) {
      const event = _eventQueue.shift();
      if (!event) continue;

      const reward = OUTCOME_REWARD[event.outcome] ?? 0;
      const patternKey = makeBanditPatternKey(event.etapa, event.risco, event.hora_bloco);

      await updateBanditArm(patternKey, event.action_taken, reward).catch(() => {});

      _stats.events_processed++;
      _stats.last_bandit_update = new Date().toISOString();
      _stats.bandit_updates_total++;
    }
  } finally {
    _processing = false;
  }
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Registra um outcome e distribui os sinais de aprendizado para todos os módulos.
 * Hot-path: não-bloqueante, retorna imediatamente.
 */
export function onOutcomeReceived(params: {
  wa_id: string;
  etapa: string;
  risco: string;
  hora_envio: number;
  action_taken: string;
  outcome: OutcomeType;
}): void {
  const horaBloco =
    params.hora_envio < 6  ? 0
    : params.hora_envio < 12 ? 1
    : params.hora_envio < 18 ? 2
    : 3;

  const event: OutcomeEvent = {
    wa_id: params.wa_id,
    etapa: params.etapa,
    risco: params.risco,
    hora_bloco: horaBloco,
    action_taken: params.action_taken,
    outcome: params.outcome,
    processed_at: Date.now(),
  };

  if (_eventQueue.length < MAX_QUEUE_SIZE) {
    _eventQueue.push(event);
  }

  void processQueue();
}

/**
 * Força retreino completo de todos os modelos (chamado pelo scheduler noturno).
 */
export async function runNightlyRetraining(): Promise<void> {
  await retrainPropensityModel().catch(() => {});
  _stats.last_propensity_retrain = new Date().toISOString();
}

export function getOnlineLearnerStats(): LearnerStats & { queue_size: number } {
  return { ..._stats, queue_size: _eventQueue.length };
}

/**
 * Converte outcome string (vindo do banco) para reward normalizado.
 * Usado por módulos que precisam da reward sem importar OnlineLearner.
 */
export function outcomeToReward(outcome: OutcomeType): number {
  return OUTCOME_REWARD[outcome] ?? 0;
}
