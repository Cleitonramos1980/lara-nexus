export function formatMoneyBRL(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatPercentBR(value: number | null | undefined, digits = 1) {
  const numeric = Number(value ?? 0);
  return `${numeric.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatDateBR(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
}

export function formatDateTimeBR(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatIntegerBR(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

export function getStatusVariant(status: string) {
  const normalized = status.toLowerCase();
  if (["ativo", "online", "pago", "baixado", "cumprida", "concluído"].includes(normalized)) return "success";
  if (["inativo", "offline", "erro", "falha", "crítico", "vencida", "quebrada"].includes(normalized)) return "destructive";
  if (["pendente", "instável", "aviso", "em homologação", "aguardando"].includes(normalized)) return "warning";
  return "default";
}

export function getRiskVariant(risk: string) {
  const normalized = risk.toLowerCase();
  if (normalized === "baixo") return "success";
  if (normalized === "médio" || normalized === "medio") return "warning";
  if (normalized === "alto") return "destructive";
  if (normalized === "crítico" || normalized === "critico") return "critical";
  return "default";
}

export function getSeverityVariant(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === "info" || normalized === "sucesso") return "info";
  if (normalized === "aviso") return "warning";
  if (normalized === "erro") return "destructive";
  if (normalized === "crítico" || normalized === "critico") return "critical";
  return "default";
}
