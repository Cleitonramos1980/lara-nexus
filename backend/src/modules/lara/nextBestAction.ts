import type { LaraNextAction, LaraRisco } from "./types.js";
import type { LaraIntent } from "./utils.js";

export type NextBestActionInput = {
  intent: LaraIntent;
  confidence: number;
  etapaRegua: string;
  risco: LaraRisco;
  perfilVulneravel: boolean;
  policyAllowed: boolean;
  mensagensOutboundUltimas24h: number;
  promessasEmAberto: number;
};

export type NextBestActionResult = {
  action: LaraNextAction;
  reason: string;
};

export function chooseNextBestAction(input: NextBestActionInput): NextBestActionResult {
  if (!input.policyAllowed) {
    return {
      action: "pausar_contato",
      reason: "Policy engine bloqueou contato automatico.",
    };
  }

  if (input.confidence < 0.55) {
    return {
      action: "escalar_humano",
      reason: "Confianca baixa na classificacao da intencao.",
    };
  }

  if (input.perfilVulneravel) {
    return {
      action: "escalar_humano",
      reason: "Perfil vulneravel identificado, priorizando abordagem assistida.",
    };
  }

  if (input.mensagensOutboundUltimas24h >= 5) {
    return {
      action: "pausar_contato",
      reason: "Frequencia de contato alta nas ultimas 24h.",
    };
  }

  if (input.intent === "falar_humano") {
    return {
      action: "escalar_humano",
      reason: "Solicitacao explicita de atendimento humano.",
    };
  }

  if (input.intent === "solicitar_boleto") {
    return {
      action: "enviar_boleto",
      reason: "Cliente solicitou boleto.",
    };
  }

  if (input.intent === "solicitar_pix") {
    return {
      action: "enviar_pix",
      reason: "Cliente solicitou PIX.",
    };
  }

  if (input.intent === "promessa_pagamento") {
    return {
      action: "registrar_promessa",
      reason: "Cliente informou intencao de pagamento.",
    };
  }

  if (input.promessasEmAberto > 0) {
    return {
      action: "negociar",
      reason: "Existe promessa aberta; recomenda-se negociacao de acompanhamento.",
    };
  }

  if (["D+15", "D+30"].includes(String(input.etapaRegua || "").toUpperCase()) || input.risco === "critico") {
    return {
      action: "escalar_humano",
      reason: "Etapa avancada ou risco critico exige estrategia assistida.",
    };
  }

  return {
    action: "resposta_padrao",
    reason: "Fluxo padrao de cobranca orientada por etapa e intencao.",
  };
}
