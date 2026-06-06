function maskDocument(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  return value;
}

export function maskSensitiveText(value: string | null | undefined) {
  if (!value) return "";

  return String(value)
    .replace(/\b\d{11,14}\b/g, (match) => maskDocument(match))
    .replace(/([A-Z0-9._%+-]{2})[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/\b(\+?55)?\d{10,11}\b/g, "***telefone***")
    .replace(
      /\b(api[_-]?key|token|authorization|senha|password|secret|client_secret|connection_string|oracle|bradesco|openai)\b\s*[:=]\s*["']?[^"',\s}]+/gi,
      "$1: ***",
    );
}
