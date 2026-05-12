/**
 * Lara — Feedback Aggregator (Loop de Aprendizado)
 *
 * Lê LARA_INTEGRACOES_LOG (feedback-loop) + LARA_OUTCOME_TRACKING diariamente,
 * agrega os resultados e atualiza LARA_CONFIGURACOES com os pesos aprendidos.
 *
 * Melhorias v2:
 * - Incorpora dados de LARA_OUTCOME_TRACKING (outcomes concretos) além dos logs de integração
 * - Mantém histórico versionado (últimas 30 versões) em LARA_FEEDBACK_HISTORICO_JSON
 * - Calcula tendência de melhora/piora por etapa (compara com última execução)
 * - Exporta dados para o learningEngine usar no ciclo diário
 */

import { laraOperationalStore } from "./operationalStore.js";
import { listRecentOutcomes } from "./outcomeTracker.js";
import { dateToIsoDateTime } from "./utils.js";

export type FeedbackInsight = {
  melhor_canal_por_etapa: Record<string, string>;
  melhor_hora_por_etapa: Record<string, number>;
  taxa_conversao_por_acao: Record<string, number>;
  taxa_resposta_por_canal: Record<string, number>;
  etapas_com_alta_evasao: string[];
  tendencia_por_etapa: Record<string, "melhorando" | "piorando" | "estavel">;
  resumo: {
    total_interacoes: number;
    total_pagamentos: number;
    taxa_conversao_global: number;
    taxa_conversao_outcome: number;   // baseada em outcomes concretos (mais precisa)
    periodo_dias: number;
    calculado_em: string;
    versao: number;
  };
};

type FeedbackRow = {
  wa_id: string;
  codcli: string;
  etapa: string;
  acao: string;
  canal: string;
  hora_envio: number;
  resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
  tempo_resposta_min?: number;
  created_at: string;
};

const PERIODO_DIAS_ANALISE = 30;
const MAX_HISTORICO_VERSOES = 30;

const CHAVE_INSIGHTS = "LARA_FEEDBACK_INSIGHTS_JSON";
const CHAVE_MELHOR_HORA = "LARA_FEEDBACK_MELHOR_HORA_JSON";
const CHAVE_MELHOR_CANAL = "LARA_FEEDBACK_MELHOR_CANAL_JSON";
const CHAVE_PESOS_ACAO = "LARA_FEEDBACK_PESOS_ACAO_JSON";
const CHAVE_HISTORICO = "LARA_FEEDBACK_HISTORICO_JSON";

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}

function taxaPagamento(rows: FeedbackRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.resultado === "pagou").length / rows.length;
}

function taxaResposta(rows: FeedbackRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.resultado === "respondeu" || r.resultado === "pagou").length / rows.length;
}

function melhorChave<K extends string>(
  groups: Record<K, FeedbackRow[]>,
  scoreFn: (rows: FeedbackRow[]) => number,
  minAmostras = 5,
): K | null {
  let bestKey: K | null = null;
  let bestScore = -1;
  for (const [k, rows] of Object.entries(groups) as [K, FeedbackRow[]][]) {
    if (rows.length < minAmostras) continue;
    const s = scoreFn(rows);
    if (s > bestScore) { bestScore = s; bestKey = k; }
  }
  return bestKey;
}

function detectarTendencia(
  etapa: string,
  taxaAtual: number,
  historico: FeedbackInsight[],
): "melhorando" | "piorando" | "estavel" {
  if (historico.length < 2) return "estavel";
  const ultima = historico[historico.length - 1];
  if (!ultima) return "estavel";

  // Compara taxa de conversão da etapa na última execução
  const taxaAnterior = ultima.taxa_conversao_por_acao[etapa];
  if (taxaAnterior === undefined) return "estavel";

  const delta = taxaAtual - taxaAnterior;
  if (delta > 5) return "melhorando";
  if (delta < -5) return "piorando";
  return "estavel";
}

export async function aggregateFeedback(): Promise<FeedbackInsight> {
  // ── Carrega dados de ambas as fontes em paralelo ───────────────────────────
  const [feedbacks, outcomes, historicoCfg] = await Promise.all([
    laraOperationalStore.listFeedbackInteracoes(PERIODO_DIAS_ANALISE),
    listRecentOutcomes(PERIODO_DIAS_ANALISE).catch(() => []),
    laraOperationalStore.listConfiguracoes().catch(() => []),
  ]);

  // ── Lê versão atual do histórico ───────────────────────────────────────────
  const historicoCfgEntry = historicoCfg.find((c) => c.chave === CHAVE_HISTORICO);
  let historico: FeedbackInsight[] = [];
  try {
    historico = JSON.parse(historicoCfgEntry?.valor ?? "[]") as FeedbackInsight[];
    if (!Array.isArray(historico)) historico = [];
  } catch { historico = []; }

  const versaoAtual = (historico[historico.length - 1]?.resumo.versao ?? 0) + 1;

  // ── Métricas de outcome concreto (mais precisas) ───────────────────────────
  const paidOutcomes = outcomes.filter((o) => o.outcome === "pagou" || o.outcome === "prometeu_cumpriu");
  const taxaConversaoOutcome = outcomes.length > 0
    ? Math.round((paidOutcomes.length / outcomes.length) * 1000) / 10
    : 0;

  const total = feedbacks.length;
  const totalPagamentos = feedbacks.filter((f) => f.resultado === "pagou").length;

  // ── Por etapa ──────────────────────────────────────────────────────────────
  const porEtapa = groupBy(feedbacks, (f) => f.etapa || "desconhecida");
  const melhor_canal_por_etapa: Record<string, string> = {};
  const melhor_hora_por_etapa: Record<string, number> = {};
  const etapas_com_alta_evasao: string[] = [];
  const tendencia_por_etapa: Record<string, "melhorando" | "piorando" | "estavel"> = {};

  for (const [etapa, rows] of Object.entries(porEtapa)) {
    const porCanal = groupBy(rows, (r) => r.canal);
    const mc = melhorChave(porCanal, taxaPagamento);
    if (mc) melhor_canal_por_etapa[etapa] = mc;

    const porHora = groupBy(rows, (r) => String(r.hora_envio));
    const mh = melhorChave(porHora, taxaResposta, 3);
    if (mh !== null) melhor_hora_por_etapa[etapa] = Number(mh);

    const txIgnorou = rows.filter((r) => r.resultado === "ignorou").length / rows.length;
    if (txIgnorou > 0.6 && rows.length >= 10) etapas_com_alta_evasao.push(etapa);

    const taxaEtapa = Math.round(taxaPagamento(rows) * 1000) / 10;
    tendencia_por_etapa[etapa] = detectarTendencia(etapa, taxaEtapa, historico);
  }

  // ── Enriquece melhor hora com dados de outcome (mais granular) ─────────────
  if (outcomes.length > 0) {
    const outcomesByEtapa = groupBy(
      outcomes.filter((o) => o.outcome === "pagou" || o.outcome === "prometeu_cumpriu"),
      (o) => o.etapa || "desconhecida",
    );
    for (const [etapa, etapaOutcomes] of Object.entries(outcomesByEtapa)) {
      if (etapaOutcomes.length < 5) continue;
      const horaFreq: Record<number, number> = {};
      for (const o of etapaOutcomes) {
        horaFreq[o.hora_envio] = (horaFreq[o.hora_envio] ?? 0) + 1;
      }
      const melhorHora = Object.entries(horaFreq)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      if (melhorHora !== undefined) {
        melhor_hora_por_etapa[etapa] = Number(melhorHora);
      }
    }
  }

  // ── Por ação ───────────────────────────────────────────────────────────────
  const porAcao = groupBy(feedbacks, (f) => f.acao || "desconhecida");
  const taxa_conversao_por_acao: Record<string, number> = {};
  for (const [acao, rows] of Object.entries(porAcao)) {
    if (rows.length >= 5) {
      taxa_conversao_por_acao[acao] = Math.round(taxaPagamento(rows) * 1000) / 10;
    }
  }

  // Enriquece com outcomes concretos por ação
  if (outcomes.length > 0) {
    const porAcaoOutcome = groupBy(outcomes, (o) => o.action_taken || "desconhecida");
    for (const [acao, rows] of Object.entries(porAcaoOutcome)) {
      if (rows.length >= 5) {
        const rate = rows.filter((r) => r.outcome === "pagou" || r.outcome === "prometeu_cumpriu").length / rows.length;
        taxa_conversao_por_acao[`${acao}_outcome`] = Math.round(rate * 1000) / 10;
      }
    }
  }

  // ── Por canal ──────────────────────────────────────────────────────────────
  const porCanal = groupBy(feedbacks, (f) => f.canal);
  const taxa_resposta_por_canal: Record<string, number> = {};
  for (const [canal, rows] of Object.entries(porCanal)) {
    taxa_resposta_por_canal[canal] = Math.round(taxaResposta(rows) * 1000) / 10;
  }

  const insight: FeedbackInsight = {
    melhor_canal_por_etapa,
    melhor_hora_por_etapa,
    taxa_conversao_por_acao,
    taxa_resposta_por_canal,
    etapas_com_alta_evasao,
    tendencia_por_etapa,
    resumo: {
      total_interacoes: total,
      total_pagamentos: totalPagamentos,
      taxa_conversao_global: total > 0 ? Math.round((totalPagamentos / total) * 1000) / 10 : 0,
      taxa_conversao_outcome: taxaConversaoOutcome,
      periodo_dias: PERIODO_DIAS_ANALISE,
      calculado_em: dateToIsoDateTime(new Date()),
      versao: versaoAtual,
    },
  };

  // ── Atualiza histórico versionado ──────────────────────────────────────────
  historico.push(insight);
  if (historico.length > MAX_HISTORICO_VERSOES) {
    historico.splice(0, historico.length - MAX_HISTORICO_VERSOES);
  }

  // ── Persiste tudo em LARA_CONFIGURACOES ───────────────────────────────────
  await Promise.allSettled([
    laraOperationalStore.upsertConfiguracao(CHAVE_INSIGHTS, JSON.stringify(insight), "Insights agregados do feedback de interações (auto-gerado)"),
    laraOperationalStore.upsertConfiguracao(CHAVE_MELHOR_HORA, JSON.stringify(melhor_hora_por_etapa), "Melhor hora de contato por etapa (auto-aprendido)"),
    laraOperationalStore.upsertConfiguracao(CHAVE_MELHOR_CANAL, JSON.stringify(melhor_canal_por_etapa), "Melhor canal por etapa (auto-aprendido)"),
    laraOperationalStore.upsertConfiguracao(CHAVE_PESOS_ACAO, JSON.stringify(taxa_conversao_por_acao), "Taxa de conversão por ação (auto-aprendido)"),
    laraOperationalStore.upsertConfiguracao(CHAVE_HISTORICO, JSON.stringify(historico), "Histórico versionado de insights de feedback (auto-gerado)"),
  ]);

  return insight;
}

export async function getFeedbackInsights(): Promise<FeedbackInsight | null> {
  const configs = await laraOperationalStore.listConfiguracoes().catch(() => []);
  const cfg = configs.find((c) => c.chave === CHAVE_INSIGHTS);
  if (!cfg) return null;
  try { return JSON.parse(cfg.valor) as FeedbackInsight; } catch { return null; }
}

export async function getMelhorHoraPorEtapa(): Promise<Record<string, number>> {
  const configs = await laraOperationalStore.listConfiguracoes().catch(() => []);
  const cfg = configs.find((c) => c.chave === CHAVE_MELHOR_HORA);
  if (!cfg) return {};
  try { return JSON.parse(cfg.valor) as Record<string, number>; } catch { return {}; }
}

export async function getMelhorCanalPorEtapa(): Promise<Record<string, string>> {
  const configs = await laraOperationalStore.listConfiguracoes().catch(() => []);
  const cfg = configs.find((c) => c.chave === CHAVE_MELHOR_CANAL);
  if (!cfg) return {};
  try { return JSON.parse(cfg.valor) as Record<string, string>; } catch { return {}; }
}

export async function getFeedbackHistorico(): Promise<FeedbackInsight[]> {
  const configs = await laraOperationalStore.listConfiguracoes().catch(() => []);
  const cfg = configs.find((c) => c.chave === CHAVE_HISTORICO);
  if (!cfg) return [];
  try {
    const parsed = JSON.parse(cfg.valor);
    return Array.isArray(parsed) ? parsed as FeedbackInsight[] : [];
  } catch { return []; }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

type LoggerLike = {
  info?: (p: Record<string, unknown>, msg?: string) => void;
  warn?: (p: Record<string, unknown>, msg?: string) => void;
  error?: (p: Record<string, unknown>, msg?: string) => void;
};

const TICK_MS = 60 * 60 * 1000;

export function startFeedbackAggregatorScheduler(logger?: LoggerLike): () => void {
  let stopped = false;
  let lastRunDate = "";

  const runTick = async () => {
    if (stopped) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;

    const hour = new Date().getHours();
    if (hour < 7) return;

    lastRunDate = today;
    try {
      const insight = await aggregateFeedback();
      logger?.info?.(
        {
          modulo: "feedback-aggregator",
          ...insight.resumo,
          etapas_melhorando: Object.entries(insight.tendencia_por_etapa)
            .filter(([, t]) => t === "melhorando")
            .map(([e]) => e),
          etapas_piorando: Object.entries(insight.tendencia_por_etapa)
            .filter(([, t]) => t === "piorando")
            .map(([e]) => e),
        },
        "Feedback aggregator executado com sucesso",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.error?.({ modulo: "feedback-aggregator", erro: msg }, "Erro no feedback aggregator");
    }
  };

  void runTick();
  const timer = setInterval(() => void runTick(), TICK_MS);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
