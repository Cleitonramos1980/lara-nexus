/**
 * Lara — Orquestrador de Canais (Omnichannel)
 * Gerencia fallback automático entre canais: WhatsApp → Email → SMS.
 * Registra tentativas e resultados para alimentar o score de propensão.
 */

import type { LaraCanal } from "./types.js";

export type CanalTentativa = {
  canal: LaraCanal;
  tentado_em: string;
  status: "enviado" | "falhou" | "sem_contato" | "pendente";
  detalhe?: string;
};

export type OrchestrationDecision = {
  canal_escolhido: LaraCanal;
  motivo: string;
  fallback_disponivel: boolean;
  proximo_canal?: LaraCanal;
};

export type ContatoDisponivel = {
  wa_id?: string;
  telefone?: string;
  email?: string;
};

/**
 * Decide qual canal usar baseado na disponibilidade de contato e histórico de tentativas.
 */
export function decidirCanal(
  contato: ContatoDisponivel,
  tentativasAnteriores: CanalTentativa[],
): OrchestrationDecision {
  const canalFalhou = (canal: LaraCanal) =>
    tentativasAnteriores.some(
      (t) => t.canal === canal && (t.status === "falhou" || t.status === "sem_contato"),
    );

  // WhatsApp é sempre o primeiro canal
  if (contato.wa_id && !canalFalhou("WHATSAPP")) {
    return {
      canal_escolhido: "WHATSAPP",
      motivo: "Canal principal de comunicação",
      fallback_disponivel: Boolean(contato.email || contato.telefone),
      proximo_canal: contato.email ? "EMAIL" : contato.telefone ? "SMS" : undefined,
    };
  }

  // Fallback: Email
  if (contato.email && !canalFalhou("EMAIL")) {
    return {
      canal_escolhido: "EMAIL",
      motivo: "Fallback: WhatsApp sem resposta ou indisponível",
      fallback_disponivel: Boolean(contato.telefone),
      proximo_canal: contato.telefone ? "SMS" : undefined,
    };
  }

  // Fallback: SMS
  if (contato.telefone && !canalFalhou("SMS")) {
    return {
      canal_escolhido: "SMS",
      motivo: "Fallback: WhatsApp e Email sem resposta",
      fallback_disponivel: false,
    };
  }

  // Todos os canais falharam — retorna WhatsApp como default para nova tentativa
  return {
    canal_escolhido: "WHATSAPP",
    motivo: "Todos os canais tentados — nova tentativa via WhatsApp",
    fallback_disponivel: false,
  };
}

/**
 * Constrói mensagem de fallback para Email/SMS (texto simplificado).
 */
export function construirMensagemFallback(input: {
  canal: LaraCanal;
  nomeCliente: string;
  valorTotal: number;
  empresa: string;
  linkPortal?: string;
}): string {
  const valorFmt = Number(input.valorTotal).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const nomeAbrev = input.nomeCliente.split(" ")[0];

  if (input.canal === "EMAIL") {
    return [
      `Olá, ${nomeAbrev}!`,
      "",
      `A ${input.empresa} identificou um débito em aberto no valor de ${valorFmt}.`,
      "Para regularizar sua situação e evitar restrições, acesse nosso portal de pagamento:",
      "",
      input.linkPortal ? `🔗 ${input.linkPortal}` : "Entre em contato conosco via WhatsApp.",
      "",
      "Você também pode responder este e-mail que redirecionaremos para nossa equipe.",
      "",
      `Atenciosamente,\nEquipe ${input.empresa}`,
    ].join("\n");
  }

  // SMS — texto curto
  const portal = input.linkPortal ? ` Acesse: ${input.linkPortal}` : "";
  return `${input.empresa}: Olá ${nomeAbrev}, há débito de ${valorFmt} em aberto.${portal} Responda PARE para não receber mais mensagens.`;
}

/**
 * Verifica se deve tentar fallback baseado no tempo de espera sem resposta.
 */
export function deveAcionarFallback(input: {
  canal_atual: LaraCanal;
  horas_sem_resposta: number;
  tem_proximo_canal: boolean;
}): { acionar: boolean; motivo: string } {
  if (!input.tem_proximo_canal) {
    return { acionar: false, motivo: "Sem canal alternativo disponível" };
  }

  const thresholdHoras: Record<LaraCanal, number> = {
    WHATSAPP: 4,   // 4h sem resposta no WhatsApp → tenta email
    EMAIL: 24,     // 24h sem resposta no email → tenta SMS
    SMS: 48,       // 48h sem resposta no SMS → encerra ciclo
    VOICE: 72,
    OUTRO: 24,
  };

  const threshold = thresholdHoras[input.canal_atual] ?? 24;

  if (input.horas_sem_resposta >= threshold) {
    return {
      acionar: true,
      motivo: `${input.horas_sem_resposta}h sem resposta via ${input.canal_atual} (threshold: ${threshold}h)`,
    };
  }

  return { acionar: false, motivo: `Aguardando resposta (${input.horas_sem_resposta}h/${threshold}h)` };
}
