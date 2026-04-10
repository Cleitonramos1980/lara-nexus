import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function run(): void {
  const filePath = "C:/Users/cleit/OneDrive/Desktop/DUPLIC 318070.xls";
  const wb = XLSX.read(readFileSync(filePath), { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });

  const filtradas = rows.filter((row) => String(row.DUPLIC ?? "").trim() === "318070" && String(row.CODCOB ?? "").trim().toUpperCase() !== "DESD");
  assert(filtradas.length >= 12, "Esperava ao menos 12 linhas para DUPLIC 318070 sem DESD.");

  const dataVenda = toIsoDate(filtradas[0].DTEMISSAO);
  const filial = String(filtradas[0].CODFILIAL ?? "").trim();
  const nsu = String(filtradas[0].NSUTEF ?? "").trim();
  const autorizacao = String(filtradas[0].CODAUTORIZACAOTEF ?? "").trim();
  const soma = filtradas.reduce((acc, row) => acc + parseNumber(row.VALOR), 0);
  const somaRound = Math.round(soma * 100) / 100;

  assert(dataVenda === "2026-02-28", `Data mapeada incorreta: ${dataVenda}`);
  assert(filial === "3D", `Filial mapeada incorreta: ${filial}`);
  assert(nsu === "36947756", `NSU mapeado incorreto: ${nsu}`);
  assert(autorizacao === "30228", `Autorizacao mapeada incorreta: ${autorizacao}`);
  assert(Math.abs(somaRound - 12500) <= 0.01, `Soma esperada 12500, obtida ${somaRound}`);

  console.log("- PCPREST DUPLIC 318070: mapeamento de campos e soma de parcelas OK");
}

run();

