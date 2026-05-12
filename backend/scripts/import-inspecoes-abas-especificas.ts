/**
 * Importa somente as abas de respostas de checklist:
 * - 9.0_-_TAPECARIA
 * - 10.0_-_FECHAMENTO
 * - 11.0_-_MOVEIS
 *
 * Mapeamento principal:
 * - SubmissionID -> INS_EXECUCAO (uma execucao por submission)
 * - cada linha da aba -> INS_EXECUCAO_ITEM
 * - FotoURL -> INS_EXECUCAO_ITEM_EVIDENCIA
 *
 * Uso:
 *   npm run inspecoes:import:abas-especificas
 *   npm run inspecoes:import:abas-especificas -- --file=./data/arquivo.xlsx
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
  createExecucao,
  createModelo,
  getModeloById,
  updateModelo,
} from "../src/repositories/inspecoes/oracleInspecoesRepository.js";
import { getAuditTimestampColumns, hasTableColumn } from "../src/repositories/inspecoes/shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_SHEETS = [
  "9.0_-_TAPECARIA",
  "10.0_-_FECHAMENTO",
  "11.0_-_MOVEIS",
] as const;

type TargetSheet = (typeof TARGET_SHEETS)[number];
type LegacySetor = "TAPECARIA" | "FECHAMENTO" | "MOVEIS";

type SheetStats = {
  execucoes: number;
  itens: number;
  evidencias: number;
  ignoradas: number;
  setores: Set<LegacySetor>;
};

type ParsedRow = {
  sheet: TargetSheet;
  submissionId: string;
  timestampIso: string;
  usuario: string;
  nome: string;
  setor: LegacySetor;
  item: string;
  descricao: string;
  status: "CONFORME" | "NAO_CONFORME" | "NAO_APLICA";
  observacao: string;
  fotoUrl: string;
};

type GroupedExecution = {
  sheet: TargetSheet;
  submissionId: string;
  timestampIso: string;
  usuario: string;
  nome: string;
  setor: LegacySetor;
  rows: ParsedRow[];
};

type ImportState = {
  startedAt: Date;
  endedAt?: Date;
  status: "SUCESSO" | "ERRO";
  sourceFile: string;
  sheetStats: Record<TargetSheet, SheetStats>;
  logs: string[];
  modelosCriadosOuAtualizados: number;
  linhasIgnoradas: number;
  setoresAfetados: Set<LegacySetor>;
};

type SetorSchema = {
  hasOrdem: boolean;
  hasAtivo: boolean;
  createdAtColumn: string | null;
  updatedAtColumn: string | null;
};

const SETOR_CONFIG: Record<LegacySetor, { setorId: string; nome: string; ordem: number; modeloId: string }> = {
  TAPECARIA: {
    setorId: "SET-009",
    nome: "TAPECARIA",
    ordem: 9,
    modeloId: "MOD-LEG-TAPECARIA",
  },
  FECHAMENTO: {
    setorId: "SET-010",
    nome: "FECHAMENTO",
    ordem: 10,
    modeloId: "MOD-LEG-FECHAMENTO",
  },
  MOVEIS: {
    setorId: "SET-011",
    nome: "MOVEIS",
    ordem: 11,
    modeloId: "MOD-LEG-MOVEIS",
  },
};

const DEFAULT_EXCEL_PATH = resolve(__dirname, "../data/CHECKLIST_MANAUS_-_qualidade.xlsx");

let setorSchemaPromise: Promise<SetorSchema> | null = null;

function getArgValue(name: string): string | null {
  const key = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(key));
  if (!arg) return null;
  return arg.slice(key.length).trim() || null;
}

function stableId(prefix: string, ...parts: Array<string | number>): string {
  const raw = parts.map((value) => String(value)).join("|");
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 16).toUpperCase();
  return `${prefix}-${hash}`;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUpperNoAccent(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeSetor(value: unknown): LegacySetor | null {
  const upper = normalizeUpperNoAccent(value);
  if (!upper) return null;

  if (upper.includes("TAPECARIA")) return "TAPECARIA";
  if (upper.includes("FECHAMENTO")) return "FECHAMENTO";
  if (upper.includes("MOVEIS")) return "MOVEIS";
  return null;
}

function parseItemOrder(itemCode: string, fallback: number): number {
  const normalized = normalizeText(itemCode);
  if (!normalized) return fallback;

  const numericMatches = normalized.match(/\d+/g);
  if (!numericMatches || numericMatches.length === 0) return fallback;
  const last = Number(numericMatches[numericMatches.length - 1]);
  return Number.isFinite(last) && last > 0 ? last : fallback;
}

function normalizeStatus(value: unknown): "CONFORME" | "NAO_CONFORME" | "NAO_APLICA" {
  const upper = normalizeUpperNoAccent(value).replace(/\s+/g, "_");
  if (upper === "CONFORME") return "CONFORME";
  if (upper === "NAO_CONFORME" || upper === "NAO-CONFORME" || upper === "N_CONFORME") return "NAO_CONFORME";
  return "NAO_APLICA";
}

function excelDateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date base (Windows): 1899-12-30
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const text = normalizeText(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function initState(sourceFile: string): ImportState {
  const makeSheetStats = (): SheetStats => ({
    execucoes: 0,
    itens: 0,
    evidencias: 0,
    ignoradas: 0,
    setores: new Set<LegacySetor>(),
  });

  return {
    startedAt: new Date(),
    status: "SUCESSO",
    sourceFile,
    sheetStats: {
      "9.0_-_TAPECARIA": makeSheetStats(),
      "10.0_-_FECHAMENTO": makeSheetStats(),
      "11.0_-_MOVEIS": makeSheetStats(),
    },
    logs: [],
    modelosCriadosOuAtualizados: 0,
    linhasIgnoradas: 0,
    setoresAfetados: new Set<LegacySetor>(),
  };
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

async function upsertSetor(setor: LegacySetor): Promise<void> {
  const cfg = SETOR_CONFIG[setor];
  const schema = await loadSetorSchema();
  const existsRow = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM INS_SETOR WHERE ID = :id`,
    { id: cfg.setorId },
  );
  const exists = Number((existsRow as any)?.CNT ?? 0) > 0;

  if (exists) {
    const updateClauses = ["NOME = :nome"];
    const binds: Record<string, unknown> = { id: cfg.setorId, nome: cfg.nome };

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
  const binds: Record<string, unknown> = { id: cfg.setorId, nome: cfg.nome };

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

function requireSheet(workbook: XLSX.WorkBook, sheetName: TargetSheet): XLSX.WorkSheet {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Aba obrigatoria nao encontrada: ${sheetName}`);
  }
  return sheet;
}

function parseTargetSheets(workbook: XLSX.WorkBook, state: ImportState): {
  parsedRows: ParsedRow[];
  grouped: Map<string, GroupedExecution>;
} {
  const parsedRows: ParsedRow[] = [];
  const grouped = new Map<string, GroupedExecution>();

  for (const sheetName of TARGET_SHEETS) {
    const sheet = requireSheet(workbook, sheetName);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const stats = state.sheetStats[sheetName];

    for (const [idx, row] of rows.entries()) {
      const submissionId = normalizeText(row["SubmissionID"]);
      const item = normalizeText(row["Item"]);
      const descricao = normalizeText(row["Descricao"] || row["Descrição"]);
      const setor = normalizeSetor(row["Setor"]) ?? normalizeSetor(sheetName);
      const status = normalizeStatus(row["Status"]);
      const usuario = normalizeText(row["Usuario"]);
      const nome = normalizeText(row["Nome"]);
      const observacao = normalizeText(row["ObservacaoItem"] || row["ObservaçãoItem"]);
      const fotoUrl = normalizeText(row["FotoURL"]);
      const timestampIso = excelDateToIso(row["Timestamp"]);

      if (!submissionId || !setor || !item || !descricao) {
        stats.ignoradas += 1;
        state.linhasIgnoradas += 1;
        state.logs.push(`[${sheetName}] linha ${idx + 2} ignorada (campos obrigatorios vazios).`);
        continue;
      }

      const parsed: ParsedRow = {
        sheet: sheetName,
        submissionId,
        timestampIso,
        usuario,
        nome,
        setor,
        item,
        descricao,
        status,
        observacao,
        fotoUrl,
      };

      parsedRows.push(parsed);
      stats.itens += 1;
      stats.setores.add(setor);
      state.setoresAfetados.add(setor);
      if (fotoUrl) {
        stats.evidencias += 1;
      }

      const groupKey = `${sheetName}|${submissionId}`;
      const existing = grouped.get(groupKey);
      if (!existing) {
        grouped.set(groupKey, {
          sheet: sheetName,
          submissionId,
          timestampIso,
          usuario,
          nome,
          setor,
          rows: [parsed],
        });
      } else {
        existing.rows.push(parsed);
        if (!existing.usuario && usuario) existing.usuario = usuario;
        if (!existing.nome && nome) existing.nome = nome;
        if (!existing.timestampIso && timestampIso) existing.timestampIso = timestampIso;
      }
    }
  }

  return { parsedRows, grouped };
}

function buildModelItems(parsedRows: ParsedRow[]): {
  bySetor: Record<LegacySetor, Array<{
    id: string;
    codigoItem: string;
    descricao: string;
    ordem: number;
    exigeEvidenciaNc: boolean;
  }>>;
  itemIdByKey: Map<string, string>;
} {
  const itemMapBySetor: Record<LegacySetor, Map<string, {
    id: string;
    codigoItem: string;
    descricao: string;
    ordem: number;
    exigeEvidenciaNc: boolean;
  }>> = {
    TAPECARIA: new Map(),
    FECHAMENTO: new Map(),
    MOVEIS: new Map(),
  };

  const itemIdByKey = new Map<string, string>();

  for (const row of parsedRows) {
    const key = `${row.setor}|${row.item}|${row.descricao}`;
    const setorMap = itemMapBySetor[row.setor];
    const existing = setorMap.get(key);
    if (existing) {
      if (row.fotoUrl) existing.exigeEvidenciaNc = true;
      continue;
    }

    const itemId = stableId("ITL", row.setor, row.item, row.descricao);
    const item = {
      id: itemId,
      codigoItem: row.item,
      descricao: row.descricao,
      ordem: parseItemOrder(row.item, setorMap.size + 1),
      exigeEvidenciaNc: Boolean(row.fotoUrl),
    };
    setorMap.set(key, item);
    itemIdByKey.set(key, itemId);
  }

  const bySetor: Record<LegacySetor, Array<{
    id: string;
    codigoItem: string;
    descricao: string;
    ordem: number;
    exigeEvidenciaNc: boolean;
  }>> = {
    TAPECARIA: Array.from(itemMapBySetor.TAPECARIA.values()).sort((a, b) => a.ordem - b.ordem || a.codigoItem.localeCompare(b.codigoItem)),
    FECHAMENTO: Array.from(itemMapBySetor.FECHAMENTO.values()).sort((a, b) => a.ordem - b.ordem || a.codigoItem.localeCompare(b.codigoItem)),
    MOVEIS: Array.from(itemMapBySetor.MOVEIS.values()).sort((a, b) => a.ordem - b.ordem || a.codigoItem.localeCompare(b.codigoItem)),
  };

  return { bySetor, itemIdByKey };
}

async function upsertLegacyModels(
  modelItemsBySetor: Record<LegacySetor, Array<{
    id: string;
    codigoItem: string;
    descricao: string;
    ordem: number;
    exigeEvidenciaNc: boolean;
  }>>,
  state: ImportState,
): Promise<void> {
  for (const setor of Object.keys(modelItemsBySetor) as LegacySetor[]) {
    const items = modelItemsBySetor[setor];
    if (items.length === 0) continue;

    const cfg = SETOR_CONFIG[setor];
    const payload = {
      id: cfg.modeloId,
      nome: `Checklist Legado ${cfg.nome}`,
      setor: cfg.nome,
      descricao: `Importacao parcial das abas ${TARGET_SHEETS.join(", ")} (${cfg.nome}).`,
      ordem: 9000 + cfg.ordem,
      ativo: true,
      itens: items.map((item) => ({
        id: item.id,
        codigoItem: item.codigoItem,
        descricao: item.descricao,
        ordem: item.ordem,
        obrigatorio: true,
        exigeEvidenciaNc: item.exigeEvidenciaNc,
        exigeTipoNc: true,
        ativo: true,
      })),
    };

    const existing = await getModeloById(cfg.modeloId);
    if (existing) {
      await updateModelo(cfg.modeloId, payload);
    } else {
      await createModelo(payload);
    }
    state.modelosCriadosOuAtualizados += 1;
  }
}

async function importGroupedExecutions(
  grouped: Map<string, GroupedExecution>,
  itemIdByKey: Map<string, string>,
  state: ImportState,
): Promise<void> {
  const entries = Array.from(grouped.values()).sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));

  for (const group of entries) {
    const setorCfg = SETOR_CONFIG[group.setor];
    const items = group.rows.map((row, idx) => {
      const key = `${row.setor}|${row.item}|${row.descricao}`;
      const modelItemId = itemIdByKey.get(key);
      if (!modelItemId) {
        throw new Error(`Item de modelo nao encontrado para chave: ${key}`);
      }

      return {
        id: stableId("EIL", group.sheet, group.submissionId, String(idx + 1), row.item, row.descricao),
        itemModeloId: modelItemId,
        codigoItem: row.item,
        ordem: parseItemOrder(row.item, idx + 1),
        descricao: row.descricao,
        resultado: row.status,
        observacao: row.observacao || undefined,
        evidencias: row.fotoUrl ? [row.fotoUrl] : undefined,
        // Em bases legadas ARQUIVO_URL pode ser NOT NULL; mantemos FotoURL como referencia tecnica
        // mesmo quando nao for URL HTTP para nao perder dado e evitar ORA-01400.
        evidenciaUrl: row.fotoUrl || undefined,
      };
    });

    const conformes = items.filter((item) => item.resultado === "CONFORME").length;
    const naoConformes = items.filter((item) => item.resultado === "NAO_CONFORME").length;
    const naoAplica = items.filter((item) => item.resultado === "NAO_APLICA").length;
    const avaliaveis = conformes + naoConformes;
    const taxaConformidade = avaliaveis > 0 ? Number(((conformes / avaliaveis) * 100).toFixed(2)) : 100;
    const observacoes = group.rows
      .filter((row) => row.observacao)
      .map((row) => `${row.item}: ${row.observacao}`);
    const observacaoGeral = [`SubmissionID: ${group.submissionId}`, ...observacoes].join(" | ");

    await createExecucao({
      id: stableId("EXL", group.sheet, group.submissionId),
      codigo: group.submissionId,
      modeloId: setorCfg.modeloId,
      setor: setorCfg.nome,
      executorUsuarioId: group.usuario || null,
      executor: group.nome || group.usuario || "LEGADO",
      dataHora: group.timestampIso,
      status: "CONCLUIDA",
      totalItens: items.length,
      conformes,
      naoConformes,
      naoAplica,
      taxaConformidade,
      observacaoGeral,
      itens: items,
    });

    state.sheetStats[group.sheet].execucoes += 1;
  }
}

function buildSummary(state: ImportState): string {
  const lines: string[] = [];
  lines.push(`Fonte: ${state.sourceFile}`);
  lines.push(`Status: ${state.status}`);
  lines.push(`Inicio: ${state.startedAt.toISOString()}`);
  lines.push(`Fim: ${(state.endedAt ?? new Date()).toISOString()}`);
  lines.push(`Setores afetados: ${Array.from(state.setoresAfetados).sort().join(", ") || "(nenhum)"}`);
  lines.push(`Modelos criados/atualizados: ${state.modelosCriadosOuAtualizados}`);
  lines.push(`Linhas ignoradas: ${state.linhasIgnoradas}`);
  lines.push("");
  lines.push("Detalhes por aba:");

  for (const sheet of TARGET_SHEETS) {
    const stats = state.sheetStats[sheet];
    lines.push(
      `- ${sheet}: execucoes=${stats.execucoes}, itens=${stats.itens}, evidencias=${stats.evidencias}, ignoradas=${stats.ignoradas}, setores=${Array.from(stats.setores).sort().join(", ") || "(nenhum)"}`,
    );
  }

  if (state.logs.length > 0) {
    lines.push("");
    lines.push("Logs:");
    lines.push(...state.logs);
  }

  return lines.join("\n");
}

async function writeAudit(state: ImportState, summary: string): Promise<void> {
  const totalExecucoes = TARGET_SHEETS.reduce((sum, sheet) => sum + state.sheetStats[sheet].execucoes, 0);
  const totalItens = TARGET_SHEETS.reduce((sum, sheet) => sum + state.sheetStats[sheet].itens, 0);
  const totalEvidencias = TARGET_SHEETS.reduce((sum, sheet) => sum + state.sheetStats[sheet].evidencias, 0);

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
      id: `IMP3-${randomUUID().slice(0, 8).toUpperCase()}`,
      fonteArquivo: `${state.sourceFile} [ABAS_ESPECIFICAS_9_10_11]`,
      status: state.status,
      setores: state.setoresAfetados.size,
      modelos: state.modelosCriadosOuAtualizados,
      itens: totalItens,
      tiposNc: 0,
      padroesMola: 0,
      vinculosUsuarioSetor: 0,
      linhasIgnoradas: state.linhasIgnoradas,
      logResumo: `${summary}\n\nTotais: execucoes=${totalExecucoes}, evidencias=${totalEvidencias}`,
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
      entidadeId: "ABAS_9_10_11",
      acao: state.status === "SUCESSO" ? "IMPORTACAO_ABAS_ESPECIFICAS" : "IMPORTACAO_ABAS_ESPECIFICAS_ERRO",
      usuarioId: "SCRIPT_IMPORT",
      usuarioNome: "import-inspecoes-abas-especificas.ts",
      detalhes: summary,
    },
  );
}

async function ensurePreconditions(excelPath: string): Promise<void> {
  if (!isOracleEnabled()) {
    throw new Error(
      "Oracle nao esta configurado. Configure ORACLE_USER/ORACLE_PASSWORD/ORACLE_CONNECT_STRING.",
    );
  }

  await initOraclePool();
  await ensureInspecoesTables();

  const requiredTables = ["INS_SETOR", "INS_MODELO_CHECKLIST", "INS_MODELO_CHECKLIST_ITEM", "INS_EXECUCAO", "INS_EXECUCAO_ITEM", "INS_EXECUCAO_ITEM_EVIDENCIA"];
  for (const table of requiredTables) {
    try {
      await executeOracle(`SELECT * FROM ${table.toUpperCase()} WHERE 1 = 0`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ORA-00942")) {
        throw new Error(`Tabela obrigatoria ausente para importacao: ${table}`);
      }
      throw error;
    }
  }

  readFileSync(excelPath);
}

async function main(): Promise<void> {
  const explicitFile = getArgValue("file");
  const excelPath = explicitFile ? resolve(process.cwd(), explicitFile) : DEFAULT_EXCEL_PATH;
  const state = initState(basename(excelPath));

  console.log("=".repeat(88));
  console.log("IMPORTACAO PARCIAL INSPECOES -> ABAS 9.0/10.0/11.0");
  console.log("=".repeat(88));
  console.log(`Arquivo: ${excelPath}`);
  console.log(`Abas alvo: ${TARGET_SHEETS.join(", ")}`);

  try {
    await ensurePreconditions(excelPath);

    const workbook = XLSX.read(readFileSync(excelPath), { type: "buffer" });
    const { parsedRows, grouped } = parseTargetSheets(workbook, state);

    if (parsedRows.length === 0) {
      throw new Error("Nenhuma linha valida encontrada nas abas alvo.");
    }

    for (const setor of state.setoresAfetados) {
      await upsertSetor(setor);
    }

    const { bySetor, itemIdByKey } = buildModelItems(parsedRows);
    await upsertLegacyModels(bySetor, state);
    await importGroupedExecutions(grouped, itemIdByKey, state);

    state.endedAt = new Date();
    const summary = buildSummary(state);
    await writeAudit(state, summary);

    console.log("\nImportacao concluida com sucesso.");
    for (const sheet of TARGET_SHEETS) {
      const stats = state.sheetStats[sheet];
      console.log(
        `- ${sheet}: execucoes=${stats.execucoes}, itens=${stats.itens}, evidencias=${stats.evidencias}, ignoradas=${stats.ignoradas}`,
      );
    }
    console.log(`Setores afetados: ${Array.from(state.setoresAfetados).sort().join(", ")}`);
    console.log(`Modelos criados/atualizados: ${state.modelosCriadosOuAtualizados}`);
    console.log(`Linhas ignoradas (total): ${state.linhasIgnoradas}`);
  } catch (error) {
    state.status = "ERRO";
    state.endedAt = new Date();
    state.logs.push(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    const summary = buildSummary(state);

    try {
      await writeAudit(state, summary);
    } catch (auditError) {
      console.error("Falha ao gravar auditoria de erro:", auditError);
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
  console.error("Falha na importacao das abas especificas:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
