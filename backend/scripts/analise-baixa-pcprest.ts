import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import oracledb, { type BindParameters } from "oracledb";

type OracleRow = Record<string, unknown>;

type ProcedureArgument = {
  argumentName: string;
  position: number;
  dataType: string;
  inOut: string;
};

type Statement = {
  kind: "SELECT" | "UPDATE" | "INSERT" | "DELETE";
  tableOwner: string | null;
  tableName: string;
  sql: string;
  lines: number[];
  parameterHits: string[];
  fields: string[];
};

type TableCategory = "DIRECT_DML" | "DIRECT_DEPENDENCY" | "TRANSITIVE_DEPENDENCY" | "TRIGGER_SIDE_EFFECT";

type RelatedTable = {
  owner: string;
  tableName: string;
  categories: Set<TableCategory>;
};

type TableField = {
  columnId: number;
  columnName: string;
  dataType: string;
  dataLength: number | null;
  dataPrecision: number | null;
  dataScale: number | null;
  nullable: string;
};

type ReportTable = {
  owner: string;
  tableName: string;
  categories: TableCategory[];
  roleDescription: string;
  usedFieldsInProcedure: string[];
  operations: Array<{
    kind: Statement["kind"];
    lines: string;
    parameterHits: string[];
    fields: string[];
  }>;
  totalFieldCount: number;
  fields: TableField[];
};

type ProcedureMetadata = {
  owner: string;
  name: string;
  arguments: ProcedureArgument[];
  source: Array<{ line: number; text: string }>;
};

const TARGET_PROCEDURE = "PRC_BAIXA_TITULO";
const OUTPUT_MD = "docs/analise-baixa-pcprest.md";
const OUTPUT_JSON = "docs/analise-baixa-pcprest.json";

const roleHints: Record<string, string> = {
  PCFILASUPPLI: "Fila/integracao da SuppliCard; resolve o NUMTRANSVENDA a partir do NUMTRANSACAOSUPPLI.",
  PCPREST: "Titulo a receber; registra efetivamente a baixa (DTPAG, DTBAIXA, VPAGO, VALORDESC, NUMTRANS).",
  PCBANCO: "Cadastro/parametrizacao bancaria; valida banco/agencia/conta e conta contabil de referencia.",
  PCSUPPLICONTAGERENCIAL: "Mapa de contas gerenciais por evento da SuppliCard (prorrogacao, repasse, cancelamentos, bonificacao).",
  PCCONSUM: "Tabela de numeradores/controle; incrementa PROXNUMLANC e PROXNUMTRANS para novos lancamentos.",
  PCLANC: "Lancamentos financeiros/contabeis de apoio na baixa e no desconto.",
  PCESTCR: "Saldo por banco/moeda de cobranca; atualiza ou cria saldo apos movimentacao.",
  PCMOVCR: "Movimento bancario do contas a receber; registra a movimentacao financeira da baixa.",
  PAGUEBEM_INT_ERP: "Tabela integrada por trigger da PCPREST para sincronizacao externa (PagueBem).",
  PCLOGPREST: "Log de exclusao/alteracao da PCPREST (trigger).",
  PCLOGALTERACAODADOS: "Log de alteracoes de dados da PCPREST (trigger).",
  LOGPCPREST_NUMNOTA: "Log especifico de alteracao de numero de nota em PCPREST (trigger).",
  PCHISTNOSSONUMEROBCO: "Historico de nosso numero bancario relacionado a alteracoes da PCPREST.",
  PCHISTSERASA: "Historico Serasa relacionado a alteracoes da PCPREST.",
  PCECOMMERCEB2BCLIENTE: "Estrutura de e-commerce B2B afetada por trigger da PCPREST.",
  PCECOMMERCEB2BFILA: "Fila de integracao e-commerce B2B afetada por trigger da PCPREST.",
  PCECOMMERCEUNILEVERCLIENTE: "Estrutura de e-commerce Unilever afetada por trigger da PCPREST.",
  PCECOMMERCEUNILEVERFILA: "Fila de e-commerce Unilever afetada por trigger da PCPREST.",
  PCINTEGRACAOWTA: "Tabela de integracao WTA afetada por trigger da PCPREST.",
};

function getOracleConnectString(): string {
  if (process.env.ORACLE_CONNECT_STRING) return process.env.ORACLE_CONNECT_STRING;
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const service = process.env.ORACLE_SERVICE_NAME;
  if (!host || !port || !service) {
    throw new Error(
      "Configure ORACLE_CONNECT_STRING ou ORACLE_HOST/ORACLE_PORT/ORACLE_SERVICE_NAME no ambiente.",
    );
  }
  return `${host}:${port}/${service}`;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Variavel ${name} nao configurada.`);
  return value.trim();
}

async function queryRows<T extends OracleRow>(
  conn: oracledb.Connection,
  sql: string,
  binds: BindParameters = {},
): Promise<T[]> {
  const result = await conn.execute<T>(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
  });
  return (result.rows ?? []) as T[];
}

async function resolveProcedureOwner(
  conn: oracledb.Connection,
  procedureName: string,
): Promise<string> {
  const rows = await queryRows<{ OWNER: string }>(
    conn,
    `SELECT OWNER
       FROM ALL_OBJECTS
      WHERE OBJECT_NAME = :procedureName
        AND OBJECT_TYPE = 'PROCEDURE'
      ORDER BY CASE WHEN OWNER = USER THEN 0 ELSE 1 END, OWNER`,
    { procedureName },
  );
  if (!rows.length) throw new Error(`Procedure ${procedureName} nao encontrada.`);
  return rows[0].OWNER;
}

async function loadProcedureMetadata(
  conn: oracledb.Connection,
  owner: string,
  procedureName: string,
): Promise<ProcedureMetadata> {
  const args = await queryRows<{
    ARGUMENT_NAME: string | null;
    POSITION: number;
    DATA_TYPE: string | null;
    IN_OUT: string | null;
  }>(
    conn,
    `SELECT ARGUMENT_NAME, POSITION, DATA_TYPE, IN_OUT
       FROM ALL_ARGUMENTS
      WHERE OWNER = :owner
        AND OBJECT_NAME = :procedureName
        AND PACKAGE_NAME IS NULL
      ORDER BY POSITION`,
    { owner, procedureName },
  );

  const source = await queryRows<{ LINE: number; TEXT: string }>(
    conn,
    `SELECT LINE, TEXT
       FROM ALL_SOURCE
      WHERE OWNER = :owner
        AND NAME = :procedureName
        AND TYPE = 'PROCEDURE'
      ORDER BY LINE`,
    { owner, procedureName },
  );

  return {
    owner,
    name: procedureName,
    arguments: args
      .filter((row) => row.ARGUMENT_NAME)
      .map((row) => ({
        argumentName: String(row.ARGUMENT_NAME),
        position: Number(row.POSITION),
        dataType: String(row.DATA_TYPE ?? ""),
        inOut: String(row.IN_OUT ?? ""),
      })),
    source: source.map((row) => ({
      line: Number(row.LINE),
      text: String(row.TEXT ?? ""),
    })),
  };
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ") ")
    .trim();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFieldTokens(sql: string): string[] {
  const tokens = new Set<string>();
  const cleaned = sql.replace(/\r?\n/g, " ");
  const fieldPattern = /\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g;
  let match: RegExpExecArray | null = fieldPattern.exec(cleaned.toUpperCase());
  while (match) {
    tokens.add(match[2]);
    match = fieldPattern.exec(cleaned.toUpperCase());
  }
  return uniqueSorted(tokens);
}

function extractFieldListFromInsert(sql: string): string[] {
  const upper = sql.toUpperCase();
  const insertMatch = upper.match(/INSERT\s+INTO\s+[A-Z0-9_."$#]+\s*\(([\s\S]*?)\)\s*VALUES/);
  if (!insertMatch) return [];
  return uniqueSorted(
    insertMatch[1]
      .split(",")
      .map((col) => col.replace(/[\s\r\n"]/g, "").trim())
      .filter(Boolean),
  );
}

function extractFieldListFromUpdate(sql: string): string[] {
  const upper = sql.toUpperCase();
  const setMatch = upper.match(/SET\s+([\s\S]*?)\s+WHERE\s+/);
  const setPart = setMatch ? setMatch[1] : "";
  const setCols = setPart
    .split(",")
    .map((chunk) => chunk.trim().split("=")[0]?.trim() ?? "")
    .map((left) => left.split(".").pop() ?? left)
    .filter(Boolean);

  const whereCols = extractFieldTokens(upper);
  return uniqueSorted([...setCols, ...whereCols]);
}

function extractFieldListFromSelectDelete(sql: string): string[] {
  return extractFieldTokens(sql.toUpperCase());
}

function detectTableOwnerAndName(tableToken: string, defaultOwner: string): { owner: string | null; tableName: string } {
  const raw = tableToken.replace(/["\s]/g, "");
  if (!raw) return { owner: null, tableName: "" };
  if (raw.includes(".")) {
    const [owner, tableName] = raw.split(".");
    return { owner: owner.toUpperCase(), tableName: tableName.toUpperCase() };
  }
  return { owner: defaultOwner.toUpperCase(), tableName: raw.toUpperCase() };
}

function parseDmlStatements(
  source: Array<{ line: number; text: string }>,
  procedureOwner: string,
  argumentNames: string[],
): Statement[] {
  const statements: Statement[] = [];
  let buffer: Array<{ line: number; text: string }> = [];

  const flush = (): void => {
    if (!buffer.length) return;
    const sqlRaw = buffer.map((entry) => entry.text).join(" ");
    const sql = normalizeSql(sqlRaw);
    const upper = sql.toUpperCase();
    const lines = buffer.map((entry) => entry.line);
    buffer = [];

    let kind: Statement["kind"] | null = null;
    let tableToken = "";
    if (/^SELECT\s+/i.test(upper)) {
      kind = "SELECT";
      const m = upper.match(/\bFROM\s+([A-Z0-9_."$#]+)(?:\s+[A-Z][A-Z0-9_]*)?/);
      tableToken = m?.[1] ?? "";
    } else if (/^UPDATE\s+/i.test(upper)) {
      kind = "UPDATE";
      const m = upper.match(/^UPDATE\s+([A-Z0-9_."$#]+)/);
      tableToken = m?.[1] ?? "";
    } else if (/^INSERT\s+INTO\s+/i.test(upper)) {
      kind = "INSERT";
      const m = upper.match(/^INSERT\s+INTO\s+([A-Z0-9_."$#]+)/);
      tableToken = m?.[1] ?? "";
    } else if (/^DELETE\s+FROM\s+/i.test(upper)) {
      kind = "DELETE";
      const m = upper.match(/^DELETE\s+FROM\s+([A-Z0-9_."$#]+)/);
      tableToken = m?.[1] ?? "";
    }
    if (!kind || !tableToken) return;

    const parameterHits = argumentNames.filter((arg) => upper.includes(arg.toUpperCase()));
    const ownerName = detectTableOwnerAndName(tableToken, procedureOwner);

    let fields: string[] = [];
    if (kind === "INSERT") fields = extractFieldListFromInsert(upper);
    else if (kind === "UPDATE") fields = extractFieldListFromUpdate(upper);
    else fields = extractFieldListFromSelectDelete(upper);

    statements.push({
      kind,
      tableOwner: ownerName.owner,
      tableName: ownerName.tableName,
      sql,
      lines,
      parameterHits: uniqueSorted(parameterHits),
      fields,
    });
  };

  for (const entry of source) {
    const text = entry.text ?? "";
    if (!buffer.length) {
      if (/^\s*(SELECT|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(text)) {
        buffer.push(entry);
        if (text.includes(";")) flush();
      }
      continue;
    }

    buffer.push(entry);
    if (text.includes(";")) flush();
  }
  flush();

  return statements;
}

async function loadDirectAndTransitiveTables(
  conn: oracledb.Connection,
  owner: string,
  procedureName: string,
): Promise<{
  directTables: Array<{ owner: string; tableName: string }>;
  transitiveTables: Array<{ owner: string; tableName: string }>;
}> {
  const direct = await queryRows<{ REFERENCED_OWNER: string; REFERENCED_NAME: string }>(
    conn,
    `SELECT DISTINCT REFERENCED_OWNER, REFERENCED_NAME
       FROM ALL_DEPENDENCIES
      WHERE OWNER = :owner
        AND NAME = :procedureName
        AND TYPE = 'PROCEDURE'
        AND REFERENCED_TYPE = 'TABLE'
      ORDER BY REFERENCED_OWNER, REFERENCED_NAME`,
    { owner, procedureName },
  );

  const transitive = await queryRows<{ REFERENCED_OWNER: string; REFERENCED_NAME: string }>(
    conn,
    `SELECT DISTINCT REFERENCED_OWNER, REFERENCED_NAME
       FROM ALL_DEPENDENCIES
      WHERE REFERENCED_TYPE = 'TABLE'
      START WITH OWNER = :owner
         AND NAME = :procedureName
         AND TYPE = 'PROCEDURE'
    CONNECT BY NOCYCLE PRIOR REFERENCED_OWNER = OWNER
                   AND PRIOR REFERENCED_NAME = NAME
                   AND PRIOR REFERENCED_TYPE = TYPE
      ORDER BY REFERENCED_OWNER, REFERENCED_NAME`,
    { owner, procedureName },
  );

  return {
    directTables: direct.map((row) => ({ owner: row.REFERENCED_OWNER, tableName: row.REFERENCED_NAME })),
    transitiveTables: transitive.map((row) => ({ owner: row.REFERENCED_OWNER, tableName: row.REFERENCED_NAME })),
  };
}

async function loadTriggerSideEffectTables(
  conn: oracledb.Connection,
  tableOwner: string,
  tableName: string,
): Promise<Array<{ owner: string; tableName: string; triggerName: string }>> {
  const triggers = await queryRows<{ OWNER: string; TRIGGER_NAME: string }>(
    conn,
    `SELECT OWNER, TRIGGER_NAME
       FROM ALL_TRIGGERS
      WHERE TABLE_OWNER = :tableOwner
        AND TABLE_NAME = :tableName
      ORDER BY OWNER, TRIGGER_NAME`,
    { tableOwner, tableName },
  );

  const out: Array<{ owner: string; tableName: string; triggerName: string }> = [];
  for (const trg of triggers) {
    const deps = await queryRows<{ REFERENCED_OWNER: string; REFERENCED_NAME: string }>(
      conn,
      `SELECT DISTINCT REFERENCED_OWNER, REFERENCED_NAME
         FROM ALL_DEPENDENCIES
        WHERE OWNER = :owner
          AND NAME = :triggerName
          AND TYPE = 'TRIGGER'
          AND REFERENCED_TYPE = 'TABLE'
        ORDER BY REFERENCED_OWNER, REFERENCED_NAME`,
      { owner: trg.OWNER, triggerName: trg.TRIGGER_NAME },
    );
    for (const dep of deps) {
      out.push({
        owner: dep.REFERENCED_OWNER,
        tableName: dep.REFERENCED_NAME,
        triggerName: `${trg.OWNER}.${trg.TRIGGER_NAME}`,
      });
    }
  }
  return out;
}

function buildRelatedTableMap(
  statements: Statement[],
  directTables: Array<{ owner: string; tableName: string }>,
  transitiveTables: Array<{ owner: string; tableName: string }>,
  triggerTables: Array<{ owner: string; tableName: string }>,
): Map<string, RelatedTable> {
  const map = new Map<string, RelatedTable>();

  const ensure = (owner: string, tableName: string): RelatedTable => {
    const key = `${owner}.${tableName}`;
    const existing = map.get(key);
    if (existing) return existing;
    const created: RelatedTable = {
      owner,
      tableName,
      categories: new Set<TableCategory>(),
    };
    map.set(key, created);
    return created;
  };

  for (const statement of statements) {
    if (!statement.tableOwner || !statement.tableName) continue;
    ensure(statement.tableOwner, statement.tableName).categories.add("DIRECT_DML");
  }
  for (const table of directTables) {
    ensure(table.owner, table.tableName).categories.add("DIRECT_DEPENDENCY");
  }
  for (const table of transitiveTables) {
    ensure(table.owner, table.tableName).categories.add("TRANSITIVE_DEPENDENCY");
  }
  for (const table of triggerTables) {
    ensure(table.owner, table.tableName).categories.add("TRIGGER_SIDE_EFFECT");
  }

  return map;
}

async function loadTableFields(
  conn: oracledb.Connection,
  owner: string,
  tableName: string,
): Promise<TableField[]> {
  const rows = await queryRows<{
    COLUMN_ID: number;
    COLUMN_NAME: string;
    DATA_TYPE: string;
    DATA_LENGTH: number | null;
    DATA_PRECISION: number | null;
    DATA_SCALE: number | null;
    NULLABLE: string;
  }>(
    conn,
    `SELECT COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE
       FROM ALL_TAB_COLUMNS
      WHERE OWNER = :owner
        AND TABLE_NAME = :tableName
      ORDER BY COLUMN_ID`,
    { owner, tableName },
  );

  return rows.map((row) => ({
    columnId: Number(row.COLUMN_ID),
    columnName: String(row.COLUMN_NAME),
    dataType: String(row.DATA_TYPE),
    dataLength: row.DATA_LENGTH === null || row.DATA_LENGTH === undefined ? null : Number(row.DATA_LENGTH),
    dataPrecision:
      row.DATA_PRECISION === null || row.DATA_PRECISION === undefined ? null : Number(row.DATA_PRECISION),
    dataScale: row.DATA_SCALE === null || row.DATA_SCALE === undefined ? null : Number(row.DATA_SCALE),
    nullable: String(row.NULLABLE),
  }));
}

function refineStatementFieldsWithDictionary(
  statements: Statement[],
  fieldsByTable: Map<string, TableField[]>,
): Statement[] {
  return statements.map((stmt) => {
    if (!stmt.tableOwner || !stmt.tableName) return stmt;
    const key = `${stmt.tableOwner}.${stmt.tableName}`;
    const dictionary = fieldsByTable.get(key) ?? [];
    if (!dictionary.length) return stmt;

    const sql = stmt.sql.toUpperCase();
    const matched = new Set<string>();
    for (const field of dictionary) {
      const pattern = new RegExp(`\\b${escapeRegExp(field.columnName.toUpperCase())}\\b`, "g");
      if (pattern.test(sql)) matched.add(field.columnName.toUpperCase());
    }

    const merged = uniqueSorted([...matched, ...stmt.fields]);
    const filtered = merged.filter((col) =>
      dictionary.some((field) => field.columnName.toUpperCase() === col.toUpperCase()),
    );

    return {
      ...stmt,
      fields: uniqueSorted(filtered),
    };
  });
}

function describeTableRole(tableName: string, categories: TableCategory[]): string {
  if (roleHints[tableName]) return roleHints[tableName];
  if (categories.includes("DIRECT_DML")) {
    return "Tabela com DML direto na procedure de baixa (lida/gravada durante a execucao).";
  }
  if (categories.includes("TRIGGER_SIDE_EFFECT")) {
    return "Tabela impactada indiretamente por triggers disparados no fluxo da baixa.";
  }
  if (categories.includes("TRANSITIVE_DEPENDENCY")) {
    return "Tabela de apoio/consulta usada por objetos chamados pela procedure.";
  }
  return "Tabela relacionada no grafo de dependencias da baixa.";
}

function buildReportTables(
  relatedTables: Map<string, RelatedTable>,
  statements: Statement[],
  fieldsByTable: Map<string, TableField[]>,
): ReportTable[] {
  const out: ReportTable[] = [];
  for (const related of relatedTables.values()) {
    const key = `${related.owner}.${related.tableName}`;
    const fields = fieldsByTable.get(key) ?? [];
    const tableStatements = statements.filter(
      (stmt) =>
        stmt.tableOwner?.toUpperCase() === related.owner.toUpperCase() &&
        stmt.tableName.toUpperCase() === related.tableName.toUpperCase(),
    );

    const usedFields = uniqueSorted(tableStatements.flatMap((stmt) => stmt.fields));
    const categories = uniqueSorted(Array.from(related.categories));
    out.push({
      owner: related.owner,
      tableName: related.tableName,
      categories: categories as TableCategory[],
      roleDescription: describeTableRole(related.tableName, categories as TableCategory[]),
      usedFieldsInProcedure: usedFields,
      operations: tableStatements.map((stmt) => ({
        kind: stmt.kind,
        lines: `${Math.min(...stmt.lines)}-${Math.max(...stmt.lines)}`,
        parameterHits: stmt.parameterHits,
        fields: stmt.fields,
      })),
      totalFieldCount: fields.length,
      fields,
    });
  }

  return out.sort((a, b) => {
    const ka = `${a.owner}.${a.tableName}`;
    const kb = `${b.owner}.${b.tableName}`;
    return ka.localeCompare(kb);
  });
}

function buildParameterFieldMatrix(
  argumentsList: ProcedureArgument[],
  statements: Statement[],
): Array<{
  parameter: string;
  dataType: string;
  inOut: string;
  tables: Array<{ owner: string | null; tableName: string; fields: string[]; operations: string[] }>;
}> {
  return argumentsList.map((arg) => {
    const hits = statements.filter((stmt) =>
      stmt.parameterHits.map((p) => p.toUpperCase()).includes(arg.argumentName.toUpperCase()),
    );

    const grouped = new Map<string, { owner: string | null; tableName: string; fields: Set<string>; operations: Set<string> }>();
    for (const stmt of hits) {
      const key = `${stmt.tableOwner ?? "?"}.${stmt.tableName}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          owner: stmt.tableOwner,
          tableName: stmt.tableName,
          fields: new Set<string>(),
          operations: new Set<string>(),
        });
      }
      const entry = grouped.get(key)!;
      for (const field of stmt.fields) entry.fields.add(field);
      entry.operations.add(stmt.kind);
    }

    return {
      parameter: arg.argumentName,
      dataType: arg.dataType,
      inOut: arg.inOut,
      tables: Array.from(grouped.values())
        .map((entry) => ({
          owner: entry.owner,
          tableName: entry.tableName,
          fields: uniqueSorted(entry.fields),
          operations: uniqueSorted(entry.operations),
        }))
        .sort((a, b) => `${a.owner}.${a.tableName}`.localeCompare(`${b.owner}.${b.tableName}`)),
    };
  });
}

function toMarkdown(report: {
  generatedAt: string;
  connectedAs: string;
  procedure: ProcedureMetadata;
  parameterMatrix: ReturnType<typeof buildParameterFieldMatrix>;
  tables: ReportTable[];
  statements: Statement[];
}): string {
  const lines: string[] = [];
  lines.push("# Analise de Baixa de Titulo - PCPREST");
  lines.push("");
  lines.push(`Gerado em: ${report.generatedAt}`);
  lines.push(`Usuario Oracle: ${report.connectedAs}`);
  lines.push(`Procedure: ${report.procedure.owner}.${report.procedure.name}`);
  lines.push("");

  lines.push("## 1) Parametros da Procedure");
  lines.push("");
  lines.push(
    "| parametro | tipo | in_out | tabelas relacionadas |",
  );
  lines.push("| --- | --- | --- | --- |");
  for (const param of report.parameterMatrix) {
    const tableList = param.tables.length
      ? param.tables.map((table) => `${table.owner ?? "?"}.${table.tableName}`).join(", ")
      : "_none_";
    lines.push(`| ${param.parameter} | ${param.dataType} | ${param.inOut} | ${tableList} |`);
  }
  lines.push("");

  lines.push("## 2) Matriz Parametro -> Tabela.Campo");
  lines.push("");
  for (const param of report.parameterMatrix) {
    lines.push(`### ${param.parameter}`);
    lines.push("");
    if (!param.tables.length) {
      lines.push("_Sem uso direto em DML detectado no parser._");
      lines.push("");
      continue;
    }
    lines.push("| tabela | operacoes | campos |");
    lines.push("| --- | --- | --- |");
    for (const table of param.tables) {
      lines.push(
        `| ${table.owner ?? "?"}.${table.tableName} | ${table.operations.join(", ")} | ${table.fields.join(", ")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 3) Tabelas Relacionadas com a Baixa");
  lines.push("");
  lines.push(
    "| tabela | categorias | o que faz no fluxo | campos usados na procedure | total de campos |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const table of report.tables) {
    lines.push(
      `| ${table.owner}.${table.tableName} | ${table.categories.join(", ")} | ${table.roleDescription} | ${table.usedFieldsInProcedure.join(", ") || "_none_"} | ${table.totalFieldCount} |`,
    );
  }
  lines.push("");

  lines.push("## 4) DML Detectado na Procedure");
  lines.push("");
  lines.push("| operacao | tabela | linhas | parametros | campos |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const stmt of report.statements) {
    lines.push(
      `| ${stmt.kind} | ${stmt.tableOwner ?? "?"}.${stmt.tableName} | ${Math.min(...stmt.lines)}-${Math.max(...stmt.lines)} | ${stmt.parameterHits.join(", ") || "_none_"} | ${stmt.fields.join(", ") || "_none_"} |`,
    );
  }
  lines.push("");

  lines.push("## 5) Campos Completos por Tabela");
  lines.push("");
  for (const table of report.tables) {
    lines.push(`### ${table.owner}.${table.tableName}`);
    lines.push("");
    lines.push(`- Papel: ${table.roleDescription}`);
    lines.push(`- Total de campos: ${table.totalFieldCount}`);
    lines.push("");
    lines.push("| id | campo | tipo | len | precision | scale | nullable |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const field of table.fields) {
      lines.push(
        `| ${field.columnId} | ${field.columnName} | ${field.dataType} | ${field.dataLength ?? ""} | ${field.dataPrecision ?? ""} | ${field.dataScale ?? ""} | ${field.nullable} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function run(): Promise<void> {
  const oracleUser = getRequiredEnv("ORACLE_USER");
  const oraclePassword = getRequiredEnv("ORACLE_PASSWORD");
  const connectString = getOracleConnectString();

  const conn = await oracledb.getConnection({
    user: oracleUser,
    password: oraclePassword,
    connectString,
  });

  try {
    const connectedUserRow = await queryRows<{ CURRENT_USER: string }>(
      conn,
      "SELECT USER AS CURRENT_USER FROM DUAL",
    );
    const connectedAs = connectedUserRow[0]?.CURRENT_USER ?? oracleUser.toUpperCase();

    const owner = await resolveProcedureOwner(conn, TARGET_PROCEDURE);
    const procedure = await loadProcedureMetadata(conn, owner, TARGET_PROCEDURE);
    const statements = parseDmlStatements(
      procedure.source,
      owner,
      procedure.arguments.map((arg) => arg.argumentName.toUpperCase()),
    );

    const { directTables, transitiveTables } = await loadDirectAndTransitiveTables(
      conn,
      owner,
      TARGET_PROCEDURE,
    );
    const triggerTables = await loadTriggerSideEffectTables(conn, owner, "PCPREST");

    const relatedTables = buildRelatedTableMap(
      statements,
      directTables,
      transitiveTables,
      triggerTables.map((row) => ({ owner: row.owner, tableName: row.tableName })),
    );

    const fieldsByTable = new Map<string, TableField[]>();
    for (const table of relatedTables.values()) {
      const key = `${table.owner}.${table.tableName}`;
      const fields = await loadTableFields(conn, table.owner, table.tableName);
      fieldsByTable.set(key, fields);
    }

    const refinedStatements = refineStatementFieldsWithDictionary(statements, fieldsByTable);
    const tables = buildReportTables(relatedTables, refinedStatements, fieldsByTable);
    const parameterMatrix = buildParameterFieldMatrix(procedure.arguments, refinedStatements);

    const report = {
      generatedAt: new Date().toISOString(),
      connectedAs,
      procedure,
      parameterMatrix,
      tables,
      statements: refinedStatements,
      dependencies: {
        directTables,
        transitiveTables,
        triggerTables,
      },
    };

    const cwd = process.cwd();
    const mdPath = resolve(cwd, "..", OUTPUT_MD);
    const jsonPath = resolve(cwd, "..", OUTPUT_JSON);
    mkdirSync(dirname(mdPath), { recursive: true });
    mkdirSync(dirname(jsonPath), { recursive: true });

    writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
    writeFileSync(mdPath, toMarkdown(report), "utf8");

    console.log("Analise concluida.");
    console.log(`- Markdown: ${mdPath}`);
    console.log(`- JSON: ${jsonPath}`);
    console.log(`- Procedure: ${procedure.owner}.${procedure.name}`);
    console.log(`- Tabelas relacionadas: ${tables.length}`);
  } finally {
    await conn.close();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha na analise: ${message}`);
  process.exitCode = 1;
});
