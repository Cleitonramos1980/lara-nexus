/**
 * Lara — Contextual Multi-Armed Bandit Engine (Thompson Sampling)
 *
 * Estado da arte em seleção de ação: ao invés de regras fixas ou taxa histórica simples,
 * usa Thompson Sampling — amostragem de distribuições Beta por ação — para equilibrar
 * exploração (testar novas abordagens) e exploração (usar o que funciona).
 *
 * Atualiza pesos após CADA interação resolvida (online learning), não em batch diário.
 *
 * Tabela Oracle: LARA_BANDIT_STATE
 * Fallback: memória in-process (persiste enquanto servidor rodar)
 */

import { laraOperationalStore } from "./operationalStore.js";
import { dateToIsoDateTime } from "./utils.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type BanditArm = {
  pattern_key: string;   // "{etapa}:{risco}:{hora_bloco}"
  action: string;
  alpha: number;         // sucessos + 1 (prior Beta)
  beta_param: number;    // fracassos + 1 (prior Beta)
  last_updated: string;
};

export type BanditRecommendation = {
  action: string;
  sampled_rate: number;  // valor amostrado da Beta
  alpha: number;
  beta_param: number;
  exploration: boolean;  // true se esta ação ainda tem alta incerteza
};

// ─── Constantes ───────────────────────────────────────────────────────────────

// Prior fraco — Lara começa sem preconceito mas aprende rápido
const ALPHA_PRIOR = 1;
const BETA_PRIOR = 1;
const MIN_ARMS_FOR_BANDIT = 3;   // precisa de pelo menos 3 ações com dados para ativar bandit
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // sincroniza com DB a cada 1 hora

// ─── Estado em memória (cache quente) ────────────────────────────────────────
// Chave: `${pattern_key}:${action}`
const _armCache = new Map<string, BanditArm>();
let _lastSyncAt = 0;
let _syncPending = false;

// ─── Distribuição Beta — Sampling ────────────────────────────────────────────

/**
 * Johnk's method para amostrar de Beta(alpha, beta).
 * Para alpha/beta grandes usa aproximação normal (Box-Muller) — mais eficiente.
 */
function sampleBeta(alpha: number, betaP: number): number {
  if (alpha <= 0 || betaP <= 0) return 0.5;

  // Aproximação normal para parâmetros grandes (mais rápida e precisa)
  if (alpha > 5 && betaP > 5) {
    const mean = alpha / (alpha + betaP);
    const variance = (alpha * betaP) / ((alpha + betaP) ** 2 * (alpha + betaP + 1));
    const std = Math.sqrt(variance);
    // Box-Muller transform
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0.001, Math.min(0.999, mean + std * z));
  }

  // Método exato de Johnk para parâmetros pequenos
  for (let attempts = 0; attempts < 200; attempts++) {
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.max(1e-10, Math.random());
    const x = Math.pow(u1, 1 / alpha);
    const y = Math.pow(u2, 1 / betaP);
    if (x + y <= 1 && x + y > 0) {
      return x / (x + y);
    }
  }
  // Fallback determinístico se sampling falhar
  return alpha / (alpha + betaP);
}

// ─── Chave de pattern ─────────────────────────────────────────────────────────

export function makeBanditPatternKey(etapa: string, risco: string, horaBloco: number): string {
  return `${(etapa || "?").toLowerCase()}:${(risco || "?").toLowerCase()}:${horaBloco}`;
}

function armCacheKey(patternKey: string, action: string): string {
  return `${patternKey}::${action}`;
}

// ─── Carregamento do estado ───────────────────────────────────────────────────

async function syncFromDb(): Promise<void> {
  if (_syncPending) return;
  _syncPending = true;
  try {
    const arms = await laraOperationalStore.listBanditArms().catch(() => [] as BanditArm[]);
    for (const arm of arms) {
      const key = armCacheKey(arm.pattern_key, arm.action);
      _armCache.set(key, arm);
    }
    _lastSyncAt = Date.now();
  } finally {
    _syncPending = false;
  }
}

function ensureFreshCache(): void {
  if (Date.now() - _lastSyncAt > SYNC_INTERVAL_MS) {
    void syncFromDb();
  }
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Seleciona a melhor ação via Thompson Sampling para o contexto dado.
 * Retorna null se não há dados suficientes (cai nas regras padrão).
 */
export function selectBanditAction(
  patternKey: string,
  candidateActions: string[],
): BanditRecommendation | null {
  ensureFreshCache();

  if (candidateActions.length === 0) return null;

  // Conta quantas ações têm dados reais (não apenas prior)
  const armsWithData = candidateActions.filter((action) => {
    const arm = _armCache.get(armCacheKey(patternKey, action));
    return arm && (arm.alpha > ALPHA_PRIOR || arm.beta_param > BETA_PRIOR);
  });

  if (armsWithData.length < MIN_ARMS_FOR_BANDIT) return null;

  let bestAction = "";
  let bestSample = -1;
  let bestArm: BanditArm | null = null;

  for (const action of candidateActions) {
    const arm = _armCache.get(armCacheKey(patternKey, action)) ?? {
      pattern_key: patternKey,
      action,
      alpha: ALPHA_PRIOR,
      beta_param: BETA_PRIOR,
      last_updated: dateToIsoDateTime(new Date()),
    };

    const sample = sampleBeta(arm.alpha, arm.beta_param);
    if (sample > bestSample) {
      bestSample = sample;
      bestAction = action;
      bestArm = arm;
    }
  }

  if (!bestAction || !bestArm) return null;

  // Exploration: braços com poucos dados (alpha + beta < 10) ainda estão em exploração
  const totalPulls = bestArm.alpha + bestArm.beta_param - 2; // subtrai os priors
  const exploration = totalPulls < 8;

  return {
    action: bestAction,
    sampled_rate: Math.round(bestSample * 10000) / 10000,
    alpha: bestArm.alpha,
    beta_param: bestArm.beta_param,
    exploration,
  };
}

/**
 * Atualiza o braço do bandit após receber o resultado de uma ação.
 * reward = 1.0 para pagamento, 0.0 para ignorou, 0.3 para respondeu, etc.
 */
export async function updateBanditArm(
  patternKey: string,
  action: string,
  reward: number, // 0.0 – 1.0
): Promise<void> {
  const key = armCacheKey(patternKey, action);
  const existing = _armCache.get(key) ?? {
    pattern_key: patternKey,
    action,
    alpha: ALPHA_PRIOR,
    beta_param: BETA_PRIOR,
    last_updated: dateToIsoDateTime(new Date()),
  };

  // Bernoulli reward: treat reward > 0.5 as success
  const isSuccess = reward >= 0.5;
  const updated: BanditArm = {
    ...existing,
    alpha: existing.alpha + (isSuccess ? reward : 0),
    beta_param: existing.beta_param + (isSuccess ? 0 : (1 - reward)),
    last_updated: dateToIsoDateTime(new Date()),
  };

  // Atualiza cache imediatamente (hot path)
  _armCache.set(key, updated);

  // Persiste no DB de forma assíncrona (não bloqueia resposta)
  void laraOperationalStore.upsertBanditArm(updated).catch(() => {});
}

// Etapas e riscos para seed dos arms iniciais
const ETAPAS_SEED = ["d-3", "d0", "d+3", "d+7", "d+15", "d+30"];
const RISCOS_SEED  = ["baixo", "medio", "alto", "critico"];
const ACOES_SEED   = ["enviar_pix", "enviar_boleto", "apresentar_opcoes_pagamento", "negociar_autonomamente", "registrar_promessa"];
const HORAS_SEED   = [0, 1, 2, 3]; // blocos: madrugada, manhã, tarde, noite

/**
 * Cria arms com prior Beta(1,1) para todos os contextos possíveis
 * se o DB estiver vazio. Permite ao Thompson Sampling iniciar exploração
 * imediatamente sem esperar dados reais.
 */
async function seedDefaultArmsIfEmpty(): Promise<void> {
  try {
    const existing = await laraOperationalStore.listBanditArms().catch(() => []);
    if (existing.length > 0) return; // já tem dados — não sobrescreve

    const now = dateToIsoDateTime(new Date());
    const arms: BanditArm[] = [];
    for (const etapa of ETAPAS_SEED) {
      for (const risco of RISCOS_SEED) {
        for (const horaB of HORAS_SEED) {
          const patternKey = makeBanditPatternKey(etapa, risco, horaB);
          for (const action of ACOES_SEED) {
            arms.push({ pattern_key: patternKey, action, alpha: ALPHA_PRIOR, beta_param: BETA_PRIOR, last_updated: now });
          }
        }
      }
    }
    // Persiste em lote — sem await para não bloquear startup
    for (const arm of arms) {
      void laraOperationalStore.upsertBanditArm(arm).catch(() => {});
    }
  } catch { /* fallback silencioso */ }
}

/**
 * Inicializa o engine: carrega estado do DB, seed se vazio, inicia sync periódico.
 */
export function startBanditEngine(): () => void {
  void syncFromDb();
  // Seed após 3 min para não competir com o startup do Oracle pool
  setTimeout(() => void seedDefaultArmsIfEmpty(), 3 * 60 * 1000);
  const timer = setInterval(() => void syncFromDb(), SYNC_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Retorna snapshot do estado atual de todos os braços (para monitoramento).
 */
export function getBanditSnapshot(patternKey?: string): BanditArm[] {
  const arms = Array.from(_armCache.values());
  if (patternKey) return arms.filter((a) => a.pattern_key === patternKey);
  return arms;
}
