/**
 * Lara — Uplift Model (T-Learner Causal)
 *
 * Estima o *incremento causal* de entrar em contato com o cliente.
 * Uplift = P(pagamento | contato) - P(pagamento | sem contato)
 *
 * Implementação T-Learner:
 *   Modelo T (treatment): treinado em interações ONDE houve contato nas últimas 48h
 *   Modelo C (control):   treinado em interações ONDE NÃO houve contato recente
 *
 * Uplift > 0.05 → vale entrar em contato
 * Uplift < 0    → contato provavelmente prejudica (cliente vai fazer optout)
 */

import { laraOperationalStore } from "./operationalStore.js";
import { extractFeatures } from "./propensityModel.js";
import type { OutcomeRecord } from "./outcomeTracker.js";

// ─── Constantes ────────────────────────────────────────────────────────────────

const FEATURE_DIM = 10;
const LEARNING_RATE = 0.04;
const L2_LAMBDA = 0.001;
const MINI_BATCH_SIZE = 32;
const MAX_EPOCHS = 40;
const MIN_SAMPLES_PER_ARM = 30;
const POSITIVE_OUTCOMES = new Set(["pagou", "prometeu_cumpriu"]);
const NEGATIVE_SIGNAL_OUTCOMES = new Set(["optout", "escalou"]);
const CONTACT_WINDOW_HOURS = 48;
const SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type UpliftPrediction = {
  uplift: number;          // -1 a 1: efeito incremental de contatar
  p_treatment: number;     // P(pagamento | contato)
  p_control: number;       // P(pagamento | sem contato) estimado
  worth_contacting: boolean;
  confidence: number;
};

type WeightState = {
  weights: number[];
  bias: number;
  n_samples: number;
};

type TLearnerState = {
  treatment: WeightState;
  control: WeightState;
  last_trained_at: string;
};

let _state: TLearnerState = {
  treatment: { weights: new Array(FEATURE_DIM).fill(0), bias: 0, n_samples: 0 },
  control: { weights: new Array(FEATURE_DIM).fill(0), bias: 0, n_samples: 0 },
  last_trained_at: "",
};
let _lastTrainAt = 0;
let _training = false;

// ─── Mini LR helpers ────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  if (z > 20) return 0.9999999;
  if (z < -20) return 0.0000001;
  return 1 / (1 + Math.exp(-z));
}

function trainLR(
  samples: Array<{ features: number[]; label: number }>,
): WeightState {
  const w = new Array(FEATURE_DIM).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
    // shuffle
    for (let i = samples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [samples[i], samples[j]] = [samples[j], samples[i]];
    }
    const lr = LEARNING_RATE / (1 + epoch * 0.08);
    for (let start = 0; start < samples.length; start += MINI_BATCH_SIZE) {
      const batch = samples.slice(start, start + MINI_BATCH_SIZE);
      const dw = new Array(FEATURE_DIM).fill(0);
      let db = 0;
      for (const s of batch) {
        const z = b + s.features.reduce((sum, f, i) => sum + f * w[i], 0);
        const err = sigmoid(z) - s.label;
        for (let i = 0; i < FEATURE_DIM; i++) dw[i] += err * s.features[i];
        db += err;
      }
      const n = batch.length;
      for (let i = 0; i < FEATURE_DIM; i++) {
        w[i] -= lr * (dw[i] / n + L2_LAMBDA * w[i]);
      }
      b -= lr * (db / n);
    }
  }
  return { weights: w, bias: b, n_samples: samples.length };
}

function predictLR(features: number[], state: WeightState): number {
  const z = state.bias + features.reduce((sum, f, i) => sum + f * state.weights[i], 0);
  return sigmoid(z);
}

// ─── Separação treatment / control ────────────────────────────────────────────
// Heurística: se dois registros do mesmo wa_id estão próximos no tempo (<48h),
// o mais recente recebe a "influência" do anterior → treatment.
// Registros isolados sem histórico recente → control.

function splitTreatmentControl(records: OutcomeRecord[]): {
  treatment: OutcomeRecord[];
  control: OutcomeRecord[];
} {
  const byWaId = new Map<string, OutcomeRecord[]>();
  for (const r of records) {
    const list = byWaId.get(r.wa_id) ?? [];
    list.push(r);
    byWaId.set(r.wa_id, list);
  }

  const treatment: OutcomeRecord[] = [];
  const control: OutcomeRecord[] = [];

  for (const recs of byWaId.values()) {
    const sorted = recs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) {
        control.push(sorted[i]);
        continue;
      }
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gapH =
        (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime())
        / 3_600_000;
      if (gapH <= CONTACT_WINDOW_HOURS) {
        treatment.push(curr);
      } else {
        control.push(curr);
      }
    }
  }

  return { treatment, control };
}

function toSamples(records: OutcomeRecord[]): Array<{ features: number[]; label: number }> {
  return records.map((r) => ({
    features: extractFeatures({
      etapa: r.etapa,
      risco: r.risco,
      hora_contato: r.hora_envio,
      dia_semana: r.dia_semana,
    }),
    label: POSITIVE_OUTCOMES.has(r.outcome) ? 1 : 0,
  }));
}

// ─── Treino ─────────────────────────────────────────────────────────────────────

async function trainIfNeeded(): Promise<void> {
  if (_training) return;
  if (Date.now() - _lastTrainAt < SYNC_INTERVAL_MS) return;
  _training = true;
  try {
    const records = await laraOperationalStore.listOutcomeRecords(60).catch(() => []);
    const { treatment, control } = splitTreatmentControl(records);

    if (treatment.length < MIN_SAMPLES_PER_ARM || control.length < MIN_SAMPLES_PER_ARM) {
      return;
    }

    const tState = trainLR(toSamples(treatment));
    const cState = trainLR(toSamples(control));

    _state = {
      treatment: tState,
      control: cState,
      last_trained_at: new Date().toISOString(),
    };
    _lastTrainAt = Date.now();

    await laraOperationalStore.upsertConfiguracao(
      "LARA_UPLIFT_MODEL_STATE",
      JSON.stringify(_state),
    ).catch(() => {});
  } finally {
    _training = false;
  }
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Calcula o uplift causal de contatar este cliente agora.
 * Retorna null se o modelo ainda não foi treinado.
 */
export function predictUplift(params: {
  etapa: string;
  risco: string;
  hora_contato: number;
  dia_semana: number;
  valor_aberto?: number;
  dias_atraso?: number;
}): UpliftPrediction | null {
  void trainIfNeeded();

  const { treatment: t, control: c } = _state;
  if (t.n_samples < MIN_SAMPLES_PER_ARM || c.n_samples < MIN_SAMPLES_PER_ARM) {
    return null;
  }

  const features = extractFeatures(params);
  const p_treatment = predictLR(features, t);
  const p_control = predictLR(features, c);
  const uplift = p_treatment - p_control;
  const minSamples = Math.min(t.n_samples, c.n_samples);
  const confidence = Math.min(0.9, minSamples / 500);

  return {
    uplift: Math.round(uplift * 10000) / 10000,
    p_treatment: Math.round(p_treatment * 10000) / 10000,
    p_control: Math.round(p_control * 10000) / 10000,
    worth_contacting: uplift > 0.03,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export async function initUpliftModel(): Promise<void> {
  try {
    const stored = await laraOperationalStore.getConfiguracao("LARA_UPLIFT_MODEL_STATE");
    if (stored) {
      const parsed = JSON.parse(stored) as TLearnerState;
      if (parsed.treatment && parsed.control) {
        _state = parsed;
        _lastTrainAt = new Date(parsed.last_trained_at || 0).getTime();
      }
    }
  } catch {
    // Começa sem modelo
  }
  if (_state.treatment.n_samples < MIN_SAMPLES_PER_ARM) {
    await trainIfNeeded();
  }
}

export function getUpliftModelStats() {
  return {
    treatment_samples: _state.treatment.n_samples,
    control_samples: _state.control.n_samples,
    last_trained_at: _state.last_trained_at,
    is_trained:
      _state.treatment.n_samples >= MIN_SAMPLES_PER_ARM &&
      _state.control.n_samples >= MIN_SAMPLES_PER_ARM,
  };
}
