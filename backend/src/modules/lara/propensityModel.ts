/**
 * Lara — Propensity Model v2 (Logistic Regression Online)
 *
 * Aprende de LARA_OUTCOME_TRACKING: features reais → P(pagamento_em_48h).
 * Treina via mini-batch SGD com regularização L2.
 * Fallback: propensityScorer.ts (baseado em regras) se não há dados suficientes.
 *
 * Features:
 *   etapa_idx, risco_idx, hora_sin, hora_cos, dia_sin, dia_cos,
 *   log_valor, dias_atraso_norm, tentativas_norm, tempo_desde_contato_norm
 */

import { laraOperationalStore } from "./operationalStore.js";
import type { OutcomeRecord } from "./outcomeTracker.js";

// ─── Constantes ────────────────────────────────────────────────────────────────

const FEATURE_DIM = 10;
const LEARNING_RATE = 0.05;
const L2_LAMBDA = 0.001;
const MINI_BATCH_SIZE = 32;
const MAX_EPOCHS = 50;
const MIN_SAMPLES_TO_TRAIN = 50;
const SUCCESS_OUTCOMES = new Set(["pagou", "prometeu_cumpriu"]);
const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

const ETAPA_MAP: Record<string, number> = {
  "D-3": 0, "D0": 1, "D+3": 2, "D+7": 3, "D+15": 4, "D+30": 5,
};
const RISCO_MAP: Record<string, number> = {
  baixo: 0, medio: 1, alto: 2, critico: 3,
};

// ─── Modelo ────────────────────────────────────────────────────────────────────

export type PropensityModelPrediction = {
  probability: number;   // 0–1: P(pagamento em 48h)
  confidence: number;    // 0–1: baseado no n° de amostras de treino
  trained: boolean;      // false se usando fallback
};

type ModelState = {
  weights: number[];
  bias: number;
  trained_samples: number;
  last_trained_at: string;
};

let _modelState: ModelState = {
  weights: new Array(FEATURE_DIM).fill(0),
  bias: 0,
  trained_samples: 0,
  last_trained_at: "",
};
let _lastRetrainAt = 0;
let _retrainRunning = false;

// ─── Utilidades ────────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  if (z > 20) return 0.9999999;
  if (z < -20) return 0.0000001;
  return 1 / (1 + Math.exp(-z));
}

export function extractFeatures(params: {
  etapa: string;
  risco: string;
  hora_contato: number;
  dia_semana: number;
  valor_aberto?: number;
  dias_atraso?: number;
  qtd_tentativas?: number;
  tempo_desde_ultimo_contato_horas?: number;
}): number[] {
  const etapaIdx = (ETAPA_MAP[params.etapa] ?? 3) / 5;
  const riscoIdx = (RISCO_MAP[params.risco] ?? 1) / 3;

  const horaNorm = params.hora_contato / 23;
  const horaSin = Math.sin(2 * Math.PI * horaNorm);
  const horaCos = Math.cos(2 * Math.PI * horaNorm);

  const diaNorm = params.dia_semana / 6;
  const diaSin = Math.sin(2 * Math.PI * diaNorm);
  const diaCos = Math.cos(2 * Math.PI * diaNorm);

  const logValor = params.valor_aberto && params.valor_aberto > 0
    ? Math.min(1, Math.log10(params.valor_aberto) / 6)
    : 0.3;

  const diasNorm = Math.min(1, (params.dias_atraso ?? 0) / 90);
  const tentativasNorm = Math.min(1, (params.qtd_tentativas ?? 1) / 10);
  const tempoSincNorm = Math.min(1, (params.tempo_desde_ultimo_contato_horas ?? 24) / 168);

  return [
    etapaIdx, riscoIdx,
    horaSin, horaCos,
    diaSin, diaCos,
    logValor, diasNorm, tentativasNorm, tempoSincNorm,
  ];
}

function predict(features: number[], state: ModelState): number {
  let z = state.bias;
  for (let i = 0; i < FEATURE_DIM; i++) {
    z += features[i] * state.weights[i];
  }
  return sigmoid(z);
}

// ─── Treinamento ────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function trainFromOutcomes(records: OutcomeRecord[]): ModelState {
  const resolved = records.filter((r) => r.resolved_at !== null && r.resolved_at !== undefined);
  if (resolved.length < MIN_SAMPLES_TO_TRAIN) return _modelState;

  const samples: Array<{ features: number[]; label: number }> = resolved
    .filter((r) => r.outcome !== "ignorou" || Math.random() > 0.5) // undersample negatives
    .map((r) => {
      const resolvedTime = r.resolved_at ? new Date(r.resolved_at).getTime() : 0;
      const createdTime = new Date(r.created_at).getTime();
      const hours = (resolvedTime - createdTime) / 3_600_000;
      const paidIn48h = SUCCESS_OUTCOMES.has(r.outcome) && hours <= 48;
      return {
        features: extractFeatures({
          etapa: r.etapa,
          risco: r.risco,
          hora_contato: r.hora_envio,
          dia_semana: r.dia_semana,
        }),
        label: paidIn48h ? 1 : 0,
      };
    });

  const w = new Array(FEATURE_DIM).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
    const shuffled = shuffle(samples);
    for (let start = 0; start < shuffled.length; start += MINI_BATCH_SIZE) {
      const batch = shuffled.slice(start, start + MINI_BATCH_SIZE);
      const dw = new Array(FEATURE_DIM).fill(0);
      let db = 0;

      for (const s of batch) {
        const z = b + s.features.reduce((sum, f, i) => sum + f * w[i], 0);
        const pred = sigmoid(z);
        const err = pred - s.label;
        for (let i = 0; i < FEATURE_DIM; i++) dw[i] += err * s.features[i];
        db += err;
      }

      const n = batch.length;
      const lr = LEARNING_RATE / (1 + epoch * 0.1); // learning rate decay
      for (let i = 0; i < FEATURE_DIM; i++) {
        w[i] -= lr * (dw[i] / n + L2_LAMBDA * w[i]);
      }
      b -= lr * (db / n);
    }
  }

  return {
    weights: w,
    bias: b,
    trained_samples: resolved.length,
    last_trained_at: new Date().toISOString(),
  };
}

// ─── Ciclo de Retreino ──────────────────────────────────────────────────────────

async function maybeRetrain(): Promise<void> {
  if (_retrainRunning) return;
  if (Date.now() - _lastRetrainAt < RETRAIN_INTERVAL_MS) return;
  _retrainRunning = true;
  try {
    const records = await laraOperationalStore.listOutcomeRecords(45).catch(() => []);
    if (records.length >= MIN_SAMPLES_TO_TRAIN) {
      const newState = trainFromOutcomes(records);
      if (newState.trained_samples >= MIN_SAMPLES_TO_TRAIN) {
        _modelState = newState;
        _lastRetrainAt = Date.now();
        // Persiste pesos no Oracle como JSON
        await laraOperationalStore.upsertConfiguracao(
          "LARA_PROPENSITY_MODEL_WEIGHTS",
          JSON.stringify(newState),
        ).catch(() => {});
      }
    }
  } finally {
    _retrainRunning = false;
  }
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Prevê P(pagamento em 48h) para um dado contexto.
 * Dispara retreino em background se o modelo estiver desatualizado.
 */
export function predictPropensity(params: {
  etapa: string;
  risco: string;
  hora_contato: number;
  dia_semana: number;
  valor_aberto?: number;
  dias_atraso?: number;
  qtd_tentativas?: number;
  tempo_desde_ultimo_contato_horas?: number;
}): PropensityModelPrediction {
  void maybeRetrain();

  if (_modelState.trained_samples < MIN_SAMPLES_TO_TRAIN) {
    return { probability: 0.5, confidence: 0, trained: false };
  }

  const features = extractFeatures(params);
  const probability = predict(features, _modelState);
  const confidence = Math.min(0.95, _modelState.trained_samples / 1000);

  return {
    probability: Math.round(probability * 10000) / 10000,
    confidence: Math.round(confidence * 100) / 100,
    trained: true,
  };
}

/**
 * Inicializa o modelo: carrega pesos persistidos do Oracle.
 */
export async function initPropensityModel(): Promise<void> {
  try {
    const stored = await laraOperationalStore.getConfiguracao("LARA_PROPENSITY_MODEL_WEIGHTS");
    if (stored) {
      const parsed = JSON.parse(stored) as ModelState;
      if (Array.isArray(parsed.weights) && parsed.weights.length === FEATURE_DIM) {
        _modelState = parsed;
        _lastRetrainAt = new Date(parsed.last_trained_at || 0).getTime();
      }
    }
  } catch {
    // Começa sem modelo treinado — próximo ciclo treina automaticamente
  }
  // Tenta treinar imediatamente se não tem modelo
  if (_modelState.trained_samples < MIN_SAMPLES_TO_TRAIN) {
    await maybeRetrain();
  }
}

/**
 * Força retreino imediato (chamado pelo scheduler noturno).
 */
export async function retrainPropensityModel(): Promise<void> {
  _lastRetrainAt = 0;
  await maybeRetrain();
}

export function getPropensityModelStats(): {
  trained_samples: number;
  last_trained_at: string;
  is_trained: boolean;
} {
  return {
    trained_samples: _modelState.trained_samples,
    last_trained_at: _modelState.last_trained_at,
    is_trained: _modelState.trained_samples >= MIN_SAMPLES_TO_TRAIN,
  };
}
