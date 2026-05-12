/**
 * Importa SOMENTE a aba "Checklist" para criar/atualizar os modelos de checklist de Inspecoes.
 *
 * Uso:
 *   npm run inspecoes:import:checklist
 *   npm run inspecoes:import:checklist -- --file="C:\\Users\\cleit\\Downloads\\CHECKLIST MANAUS - qualidade.xlsx"
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

import { closeOraclePool, executeOracle, initOraclePool, isOracleEnabled } from "../src/db/oracle.js";
import { ensureInspecoesTables } from "../src/repositories/inspecoes/initTables.js";
import { execDml, queryOne } from "../src/repositories/baseRepository.js";
import {
  createModelo,
  getModeloById,
  updateModelo,
} from "../src/repositories/inspecoes/oracleInspecoesRepository.js";
import { getAuditTimestampColumns, hasTableColumn } from "../src/repositories/inspecoes/shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_EXCEL_PATH = resolve(__dirname, "../data/CHECKLIST_MANAUS_-_qualidade.xlsx");

const SETOR_CONFIG = [
  { id: "SET-001", nome: "ESPUMACAO", ordem: 1, modeloId: "MOD-001" },
  { id: "SET-002", nome: "AREA DE CURA", ordem: 2, modeloId: "MOD-002" },
  { id: "SET-003", nome: "FLOCADEIRA", ordem: 3, modeloId: "MOD-003" },
  { id: "SET-004", nome: "LAMINACAO", ordem: 4, modeloId: "MOD-004" },
  { id: "SET-005", nome: "MOLA", ordem: 5, modeloId: "MOD-005" },
  { id: "SET-006", nome: "BORDADEIRA", ordem: 6, modeloId: "MOD-006" },
  { id: "SET-007", nome: "CORTE E COSTURA", ordem: 7, modeloId: "MOD-007" },
  { id: "SET-008", nome: "MARCENARIA", ordem: 8, modeloId: "MOD-008" },
  { id: "SET-009", nome: "TAPECARIA", ordem: 9, modeloId: "MOD-009" },
  { id: "SET-010", nome: "FECHAMENTO", ordem: 10, modeloId: "MOD-010" },
  { id: "SET-011", nome: "MOVEIS", ordem: 11, modeloId: "MOD-011" },
  { id: "SET-012", nome: "EMBALAGEM", ordem: 12, modeloId: "MOD-012" },
  { id: "SET-013", nome: "ALMOXARIFADO", ordem: 13, modeloId: "MOD-013" },
  { id: "SET-014", nome: "ESTOFAMENTO", ordem: 14, modeloId: "MOD-014" },
  { id: "SET-015", nome: "EMBALAGEM DE BASE", ordem: 15, modeloId: "MOD-015" },
] as const;

type CanonicalSetor = (typeof SETOR_CONFIG)[number]["nome"];

type ParsedChecklistItem = {
  setor: CanonicalSetor;
  codigoItem: string;
  descricao: string;
  ordem: number;
  obrigatorio: boolean;
  exigeEvidenciaNc: boolean;
  exigeTipoNc: boolean;
  itemId: string;
};

type ImportStats = {
  sourceFile: string;
  startedAt: Date;
  endedAt?: Date;
  status: "SUCESSO" | "ERRO";
  setores: number;
  modelos: number;
  itens: number;
  linhasIgnoradas: number;
  logs: string[];
  porSetor: Record<CanonicalSetor, number>;
};

type SetorSchema = {
  hasOrdem: boolean;
  hasAtivo: boolean;
  createdAtColumn: string | null;
  updatedAtColumn: string | null;
};

const SETOR_BY_NAME = new Map<CanonicalSetor, (typeof SETOR_CONFIG)[number]>(
  SETOR_CONFIG.map((item) => [item.nome, item]),
);

let setorSchemaPromise: Promise<SetorSchema> | null = null;

function getArgValue(name: string): string | null {
  const key = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(key));
  if (!arg) return null;
  return arg.slice(key.length).trim() || null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeUpperNoAccent(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeSetor(value: unknown): CanonicalSetor | null {
  const full = normalizeUpperNoAccent(value);
  if (!full) return null;

  const withoutPrefix = full.replace(/^\d+(\.\d+)?\s*-\s*/g, "").trim();
  const exact = SETOR_CONFIG.find((cfg) => withoutPrefix === cfg.nome);
  if (exact) return exact.nome;

  const bySpecificity = [...SETOR_CONFIG].sort((a, b) => b.nome.length - a.nome.length);
  for (const cfg of bySpecificity) {
    if (withoutPrefix.includes(cfg.nome)) {
      return cfg.nome;
    }
  }
  return null;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === "") return fallback;
  const upper = normalizeUpperNoAccent(value);
  if (["SIM", "S", "TRUE", "1", "Y", "YES"].includes(upper)) return true;
  if (["NAO", "N", "FALSE", "0", "NO"].includes(upper)) return false;
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseItemOrder(itemCode: string, fallback: number): number {
  const normalized = normalizeText(itemCode);
  if (!normalized) return fallback;

  const numericMatches = normalized.match(/\d+/g);
  if (!numericMatches || numericMatches.length === 0) return fallback;
  const last = Number(numericMatches[numericMatches.length - 1]);
  return Number.isFinite(last) && last > 0 ? last : fallback;
}

function stableId(prefix: string, ...parts: Array<string | number>): string {
  const raw = parts.map((value) => String(value)).join("|");
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 16).toUpperCase();
  return `${prefix}-${hash}`;
}

function buildChecklistItemId(setor: CanonicalSetor, codigoItem: string, ordem: number): string {
  const setorOrdem = SETOR_BY_NAME.get(setor)?.ordem ?? 0;
  const compactCode = normalizeText(codigoItem).replace(/\s+/g, "");
  const fallbackCode = `${setorOrdem}.${String(ordem).padStart(2, "0")}`;
  const base = compactCode || fallbackCode;

  // Legacy schema can lack CODIGO_ITEM; in this case the API falls back to ID.
  // Keep ID aligned with official item code to preserve traceability in the UI.
  const prefixed = base.startsWith(`${setorOrdem}.`) ? base : `${setorOrdem}.${base}`;
  const candidate = prefixed.slice(0, 40);
  if (candidate.length > 0) {
    return candidate;
  }

  return stableId("ITC", setor, codigoItem, ordem);
}

function initStats(sourceFile: string): ImportStats {
  const porSetor = Object.fromEntries(
    SETOR_CONFIG.map((cfg) => [cfg.nome, 0]),
  ) as Record<CanonicalSetor, number>;

  return {
    sourceFile,
    startedAt: new Date(),
    status: "SUCESSO",
    setores: 0,
    modelos: 0,
    itens: 0,
    linhasIgnoradas: 0,
    logs: [],
    porSetor,
  };
}

async function ensureAccessibleTable(tableName: string): Promise<void> {
  try {
    await executeOracle(`SELECT * FROM ${tableName.toUpperCase()} WHERE 1 = 0`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ORA-00942")) {
      throw new Error(`Tabela obrigatoria ausente/inacessivel: ${tableName}`);
    }
    throw error;
  }
}

async function ensurePreconditions(excelPath: string): Promise<void> {
  if (!isOracleEnabled()) {
    throw new Error(
      "Oracle nao esta configurado. Configure ORACLE_USER/ORACLE_PASSWORD/ORACLE_CONNECT_STRING.",
    );
  }

  await initOraclePool();
  await ensureInspecoesTables();

  for (const table of [
    "INS_SETOR",
    "INS_MODELO_CHECKLIST",
    "INS_MODELO_CHECKLIST_ITEM",
    "INS_AUDITORIA_IMPORTACAO",
    "INS_AUDITORIA",
  ]) {
    await ensureAccessibleTable(table);
  }

  readFileSync(excelPath);
}

async function loadSetorSchema(): Promise<SetorSchema> {
  if (!setorSchemaPromise) {
    setorSchemaPromise = (async () => {
      const auditCols = await getAuditTimestampColumns("INS_SETOR");
      return {
        hasOrdem: await hasTableColumn("INS_SETOR", "ORDEM"),
        hasAtivo: await hasTableColumn("INS_SETOR", "ATIVO"),
        createdAtColumn: auditCols.createdAtColumn,
        updatedAtColumn: auditCols.updatedAtColumn,
      };
    })();
  }
  return setorSchemaPromise;
}

async function upsertSetor(cfg: (typeof SETOR_CONFIG)[number]): Promise<void> {
  const schema = await loadSetorSchema();
  const existingByName = await queryOne<{ ID: string }>(
    `SELECT ID FROM INS_SETOR WHERE UPPER(NOME) = UPPER(:nome) FETCH FIRST 1 ROWS ONLY`,
    { nome: cfg.nome },
  );
  const targetId = existingByName?.ID ?? cfg.id;

  const existsRow = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM INS_SETOR WHERE ID = :id`,
    { id: targetId },
  );
  const exists = Number((existsRow as any)?.CNT ?? 0) > 0;

  if (exists) {
    const updateClauses = ["NOME = :nome"];
    const binds: Record<string, unknown> = { id: targetId, nome: cfg.nome };

    if (schema.hasOrdem) {
      updateClauses.push("ORDEM = :ordem");
      binds.ordem = cfg.ordem;
    }
    if (schema.hasAtivo) {
      updateClauses.push("ATIVO = 1");
    }
    if (schema.updatedAtColumn) {
      updateClauses.push(`${schema.updatedAtColumn} = SYSTIMESTAMP`);
    }

    await execDml(
      `UPDATE INS_SETOR
          SET ${updateClauses.join(", ")}
        WHERE ID = :id`,
      binds,
    );
    return;
  }

  const columns = ["ID", "NOME"];
  const values = [":id", ":nome"];
  const binds: Record<string, unknown> = { id: targetId, nome: cfg.nome };

  if (schema.hasOrdem) {
    columns.push("ORDEM");
    values.push(":ordem");
    binds.ordem = cfg.ordem;
  }
  if (schema.hasAtivo) {
    columns.push("ATIVO");
    values.push("1");
  }
  if (schema.createdAtColumn) {
    columns.push(schema.createdAtColumn);
    values.push("SYSTIMESTAMP");
  }
  if (schema.updatedAtColumn) {
    columns.push(schema.updatedAtColumn);
    values.push("SYSTIMESTAMP");
  }

  await execDml(
    `INSERT INTO INS_SETOR (${columns.join(", ")})
     VALUES (${values.join(", ")})`,
    binds,
  );
}

function requireChecklistSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const sheet = workbook.Sheets.Checklist;
  if (!sheet) {
    throw new Error("Aba obrigatoria nao encontrada: Checklist");
  }
  return sheet;
}

function parseChecklistRows(
  rows: Array<Record<string, unknown>>,
  stats: ImportStats,
): Map<CanonicalSetor, ParsedChecklistItem[]> {
  const itemsBySetor = new Map<CanonicalSetor, ParsedChecklistItem[]>(
    SETOR_CONFIG.map((cfg) => [cfg.nome, []]),
  );
  const dedupe = new Set<string>();
  const usedItemIds = new Set<string>();
  const rowOrderBySetor = new Map<CanonicalSetor, number>();

  for (const [idx, row] of rows.entries()) {
    const setor = normalizeSetor(row.Setor ?? row.setor);
    const descricao = normalizeText(
      row["Descricao"] ?? row["Descrição"] ?? row["DESCRICAO"] ?? row["descrição"],
    );
    const codigoItemRaw = normalizeText(row.Item ?? row.Codigo ?? row["Código"]);

    if (!setor || !descricao) {
      stats.linhasIgnoradas += 1;
      stats.logs.push(`Checklist linha ${idx + 2}: ignorada (setor/descricao ausentes).`);
      continue;
    }

    const ordemRaw = row.Ordem ?? row.ORDEM;
    const nextLocalOrder = (rowOrderBySetor.get(setor) ?? 0) + 1;
    rowOrderBySetor.set(setor, nextLocalOrder);

    const ordemFromSheet = toNumber(ordemRaw, 0);
    const codigoItem =
      codigoItemRaw || `${SETOR_BY_NAME.get(setor)?.ordem ?? 0}.${String(nextLocalOrder).padStart(2, "0")}`;
    const ordem = ordemFromSheet > 0 ? ordemFromSheet : parseItemOrder(codigoItem, nextLocalOrder);
    const obrigatorio = toBool(
      row["Obrigatorio?"] ?? row["Obrigatorio? "] ?? row.Obrigatorio,
      true,
    );
    const exigeEvidenciaNc = toBool(
      row["Exige Evidencia?"] ?? row["Exige Evidência?"] ?? row.ExigeEvidencia,
      false,
    );
    const exigeTipoNc = toBool(
      row["Exige Tipo NC?"] ?? row["Exige Tipo de NC?"] ?? row.ExigeTipoNc,
      true,
    );

    const dedupeKey = `${setor}|${codigoItem}|${descricao}`;
    if (dedupe.has(dedupeKey)) {
      stats.linhasIgnoradas += 1;
      stats.logs.push(`Checklist linha ${idx + 2}: item duplicado ignorado (${dedupeKey}).`);
      continue;
    }
    dedupe.add(dedupeKey);

    let itemId = buildChecklistItemId(setor, codigoItem, ordem);
    if (usedItemIds.has(itemId)) {
      itemId = stableId("ITC", setor, codigoItem, descricao);
    }
    usedItemIds.add(itemId);
    itemsBySetor.get(setor)!.push({
      setor,
      codigoItem,
      descricao,
      ordem,
      obrigatorio,
      exigeEvidenciaNc,
      exigeTipoNc,
      itemId,
    });
  }

  for (const cfg of SETOR_CONFIG) {
    const arr = itemsBySetor.get(cfg.nome)!;
    arr.sort((a, b) => a.ordem - b.ordem || a.codigoItem.localeCompare(b.codigoItem));
    stats.porSetor[cfg.nome] = arr.length;
  }

  return itemsBySetor;
}

async function findModelIdByNomeSetor(
  modeloNome: string,
  setorNome: string,
): Promise<string | null> {
  const row = await queryOne<{ ID: string }>(
    `SELECT m.ID
       FROM INS_MODELO_CHECKLIST m
       JOIN INS_SETOR s ON s.ID = m.SETOR_ID
      WHERE UPPER(m.NOME) = UPPER(:nome)
        AND UPPER(s.NOME) = UPPER(:setor)
      FETCH FIRST 1 ROWS ONLY`,
    { nome: modeloNome, setor: setorNome },
  );
  return row?.ID ?? null;
}

async function upsertChecklistModel(
  cfg: (typeof SETOR_CONFIG)[number],
  items: ParsedChecklistItem[],
): Promise<boolean> {
  if (items.length === 0) return false;

  const modeloNome = `Checklist ${cfg.nome}`;
  const existingByNameId = await findModelIdByNomeSetor(modeloNome, cfg.nome);
  const modelId = existingByNameId ?? cfg.modeloId;

  const payload = {
    id: modelId,
    nome: modeloNome,
    setor: cfg.nome,
    descricao: `Checklist oficial importado da aba Checklist (${cfg.nome}).`,
    ordem: cfg.ordem,
    ativo: true,
    itens: items.map((item) => ({
      id: item.itemId,
      codigoItem: item.codigoItem,
      descricao: item.descricao,
      ordem: item.ordem,
      obrigatorio: item.obrigatorio,
      exigeEvidenciaNc: item.exigeEvidenciaNc,
      exigeTipoNc: item.exigeTipoNc,
      ativo: true,
    })),
  };

  const existingById = await getModeloById(modelId);
  if (existingById) {
    await updateModelo(modelId, payload);
  } else {
    await createModelo(payload);
  }

  return true;
}

async function deactivateLegacyChecklistModels(stats: ImportStats): Promise<void> {
  const modeloAudit = await getAuditTimestampColumns("INS_MODELO_CHECKLIST");
  const itemAudit = await getAuditTimestampColumns("INS_MODELO_CHECKLIST_ITEM");

  const modelUpdateClauses = ["ATIVO = 0"];
  if (modeloAudit.updatedAtColumn) {
    modelUpdateClauses.push(`${modeloAudit.updatedAtColumn} = SYSTIMESTAMP`);
  }
  await execDml(
    `UPDATE INS_MODELO_CHECKLIST
        SET ${modelUpdateClauses.join(", ")}
      WHERE ID LIKE 'MOD-LEG-%'
        AND ATIVO = 1`,
  );

  const itemUpdateClauses = ["ATIVO = 0"];
  if (itemAudit.updatedAtColumn) {
    itemUpdateClauses.push(`${itemAudit.updatedAtColumn} = SYSTIMESTAMP`);
  }
  await execDml(
    `UPDATE INS_MODELO_CHECKLIST_ITEM
        SET ${itemUpdateClauses.join(", ")}
      WHERE MODELO_ID IN (
        SELECT ID
          FROM INS_MODELO_CHECKLIST
         WHERE ID LIKE 'MOD-LEG-%'
      )
        AND ATIVO = 1`,
  );

  stats.logs.push("Modelos legados MOD-LEG-* foram desativados.");
}

function buildSummary(stats: ImportStats): string {
  const lines: string[] = [];
  lines.push(`Fonte: ${stats.sourceFile}`);
  lines.push("Escopo: CHECKLIST_ONLY");
  lines.push(`Status: ${stats.status}`);
  lines.push(`Inicio: ${stats.startedAt.toISOString()}`);
  lines.push(`Fim: ${(stats.endedAt ?? new Date()).toISOString()}`);
  lines.push(`Setores importados: ${stats.setores}`);
  lines.push(`Modelos importados: ${stats.modelos}`);
  lines.push(`Itens importados: ${stats.itens}`);
  lines.push(`Linhas ignoradas: ${stats.linhasIgnoradas}`);
  lines.push("");
  lines.push("Itens por setor:");
  for (const cfg of SETOR_CONFIG) {
    lines.push(`- ${cfg.nome}: ${stats.porSetor[cfg.nome]}`);
  }
  if (stats.logs.length > 0) {
    lines.push("");
    lines.push("Logs:");
    lines.push(...stats.logs);
  }
  return lines.join("\n");
}

async function writeAudit(stats: ImportStats, summary: string): Promise<void> {
  await execDml(
    `INSERT INTO INS_AUDITORIA_IMPORTACAO (
      ID, FONTE_ARQUIVO, STATUS,
      SETORES_IMPORTADOS, MODELOS_IMPORTADOS, ITENS_IMPORTADOS,
      TIPOS_NC_IMPORTADOS, PADROES_MOLA_IMPORTADOS, VINCULOS_USUARIO_SETOR,
      LINHAS_IGNORADAS, LOG_RESUMO, CRIADO_EM
    ) VALUES (
      :id, :fonteArquivo, :status,
      :setores, :modelos, :itens,
      :tiposNc, :padroesMola, :vinculosUsuarioSetor,
      :linhasIgnoradas, :logResumo, SYSTIMESTAMP
    )`,
    {
      id: `IMC-${randomUUID().slice(0, 8).toUpperCase()}`,
      fonteArquivo: `${stats.sourceFile} [CHECKLIST_ONLY]`,
      status: stats.status,
      setores: stats.setores,
      modelos: stats.modelos,
      itens: stats.itens,
      tiposNc: 0,
      padroesMola: 0,
      vinculosUsuarioSetor: 0,
      linhasIgnoradas: stats.linhasIgnoradas,
      logResumo: summary,
    },
  );

  await execDml(
    `INSERT INTO INS_AUDITORIA (
      ID, ENTIDADE, ENTIDADE_ID, ACAO, USUARIO_ID, USUARIO_NOME, DETALHES, CRIADO_EM
    ) VALUES (
      :id, 'INS_IMPORTACAO', :entidadeId, :acao, :usuarioId, :usuarioNome, :detalhes, SYSTIMESTAMP
    )`,
    {
      id: `AUD-${randomUUID().slice(0, 8).toUpperCase()}`,
      entidadeId: "CHECKLIST_ONLY",
      acao: stats.status === "SUCESSO" ? "IMPORTACAO_CHECKLIST_ONLY" : "IMPORTACAO_CHECKLIST_ONLY_ERRO",
      usuarioId: "SCRIPT_IMPORT",
      usuarioNome: "import-inspecoes-checklist.ts",
      detalhes: summary,
    },
  );
}

async function main(): Promise<void> {
  const explicitFile = getArgValue("file");
  const excelPath = explicitFile ? resolve(process.cwd(), explicitFile) : DEFAULT_EXCEL_PATH;
  const stats = initStats(basename(excelPath));

  console.log("=".repeat(88));
  console.log("IMPORTACAO INSPECOES -> ABA CHECKLIST");
  console.log("=".repeat(88));
  console.log(`Arquivo: ${excelPath}`);

  try {
    await ensurePreconditions(excelPath);

    const workbook = XLSX.read(readFileSync(excelPath), { type: "buffer" });
    const checklistSheet = requireChecklistSheet(workbook);
    const checklistRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(checklistSheet, {
      defval: "",
    });

    console.log(`Checklist rows lidas: ${checklistRows.length}`);
    const itemsBySetor = parseChecklistRows(checklistRows, stats);

    for (const cfg of SETOR_CONFIG) {
      await upsertSetor(cfg);
    }

    let modelosImportados = 0;
    let itensImportados = 0;
    for (const cfg of SETOR_CONFIG) {
      const items = itemsBySetor.get(cfg.nome) ?? [];
      if (items.length === 0) continue;

      const imported = await upsertChecklistModel(cfg, items);
      if (imported) modelosImportados += 1;
      itensImportados += items.length;
    }

    await deactivateLegacyChecklistModels(stats);

    stats.setores = SETOR_CONFIG.length;
    stats.modelos = modelosImportados;
    stats.itens = itensImportados;
    stats.endedAt = new Date();

    const summary = buildSummary(stats);
    await writeAudit(stats, summary);

    console.log("\nImportacao da aba Checklist concluida com sucesso.");
    console.log(`Setores: ${stats.setores}`);
    console.log(`Modelos: ${stats.modelos}`);
    console.log(`Itens: ${stats.itens}`);
    console.log(`Linhas ignoradas: ${stats.linhasIgnoradas}`);
    for (const cfg of SETOR_CONFIG) {
      console.log(`- ${cfg.nome}: ${stats.porSetor[cfg.nome]} itens`);
    }
  } catch (error) {
    stats.status = "ERRO";
    stats.endedAt = new Date();
    stats.logs.push(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    const summary = buildSummary(stats);

    try {
      await writeAudit(stats, summary);
    } catch {
      // noop
    }

    throw error;
  } finally {
    try {
      await closeOraclePool();
    } catch {
      // noop
    }
  }
}

main().catch((error) => {
  console.error("Falha na importacao da aba Checklist:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
