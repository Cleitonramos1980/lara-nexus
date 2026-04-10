import { createHash, randomUUID } from "node:crypto";
import type { LaraRisco } from "./types.js";

const boletoIntentPatterns = [
  /\bboleto\b/,
  /\bsegunda via\b/,
  /\benviar boleto\b/,
  /\bmanda o boleto\b/,
];

const pixIntentPatterns = [
  /\bpix\b/,
  /\bcopia e cola\b/,
  /\bchave pix\b/,
];

const confirmIntentPatterns = [
  /\bok\b/,
  /\bpode mandar\b/,
  /\benvia\b/,
  /\bme manda\b/,
  /\bmanda\b/,
];

const humanIntentPatterns = [
  /\batendente\b/,
  /\bhumano\b/,
  /\boperador\b/,
  /\bfalar com/i,
];

const optOutIntentPatterns = [
  /\bpare\b/,
  /\bparar\b/,
  /\bn[aã]o (quero|desejo) (mais )?(mensagem|mensagens|contato)\b/,
  /\bremover\b/,
  /\bdescadastrar\b/,
  /\bopt[- ]?out\b/,
];

const promessaIntentPatterns = [
  /\bpromessa\b/,
  /\bpago (amanh[aã]|hoje|dia|em)\b/,
  /\bvou pagar\b/,
  /\bpagamento\b/,
];

function removeAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizePhone(input: string): string {
  const digits = String(input ?? "").replace(/\D+/g, "");
  if (!digits) return "";

  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  if (digits.length > 11 && !digits.startsWith("55")) return `55${digits}`;
  return digits;
}

export function buildPhoneCandidates(input: string): string[] {
  const normalized = normalizePhone(input);
  const rawDigits = String(input ?? "").replace(/\D+/g, "");
  const set = new Set<string>();
  if (normalized) set.add(normalized);
  if (rawDigits) set.add(rawDigits);

  if (normalized.startsWith("55")) {
    set.add(normalized.slice(2));
    if (normalized.length >= 13) {
      const ddd = normalized.slice(2, 4);
      const local = normalized.slice(4);
      if (local.length === 9 && local.startsWith("9")) {
        set.add(`${ddd}${local.slice(1)}`);
      }
      if (local.length === 8) {
        set.add(`${ddd}9${local}`);
      }
    }
  }

  return Array.from(set).filter(Boolean);
}

export function normalizeWaId(input: string): string {
  return normalizePhone(input);
}

export function safeText(input: unknown): string {
  return String(input ?? "").trim().replace(/\s+/g, " ");
}

export function maskCpfCnpj(document: string): string {
  const digits = String(document ?? "").replace(/\D+/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  }
  return "***";
}

export function maskPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}*****${digits.slice(-2)}`;
}

export function dateToIsoDate(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateToIsoDateTime(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function dateToOracleTimestamp(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}.${ms}`;
}

export function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function roundMoney(value: number): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function inferRisk(maxDiasAtraso: number, totalAberto: number): LaraRisco {
  if (maxDiasAtraso >= 180 || totalAberto >= 100000) return "critico";
  if (maxDiasAtraso >= 60 || totalAberto >= 40000) return "alto";
  if (maxDiasAtraso >= 15 || totalAberto >= 10000) return "medio";
  return "baixo";
}

export function inferEtapaRegua(maxDiasAtraso: number): string {
  if (maxDiasAtraso < 0) return "D-3";
  if (maxDiasAtraso === 0) return "D0";
  if (maxDiasAtraso <= 3) return "D+3";
  if (maxDiasAtraso <= 7) return "D+7";
  if (maxDiasAtraso <= 15) return "D+15";
  return "D+30";
}

export type LaraIntent =
  | "solicitar_boleto"
  | "solicitar_pix"
  | "confirmacao_contexto"
  | "promessa_pagamento"
  | "falar_humano"
  | "optout"
  | "neutro";

export function detectIntent(messageText: string): LaraIntent {
  const normalized = removeAccents(safeText(messageText).toLowerCase());
  if (!normalized) return "neutro";
  if (optOutIntentPatterns.some((pattern) => pattern.test(normalized))) return "optout";
  if (humanIntentPatterns.some((pattern) => pattern.test(normalized))) return "falar_humano";
  if (pixIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_pix";
  if (boletoIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_boleto";
  if (promessaIntentPatterns.some((pattern) => pattern.test(normalized))) return "promessa_pagamento";
  if (confirmIntentPatterns.some((pattern) => pattern.test(normalized))) return "confirmacao_contexto";
  return "neutro";
}

export function extractDocumentFromText(messageText: string): string | null {
  const digits = String(messageText ?? "").replace(/\D+/g, "");
  if (digits.length >= 14) {
    return digits.slice(0, 14);
  }
  if (digits.length >= 11) {
    return digits.slice(0, 11);
  }
  return null;
}

export function extractPromessaDate(messageText: string): string | null {
  const normalized = removeAccents(safeText(messageText).toLowerCase());
  if (!normalized) return null;

  if (normalized.includes("amanha")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateToIsoDate(d);
  }
  if (normalized.includes("hoje")) {
    return dateToIsoDate(new Date());
  }

  const ddmmyyyy = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]) - 1;
    const year = Number(ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3]);
    const d = new Date(year, month, day);
    if (Number.isFinite(d.getTime())) return dateToIsoDate(d);
  }

  const dayOnly = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const now = new Date();
    const day = Number(dayOnly[1]);
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d < now) d.setMonth(d.getMonth() + 1);
    return dateToIsoDate(d);
  }

  return null;
}

export function generateLaraId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function makeIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  const payload = parts.map((item) => String(item ?? "")).join("|");
  return createHash("sha1").update(payload).digest("hex");
}

export function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function containsAnyTerm(input: string, terms: string[]): boolean {
  const normalized = removeAccents(safeText(input).toLowerCase());
  return terms.some((term) => normalized.includes(removeAccents(term.toLowerCase())));
}
