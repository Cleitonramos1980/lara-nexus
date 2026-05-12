/**
 * Importador oficial do modulo Inspecoes.
 *
 * Fonte: planilha legado (Excel) -> tabelas INS_* em Oracle.
 *
 * Abas obrigatorias:
 * - Checklist
 * - NC_PADROES
 * - Molas_Padroes
 * - Users
 *
 * Uso:
 *   npx tsx backend/scripts/import-inspecoes-planilha.ts
 *   npx tsx backend/scripts/import-inspecoes-planilha.ts --force
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

import { initOraclePool, isOracleEnabled } from "../src/db/oracle.js";
import { ensureInspecoesTables } from "../src/repositories/inspecoes/initTables.js";
import { execDml, queryOne } from "../src/repositories/baseRepository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const force = process.argv.includes("--force");
const excelPath = resolve(__dirname, "../data/CHECKLIST_MANAUS_-_qualidade.xlsx");

const OFFICIAL_SETORES = [
  "ESPUMACAO",
  "AREA DE CURA",
  "FLOCADEIRA",
  "LAMINACAO",
  "MOLA",
  "BORDADEIRA",
  "CORTE E COSTURA",
  "MARCENARIA",
  "TAPECARIA",
  "FECHAMENTO",
  "MOVEIS",
  "EMBALAGEM",
  "ALMOXARIFADO",
  "ESTOFAMENTO",
  "EMBALAGEM DE BASE",
] as const;

type CanonicalSetor = (typeof OFFICIAL_SETORES)[number];

const IMPORT_SOURCE = "CHECKLIST_MANAUS_-_qualidade.xlsx";

interface ImportAudit {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  status: "SUCESSO" | "ERRO";
  setores: number;
  modelos: number;
  itens: number;
  tiposNc: number;
  padroesMola: number;
  vinculosUsuarioSetor: number;
  linhasIgnoradas: number;
  logs: string[];
}

const audit: ImportAudit = {
  id: `IMP-${Date.now()}`,
  startedAt: new Date(),
  status: "SUCESSO",
  setores: 0,
  modelos: 0,
  itens: 0,
  tiposNc: 0,
  padroesMola: 0,
  vinculosUsuarioSetor: 0,
  linhasIgnoradas: 0,
  logs: [],
};

async function tableExists(tableName: string): Promise<boolean> {
  const row = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = :tableName`,
    { tableName: tableName.toUpperCase() },
  );
  return Number((row as any)?.CNT ?? 0) > 0;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const row = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT
       FROM USER_TAB_COLUMNS
      WHERE TABLE_NAME = :tableName
        AND COLUMN_NAME = :columnName`,
    {
      tableName: tableName.toUpperCase(),
      columnName: columnName.toUpperCase(),
    },
  );
  return Number((row as any)?.CNT ?? 0) > 0;
}

async function validateSchemaReadiness(): Promise<void> {
  const required: Record<string, string[]> = {
    INS_SETOR: ["ID", "NOME", "ORDEM", "ATIVO"],
    INS_USUARIO_SETOR: ["ID", "SETOR_ID"],
    INS_MODELO_CHECKLIST: ["ID", "NOME", "SETOR_ID", "DESCRICAO", "ATIVO", "ORDEM"],
    INS_MODELO_CHECKLIST_ITEM: ["ID", "MODELO_ID", "DESCRICAO", "ORDEM", "OBRIGATORIO", "EXIGE_EVIDENCIA", "EXIGE_TIPO_NC", "ATIVO"],
    INS_TIPO_NC: ["ID", "SETOR_ID", "NOME", "CATEGORIA", "ATIVO"],
    INS_MOLA_MAQUINA: ["ID", "CODIGO", "DESCRICAO", "ATIVO"],
    INS_MOLA_PADRAO: ["ID", "ALTURA_TIPO", "ITEM", "DESCRICAO", "PADRAO", "MINIMO", "MAXIMO", "UNIDADE", "ATIVO"],
  };

  const missing: string[] = [];

  for (const [table, cols] of Object.entries(required)) {
    if (!(await tableExists(table))) {
      missing.push(`${table} (tabela ausente)`);
      continue;
    }

    for (const col of cols) {
      if (!(await columnExists(table, col))) {
        missing.push(`${table}.${col}`);
      }
    }
  }

  // At least one user column must exist (legacy USER_ID or new USUARIO_ID).
  const hasLegacyUserId = await columnExists("INS_USUARIO_SETOR", "USER_ID");
  const hasNewUserId = await columnExists("INS_USUARIO_SETOR", "USUARIO_ID");
  if (!hasLegacyUserId && !hasNewUserId) {
    missing.push("INS_USUARIO_SETOR.(USER_ID|USUARIO_ID)");
  }

  if (missing.length > 0) {
    throw new Error(
      [
        "Schema Oracle de Inspecoes incompleto para importacao oficial.",
        "Objetos ausentes/incompativeis:",
        ...missing.map((item) => ` - ${item}`),
        "Aplique o DDL oficial (db/oracle/INS_DDL.sql) com um usuario dono do schema.",
      ].join("\\n"),
    );
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeSetor(value: unknown): CanonicalSetor | null {
  const raw = normalizeText(value);
  if (!raw) return null;

  const cleaned = raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ") : raw;
  const upper = cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (OFFICIAL_SETORES.includes(upper as CanonicalSetor)) {
    return upper as CanonicalSetor;
  }

  return null;
}

function setorDisplay(setor: CanonicalSetor): string {
  const map: Record<CanonicalSetor, string> = {
    ESPUMACAO: "ESPUMACAO",
    "AREA DE CURA": "AREA DE CURA",
    FLOCADEIRA: "FLOCADEIRA",
    LAMINACAO: "LAMINACAO",
    MOLA: "MOLA",
    BORDADEIRA: "BORDADEIRA",
    "CORTE E COSTURA": "CORTE E COSTURA",
    MARCENARIA: "MARCENARIA",
    TAPECARIA: "TAPECARIA",
    FECHAMENTO: "FECHAMENTO",
    MOVEIS: "MOVEIS",
    EMBALAGEM: "EMBALAGEM",
    ALMOXARIFADO: "ALMOXARIFADO",
    ESTOFAMENTO: "ESTOFAMENTO",
    "EMBALAGEM DE BASE": "EMBALAGEM DE BASE",
  };
  return map[setor];
}

function stableId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((p) => String(p ?? "")).join("|");
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 12).toUpperCase();
  return `${prefix}-${hash}`;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === "") return fallback;
  const norm = normalizeText(value).toUpperCase();
  if (["SIM", "S", "TRUE", "1", "Y", "YES"].includes(norm)) return true;
  if (["NAO", "N", "FALSE", "0", "NO"].includes(norm)) return false;
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseItemOrder(itemCode: string, fallback: number): number {
  const clean = normalizeText(itemCode);
  if (!clean) return fallback;
  const parts = clean.split(".").map((p) => Number(p));
  if (parts.every((p) => Number.isFinite(p)) && parts.length > 0) {
    return parts[parts.length - 1] || fallback;
  }
  return fallback;
}

async function mergeSetor(id: string, nome: string, ordem: number): Promise<void> {
  await execDml(
    `MERGE INTO INS_SETOR t
     USING (SELECT :id ID, :nome NOME, :ordem ORDEM FROM dual) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.NOME = s.NOME,
        t.ORDEM = s.ORDEM,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, NOME, ORDEM, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.NOME, s.ORDEM, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, nome, ordem },
  );
}

async function mergeModelo(id: string, nome: string, descricao: string, setorId: string, ordem: number): Promise<void> {
  await execDml(
    `MERGE INTO INS_MODELO_CHECKLIST t
     USING (SELECT :id ID, :nome NOME, :descricao DESCRICAO, :setorId SETOR_ID, :ordem ORDEM FROM dual) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.NOME = s.NOME,
        t.DESCRICAO = s.DESCRICAO,
        t.SETOR_ID = s.SETOR_ID,
        t.ORDEM = s.ORDEM,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, NOME, DESCRICAO, SETOR_ID, ORDEM, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.NOME, s.DESCRICAO, s.SETOR_ID, s.ORDEM, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, nome, descricao, setorId, ordem },
  );
}

interface ChecklistItemPayload {
  id: string;
  modeloId: string;
  setorId: string;
  codigoItem: string;
  ordem: number;
  descricao: string;
  obrigatorio: boolean;
  exigeEvidencia: boolean;
  exigeTipoNc: boolean;
}

async function mergeChecklistItem(payload: ChecklistItemPayload): Promise<void> {
  await execDml(
    `MERGE INTO INS_MODELO_CHECKLIST_ITEM t
     USING (
       SELECT
         :id ID,
         :modeloId MODELO_ID,
         :setorId SETOR_ID,
         :codigoItem CODIGO_ITEM,
         :ordem ORDEM,
         :descricao DESCRICAO,
         :obrigatorio OBRIGATORIO,
         :exigeEvidencia EXIGE_EVIDENCIA,
         :exigeTipoNc EXIGE_TIPO_NC
       FROM dual
     ) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.MODELO_ID = s.MODELO_ID,
        t.SETOR_ID = s.SETOR_ID,
        t.CODIGO_ITEM = s.CODIGO_ITEM,
        t.ORDEM = s.ORDEM,
        t.DESCRICAO = s.DESCRICAO,
        t.OBRIGATORIO = s.OBRIGATORIO,
        t.EXIGE_EVIDENCIA = s.EXIGE_EVIDENCIA,
        t.EXIGE_TIPO_NC = s.EXIGE_TIPO_NC,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, MODELO_ID, SETOR_ID, CODIGO_ITEM, ORDEM, DESCRICAO,
        OBRIGATORIO, EXIGE_EVIDENCIA, EXIGE_TIPO_NC, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.MODELO_ID, s.SETOR_ID, s.CODIGO_ITEM, s.ORDEM, s.DESCRICAO,
        s.OBRIGATORIO, s.EXIGE_EVIDENCIA, s.EXIGE_TIPO_NC, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    {
      ...payload,
      obrigatorio: payload.obrigatorio ? 1 : 0,
      exigeEvidencia: payload.exigeEvidencia ? 1 : 0,
      exigeTipoNc: payload.exigeTipoNc ? 1 : 0,
    },
  );
}

async function mergeTipoNc(id: string, setorId: string, nome: string, categoria: string, observacao: string | null): Promise<void> {
  await execDml(
    `MERGE INTO INS_TIPO_NC t
     USING (SELECT :id ID, :setorId SETOR_ID, :nome NOME, :categoria CATEGORIA, :observacao OBSERVACAO FROM dual) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.SETOR_ID = s.SETOR_ID,
        t.NOME = s.NOME,
        t.CATEGORIA = s.CATEGORIA,
        t.OBSERVACAO = s.OBSERVACAO,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, SETOR_ID, NOME, CATEGORIA, OBSERVACAO, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.SETOR_ID, s.NOME, s.CATEGORIA, s.OBSERVACAO, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, setorId, nome, categoria, observacao },
  );
}

async function mergePadraoMola(
  id: string,
  alturaTipo: string,
  item: string,
  descricao: string,
  padrao: string,
  minimo: number,
  maximo: number,
  unidade: string,
): Promise<void> {
  await execDml(
    `MERGE INTO INS_MOLA_PADRAO t
     USING (
       SELECT :id ID, :alturaTipo ALTURA_TIPO, :item ITEM, :descricao DESCRICAO,
              :padrao PADRAO, :minimo MINIMO, :maximo MAXIMO, :unidade UNIDADE
         FROM dual
     ) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.ALTURA_TIPO = s.ALTURA_TIPO,
        t.ITEM = s.ITEM,
        t.DESCRICAO = s.DESCRICAO,
        t.PADRAO = s.PADRAO,
        t.MINIMO = s.MINIMO,
        t.MAXIMO = s.MAXIMO,
        t.UNIDADE = s.UNIDADE,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, ALTURA_TIPO, ITEM, DESCRICAO, PADRAO, MINIMO, MAXIMO, UNIDADE,
        ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.ALTURA_TIPO, s.ITEM, s.DESCRICAO, s.PADRAO, s.MINIMO, s.MAXIMO, s.UNIDADE,
        1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, alturaTipo, item, descricao, padrao, minimo, maximo, unidade },
  );
}

async function mergeMaquina(id: string, codigo: string, descricao: string): Promise<void> {
  await execDml(
    `MERGE INTO INS_MOLA_MAQUINA t
     USING (SELECT :id ID, :codigo CODIGO, :descricao DESCRICAO FROM dual) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.CODIGO = s.CODIGO,
        t.DESCRICAO = s.DESCRICAO,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, CODIGO, DESCRICAO, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.CODIGO, s.DESCRICAO, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, codigo, descricao },
  );
}

async function mergeUsuarioSetor(id: string, usuarioId: string, setorId: string): Promise<void> {
  await execDml(
    `MERGE INTO INS_USUARIO_SETOR t
     USING (SELECT :id ID, :usuarioId USUARIO_ID, :setorId SETOR_ID FROM dual) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.USUARIO_ID = s.USUARIO_ID,
        t.SETOR_ID = s.SETOR_ID,
        t.ATIVO = 1,
        t.ATUALIZADO_EM = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        ID, USUARIO_ID, SETOR_ID, ATIVO, CRIADO_EM, ATUALIZADO_EM
      ) VALUES (
        s.ID, s.USUARIO_ID, s.SETOR_ID, 1, SYSTIMESTAMP, SYSTIMESTAMP
      )`,
    { id, usuarioId, setorId },
  );
}

async function writeAuditoriaImportacao(logSummary: string): Promise<void> {
  await execDml(
    `MERGE INTO INS_AUDITORIA_IMPORTACAO t
     USING (
       SELECT
         :id ID,
         :fonteArquivo FONTE_ARQUIVO,
         :status STATUS,
         :setores SETORES_IMPORTADOS,
         :modelos MODELOS_IMPORTADOS,
         :itens ITENS_IMPORTADOS,
         :tiposNc TIPOS_NC_IMPORTADOS,
         :padroesMola PADROES_MOLA_IMPORTADOS,
         :vinculos VINCULOS_USUARIO_SETOR,
         :linhasIgnoradas LINHAS_IGNORADAS,
         :logResumo LOG_RESUMO
       FROM dual
     ) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        t.FONTE_ARQUIVO = s.FONTE_ARQUIVO,
        t.STATUS = s.STATUS,
        t.SETORES_IMPORTADOS = s.SETORES,
        t.MODELOS_IMPORTADOS = s.MODELOS,
        t.ITENS_IMPORTADOS = s.ITENS,
        t.TIPOS_NC_IMPORTADOS = s.TIPOS_NC,
        t.PADROES_MOLA_IMPORTADOS = s.PADROES_MOLA,
        t.VINCULOS_USUARIO_SETOR = s.VINCULOS,
        t.LINHAS_IGNORADAS = s.LINHAS_IGNORADAS,
        t.LOG_RESUMO = s.LOG_RESUMO
      WHEN NOT MATCHED THEN INSERT (
        ID, FONTE_ARQUIVO, STATUS,
        SETORES_IMPORTADOS, MODELOS_IMPORTADOS, ITENS_IMPORTADOS,
        TIPOS_NC_IMPORTADOS, PADROES_MOLA_IMPORTADOS,
        VINCULOS_USUARIO_SETOR, LINHAS_IGNORADAS,
        LOG_RESUMO, CRIADO_EM
      ) VALUES (
        s.ID, s.FONTE_ARQUIVO, s.STATUS,
        s.SETORES, s.MODELOS, s.ITENS,
        s.TIPOS_NC, s.PADROES_MOLA,
        s.VINCULOS, s.LINHAS_IGNORADAS,
        s.LOG_RESUMO, SYSTIMESTAMP
      )`,
    {
      id: audit.id,
      fonteArquivo: IMPORT_SOURCE,
      status: audit.status,
      setores: audit.setores,
      modelos: audit.modelos,
      itens: audit.itens,
      tiposNc: audit.tiposNc,
      padroesMola: audit.padroesMola,
      vinculos: audit.vinculosUsuarioSetor,
      linhasIgnoradas: audit.linhasIgnoradas,
      logResumo,
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
      entidadeId: audit.id,
      acao: audit.status === "SUCESSO" ? "IMPORTACAO_CONCLUIDA" : "IMPORTACAO_COM_ERRO",
      usuarioId: "SCRIPT_IMPORT",
      usuarioNome: "import-inspecoes-planilha.ts",
      detalhes: logSummary,
    },
  );
}

async function cleanByForce(): Promise<void> {
  const tables = [
    "INS_EXECUCAO_ITEM_EVIDENCIA",
    "INS_EXECUCAO_ITEM",
    "INS_EXECUCAO",
    "INS_MOLA_INSPECAO_AMOSTRA",
    "INS_MOLA_INSPECAO",
    "INS_USUARIO_SETOR",
    "INS_TIPO_NC",
    "INS_MODELO_CHECKLIST_ITEM",
    "INS_MODELO_CHECKLIST",
    "INS_MOLA_PADRAO",
    "INS_MOLA_MAQUINA",
    "INS_SETOR",
  ];

  for (const table of tables) {
    await execDml(`DELETE FROM ${table}`);
  }
}

function requireSheet(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Aba obrigatoria nao encontrada: ${sheetName}`);
  }
  return sheet;
}

async function main(): Promise<void> {
  console.log("=".repeat(80));
  console.log("IMPORTACAO OFICIAL INSPECOES -> ORACLE");
  console.log("=".repeat(80));
  console.log(`Arquivo: ${excelPath}`);

  if (!isOracleEnabled()) {
    throw new Error(
      "Oracle nao esta configurado. Configure ORACLE_USER/ORACLE_PASSWORD/ORACLE_CONNECT_STRING para rodar a importacao oficial.",
    );
  }

  await initOraclePool();
  await ensureInspecoesTables();
  await validateSchemaReadiness();

  if (force) {
    console.log("[FORCE] Limpando dados atuais de Inspecoes...");
    await cleanByForce();
  }

  const file = readFileSync(excelPath);
  const workbook = XLSX.read(file, { type: "buffer" });

  const checklistSheet = requireSheet(workbook, "Checklist");
  const ncSheet = requireSheet(workbook, "NC_PADROES");
  const molasSheet = requireSheet(workbook, "Molas_Padroes");
  const usersSheet = requireSheet(workbook, "Users");

  const checklistRows: any[] = XLSX.utils.sheet_to_json(checklistSheet, { defval: "" });
  const ncRows: any[] = XLSX.utils.sheet_to_json(ncSheet, { defval: "" });
  const molaRows: any[] = XLSX.utils.sheet_to_json(molasSheet, { defval: "" });
  const usersRows: any[] = XLSX.utils.sheet_to_json(usersSheet, { defval: "" });

  console.log(`Checklist rows: ${checklistRows.length}`);
  console.log(`NC rows: ${ncRows.length}`);
  console.log(`Molas rows: ${molaRows.length}`);
  console.log(`Users rows: ${usersRows.length}`);

  const setorIdByName = new Map<CanonicalSetor, string>();

  // 1) Setores oficiais (15)
  for (const [index, setor] of OFFICIAL_SETORES.entries()) {
    const setorId = `SET-${String(index + 1).padStart(3, "0")}`;
    setorIdByName.set(setor, setorId);
    await mergeSetor(setorId, setorDisplay(setor), index + 1);
  }
  audit.setores = OFFICIAL_SETORES.length;

  // 2) Modelos por setor (1 por setor)
  for (const [index, setor] of OFFICIAL_SETORES.entries()) {
    const setorId = setorIdByName.get(setor)!;
    const modeloId = `MOD-${String(index + 1).padStart(3, "0")}`;
    await mergeModelo(
      modeloId,
      `Checklist ${setorDisplay(setor)}`,
      `Checklist oficial do setor ${setorDisplay(setor)} (importado da planilha legado).`,
      setorId,
      index + 1,
    );
  }
  audit.modelos = OFFICIAL_SETORES.length;

  // 3) Itens do checklist (1:1)
  let checklistImported = 0;
  for (const [idx, row] of checklistRows.entries()) {
    const setor = normalizeSetor(row["Setor"]);
    const descricao = normalizeText(row["Descricao"] || row["Descrição"] || row["descrição"]);
    const codigoItem = normalizeText(row["Item"] || row["Codigo"] || row["Código"]);

    if (!setor || !descricao) {
      audit.linhasIgnoradas += 1;
      audit.logs.push(`Checklist linha ${idx + 2}: ignorada (setor/descricao ausentes).`);
      continue;
    }

    const setorId = setorIdByName.get(setor)!;
    const modeloId = `MOD-${String(OFFICIAL_SETORES.indexOf(setor) + 1).padStart(3, "0")}`;

    const ordemPlanilha = row["Ordem"];
    const ordem = toNumber(
      ordemPlanilha,
      parseItemOrder(codigoItem, checklistImported + 1),
    );

    const obrigatorio = toBool(row["Obrigatorio?"] ?? row["Obrigatorio? "] ?? row["Obrigatorio"], true);
    const exigeEvidencia = toBool(
      row["Exige Evidencia?"] ?? row["Exige Evidencia"] ?? row["ExigeEvidencia"],
      false,
    );
    const exigeTipoNc = toBool(
      row["Exige Tipo NC?"] ?? row["Exige Tipo NC"] ?? row["ExigeTipoNC"],
      true,
    );

    const effectiveCodigo = codigoItem || `ITEM-${String(ordem).padStart(4, "0")}`;
    const itemId = stableId("ITEM", setor, effectiveCodigo, descricao);

    await mergeChecklistItem({
      id: itemId,
      modeloId,
      setorId,
      codigoItem: effectiveCodigo,
      ordem,
      descricao,
      obrigatorio,
      exigeEvidencia,
      exigeTipoNc,
    });

    checklistImported += 1;
  }
  audit.itens = checklistImported;

  // 4) Tipos NC (1:1)
  let tiposNcImported = 0;
  for (const [idx, row] of ncRows.entries()) {
    const setor = normalizeSetor(row["Setor"]);
    const nome = normalizeText(row["Defeito"] || row["Nome"] || row["Descricao"] || row["Descrição"]);

    if (!setor || !nome) {
      audit.linhasIgnoradas += 1;
      audit.logs.push(`NC linha ${idx + 2}: ignorada (setor/nome ausentes).`);
      continue;
    }

    const categoria = normalizeText(row["Categoria"] || row["Classificacao"] || row["Classificação"] || "Processo") || "Processo";
    const observacaoRaw = normalizeText(row["Observacao"] || row["Observação"] || "");

    const setorId = setorIdByName.get(setor)!;
    const ncId = stableId("TNC", setor, nome);

    await mergeTipoNc(ncId, setorId, nome, categoria, observacaoRaw || null);
    tiposNcImported += 1;
  }
  audit.tiposNc = tiposNcImported;

  // 5) Padroes mola (1:1)
  let padroesImported = 0;
  for (const [idx, row] of molaRows.entries()) {
    const alturaTipo = normalizeText(row["AlturaTipo"]);
    const item = normalizeText(row["Item"]);
    const descricao = normalizeText(row["Descricao"] || row["Descrição"]);
    const padrao = normalizeText(row["Padrao"] || row["Padrão"]);
    const minimo = toNumber(row["Min"], 0);
    const maximo = toNumber(row["Max"], 0);
    const unidade = normalizeText(row["Unidade"]);

    if (!alturaTipo || !item || !descricao) {
      audit.linhasIgnoradas += 1;
      audit.logs.push(`Mola linha ${idx + 2}: ignorada (altura/item/descricao ausentes).`);
      continue;
    }

    const padraoId = stableId("PM", alturaTipo, item, descricao);
    await mergePadraoMola(padraoId, alturaTipo, item, descricao, padrao, minimo, maximo, unidade);
    padroesImported += 1;
  }
  audit.padroesMola = padroesImported;

  // 6) Maquinas 01..04
  for (const cod of ["01", "02", "03", "04"]) {
    await mergeMaquina(`MAQ-${cod}`, cod, `MAQUINA ${cod}`);
  }

  // 7) Vínculo usuario-setor (Users + histórico de abas de setor)
  const userSetorPairs = new Set<string>();

  for (const row of usersRows) {
    const usuarioId = normalizeText(row["Usuario"] || row["Usuário"] || row["User"]);
    if (!usuarioId) continue;

    const setoresRaw = normalizeText(row["Setor"] || row["Setores"] || "");
    if (!setoresRaw) continue;

    const split = setoresRaw.split(",").map((s) => normalizeText(s)).filter(Boolean);
    for (const setorText of split) {
      const setor = normalizeSetor(setorText);
      if (!setor) {
        audit.linhasIgnoradas += 1;
        audit.logs.push(`Users: setor nao reconhecido para usuario ${usuarioId}: ${setorText}`);
        continue;
      }
      userSetorPairs.add(`${usuarioId}||${setor}`);
    }
  }

  // Complementa com histórico em abas de setor no legado.
  for (const sheetName of workbook.SheetNames) {
    if (["Checklist", "NC_PADROES", "Molas_Padroes", "Users"].includes(sheetName)) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    for (const row of rows) {
      const usuarioId = normalizeText(row["Usuario"] || row["Usuário"] || row["User"]);
      const setor = normalizeSetor(row["Setor"]);
      if (!usuarioId || !setor) continue;
      userSetorPairs.add(`${usuarioId}||${setor}`);
    }
  }

  for (const pair of userSetorPairs) {
    const [usuarioId, setor] = pair.split("||") as [string, CanonicalSetor];
    const setorId = setorIdByName.get(setor);
    if (!setorId) continue;

    const id = stableId("US", usuarioId, setor);
    await mergeUsuarioSetor(id, usuarioId, setorId);
    audit.vinculosUsuarioSetor += 1;
  }

  // 8) Sanity check counts
  const dbSetores = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM INS_SETOR WHERE ATIVO = 1");
  const dbModelos = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM INS_MODELO_CHECKLIST WHERE ATIVO = 1");
  const dbItens = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM INS_MODELO_CHECKLIST_ITEM WHERE ATIVO = 1");
  const dbNc = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM INS_TIPO_NC WHERE ATIVO = 1");
  const dbPadroes = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM INS_MOLA_PADRAO WHERE ATIVO = 1");

  audit.logs.push(`Contagem final INS_SETOR: ${Number((dbSetores as any)?.CNT ?? 0)}`);
  audit.logs.push(`Contagem final INS_MODELO_CHECKLIST: ${Number((dbModelos as any)?.CNT ?? 0)}`);
  audit.logs.push(`Contagem final INS_MODELO_CHECKLIST_ITEM: ${Number((dbItens as any)?.CNT ?? 0)}`);
  audit.logs.push(`Contagem final INS_TIPO_NC: ${Number((dbNc as any)?.CNT ?? 0)}`);
  audit.logs.push(`Contagem final INS_MOLA_PADRAO: ${Number((dbPadroes as any)?.CNT ?? 0)}`);

  audit.endedAt = new Date();

  const summary = [
    `Fonte: ${IMPORT_SOURCE}`,
    `FORCE: ${force ? "SIM" : "NAO"}`,
    `Setores importados: ${audit.setores}`,
    `Modelos importados: ${audit.modelos}`,
    `Itens importados: ${audit.itens}`,
    `Tipos NC importados: ${audit.tiposNc}`,
    `Padroes de mola importados: ${audit.padroesMola}`,
    `Vinculos usuario-setor: ${audit.vinculosUsuarioSetor}`,
    `Linhas ignoradas: ${audit.linhasIgnoradas}`,
    `Inicio: ${audit.startedAt.toISOString()}`,
    `Fim: ${audit.endedAt.toISOString()}`,
    "",
    "Logs:",
    ...audit.logs,
  ].join("\n");

  await writeAuditoriaImportacao(summary);

  console.log("\nImportacao concluida com sucesso.");
  console.log(`Setores: ${audit.setores}`);
  console.log(`Modelos: ${audit.modelos}`);
  console.log(`Itens checklist: ${audit.itens}`);
  console.log(`Tipos NC: ${audit.tiposNc}`);
  console.log(`Padroes mola: ${audit.padroesMola}`);
  console.log(`Vinculos usuario-setor: ${audit.vinculosUsuarioSetor}`);
  console.log(`Linhas ignoradas: ${audit.linhasIgnoradas}`);
}

main().catch(async (error) => {
  audit.status = "ERRO";
  audit.endedAt = new Date();
  audit.logs.push(`Erro: ${error instanceof Error ? error.message : String(error)}`);

  const summary = [
    `Fonte: ${IMPORT_SOURCE}`,
    `Status: ERRO`,
    `Setores importados: ${audit.setores}`,
    `Modelos importados: ${audit.modelos}`,
    `Itens importados: ${audit.itens}`,
    `Tipos NC importados: ${audit.tiposNc}`,
    `Padroes de mola importados: ${audit.padroesMola}`,
    `Vinculos usuario-setor: ${audit.vinculosUsuarioSetor}`,
    `Linhas ignoradas: ${audit.linhasIgnoradas}`,
    `Inicio: ${audit.startedAt.toISOString()}`,
    `Fim: ${audit.endedAt.toISOString()}`,
    "",
    "Logs:",
    ...audit.logs,
  ].join("\n");

  try {
    if (isOracleEnabled()) {
      await initOraclePool();
      await ensureInspecoesTables();
      await writeAuditoriaImportacao(summary);
    }
  } catch {
    // Ignora erro secundario de auditoria para nao mascarar falha principal.
  }

  console.error("Falha na importacao oficial de Inspecoes:", error);
  process.exit(1);
});
