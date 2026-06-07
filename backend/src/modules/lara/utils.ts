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
  /\bpagar (amanh[aã]|hoje|depois)\b/,
  /\bquero pagar (amanh[aã]|hoje|depois)\b/,
  /\bdepois de amanh[aã]\b/,
  /\bpagamento\b/,
  /\bagendar\b/,
  /\bagend[ao]\b/,
  /\bpagar.*dia\s+\d/,
  /\bdia\s+\d.*pagar\b/,
  /\bpara o dia\s+\d/,
  /\bno dia\s+\d/,
  // Dias da semana
  /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira)?\b/,
  /\bproxim[ao]\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/,
  // Fim / final de mês
  /\b(fim|final)\s+do\s+mes\b/,
  /\bultimo\s+dia\b/,
  // Próximo mês
  /\bmes\s+que\s+vem\b/,
  /\bproximo\s+mes\b/,
  /\bmes\s+seguinte\b/,
  // Semana que vem
  /\bsemana\s+que\s+vem\b/,
  /\bproxima\s+semana\b/,
  // Dia útil
  /\bdia\s+util\b/,
  /\bdias?\s+uteis?\b/,
];

const pagamentoIntentPatterns = [
  /\bquero pagar\b/,
  /\bdesejo pagar\b/,
  /\bpagar o titulo\b/,
  /\bpagar a duplicata\b/,
  /\bpagar essa\b/,
  /\bpagar esse\b/,
  /\bpagar os titulos\b/,
  /\bpagar as duplicatas\b/,
  /\bquero (efetuar|realizar|fazer) o pagamento\b/,
  /\bcomo (pago|efetuo|realizo|faço o pagamento)\b/,
  /\bforma[s]? de pagamento\b/,
  /\bop[cç][oõ]es de pagamento\b/,
];

export function removeAccents(input: string): string {
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

const negociacaoIntentPatterns = [
  /\bparcelar\b/,
  /\bparcelamento\b/,
  /\bnegociar\b/,
  /\bnegociação\b/,
  /\bnegociacao\b/,
  /\bdesconto\b/,
  /\bacordo\b/,
  /\bprazo\b/,
  /\bn[aã]o tenho o valor todo\b/,
  /\bpagar em partes\b/,
  /\bdivid(ir|er) o pagamento\b/,
  /\bcondi[cç][aã]o especial\b/,
];

// Exige contexto positivo explícito — evita falso-positivo em frases como "nao quero continuar"
const optInIntentPatterns = [
  /\bquero (continuar|voltar) (a )?(receber|receber mensagem)\b/,
  /\bpode (me )?enviar (novamente|de novo|mensagens)\b/,
  /\breativar\b/,
  /\bme inclua\b/,
  /\bquero (receber )?(mensagem|mensagens|contato)\b/,
  /\bvolta (a me enviar|a enviar)\b/,
  /\bopt[- ]?in\b/,
];

const pagamentoConfirmadoPatterns = [
  /^pago$/,
  /\bja paguei\b/,
  /\bpaguei( o titulo| o pix| o boleto| agora| hoje)?\b/,
  /\befetuei o pagamento\b/,
  /\bfiz o pagamento\b/,
  /\bfiz o pix\b/,
  /\brealizei o pagamento\b/,
  /\bpix (enviado|realizado|feito|efetuado)\b/,
  /\bpagamento (realizado|efetuado|feito|confirmado)\b/,
  /\bjá está pago\b/,
  /\bjá paguei\b/,
];

export type LaraIntent =
  | "solicitar_boleto"
  | "solicitar_pix"
  | "solicitar_pagamento"
  | "solicitar_negociacao"
  | "confirmacao_contexto"
  | "promessa_pagamento"
  | "pagamento_confirmado"
  | "falar_humano"
  | "optout"
  | "optin"
  | "neutro";

export function detectIntent(messageText: string): LaraIntent {
  const normalized = removeAccents(safeText(messageText).toLowerCase());
  if (!normalized) return "neutro";
  if (pagamentoConfirmadoPatterns.some((pattern) => pattern.test(normalized))) return "pagamento_confirmado";
  // optout antes de optin: frases como "nao quero continuar" devem ser opt-out, não opt-in
  if (optOutIntentPatterns.some((pattern) => pattern.test(normalized))) return "optout";
  if (optInIntentPatterns.some((pattern) => pattern.test(normalized))) return "optin";
  if (humanIntentPatterns.some((pattern) => pattern.test(normalized))) return "falar_humano";
  if (negociacaoIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_negociacao";
  if (pixIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_pix";
  if (boletoIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_boleto";
  if (pagamentoIntentPatterns.some((pattern) => pattern.test(normalized))) return "solicitar_pagamento";
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

function nthBusinessDay(year: number, month: number, n: number): Date {
  let count = 0;
  const d = new Date(year, month, 1);
  while (count < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    if (count < n) d.setDate(d.getDate() + 1);
  }
  return d;
}

function lastBusinessDay(year: number, month: number): Date {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

const ordinalWordToNumber: Record<string, number> = {
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, quinto: 5,
  sexto: 6, setimo: 7, oitavo: 8, nono: 9, decimo: 10,
};

export function extractPromessaDate(messageText: string): string | null {
  const normalized = removeAccents(safeText(messageText).toLowerCase());
  if (!normalized) return null;

  const today = new Date();

  // ── Relativo simples ──────────────────────────────────────────────────────
  if (/depois de amanh[aã]|depois de amanha/.test(normalized)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return dateToIsoDate(d);
  }
  if (/\bamanha\b/.test(normalized)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return dateToIsoDate(d);
  }
  if (/\bhoje\b/.test(normalized)) {
    return dateToIsoDate(today);
  }

  // ── Semana ────────────────────────────────────────────────────────────────
  if (/semana que vem|proxima semana|semana seguinte/.test(normalized)) {
    const d = new Date(today);
    const daysUntilNextMonday = ((1 - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + daysUntilNextMonday);
    return dateToIsoDate(d);
  }

  // ── Último dia útil do mês ────────────────────────────────────────────────
  // "ultimo dia util do mes que vem" — deve vir antes de "ultimo dia util"
  if (/ultimo\s+dia\s+util\s+(?:do\s+)?(?:mes que vem|proximo mes|mes seguinte)/.test(normalized)) {
    return dateToIsoDate(lastBusinessDay(today.getFullYear(), today.getMonth() + 1));
  }
  if (/ultimo\s+dia\s+util/.test(normalized)) {
    const candidate = lastBusinessDay(today.getFullYear(), today.getMonth());
    const d = candidate <= today
      ? lastBusinessDay(today.getFullYear(), today.getMonth() + 1)
      : candidate;
    return dateToIsoDate(d);
  }

  // ── Último dia do mês (calendário) ───────────────────────────────────────
  if (/ultimo\s+dia\s+(?:do\s+)?(?:mes que vem|proximo mes|mes seguinte)/.test(normalized)) {
    return dateToIsoDate(new Date(today.getFullYear(), today.getMonth() + 2, 0));
  }
  if (/ultimo\s+dia\s+do\s+mes|ultimo\s+dia\s+deste\s+mes/.test(normalized)) {
    return dateToIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  }

  // ── Nº dia útil do mês que vem ────────────────────────────────────────────
  const nthUtilProxMatch = normalized.match(
    /(\d+)[o°º]?\s*(?:dia[s]?\s+)?util(?:is)?\s+(?:do\s+)?(?:mes que vem|proximo mes|mes seguinte)/,
  );
  if (nthUtilProxMatch) {
    return dateToIsoDate(nthBusinessDay(today.getFullYear(), today.getMonth() + 1, Number(nthUtilProxMatch[1])));
  }
  // Ordinal por extenso: "quinto dia util do mes que vem"
  for (const [word, num] of Object.entries(ordinalWordToNumber)) {
    if (new RegExp(`${word}\\s+dia\\s+util(?:is)?\\s+(?:do\\s+)?(?:mes que vem|proximo mes|mes seguinte)`).test(normalized)) {
      return dateToIsoDate(nthBusinessDay(today.getFullYear(), today.getMonth() + 1, num));
    }
  }

  // ── Nº dia útil do mês atual ──────────────────────────────────────────────
  const nthUtilMatch = normalized.match(/(\d+)[o°º]?\s*(?:dia[s]?\s+)?util(?:is)?/);
  if (nthUtilMatch) {
    const n = Number(nthUtilMatch[1]);
    const candidate = nthBusinessDay(today.getFullYear(), today.getMonth(), n);
    const d = candidate <= today
      ? nthBusinessDay(today.getFullYear(), today.getMonth() + 1, n)
      : candidate;
    return dateToIsoDate(d);
  }
  for (const [word, num] of Object.entries(ordinalWordToNumber)) {
    if (new RegExp(`${word}\\s+dia\\s+util`).test(normalized)) {
      const candidate = nthBusinessDay(today.getFullYear(), today.getMonth(), num);
      const d = candidate <= today
        ? nthBusinessDay(today.getFullYear(), today.getMonth() + 1, num)
        : candidate;
      return dateToIsoDate(d);
    }
  }

  // ── Dia X do mês que vem ─────────────────────────────────────────────────
  const diaProxMes = normalized.match(/dia\s+(\d{1,2})\s+(?:do\s+)?(?:mes que vem|proximo mes|mes seguinte)/);
  if (diaProxMes) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, Number(diaProxMes[1]));
    if (Number.isFinite(d.getTime())) return dateToIsoDate(d);
  }

  // ── Final / fim do mês ────────────────────────────────────────────────────
  if (/final\s+do\s+mes\s+(?:que vem|seguinte)|fim\s+do\s+mes\s+(?:que vem|seguinte)/.test(normalized)) {
    return dateToIsoDate(new Date(today.getFullYear(), today.getMonth() + 2, 0));
  }
  if (/final do mes|fim do mes|final de mes/.test(normalized)) {
    return dateToIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  }

  // ── Mês que vem / próximo mês ─────────────────────────────────────────────
  if (/mes que vem|proximo mes|mes seguinte/.test(normalized)) {
    return dateToIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  }

  // ── Dia da semana ─────────────────────────────────────────────────────────
  // Aceita: "na sexta", "no sabado", "para sexta", "para a sexta",
  //         "proxima segunda", "sexta-feira", "sexta feira", "sexta"
  const weekdayMap: Record<string, number> = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  };
  for (const [name, targetDay] of Object.entries(weekdayMap)) {
    const pattern = new RegExp(
      `(?:(?:na|no|para(?:\\s+[ao])?|proxim[ao])\\s+)?\\b${name}(?:-?feira)?\\b`,
    );
    if (pattern.test(normalized)) {
      const d = new Date(today);
      let diff = targetDay - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return dateToIsoDate(d);
    }
  }

  // ── DD/MM/YYYY ou DD-MM-YYYY ou DD/MM/YY ─────────────────────────────────
  const ddmmyyyy = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]) - 1;
    const year = Number(ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3]);
    const d = new Date(year, month, day);
    if (Number.isFinite(d.getTime())) return dateToIsoDate(d);
  }

  // ── Dia X (mês atual ou próximo) ─────────────────────────────────────────
  const dayOnly = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d <= today) d.setMonth(d.getMonth() + 1);
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
