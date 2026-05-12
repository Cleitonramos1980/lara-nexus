/**
 * Lara — A/B Testing de Templates de Régua
 *
 * Permite criar variantes A/B/C de templates por etapa e distribuir clientes
 * entre elas com pesos configuráveis. Registra qual variante foi usada para
 * que o feedbackAggregator possa calcular qual converte mais.
 *
 * Integração:
 *   - Templates com campo `variante` (A/B/C) e `peso_distribuicao` (0-100)
 *   - Seleção weighted-random na hora do disparo
 *   - Resultado registrado no feedback loop
 */

import type { LaraReguaTemplate } from "./types.js";
import { generateLaraId } from "./utils.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TemplateVariante = "A" | "B" | "C";

export type TemplateComVariante = LaraReguaTemplate & {
  variante: TemplateVariante;
  peso_distribuicao: number;  // 0–100, soma das variantes ativas deve ≈ 100
  taxa_conversao_7d?: number; // % de pagamentos nos últimos 7 dias (auto-calculado)
};

export type ABTestResult = {
  template: TemplateComVariante;
  variante_escolhida: TemplateVariante;
  motivo: string;
};

// ─── Seleção por Peso ─────────────────────────────────────────────────────────

/**
 * Seleciona um template usando distribuição ponderada (weighted random).
 * Se nenhuma variante estiver configurada, retorna o primeiro template ativo.
 */
export function selecionarTemplateAB(
  templates: LaraReguaTemplate[],
  etapa: string,
): ABTestResult | null {
  const ativos = templates.filter(
    (t) => t.etapa === etapa && t.ativo,
  ) as TemplateComVariante[];

  if (ativos.length === 0) return null;

  // Sem A/B: retorna o de menor ordem_execucao
  const semVariante = ativos.filter((t) => !t.variante);
  if (semVariante.length > 0 || ativos.every((t) => !t.peso_distribuicao)) {
    const escolhido = ativos.sort((a, b) => (a.ordem_execucao ?? 0) - (b.ordem_execucao ?? 0))[0];
    return {
      template: escolhido,
      variante_escolhida: (escolhido.variante ?? "A") as TemplateVariante,
      motivo: "único template ativo para etapa",
    };
  }

  // Weighted random
  const totalPeso = ativos.reduce((sum, t) => sum + (t.peso_distribuicao ?? 0), 0);
  if (totalPeso <= 0) {
    return {
      template: ativos[0],
      variante_escolhida: (ativos[0].variante ?? "A") as TemplateVariante,
      motivo: "pesos zerados — fallback para primeiro",
    };
  }

  let rand = Math.random() * totalPeso;
  for (const t of ativos) {
    rand -= t.peso_distribuicao ?? 0;
    if (rand <= 0) {
      return {
        template: t,
        variante_escolhida: (t.variante ?? "A") as TemplateVariante,
        motivo: `selecionado por peso ${t.peso_distribuicao}/${totalPeso} (variante ${t.variante ?? "A"})`,
      };
    }
  }

  // Fallback (floating point edge case)
  return {
    template: ativos[ativos.length - 1],
    variante_escolhida: (ativos[ativos.length - 1].variante ?? "A") as TemplateVariante,
    motivo: "fallback de precisão numérica",
  };
}

// ─── Análise de Performance por Variante ──────────────────────────────────────

export type VariantePerformance = {
  variante: TemplateVariante;
  template_id: string;
  nome_template: string;
  total_disparos: number;
  total_respostas: number;
  total_pagamentos: number;
  taxa_resposta: number;    // 0–100%
  taxa_conversao: number;   // 0–100%
  vencedor: boolean;
};

/**
 * Analisa qual variante está convertendo melhor com base nos registros de feedback.
 * feedbacks deve ser o array retornado por operationalStore.listFeedbackInteracoes().
 */
export function analisarVariantes(
  templates: TemplateComVariante[],
  feedbacks: {
    acao: string;
    resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
    etapa: string;
  }[],
  etapa: string,
): VariantePerformance[] {
  const templatesDaEtapa = templates.filter((t) => t.etapa === etapa && t.ativo);

  return templatesDaEtapa.map((t) => {
    // O feedback é registrado com acao = `template:{id}:{variante}`
    const chave = `template:${t.id}:${t.variante ?? "A"}`;
    const registros = feedbacks.filter((f) => f.acao === chave || f.etapa === etapa);

    const total = registros.length || 1;
    const respostas = registros.filter((f) => f.resultado === "respondeu" || f.resultado === "pagou").length;
    const pagamentos = registros.filter((f) => f.resultado === "pagou").length;

    return {
      variante: (t.variante ?? "A") as TemplateVariante,
      template_id: t.id,
      nome_template: t.nome_template,
      total_disparos: total,
      total_respostas: respostas,
      total_pagamentos: pagamentos,
      taxa_resposta: Math.round((respostas / total) * 1000) / 10,
      taxa_conversao: Math.round((pagamentos / total) * 1000) / 10,
      vencedor: false,
    };
  }).map((p, _i, arr) => ({
    ...p,
    vencedor: p.taxa_conversao === Math.max(...arr.map((x) => x.taxa_conversao)),
  }));
}

// ─── Helper: cria variante B de um template existente ────────────────────────

export function criarVarianteB(
  templateOriginal: LaraReguaTemplate,
  mensagemVarianteB: string,
): TemplateComVariante {
  return {
    ...templateOriginal,
    id: generateLaraId("TMP"),
    nome_template: `${templateOriginal.nome_template} — Variante B`,
    mensagem_template: mensagemVarianteB,
    variante: "B",
    peso_distribuicao: 30,  // começa com 30% de tráfego
    taxa_conversao_7d: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
