import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import oracledb, { type BindParameters } from "oracledb";

type OracleRow = Record<string, unknown>;

type TitleReferenceReport = {
  generatedAt: string;
  schemaName: string | null;
  titleInput: string;
  titleNumeric: number | null;
  counts: {
    pcprest: number;
    pcmovcr: number;
    pclogprest: number;
  };
  reference: {
    codcli: number | null;
    duplic: string | null;
    prest: string | null;
    numtrans: number | null;
    numtransvenda: number | null;
    codbanco: number | null;
    codbancobaixa: number | null;
    dtpagIso: string | null;
    dtbaixaIso: string | null;
    codcob: string | null;
    codcoborig: string | null;
    status: string | null;
    vpago: number | null;
    valor: number | null;
    obs: string | null;
    rotinapag: string | null;
    rotinafecha: string | null;
    rotinainsert: string | null;
  };
  interpretation: {
    codbanco1007Confirmed: boolean;
    looksLikePixSettlement: boolean;
    hasSettlementDate: boolean;
  };
  pcprestRows: OracleRow[];
  pcmovcrRows: OracleRow[];
  pclogprestRows: OracleRow[];
  columnDictionary: {
    pcprest: string[];
    pcmovcr: string[];
    pclogprest: string[];
  };
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Variavel ${name} nao configurada.`);
  }
  return value.trim();
}

function getOracleConnectString(): string {
  if (process.env.ORACLE_CONNECT_STRING?.trim()) {
    return process.env.ORACLE_CONNECT_STRING.trim();
  }
  const host = process.env.ORACLE_HOST?.trim();
  const port = process.env.ORACLE_PORT?.trim();
  const service = process.env.ORACLE_SERVICE_NAME?.trim();
  if (!host || !port || !service) {
    throw new Error(
      "Configure ORACLE_CONNECT_STRING ou ORACLE_HOST/ORACLE_PORT/ORACLE_SERVICE_NAME.",
    );
  }
  return `${host}:${port}/${service}`;
}

function getSchemaName(): string | null {
  const value = String(process.env.ORACLE_SCHEMA ?? "").trim().toUpperCase();
  return value || null;
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

async function loadTableColumns(
  conn: oracledb.Connection,
  schemaName: string | null,
  tableName: string,
): Promise<string[]> {
  const normalized = tableName.toUpperCase();
  if (schemaName) {
    const rows = await queryRows<{ COLUMN_NAME: string }>(
      conn,
      `
      SELECT COLUMN_NAME
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = :owner
        AND TABLE_NAME = :tableName
      ORDER BY COLUMN_ID
      `,
      {
        owner: schemaName,
        tableName: normalized,
      },
    );
    return rows.map((row) => String(row.COLUMN_NAME ?? "").toUpperCase()).filter(Boolean);
  }

  const rows = await queryRows<{ COLUMN_NAME: string }>(
    conn,
    `
    SELECT COLUMN_NAME
    FROM USER_TAB_COLUMNS
    WHERE TABLE_NAME = :tableName
    ORDER BY COLUMN_ID
    `,
    { tableName: normalized },
  );
  return rows.map((row) => String(row.COLUMN_NAME ?? "").toUpperCase()).filter(Boolean);
}

function getQualifiedTableName(schemaName: string | null, tableName: string): string {
  const normalized = tableName.toUpperCase();
  if (!schemaName) return normalized;
  return `${schemaName}.${normalized}`;
}

function pickExistingColumns(available: string[], candidates: string[]): string[] {
  const dictionary = new Set(available.map((value) => value.toUpperCase()));
  return candidates.filter((candidate) => dictionary.has(candidate.toUpperCase()));
}

function toUpperKeys(row: OracleRow): OracleRow {
  const normalized: OracleRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.toUpperCase()] = value;
  }
  return normalized;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function reportToMarkdown(report: TitleReferenceReport): string {
  const lines: string[] = [];
  lines.push(`# Referencia de baixa - titulo ${report.titleInput}`);
  lines.push("");
  lines.push(`Gerado em: ${report.generatedAt}`);
  lines.push(`Schema: ${report.schemaName ?? "USER atual"}`);
  lines.push("");
  lines.push("## 1) Resumo");
  lines.push("");
  lines.push(`- PCPREST encontrados: ${report.counts.pcprest}`);
  lines.push(`- PCMOVCR encontrados: ${report.counts.pcmovcr}`);
  lines.push(`- PCLOGPREST encontrados: ${report.counts.pclogprest}`);
  lines.push(`- codbanco 1007 confirmado: ${report.interpretation.codbanco1007Confirmed ? "sim" : "nao"}`);
  lines.push(`- indicio de baixa PIX: ${report.interpretation.looksLikePixSettlement ? "sim" : "nao"}`);
  lines.push(`- possui data de baixa/pagamento: ${report.interpretation.hasSettlementDate ? "sim" : "nao"}`);
  lines.push("");
  lines.push("## 2) Linha de referencia em PCPREST");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(report.reference));
  lines.push("```");
  lines.push("");
  lines.push("## 3) Evidencias brutas");
  lines.push("");
  lines.push("### PCPREST");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(report.pcprestRows));
  lines.push("```");
  lines.push("");
  lines.push("### PCMOVCR");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(report.pcmovcrRows));
  lines.push("```");
  lines.push("");
  lines.push("### PCLOGPREST");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(report.pclogprestRows));
  lines.push("```");
  lines.push("");
  lines.push("## 4) Dicionario de colunas considerado");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(report.columnDictionary));
  lines.push("```");
  lines.push("");
  lines.push("## 5) Uso recomendado como baseline da Lara");
  lines.push("");
  lines.push("- Usar este caso como referencia de sucesso para baixa com `codbanco = 1007`.");
  lines.push("- Exigir confirmacao positiva antes da baixa.");
  lines.push("- Validar idempotencia por evento/TXID/e2eId e identificador de titulo.");
  lines.push("- Confirmar existencia unica do titulo antes de executar rotina oficial de baixa.");
  lines.push("- Persistir auditoria tecnica e funcional do processo.");
  lines.push("");
  lines.push("## 6) Pendencias");
  lines.push("");
  lines.push("- Confirmar com DBA/financeiro a rotina oficial de baixa homologada no ambiente.");
  lines.push("- Validar regras de valor parcial, juros e desconto para conciliacao automatica.");
  lines.push("- Garantir endpoint produtivo fixo (sem tunel temporario) para n8n -> Lara.");
  lines.push("");
  return lines.join("\n");
}

async function loadPcprestRows(
  conn: oracledb.Connection,
  schemaName: string | null,
  title: string,
  titleNumeric: number | null,
  columns: string[],
): Promise<OracleRow[]> {
  const tableName = getQualifiedTableName(schemaName, "PCPREST");
  const has = (column: string) => columns.includes(column.toUpperCase());

  const whereParts: string[] = [];
  const binds: Record<string, unknown> = { title };

  if (has("DUPLIC")) {
    whereParts.push("TRIM(TO_CHAR(p.DUPLIC)) = :title");
  }
  if (has("NUMTRANS") && titleNumeric !== null) {
    whereParts.push("p.NUMTRANS = :titleNumeric");
    binds.titleNumeric = titleNumeric;
  }
  if (has("NUMTRANSVENDA") && titleNumeric !== null) {
    whereParts.push("p.NUMTRANSVENDA = :titleNumeric");
  }
  if (has("DUPLIC") && has("PREST")) {
    whereParts.push("TRIM(TO_CHAR(p.DUPLIC)) || TRIM(TO_CHAR(p.PREST)) = :title");
  }

  if (!whereParts.length) return [];

  const selectedColumns = pickExistingColumns(columns, [
    "CODCLI",
    "CODFILIAL",
    "DUPLIC",
    "PREST",
    "NUMTRANS",
    "NUMTRANSVENDA",
    "VALOR",
    "VPAGO",
    "CODCOB",
    "CODCOBORIG",
    "STATUS",
    "CODBAIXA",
    "DTPAG",
    "DTBAIXA",
    "CODBANCO",
    "CODBANCOBAIXA",
    "OBS",
    "ROTINAPAG",
    "ROTINAFECHA",
    "ROTINAINSERT",
    "FUNCLANC",
    "EQUIPLANC",
    "TIPOPREST",
  ]);

  const selectClause = selectedColumns.length
    ? selectedColumns.map((column) => `p.${column}`).join(",\n      ")
    : "p.*";

  const rows = await queryRows<OracleRow>(
    conn,
    `
    SELECT
      ${selectClause}
    FROM ${tableName} p
    WHERE ${whereParts.map((part) => `(${part})`).join("\n       OR ")}
    `,
    binds,
  );

  return rows.map(toUpperKeys);
}

async function loadPcmovcrRows(
  conn: oracledb.Connection,
  schemaName: string | null,
  title: string,
  reference: OracleRow | null,
  columns: string[],
): Promise<OracleRow[]> {
  if (!reference) return [];

  const tableName = getQualifiedTableName(schemaName, "PCMOVCR");
  const has = (column: string) => columns.includes(column.toUpperCase());
  const codcli = asNumber(reference.CODCLI);
  const duplic = asText(reference.DUPLIC);
  const prest = asText(reference.PREST);
  const numtrans = asNumber(reference.NUMTRANS);
  const numtransvenda = asNumber(reference.NUMTRANSVENDA);
  const dtpagIso = asIsoDate(reference.DTPAG);

  const whereAnd: string[] = [];
  const binds: Record<string, unknown> = {};

  if (has("CODCLI") && codcli !== null) {
    whereAnd.push("m.CODCLI = :codcli");
    binds.codcli = codcli;
  }

  const strongOr: string[] = [];
  if (has("DUPLICBAIXA") && has("PRESTBAIXA") && duplic && prest) {
    strongOr.push("(TRIM(TO_CHAR(m.DUPLICBAIXA)) = :duplic AND TRIM(TO_CHAR(m.PRESTBAIXA)) = :prest)");
    binds.duplic = duplic;
    binds.prest = prest;
  }
  if (has("NUMTRANS") && numtrans !== null) {
    strongOr.push("m.NUMTRANS = :numtrans");
    binds.numtrans = numtrans;
  }
  if (has("NUMTRANSVENDA") && numtransvenda !== null) {
    strongOr.push("m.NUMTRANSVENDA = :numtransvenda");
    binds.numtransvenda = numtransvenda;
  }
  if (has("HISTORICO")) {
    strongOr.push("UPPER(NVL(m.HISTORICO, '')) LIKE :titleLike");
    binds.titleLike = `%${title.toUpperCase()}%`;
  }
  if (has("NUMDOC")) {
    strongOr.push("UPPER(NVL(m.NUMDOC, '')) LIKE :titleLike");
    binds.titleLike = `%${title.toUpperCase()}%`;
  }

  if (strongOr.length) {
    whereAnd.push(`(${strongOr.join("\n        OR ")})`);
  }

  const dateColumn = has("DATACOMPLETA")
    ? "DATACOMPLETA"
    : has("DATA")
      ? "DATA"
      : has("DTMOV")
        ? "DTMOV"
        : null;

  if (dateColumn && dtpagIso) {
    const dt = new Date(dtpagIso);
    const ini = new Date(dt);
    ini.setDate(ini.getDate() - 3);
    const fim = new Date(dt);
    fim.setDate(fim.getDate() + 3);
    whereAnd.push(`m.${dateColumn} BETWEEN :dtIni AND :dtFim`);
    binds.dtIni = ini;
    binds.dtFim = fim;
  }

  if (!whereAnd.length) return [];

  const selectedColumns = pickExistingColumns(columns, [
    "NUMTRANS",
    "NUMTRANSVENDA",
    "CODCLI",
    "CODFILIAL",
    "VALOR",
    "CODBANCO",
    "CONCILIACAO",
    "HISTORICO",
    "NUMDOC",
    "DUPLICBAIXA",
    "PRESTBAIXA",
    "DATACOMPLETA",
    "DATA",
    "DTMOV",
    "CODCOB",
    "CODUSUR",
    "OBS",
  ]);

  const selectClause = selectedColumns.length
    ? selectedColumns.map((column) => `m.${column}`).join(",\n      ")
    : "m.*";

  const orderBy = dateColumn ? `ORDER BY m.${dateColumn} DESC` : "";
  const rows = await queryRows<OracleRow>(
    conn,
    `
    SELECT
      ${selectClause}
    FROM ${tableName} m
    WHERE ${whereAnd.join("\n      AND ")}
    ${orderBy}
    `,
    binds,
  );
  return rows.map(toUpperKeys);
}

async function loadPclogprestRows(
  conn: oracledb.Connection,
  schemaName: string | null,
  reference: OracleRow | null,
  columns: string[],
): Promise<OracleRow[]> {
  if (!reference) return [];
  const tableName = getQualifiedTableName(schemaName, "PCLOGPREST");
  const has = (column: string) => columns.includes(column.toUpperCase());
  const whereAnd: string[] = [];
  const binds: Record<string, unknown> = {};

  const codcli = asNumber(reference.CODCLI);
  const duplic = asText(reference.DUPLIC);
  const prest = asText(reference.PREST);

  if (has("CODCLI") && codcli !== null) {
    whereAnd.push("l.CODCLI = :codcli");
    binds.codcli = codcli;
  }
  if (has("DUPLIC") && duplic) {
    whereAnd.push("TRIM(TO_CHAR(l.DUPLIC)) = :duplic");
    binds.duplic = duplic;
  }
  if (has("PREST") && prest) {
    whereAnd.push("TRIM(TO_CHAR(l.PREST)) = :prest");
    binds.prest = prest;
  }

  if (!whereAnd.length) return [];

  const selectedColumns = pickExistingColumns(columns, [
    "CODCLI",
    "DUPLIC",
    "PREST",
    "DATA",
    "DTALTER",
    "CODUSUR",
    "MOTIVO",
    "OBS",
  ]);
  const selectClause = selectedColumns.length
    ? selectedColumns.map((column) => `l.${column}`).join(",\n      ")
    : "l.*";

  const orderBy = has("DATA") ? "ORDER BY l.DATA DESC" : "";

  const rows = await queryRows<OracleRow>(
    conn,
    `
    SELECT
      ${selectClause}
    FROM ${tableName} l
    WHERE ${whereAnd.join("\n      AND ")}
    ${orderBy}
    `,
    binds,
  );
  return rows.map(toUpperKeys);
}

function pickReferenceRow(rows: OracleRow[], title: string): OracleRow | null {
  if (!rows.length) return null;
  const exactDuplic = rows.find((row) => asText(row.DUPLIC) === title);
  if (exactDuplic) return exactDuplic;
  return rows[0];
}

function extractReference(row: OracleRow | null): TitleReferenceReport["reference"] {
  if (!row) {
    return {
      codcli: null,
      duplic: null,
      prest: null,
      numtrans: null,
      numtransvenda: null,
      codbanco: null,
      codbancobaixa: null,
      dtpagIso: null,
      dtbaixaIso: null,
      codcob: null,
      codcoborig: null,
      status: null,
      vpago: null,
      valor: null,
      obs: null,
      rotinapag: null,
      rotinafecha: null,
      rotinainsert: null,
    };
  }

  return {
    codcli: asNumber(row.CODCLI),
    duplic: asText(row.DUPLIC),
    prest: asText(row.PREST),
    numtrans: asNumber(row.NUMTRANS),
    numtransvenda: asNumber(row.NUMTRANSVENDA),
    codbanco: asNumber(row.CODBANCO),
    codbancobaixa: asNumber(row.CODBANCOBAIXA),
    dtpagIso: asIsoDate(row.DTPAG),
    dtbaixaIso: asIsoDate(row.DTBAIXA),
    codcob: asText(row.CODCOB),
    codcoborig: asText(row.CODCOBORIG),
    status: asText(row.STATUS),
    vpago: asNumber(row.VPAGO),
    valor: asNumber(row.VALOR),
    obs: asText(row.OBS),
    rotinapag: asText(row.ROTINAPAG),
    rotinafecha: asText(row.ROTINAFECHA),
    rotinainsert: asText(row.ROTINAINSERT),
  };
}

async function run(): Promise<void> {
  const titleInput = String(process.argv[2] ?? "").trim();
  if (!titleInput) {
    throw new Error("Uso: npm run baixa:referencia-titulo -- <titulo>");
  }

  const titleNumeric = /^\d+$/.test(titleInput) ? Number(titleInput) : null;
  const oracleUser = getRequiredEnv("ORACLE_USER");
  const oraclePassword = getRequiredEnv("ORACLE_PASSWORD");
  const connectString = getOracleConnectString();
  const schemaName = getSchemaName();

  const conn = await oracledb.getConnection({
    user: oracleUser,
    password: oraclePassword,
    connectString,
  });

  try {
    const pcprestColumns = await loadTableColumns(conn, schemaName, "PCPREST");
    const pcmovcrColumns = await loadTableColumns(conn, schemaName, "PCMOVCR");
    const pclogprestColumns = await loadTableColumns(conn, schemaName, "PCLOGPREST");

    const pcprestRows = await loadPcprestRows(
      conn,
      schemaName,
      titleInput,
      titleNumeric,
      pcprestColumns,
    );
    const referenceRow = pickReferenceRow(pcprestRows, titleInput);
    const pcmovcrRows = await loadPcmovcrRows(
      conn,
      schemaName,
      titleInput,
      referenceRow,
      pcmovcrColumns,
    );
    const pclogprestRows = await loadPclogprestRows(
      conn,
      schemaName,
      referenceRow,
      pclogprestColumns,
    );

    const reference = extractReference(referenceRow);
    const report: TitleReferenceReport = {
      generatedAt: new Date().toISOString(),
      schemaName,
      titleInput,
      titleNumeric,
      counts: {
        pcprest: pcprestRows.length,
        pcmovcr: pcmovcrRows.length,
        pclogprest: pclogprestRows.length,
      },
      reference,
      interpretation: {
        codbanco1007Confirmed:
          reference.codbanco === 1007 || reference.codbancobaixa === 1007,
        looksLikePixSettlement:
          (reference.codcob ?? "").toUpperCase().includes("PIX")
          || (reference.codcoborig ?? "").toUpperCase().includes("PIX")
          || (reference.obs ?? "").toUpperCase().includes("PIX"),
        hasSettlementDate: Boolean(reference.dtpagIso || reference.dtbaixaIso),
      },
      pcprestRows,
      pcmovcrRows,
      pclogprestRows,
      columnDictionary: {
        pcprest: pcprestColumns,
        pcmovcr: pcmovcrColumns,
        pclogprest: pclogprestColumns,
      },
    };

    const rootDir = resolve(process.cwd(), "..");
    const outDir = resolve(rootDir, "docs", "oracle");
    mkdirSync(outDir, { recursive: true });

    const baseName = `referencia-baixa-titulo-${titleInput}`;
    const mdPath = resolve(outDir, `${baseName}.md`);
    const jsonPath = resolve(outDir, `${baseName}.json`);

    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
    writeFileSync(mdPath, reportToMarkdown(report), "utf8");

    console.log(`Relatorio gerado para titulo ${titleInput}`);
    console.log(`- Markdown: ${mdPath}`);
    console.log(`- JSON: ${jsonPath}`);
    console.log(`- PCPREST: ${report.counts.pcprest}`);
    console.log(`- PCMOVCR: ${report.counts.pcmovcr}`);
    console.log(`- PCLOGPREST: ${report.counts.pclogprest}`);
    console.log(
      `- codbanco 1007 confirmado: ${report.interpretation.codbanco1007Confirmed ? "sim" : "nao"}`,
    );
  } finally {
    await conn.close();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha no diagnostico de referencia: ${message}`);
  process.exitCode = 1;
});

