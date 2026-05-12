import * as XLSX from "xlsx";
import type { PaginatedResult } from "./types.js";

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return "";
}

export function parseTime(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && typeof parsed.H === "number" && typeof parsed.M === "number") {
      return `${pad2(parsed.H)}:${pad2(parsed.M)}`;
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})/);
  if (hhmm) {
    return `${pad2(Number(hhmm[1]))}:${hhmm[2]}`;
  }

  if (/^\d{3,4}$/.test(raw)) {
    const normalized = raw.padStart(4, "0");
    return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
  }

  return "";
}

export function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const sanitized = raw
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;

  const commaIndex = sanitized.lastIndexOf(",");
  const dotIndex = sanitized.lastIndexOf(".");
  let normalized = sanitized;

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      // Formato BR: 1.234,56
      normalized = sanitized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      // Formato EN: 1,234.56
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    const decimalDigits = sanitized.length - commaIndex - 1;
    if (decimalDigits > 0 && decimalDigits <= 2) {
      normalized = sanitized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (dotIndex >= 0) {
    const decimalDigits = sanitized.length - dotIndex - 1;
    if (decimalDigits > 0 && decimalDigits <= 2) {
      normalized = sanitized.replace(/,/g, "");
    } else {
      normalized = sanitized.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  return ["sim", "s", "true", "1", "yes", "y"].includes(normalized);
}

export function sanitizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function maskCard(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (digits.length < 8) return value;
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

export function buildLookup(row: Record<string, unknown>): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    lookup.set(normalizeHeader(key), value);
  }
  return lookup;
}

export function absDiff(a: number, b: number): number {
  return Math.abs((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0));
}

export function minutesBetween(dateIso: string, hourA: string, hourB: string): number {
  if (!hourA || !hourB || !dateIso) return Number.MAX_SAFE_INTEGER;

  const a = new Date(`${dateIso}T${hourA}:00`);
  const b = new Date(`${dateIso}T${hourB}:00`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return Number.MAX_SAFE_INTEGER;

  return Math.abs(Math.round((a.getTime() - b.getTime()) / 60000));
}

export function toPagination<T>(source: T[], page = 1, limit = 25): PaginatedResult<T> {
  const normalizedLimit = Math.max(1, Math.min(limit, 200));
  const normalizedPage = Math.max(1, page);
  const total = source.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
  const start = (normalizedPage - 1) * normalizedLimit;
  return {
    items: source.slice(start, start + normalizedLimit),
    page: normalizedPage,
    limit: normalizedLimit,
    total,
    totalPages,
  };
}

export function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((acc, item) => acc + selector(item), 0);
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (text.includes(";") || text.includes("\n") || text.includes("\"")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(csvEscape).join(";");
  const lines = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(";"));
  return [headerLine, ...lines].join("\n");
}
