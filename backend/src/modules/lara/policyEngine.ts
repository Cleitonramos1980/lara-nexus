import type { LaraCanal, LaraJurisdicao } from "./types.js";

export type PolicyEvaluationInput = {
  now: Date;
  timezone: string;
  tenantId: string;
  waId: string;
  jurisdicao: LaraJurisdicao;
  canal: LaraCanal;
  initiatedByCustomer?: boolean;
  optoutAtivo: boolean;
  perfilVulneravel: boolean;
  etapaRegua: string;
  mensagensOutboundUltimas24h: number;
  cooldownMinutos: number;
};

export type PolicyEvaluation = {
  permitido: boolean;
  baseLegal: string;
  razao: string;
  revisaoHumanaDisponivel: boolean;
  proximoHorarioPermitido?: string;
};

type ContactWindow = {
  fromHour: number;
  toHour: number;
};

const JURISDICTION_WINDOWS: Record<LaraJurisdicao, ContactWindow> = {
  BR: { fromHour: 8, toHour: 20 },
  US: { fromHour: 8, toHour: 21 },
  EU: { fromHour: 8, toHour: 20 },
  UK: { fromHour: 8, toHour: 20 },
  GLOBAL: { fromHour: 8, toHour: 20 },
};

const LEGAL_BASIS_BY_JURISDICTION: Record<LaraJurisdicao, string> = {
  BR: "LGPD Art. 7, X (protecao do credito) + CDC Art. 42 + Lei 14.181/2021",
  US: "FDCPA + state rules + TCPA consent governance",
  EU: "GDPR (Arts. 5, 6, 22) + AI Act risk-based obligations",
  UK: "UK GDPR + FCA Consumer Duty",
  GLOBAL: "NIST AI RMF controls + local consumer protection law",
};

function getLocalHour(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(now));
}

function isAllowedHour(now: Date, timezone: string, jurisdicao: LaraJurisdicao): boolean {
  const window = JURISDICTION_WINDOWS[jurisdicao] || JURISDICTION_WINDOWS.GLOBAL;
  const hour = getLocalHour(now, timezone);
  return hour >= window.fromHour && hour < window.toHour;
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const baseLegal = LEGAL_BASIS_BY_JURISDICTION[input.jurisdicao] || LEGAL_BASIS_BY_JURISDICTION.GLOBAL;

  if (input.optoutAtivo) {
    return {
      permitido: false,
      baseLegal,
      razao: "Contato bloqueado por opt-out ativo.",
      revisaoHumanaDisponivel: true,
    };
  }

  if (input.initiatedByCustomer) {
    return {
      permitido: true,
      baseLegal,
      razao: "Contato reativo permitido por iniciacao explicita do cliente.",
      revisaoHumanaDisponivel: true,
    };
  }

  if (!isAllowedHour(input.now, input.timezone, input.jurisdicao)) {
    return {
      permitido: false,
      baseLegal,
      razao: "Fora da janela permitida de contato para a jurisdicao.",
      revisaoHumanaDisponivel: true,
      proximoHorarioPermitido: "Proximo horario util local",
    };
  }

  if (input.perfilVulneravel && ["D+15", "D+30"].includes(String(input.etapaRegua || "").toUpperCase())) {
    return {
      permitido: false,
      baseLegal,
      razao: "Perfil vulneravel requer revisao humana em etapas de pressao alta.",
      revisaoHumanaDisponivel: true,
    };
  }

  const maxOutbound24h = input.canal === "WHATSAPP" ? 6 : 4;
  if (input.mensagensOutboundUltimas24h >= maxOutbound24h) {
    return {
      permitido: false,
      baseLegal,
      razao: "Limite de frequencia de contato por 24h atingido.",
      revisaoHumanaDisponivel: true,
    };
  }

  if (input.cooldownMinutos > 0 && input.mensagensOutboundUltimas24h > 0 && input.canal === "WHATSAPP") {
    return {
      permitido: true,
      baseLegal,
      razao: "Contato permitido com controles de frequencia e horario aplicados.",
      revisaoHumanaDisponivel: true,
    };
  }

  return {
    permitido: true,
    baseLegal,
    razao: "Contato permitido pelas politicas de compliance.",
    revisaoHumanaDisponivel: true,
  };
}
