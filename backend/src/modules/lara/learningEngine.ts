/**
 * Lara — Learning Engine
 *
 * Analisa os outcomes registrados pelo outcomeTracker, identifica padrões de sucesso
 * e fracasso, e atualiza LARA_LEARNED_PATTERNS com regras aprendidas.
 *
 * A Lara aprende:
 *   - Qual ação tem maior taxa de pagamento para cada perfil (etapa + risco + intent + hora)
 *   - Quais padrões de mensagem levam a erros de classificação (NLU corrections)
 *   - Quais horas e dias têm melhor resultado por etapa
 *   - Quais abordagens falham repetidamente para certos perfis
 *
 * O learningEngine NÃO substitui as regras de negócio obrigatórias (compliance, optout,
 * sentimento crítico) — ele só age no espaço de decisão após as regras de segurança.
 */

import { laraOperationalStore } from "./operationalStore.js";
import { listRecentOutcomes, type OutcomeRecord, type OutcomeType } from "./outcomeTracker.js";
import { dateToIsoDateTime } from "./utils.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type LearnedPattern = {
  pattern_key: string;         // "{etapa}:{risco}:{intent}:{hora_bloco}"
  action_recommended: string;
  success_rate: number;        // 0.0–1.0
  sample_count: number;
  last_updated: string;
  is_active: boolean;
};

export type LearningReport = {
  patterns_created: number;
  patterns_updated: number;
  patterns_deactivated: number;
  nlu_corrections_applied: number;
  top_patterns: Array<{ key: string; action: string; rate: number; samples: number }>;
  worst_patterns: Array<{ key: string; action: string; rate: number; samples: number }>;
  calculated_at: string;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const MIN_SAMPLES_FOR_LEARNING = 15;    // mínimo de amostras para confiar no padrão
const MIN_SUCCESS_RATE_ACTIVATE = 0.65; // taxa mínima para recomendar uma ação
const DEACTIVATE_BELOW_RATE = 0.30;     // desativa padrão abaixo desta taxa
const ANALYSIS_PERIOD_DAYS = 45;        // analisa últimos 45 dias

// Agrupa hora em blocos: 0=madrugada(0-6), 1=manhã(7-11), 2=tarde(12-17), 3=noite(18-23)
function horaBloco(hora: number): number {
  if (hora <= 6) return 0;
  if (hora <= 11) return 1;
  if (hora <= 17) return 2;
  return 3;
}

function horaBloco2Label(bloco: number): string {
  return ["madrugada(0-6)", "manhã(7-11)", "tarde(12-17)", "noite(18-23)"][bloco] ?? String(bloco);
}

// Outcomes que indicam sucesso real (dinheiro entrou ou compromisso firme)
const SUCCESS_OUTCOMES: Set<OutcomeType> = new Set([
  "pagou",
  "prometeu_cumpriu",
]);

// Outcomes que indicam fracasso claro
const FAILURE_OUTCOMES: Set<OutcomeType> = new Set([
  "ignorou",
  "prometeu_nao_cumpriu",
  "respondeu_diferente",
]);

function isResolved(r: OutcomeRecord): boolean {
  return r.resolved_at !== null && r.outcome !== "ignorou";
}

function successScore(r: OutcomeRecord): number {
  if (SUCCESS_OUTCOMES.has(r.outcome)) return 1;
  if (r.outcome === "respondeu") return 0.3; // respondeu mas não pagou ainda
  if (r.outcome === "escalou") return 0.2;   // escalação não é falha mas não é conversão
  return 0; // ignorou, prometeu_nao_cumpriu, respondeu_diferente, optout
}

function buildPatternKey(r: OutcomeRecord): string {
  return [
    (r.etapa || "desconhecida").toLowerCase(),
    (r.risco || "desconhecido").toLowerCase(),
    (r.intent_classified || "neutro").toLowerCase(),
    String(horaBloco(r.hora_envio)),
  ].join(":");
}

// ─── Análise de outcomes ──────────────────────────────────────────────────────

type PatternAccumulator = {
  action_counts: Record<string, { success_sum: number; total: number }>;
};

function analyzeOutcomes(outcomes: OutcomeRecord[]): Map<string, LearnedPattern> {
  // Agrupa por chave de padrão
  const grouped = new Map<string, PatternAccumulator>();

  for (const r of outcomes) {
    const key = buildPatternKey(r);
    const acc = grouped.get(key) ?? { action_counts: {} };
    const actionEntry = acc.action_counts[r.action_taken] ?? { success_sum: 0, total: 0 };
    actionEntry.success_sum += successScore(r);
    actionEntry.total += 1;
    acc.action_counts[r.action_taken] = actionEntry;
    grouped.set(key, acc);
  }

  const patterns = new Map<string, LearnedPattern>();
  const now = dateToIsoDateTime(new Date());

  for (const [key, acc] of grouped) {
    // Encontra a melhor ação para este padrão
    let bestAction = "";
    let bestRate = -1;
    let bestSamples = 0;

    for (const [action, stats] of Object.entries(acc.action_counts)) {
      if (stats.total < MIN_SAMPLES_FOR_LEARNING) continue;
      const rate = stats.success_sum / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestAction = action;
        bestSamples = stats.total;
      }
    }

    if (!bestAction || bestSamples < MIN_SAMPLES_FOR_LEARNING) continue;

    patterns.set(key, {
      pattern_key: key,
      action_recommended: bestAction,
      success_rate: Math.round(bestRate * 10000) / 10000,
      sample_count: bestSamples,
      last_updated: now,
      is_active: bestRate >= MIN_SUCCESS_RATE_ACTIVATE,
    });
  }

  return patterns;
}

// ─── NLU Corrections → lexicon ───────────────────────────────────────────────

type NluCorrectionRow = {
  original_action: string;
  corrected_intent: string;
  message_text: string;
  count: number;
};

async function applyNluCorrections(): Promise<number> {
  const corrections = await laraOperationalStore.listNluCorrections(30).catch(() => [] as NluCorrectionRow[]);
  if (corrections.length === 0) return 0;

  // Agrupa por corrected_intent e extrai palavras-chave mais frequentes
  const byIntent: Record<string, string[]> = {};
  for (const c of corrections) {
    const words = c.message_text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4); // palavras com pelo menos 4 letras
    byIntent[c.corrected_intent] = [...(byIntent[c.corrected_intent] ?? []), ...words];
  }

  // Identifica palavras que aparecem 3+ vezes em um intent mas não são genéricas
  const STOPWORDS = new Set(["para", "isso", "esse", "essa", "voce", "quero", "minha", "meu"]);
  const newTerms: Record<string, string[]> = {};

  for (const [intent, words] of Object.entries(byIntent)) {
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (!STOPWORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1;
    }
    const candidates = Object.entries(freq)
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([w]) => w);
    if (candidates.length > 0) newTerms[intent] = candidates;
  }

  if (Object.keys(newTerms).length === 0) return 0;

  // Persiste como override de lexicon para o nluClassifier
  await laraOperationalStore.upsertConfiguracao(
    "LARA_NLU_LEXICON_OVERRIDE_JSON",
    JSON.stringify(newTerms),
    "Termos aprendidos de correções de classificação NLU (auto-gerado)",
  ).catch(() => {});

  return corrections.length;
}

// ─── Engine Principal ─────────────────────────────────────────────────────────

export async function runLearningCycle(): Promise<LearningReport> {
  const [outcomes, existingPatterns] = await Promise.all([
    listRecentOutcomes(ANALYSIS_PERIOD_DAYS),
    laraOperationalStore.listLearnedPatterns().catch(() => [] as LearnedPattern[]),
  ]);

  const existingMap = new Map(existingPatterns.map((p) => [p.pattern_key, p]));
  const newPatterns = analyzeOutcomes(outcomes);

  let created = 0;
  let updated = 0;
  let deactivated = 0;

  // Upsert padrões aprendidos
  for (const [key, pattern] of newPatterns) {
    const existing = existingMap.get(key);
    if (!existing) {
      await laraOperationalStore.upsertLearnedPattern(pattern).catch(() => {});
      created++;
    } else if (
      Math.abs(existing.success_rate - pattern.success_rate) > 0.02
      || existing.sample_count !== pattern.sample_count
    ) {
      await laraOperationalStore.upsertLearnedPattern(pattern).catch(() => {});
      updated++;
    }
  }

  // Desativa padrões que pioraram muito
  for (const [key, existing] of existingMap) {
    if (!newPatterns.has(key) && existing.is_active) {
      const freshOutcomes = outcomes.filter((r) => buildPatternKey(r) === key);
      if (freshOutcomes.length >= MIN_SAMPLES_FOR_LEARNING) {
        const avgScore = freshOutcomes.reduce((s, r) => s + successScore(r), 0) / freshOutcomes.length;
        if (avgScore < DEACTIVATE_BELOW_RATE) {
          await laraOperationalStore.upsertLearnedPattern({ ...existing, is_active: false }).catch(() => {});
          deactivated++;
        }
      }
    }
  }

  // Aplica correções NLU ao lexicon
  const nluCorrections = await applyNluCorrections();

  // Monta relatório
  const allPatterns = await laraOperationalStore.listLearnedPatterns().catch(() => [] as LearnedPattern[]);
  const activePatterns = allPatterns.filter((p) => p.is_active);

  const sorted = [...activePatterns].sort((a, b) => b.success_rate - a.success_rate);
  const top_patterns = sorted.slice(0, 5).map((p) => ({
    key: p.pattern_key,
    action: p.action_recommended,
    rate: p.success_rate,
    samples: p.sample_count,
  }));
  const worst_patterns = sorted
    .slice(-5)
    .reverse()
    .map((p) => ({
      key: p.pattern_key,
      action: p.action_recommended,
      rate: p.success_rate,
      samples: p.sample_count,
    }));

  const report: LearningReport = {
    patterns_created: created,
    patterns_updated: updated,
    patterns_deactivated: deactivated,
    nlu_corrections_applied: nluCorrections,
    top_patterns,
    worst_patterns,
    calculated_at: dateToIsoDateTime(new Date()),
  };

  // Persiste relatório em LARA_CONFIGURACOES para o front visualizar
  await laraOperationalStore.upsertConfiguracao(
    "LARA_LEARNING_LAST_REPORT_JSON",
    JSON.stringify(report),
    "Último relatório do ciclo de aprendizado (auto-gerado)",
  ).catch(() => {});

  return report;
}

/**
 * Consulta o padrão aprendido mais relevante para um dado contexto.
 * Retorna null se não há padrão suficientemente confiável.
 */
export async function getLearnedRecommendation(params: {
  etapa: string;
  risco: string;
  intent: string;
  hora: number;
}): Promise<LearnedPattern | null> {
  const key = [
    (params.etapa || "desconhecida").toLowerCase(),
    (params.risco || "desconhecido").toLowerCase(),
    (params.intent || "neutro").toLowerCase(),
    String(horaBloco(params.hora)),
  ].join(":");

  return laraOperationalStore.getLearnedPattern(key).catch(() => null);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

type LoggerLike = {
  info?: (p: Record<string, unknown>, msg?: string) => void;
  warn?: (p: Record<string, unknown>, msg?: string) => void;
  error?: (p: Record<string, unknown>, msg?: string) => void;
};

const TICK_MS = 60 * 60 * 1000; // verifica a cada 1h

export function startLearningEngineScheduler(logger?: LoggerLike): () => void {
  let stopped = false;
  let lastRunDate = "";

  const runCycle = async (reason: "scheduled" | "bootstrap") => {
    if (stopped) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today && reason !== "bootstrap") return;
    lastRunDate = today;
    try {
      const report = await runLearningCycle();
      logger?.info?.({ modulo: "learning-engine", reason, ...report }, "Ciclo de aprendizado concluído");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.error?.({ modulo: "learning-engine", reason, erro: msg }, "Erro no ciclo de aprendizado");
    }
  };

  const runTick = async () => {
    if (stopped) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;
    // Roda entre 3h e 4h da manhã (janela de baixo tráfego)
    const hour = new Date().getHours();
    if (hour < 3 || hour > 4) return;
    await runCycle("scheduled");
  };

  // Bootstrap: roda imediatamente se não há padrões aprendidos ainda
  // Garante que o learningEngine tem dados assim que o servidor sobe
  setTimeout(async () => {
    if (stopped) return;
    try {
      const existing = await laraOperationalStore.listLearnedPatterns().catch(() => []);
      if (existing.length === 0) {
        logger?.info?.({ modulo: "learning-engine" }, "Bootstrap: nenhum padrão encontrado — executando ciclo inicial de aprendizado");
        await runCycle("bootstrap");
      }
    } catch (err) {
      console.error("[learningEngine] Falha no bootstrap inicial:", String(err));
    }
  }, 2 * 60 * 1000); // aguarda 2 min apos startup para DB estar disponivel

  const timer = setInterval(() => void runTick(), TICK_MS);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}

export { horaBloco, horaBloco2Label };
