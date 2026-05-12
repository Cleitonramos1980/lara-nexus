import type { LaraNextAction, LaraRisco, LaraSentimentResult, LaraPropensityLevel } from "./types.js";
import type { LaraIntent } from "./utils.js";
import { getLearnedRecommendation } from "./learningEngine.js";
import { selectBanditAction, makeBanditPatternKey } from "./banditsEngine.js";
import { predictPropensity } from "./propensityModel.js";
import { predictUplift } from "./upliftModel.js";
import { getMultiObjectiveRecommendation } from "./multiObjectiveOptimizer.js";

export type NextBestActionInput = {
  intent: LaraIntent;
  confidence: number;
  etapaRegua: string;
  risco: LaraRisco;
  perfilVulneravel: boolean;
  policyAllowed: boolean;
  mensagensOutboundUltimas24h: number;
  promessasEmAberto: number;
  initiatedByCustomer?: boolean;
  sentiment?: LaraSentimentResult | null;
  propensityLevel?: LaraPropensityLevel | null;
  negociacaoAtiva?: boolean;
};

export type NextBestActionResult = {
  action: LaraNextAction;
  reason: string;
  prioridade: "critica" | "alta" | "normal" | "baixa";
  contexto?: string;
  learned?: boolean; // indica se foi baseado em padrão aprendido
};

// Ações que NUNCA podem ser sobrescritas por padrões aprendidos
// (regras de segurança, compliance e proteção do cliente)
const SAFE_GUARD_ACTIONS: Set<LaraNextAction> = new Set([
  "pausar_contato",
  "escalar_humano",
]);

export async function chooseNextBestAction(input: NextBestActionInput): Promise<NextBestActionResult> {
  // ── 1. Política bloqueou ──────────────────────────────────────────────────
  if (!input.policyAllowed) {
    return {
      action: "pausar_contato",
      reason: "Policy engine bloqueou o contato automático (horário, opt-out ou frequência).",
      prioridade: "alta",
    };
  }

  // ── 2. Sentimento crítico → escalar imediatamente ────────────────────────
  if (input.sentiment?.requer_escalacao_imediata) {
    return {
      action: "escalar_humano",
      reason: `Sentimento crítico detectado: ${input.sentiment.keywords_detectadas.slice(0, 3).join(", ")}. Escalação de emergência.`,
      prioridade: "critica",
      contexto: "sentimento_critico",
    };
  }

  // ── 3. Stress alto + D+15/D+30 → escalação empática ─────────────────────
  if (
    input.sentiment?.stress_level === 2
    && ["D+15", "D+30"].includes(String(input.etapaRegua).toUpperCase())
  ) {
    return {
      action: "escalar_humano",
      reason: "Stress elevado em etapa avançada. Abordagem empática humana recomendada.",
      prioridade: "alta",
      contexto: "stress_etapa_avancada",
    };
  }

  // ── 4. Confiança baixa na classificação ──────────────────────────────────
  if (input.confidence < 0.55) {
    return {
      action: "escalar_humano",
      reason: "Confiança baixa na classificação da intenção.",
      prioridade: "normal",
    };
  }

  // ── 5. Perfil vulnerável ──────────────────────────────────────────────────
  if (input.perfilVulneravel) {
    return {
      action: "escalar_humano",
      reason: "Perfil vulnerável identificado, priorizando abordagem assistida.",
      prioridade: "alta",
    };
  }

  // ── 6. Frequência de contato alta ─────────────────────────────────────────
  if (!input.initiatedByCustomer && input.mensagensOutboundUltimas24h >= 5) {
    return {
      action: "pausar_contato",
      reason: "Frequência de contato alta nas últimas 24h.",
      prioridade: "normal",
    };
  }

  // ── 7. Intenções explícitas do cliente (alta confiança) ───────────────────
  // Estas só são superadas por padrões aprendidos com taxa de sucesso muito alta
  if (input.intent === "falar_humano") {
    return {
      action: "escalar_humano",
      reason: "Solicitação explícita de atendimento humano.",
      prioridade: "alta",
    };
  }

  // ── 8. Consulta padrão aprendido ──────────────────────────────────────────
  // Antes de aplicar as regras padrão, verifica se o learningEngine tem uma
  // recomendação melhor para este perfil específico.
  const hora = new Date().getHours();
  const learnedPattern = await getLearnedRecommendation({
    etapa: input.etapaRegua,
    risco: input.risco,
    intent: input.intent,
    hora,
  }).catch(() => null);

  if (
    learnedPattern
    && learnedPattern.is_active
    && learnedPattern.sample_count >= 20
    && learnedPattern.success_rate >= 0.65
    && !SAFE_GUARD_ACTIONS.has(learnedPattern.action_recommended as LaraNextAction)
  ) {
    const rate = Math.round(learnedPattern.success_rate * 100);
    return {
      action: learnedPattern.action_recommended as LaraNextAction,
      reason: `Padrão aprendido: ${rate}% de conversão para este perfil (${learnedPattern.sample_count} amostras).`,
      prioridade: learnedPattern.success_rate >= 0.8 ? "alta" : "normal",
      learned: true,
    };
  }

  // ── 8a. ML Ensemble: Uplift + Bandit + Multi-Objective ───────────────────
  // Ativa somente para intenções ambíguas/neutras — intenções explícitas do
  // cliente são atendidas diretamente nas regras abaixo.
  const EXPLICIT_INTENTS = new Set<LaraIntent>([
    "solicitar_boleto", "solicitar_pix", "solicitar_pagamento",
    "solicitar_negociacao", "promessa_pagamento", "falar_humano",
    "confirmacao_contexto",
  ]);

  if (!EXPLICIT_INTENTS.has(input.intent)) {
    const horaBloco = hora < 6 ? 0 : hora < 12 ? 1 : hora < 18 ? 2 : 3;
    const diaSemana = new Date().getDay();

    // Uplift causal: se contato agora prejudica P(pagamento) → pausar
    const uplift = predictUplift({
      etapa: input.etapaRegua,
      risco: input.risco,
      hora_contato: hora,
      dia_semana: diaSemana,
    });
    if (
      uplift
      && uplift.confidence >= 0.5
      && uplift.uplift < -0.1
      && !input.initiatedByCustomer
    ) {
      return {
        action: "pausar_contato",
        reason: `Uplift causal negativo (${(uplift.uplift * 100).toFixed(1)}%): contato agora reduz P(pagamento). Aguardando momento ótimo.`,
        prioridade: "normal",
        learned: true,
      };
    }

    // Propensity model: P(pagamento em 48h) para enriquecer o contexto
    const mlPropensity = predictPropensity({
      etapa: input.etapaRegua,
      risco: input.risco,
      hora_contato: hora,
      dia_semana: diaSemana,
    });

    // Bandit (Thompson Sampling)
    const patternKey = makeBanditPatternKey(input.etapaRegua, input.risco, horaBloco);
    const candidateActions: LaraNextAction[] = [
      "enviar_pix", "enviar_boleto", "apresentar_opcoes_pagamento",
      "negociar_autonomamente", "registrar_promessa",
    ];
    const banditRec = selectBanditAction(patternKey, candidateActions);

    // Multi-objetivo (Pareto)
    const moRec = await getMultiObjectiveRecommendation(
      input.etapaRegua,
      input.risco,
      candidateActions,
    ).catch(() => null);

    // Consenso bandit + Pareto → decisão de maior confiança
    if (
      banditRec
      && moRec
      && banditRec.action === moRec.best_action
      && !SAFE_GUARD_ACTIONS.has(banditRec.action as LaraNextAction)
    ) {
      const pStr = mlPropensity.trained
        ? ` · P(pgto)=${(mlPropensity.probability * 100).toFixed(0)}%`
        : "";
      return {
        action: banditRec.action as LaraNextAction,
        reason: `Consenso ML — Bandit ${(banditRec.sampled_rate * 100).toFixed(1)}% + Pareto ${(moRec.utility * 100).toFixed(1)}%${pStr}.`,
        prioridade: banditRec.sampled_rate >= 0.7 ? "alta" : "normal",
        learned: true,
      };
    }

    // Somente bandit com alta certeza
    if (
      banditRec
      && !banditRec.exploration
      && banditRec.sampled_rate >= 0.6
      && !SAFE_GUARD_ACTIONS.has(banditRec.action as LaraNextAction)
    ) {
      return {
        action: banditRec.action as LaraNextAction,
        reason: `Thompson Sampling: ação com maior taxa amostrada (${(banditRec.sampled_rate * 100).toFixed(1)}%) neste contexto.`,
        prioridade: "normal",
        learned: true,
      };
    }

    // Somente Pareto com ação na fronteira e alta utilidade
    if (
      moRec
      && moRec.pareto_rank === 1
      && moRec.utility >= 0.6
      && !SAFE_GUARD_ACTIONS.has(moRec.best_action as LaraNextAction)
    ) {
      return {
        action: moRec.best_action as LaraNextAction,
        reason: `Otimização multi-objetivo: ação Pareto-ótima (utilidade ${(moRec.utility * 100).toFixed(1)}%).`,
        prioridade: "normal",
        learned: true,
      };
    }
  }

  // ── 9. Regras de negócio padrão ───────────────────────────────────────────

  if (input.intent === "solicitar_boleto") {
    return {
      action: "enviar_boleto",
      reason: "Cliente solicitou boleto.",
      prioridade: "alta",
    };
  }

  if (input.intent === "solicitar_pix") {
    return {
      action: "enviar_pix",
      reason: "Cliente solicitou PIX.",
      prioridade: "alta",
    };
  }

  if (input.intent === "solicitar_pagamento") {
    return {
      action: "apresentar_opcoes_pagamento",
      reason: "Cliente quer pagar mas não especificou o método. Apresentar opções PIX/boleto.",
      prioridade: "alta",
    };
  }

  if (input.intent === "solicitar_negociacao") {
    return {
      action: "negociar_autonomamente",
      reason: "Cliente sinalizou interesse em negociação, parcelamento ou acordo.",
      prioridade: "alta",
    };
  }

  if (input.intent === "promessa_pagamento") {
    return {
      action: "registrar_promessa",
      reason: "Cliente informou intenção de pagamento.",
      prioridade: "alta",
    };
  }

  // ── 10. Confirmação com proposta de negociação aguardando ─────────────────
  if (input.intent === "confirmacao_contexto" && input.negociacaoAtiva) {
    return {
      action: "negociar_autonomamente",
      reason: "Cliente confirmou proposta de negociação em andamento.",
      prioridade: "alta",
      contexto: "confirmacao_proposta",
    };
  }

  // ── 11. Promessa em aberto + propensão ────────────────────────────────────
  if (input.promessasEmAberto > 0) {
    const action =
      input.propensityLevel === "muito_alto" || input.propensityLevel === "alto"
        ? "registrar_promessa"
        : "negociar_autonomamente";
    return {
      action,
      reason: "Promessa em aberto. Verificando situação e propondo regularização.",
      prioridade: "alta",
    };
  }

  // ── 12. Etapa avançada ou risco crítico ──────────────────────────────────
  if (
    ["D+15", "D+30"].includes(String(input.etapaRegua || "").toUpperCase())
    || input.risco === "critico"
  ) {
    if (
      input.propensityLevel === "medio"
      || input.propensityLevel === "alto"
      || input.propensityLevel === "muito_alto"
    ) {
      return {
        action: "negociar_autonomamente",
        reason: "Etapa avançada com propensão razoável. Oferece acordo antes de escalar.",
        prioridade: "alta",
      };
    }
    return {
      action: "escalar_humano",
      reason: "Etapa avançada ou risco crítico com baixa propensão. Estratégia assistida.",
      prioridade: "alta",
    };
  }

  // ── 13. Propensão baixa com stress moderado → negociação autônoma ─────────
  if (
    (input.propensityLevel === "baixo" || input.propensityLevel === "muito_baixo")
    && (input.sentiment?.stress_level ?? 0) >= 1
  ) {
    return {
      action: "negociar_autonomamente",
      reason: "Baixa propensão com sinal de dificuldade financeira. Oferece parcelamento.",
      prioridade: "normal",
    };
  }

  // ── 14. Default ──────────────────────────────────────────────────────────
  return {
    action: "resposta_padrao",
    reason: "Fluxo padrão de cobrança orientado por etapa e intenção.",
    prioridade: "normal",
  };
}
