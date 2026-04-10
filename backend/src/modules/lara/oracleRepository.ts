import { env } from "../../config/env.js";
import { isOracleEnabled, withOracleConnection } from "../../db/oracle.js";
import { queryOne, queryRows } from "../../repositories/baseRepository.js";
import oracledb from "oracledb";
import { buildPhoneCandidates, dateToIsoDate, normalizePhone, roundMoney, toNumber } from "./utils.js";
import type { LaraWinthorBoleto } from "./types.js";

type OracleClientMatch = {
  CODCLI: number;
  CLIENTE: string | null;
  CGCENT: string | null;
  CODFILIAL: string | null;
  TELEFONE: string | null;
};

type OracleOpenTitleRow = {
  CODCLI: number;
  CLIENTE: string | null;
  DOCUMENTO: string | null;
  TELEFONE: string | null;
  DUPLICATA: string;
  PRESTACAO: string;
  VALOR: number;
  SALDO_ABERTO: number;
  DTVENC: Date | string | null;
  DIAS_ATRASO: number;
  CODCOB: string | null;
  FILIAL: string | null;
  STATUS_TITULO: string | null;
};

export type OpenTitleQueryOptions = {
  codcli?: number;
  duplicata?: string;
  prestacao?: string;
  includeDesd?: boolean;
  limit?: number;
  offset?: number;
};

type OracleTopClientRow = {
  CODCLI: number;
  CLIENTE: string | null;
  DOCUMENTO: string | null;
  TELEFONE: string | null;
  FILIAL: string | null;
  TOTAL_ABERTO: number;
  QTD_TITULOS: number;
  TITULO_MAIS_ANTIGO: Date | string | null;
  PROXIMO_VENCIMENTO: Date | string | null;
  MAX_DIAS_ATRASO: number;
};

type OracleFilialRow = {
  CODIGO: string | number | null;
};

type OracleWinthorBoletoRow = {
  CODCLI: number;
  CLIENTE: string | null;
  CODFILIAL: string | null;
  NUMTRANSVENDA: number;
  DUPLICATA: string;
  PRESTACAO: string;
  CODCOB: string | null;
  CODBANCOCM: number | null;
  NUMDIASPRAZOPROTESTO: number | null;
  VALOR: number;
  DTVENC: Date | string | null;
  NOSSONUMBCO: string | null;
  CODBARRA: string | null;
  LINHADIG: string | null;
};

export type WinthorTituloLookupInput = {
  codcli?: number;
  duplicata?: string;
  prestacao?: string;
  codfilial?: string;
  numtransvenda?: number;
  cgcent?: string;
  fantasia?: string;
  cliente?: string;
};

export type WinthorGerarBoletoInput = WinthorTituloLookupInput & {
  codbanco?: number;
  numdiasprotesto?: number;
  primeiraImpressao?: boolean;
  forceRegenerate?: boolean;
};

export type WinthorProrrogarTituloInput = WinthorTituloLookupInput & {
  novaDataVencimento: string;
  observacao?: string;
  codfunc?: number;
  tipoProrrog?: string;
  solicitanteRotina?: string;
};

export type WinthorProrrogarTituloResult = {
  boleto: LaraWinthorBoleto;
  dtvenc_anterior: string;
  dtvenc_prorrogada: string;
};

const tableColumnsCache = new Map<string, Set<string>>();
const schemaName = String(env.ORACLE_SCHEMA ?? "").trim().toUpperCase();

function getQualifiedTableName(tableName: string): string {
  const normalizedTable = String(tableName).trim().toUpperCase();
  if (!schemaName) return normalizedTable;
  if (!/^[A-Z0-9_$#]+$/.test(schemaName)) return normalizedTable;
  return `${schemaName}.${normalizedTable}`;
}

async function getTableColumns(tableName: string): Promise<Set<string>> {
  const normalized = tableName.toUpperCase();
  const cacheKey = `${schemaName || "CURRENT"}:${normalized}`;
  const cached = tableColumnsCache.get(cacheKey);
  if (cached) return cached;

  const rows = schemaName
    ? await queryRows<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName`,
      { owner: schemaName, tableName: normalized },
    )
    : await queryRows<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tableName`,
      { tableName: normalized },
    );
  const set = new Set(rows.map((row) => String(row.COLUMN_NAME || "").toUpperCase()));
  tableColumnsCache.set(cacheKey, set);
  return set;
}

function firstAvailableColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const column of candidates) {
    if (columns.has(column.toUpperCase())) return column.toUpperCase();
  }
  return null;
}

function resolvePhoneColumns(columns: Set<string>): string[] {
  const candidates = [
    "TELCOB",
    "TELCOB1",
    "TELCOB2",
    "TELCEL",
    "TELRES",
    "TELCOM1",
    "TELCOM2",
    "TELEFONE",
    "WHATSAPP",
    "FONE1",
    "FONE2",
  ];
  return candidates.filter((column) => columns.has(column));
}

function buildPhoneExpression(alias: string, columns: Set<string>): string {
  const phoneColumn = firstAvailableColumn(columns, resolvePhoneColumns(columns));
  if (!phoneColumn) return "''";
  return `TRIM(${alias}.${phoneColumn})`;
}

function buildPhoneFilterSql(
  alias: string,
  columns: Set<string>,
  phone: string,
): { sql: string; binds: Record<string, unknown> } {
  const phoneColumns = resolvePhoneColumns(columns);
  const phoneCandidates = buildPhoneCandidates(phone);
  const predicates: string[] = [];
  const binds: Record<string, unknown> = {};

  if (!phoneColumns.length || !phoneCandidates.length) {
    return {
      sql: "1 = 0",
      binds: {},
    };
  }

  for (let i = 0; i < phoneColumns.length; i += 1) {
    const column = phoneColumns[i];
    for (let j = 0; j < phoneCandidates.length; j += 1) {
      const bindName = `ph_${i}_${j}`;
      binds[bindName] = phoneCandidates[j];
      predicates.push(`REGEXP_REPLACE(NVL(TRIM(${alias}.${column}), ''), '[^0-9]', '') = :${bindName}`);
    }
  }

  return {
    sql: `(${predicates.join(" OR ")})`,
    binds,
  };
}

function buildDocumentExpression(alias: string, columns: Set<string>): string {
  const documentColumn = firstAvailableColumn(columns, ["CGCENT", "CNPJ", "CPF", "CGCCLI"]);
  if (!documentColumn) return "''";
  return `TRIM(${alias}.${documentColumn})`;
}

function buildFilialExpression(alias: string, columns: Set<string>): string {
  const filialColumn = firstAvailableColumn(columns, ["CODFILIAL", "FILIAL"]);
  if (!filialColumn) return "''";
  return `TRIM(${alias}.${filialColumn})`;
}

export async function findClientsByPhone(phone: string): Promise<OracleClientMatch[]> {
  if (!isOracleEnabled()) return [];
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const pccColumns = await getTableColumns("PCCLIENT");
  const wherePhone = buildPhoneFilterSql("c", pccColumns, normalized);
  const phoneExpr = buildPhoneExpression("c", pccColumns);
  const docExpr = buildDocumentExpression("c", pccColumns);
  const filialExpr = buildFilialExpression("c", pccColumns);

  const rows = await queryRows<OracleClientMatch>(
    `
    SELECT
      c.CODCLI,
      TRIM(c.CLIENTE) AS CLIENTE,
      ${docExpr} AS CGCENT,
      ${filialExpr} AS CODFILIAL,
      ${phoneExpr} AS TELEFONE
    FROM ${getQualifiedTableName("PCCLIENT")} c
    WHERE ${wherePhone.sql}
    ORDER BY c.CODCLI
    `,
    wherePhone.binds,
  );

  const seen = new Set<number>();
  const deduped: OracleClientMatch[] = [];
  for (const row of rows) {
    const codcli = Number(row.CODCLI);
    if (!Number.isFinite(codcli) || seen.has(codcli)) continue;
    seen.add(codcli);
    deduped.push({
      CODCLI: codcli,
      CLIENTE: row.CLIENTE ?? "",
      CGCENT: row.CGCENT ?? "",
      CODFILIAL: row.CODFILIAL ?? "",
      TELEFONE: row.TELEFONE ?? normalized,
    });
  }
  return deduped;
}

export async function findClientByDocument(document: string): Promise<OracleClientMatch | null> {
  if (!isOracleEnabled()) return null;
  const docDigits = String(document ?? "").replace(/\D+/g, "");
  if (!docDigits) return null;

  const pccColumns = await getTableColumns("PCCLIENT");
  const docColumn = firstAvailableColumn(pccColumns, ["CGCENT", "CNPJ", "CPF", "CGCCLI"]);
  const phoneExpr = buildPhoneExpression("c", pccColumns);
  const filialExpr = buildFilialExpression("c", pccColumns);
  if (!docColumn) return null;

  const row = await queryOne<OracleClientMatch>(
    `
    SELECT
      c.CODCLI,
      TRIM(c.CLIENTE) AS CLIENTE,
      TRIM(c.${docColumn}) AS CGCENT,
      ${filialExpr} AS CODFILIAL,
      ${phoneExpr} AS TELEFONE
    FROM ${getQualifiedTableName("PCCLIENT")} c
    WHERE REGEXP_REPLACE(NVL(TRIM(c.${docColumn}), ''), '[^0-9]', '') = :docDigits
    `,
    { docDigits },
  );
  if (!row) return null;
  return {
    CODCLI: Number(row.CODCLI),
    CLIENTE: row.CLIENTE ?? "",
    CGCENT: row.CGCENT ?? "",
    CODFILIAL: row.CODFILIAL ?? "",
    TELEFONE: row.TELEFONE ?? "",
  };
}

export async function getClientByCodcli(codcli: number): Promise<OracleClientMatch | null> {
  if (!isOracleEnabled()) return null;
  const pccColumns = await getTableColumns("PCCLIENT");
  const phoneExpr = buildPhoneExpression("c", pccColumns);
  const docExpr = buildDocumentExpression("c", pccColumns);
  const filialExpr = buildFilialExpression("c", pccColumns);

  const row = await queryOne<OracleClientMatch>(
    `
    SELECT
      c.CODCLI,
      TRIM(c.CLIENTE) AS CLIENTE,
      ${docExpr} AS CGCENT,
      ${filialExpr} AS CODFILIAL,
      ${phoneExpr} AS TELEFONE
    FROM ${getQualifiedTableName("PCCLIENT")} c
    WHERE c.CODCLI = :codcli
    `,
    { codcli },
  );
  if (!row) return null;
  return {
    CODCLI: Number(row.CODCLI),
    CLIENTE: row.CLIENTE ?? "",
    CGCENT: row.CGCENT ?? "",
    CODFILIAL: row.CODFILIAL ?? "",
    TELEFONE: row.TELEFONE ?? "",
  };
}

function sanitizeTextFilter(value: string | undefined): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function sanitizeDigits(value: string | undefined): string | undefined {
  const normalized = String(value ?? "").replace(/\D+/g, "");
  return normalized || undefined;
}

function sortFilialCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    const aIsNumeric = /^\d+$/.test(a);
    const bIsNumeric = /^\d+$/.test(b);
    if (aIsNumeric && bIsNumeric) return Number(a) - Number(b);
    if (aIsNumeric) return -1;
    if (bIsNumeric) return 1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
  });
}

export async function listFiliaisFromOracle(): Promise<string[]> {
  if (!isOracleEnabled()) return [];

  const columns = await getTableColumns("PCFILIAL");
  const codigoColumn = firstAvailableColumn(columns, ["CODIGO", "CODFILIAL"]);
  if (!codigoColumn) return [];

  const rows = await queryRows<OracleFilialRow>(
    `
    SELECT DISTINCT TRIM(TO_CHAR(f.${codigoColumn})) AS CODIGO
    FROM ${getQualifiedTableName("PCFILIAL")} f
    WHERE f.${codigoColumn} IS NOT NULL
    `,
  );

  const unique = new Set<string>();
  for (const row of rows) {
    const codigo = String(row.CODIGO ?? "").trim();
    if (codigo) unique.add(codigo);
  }

  return sortFilialCodes(Array.from(unique));
}

export async function listOpenTitlesFromOracle(
  options: OpenTitleQueryOptions = {},
): Promise<OracleOpenTitleRow[]> {
  if (!isOracleEnabled()) return [];
  const pccColumns = await getTableColumns("PCCLIENT");
  const phoneExpr = buildPhoneExpression("c", pccColumns);
  const docExpr = buildDocumentExpression("c", pccColumns);

  const where: string[] = [
    "p.DTPAG IS NULL",
    "NVL(p.VALOR, 0) > NVL(p.VPAGO, 0)",
  ];
  const binds: Record<string, unknown> = {};

  if (!options.includeDesd) {
    where.push("NVL(TRIM(p.CODCOB), 'SEM_CODCOB') <> 'DESD'");
  }
  if (options.codcli !== undefined) {
    where.push("p.CODCLI = :codcli");
    binds.codcli = options.codcli;
  }

  const duplicata = sanitizeTextFilter(options.duplicata);
  if (duplicata) {
    where.push("TRIM(p.DUPLIC) = :duplicata");
    binds.duplicata = duplicata;
  }

  const prestacao = sanitizeTextFilter(options.prestacao);
  if (prestacao) {
    where.push("TRIM(p.PREST) = :prestacao");
    binds.prestacao = prestacao;
  }

  const coreSql = `
    SELECT
      p.CODCLI,
      TRIM(c.CLIENTE) AS CLIENTE,
      ${docExpr} AS DOCUMENTO,
      ${phoneExpr} AS TELEFONE,
      TRIM(p.DUPLIC) AS DUPLICATA,
      TRIM(p.PREST) AS PRESTACAO,
      NVL(p.VALOR, 0) AS VALOR,
      NVL(p.VALOR, 0) - NVL(p.VPAGO, 0) AS SALDO_ABERTO,
      p.DTVENC,
      TRUNC(SYSDATE) - TRUNC(p.DTVENC) AS DIAS_ATRASO,
      TRIM(p.CODCOB) AS CODCOB,
      TRIM(p.CODFILIAL) AS FILIAL,
      TRIM(p.STATUS) AS STATUS_TITULO
    FROM ${getQualifiedTableName("PCPREST")} p
    LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c ON c.CODCLI = p.CODCLI
    WHERE ${where.join("\n      AND ")}
  `;

  const normalizedLimit = Math.max(0, Math.trunc(Number(options.limit ?? 0)));
  const normalizedOffset = Math.max(0, Math.trunc(Number(options.offset ?? 0)));

  if (normalizedLimit > 0) {
    const pagedSql = `
      SELECT
        CODCLI,
        CLIENTE,
        DOCUMENTO,
        TELEFONE,
        DUPLICATA,
        PRESTACAO,
        VALOR,
        SALDO_ABERTO,
        DTVENC,
        DIAS_ATRASO,
        CODCOB,
        FILIAL,
        STATUS_TITULO
      FROM (
        SELECT
          q.*,
          ROW_NUMBER() OVER (
            ORDER BY q.DTVENC ASC, q.CODCLI ASC, q.DUPLICATA ASC, q.PRESTACAO ASC
          ) AS RN
        FROM (
          ${coreSql}
        ) q
      )
      WHERE RN > :offsetRows
        AND RN <= (:offsetRows + :limitRows)
      ORDER BY RN
    `;
    binds.offsetRows = normalizedOffset;
    binds.limitRows = normalizedLimit;
    return queryRows<OracleOpenTitleRow>(pagedSql, binds);
  }

  return queryRows<OracleOpenTitleRow>(
    `
    ${coreSql}
    ORDER BY p.DTVENC ASC, p.CODCLI ASC, p.DUPLIC ASC, p.PREST ASC
    `,
    binds,
  );
}

export async function listTopOpenClientsFromOracle(limit = 100): Promise<OracleTopClientRow[]> {
  if (!isOracleEnabled()) return [];
  const pccColumns = await getTableColumns("PCCLIENT");
  const docExpr = buildDocumentExpression("c", pccColumns);
  const phoneExpr = buildPhoneExpression("c", pccColumns);

  return queryRows<OracleTopClientRow>(
    `
    SELECT * FROM (
      SELECT
        p.CODCLI,
        MAX(TRIM(c.CLIENTE)) AS CLIENTE,
        MAX(${docExpr}) AS DOCUMENTO,
        MAX(${phoneExpr}) AS TELEFONE,
        MAX(TRIM(p.CODFILIAL)) AS FILIAL,
        SUM(NVL(p.VALOR, 0) - NVL(p.VPAGO, 0)) AS TOTAL_ABERTO,
        COUNT(1) AS QTD_TITULOS,
        MIN(p.DTVENC) AS TITULO_MAIS_ANTIGO,
        MIN(CASE WHEN p.DTVENC >= TRUNC(SYSDATE) THEN p.DTVENC END) AS PROXIMO_VENCIMENTO,
        MAX(TRUNC(SYSDATE) - TRUNC(p.DTVENC)) AS MAX_DIAS_ATRASO
      FROM ${getQualifiedTableName("PCPREST")} p
      LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c ON c.CODCLI = p.CODCLI
      WHERE p.DTPAG IS NULL
        AND NVL(p.VALOR, 0) > NVL(p.VPAGO, 0)
        AND NVL(TRIM(p.CODCOB), 'SEM_CODCOB') <> 'DESD'
      GROUP BY p.CODCLI
      ORDER BY TOTAL_ABERTO DESC
    )
    WHERE ROWNUM <= :limitRows
    `,
    { limitRows: Math.max(1, Math.min(limit, 5000)) },
  );
}

export async function getOpenSummaryByCodcli(codcli: number): Promise<{
  totalAberto: number;
  qtdTitulos: number;
  maxDiasAtraso: number;
}> {
  if (!isOracleEnabled()) {
    return {
      totalAberto: 0,
      qtdTitulos: 0,
      maxDiasAtraso: 0,
    };
  }

  const row = await queryOne<{
    TOTAL_ABERTO: number;
    QTD_TITULOS: number;
    MAX_DIAS_ATRASO: number;
  }>(
    `
    SELECT
      NVL(SUM(NVL(p.VALOR, 0) - NVL(p.VPAGO, 0)), 0) AS TOTAL_ABERTO,
      COUNT(1) AS QTD_TITULOS,
      NVL(MAX(TRUNC(SYSDATE) - TRUNC(p.DTVENC)), 0) AS MAX_DIAS_ATRASO
    FROM ${getQualifiedTableName("PCPREST")} p
    WHERE p.CODCLI = :codcli
      AND p.DTPAG IS NULL
      AND NVL(p.VALOR, 0) > NVL(p.VPAGO, 0)
      AND NVL(TRIM(p.CODCOB), 'SEM_CODCOB') <> 'DESD'
    `,
    { codcli },
  );

  return {
    totalAberto: roundMoney(toNumber((row as any)?.TOTAL_ABERTO ?? 0)),
    qtdTitulos: Number((row as any)?.QTD_TITULOS ?? 0),
    maxDiasAtraso: Number((row as any)?.MAX_DIAS_ATRASO ?? 0),
  };
}

function normalizeLookup(input: WinthorTituloLookupInput): WinthorTituloLookupInput {
  return {
    codcli: input.codcli,
    numtransvenda: input.numtransvenda,
    codfilial: sanitizeTextFilter(input.codfilial),
    duplicata: sanitizeTextFilter(input.duplicata),
    prestacao: sanitizeTextFilter(input.prestacao),
    cgcent: sanitizeDigits(input.cgcent),
    fantasia: sanitizeTextFilter(input.fantasia),
    cliente: sanitizeTextFilter(input.cliente),
  };
}

function assertLookup(input: WinthorTituloLookupInput): void {
  if (
    input.numtransvenda === undefined
    && input.codcli === undefined
    && !input.cgcent
    && !input.fantasia
    && !input.cliente
    && !(input.duplicata && input.prestacao)
  ) {
    throw new Error("Informe numtransvenda, codcli, cgcent, fantasia, cliente ou duplicata + prestacao para localizar o titulo.");
  }
}

async function resolveCodcliFromPcclient(input: WinthorTituloLookupInput): Promise<number | undefined> {
  const hasCustomerLookup = Boolean(input.cgcent || input.fantasia || input.cliente);
  if (!hasCustomerLookup) return input.codcli;

  const pccColumns = await getTableColumns("PCCLIENT");
  const docColumn = firstAvailableColumn(pccColumns, ["CGCENT", "CNPJ", "CPF", "CGCCLI"]);
  const fantasiaColumn = firstAvailableColumn(pccColumns, ["FANTASIA"]);
  const clienteColumn = firstAvailableColumn(pccColumns, ["CLIENTE"]);
  const filialColumn = firstAvailableColumn(pccColumns, ["CODFILIAL", "FILIAL"]);

  const where: string[] = [];
  const binds: Record<string, unknown> = {};

  if (input.cgcent) {
    if (!docColumn) {
      throw new Error("Campo de documento do cliente nao encontrado em PCCLIENT para filtro por cgcent.");
    }
    where.push(`REGEXP_REPLACE(NVL(TRIM(c.${docColumn}), ''), '[^0-9]', '') = :cgcent`);
    binds.cgcent = input.cgcent;
  }

  if (input.fantasia) {
    if (!fantasiaColumn) {
      throw new Error("Campo FANTASIA nao encontrado em PCCLIENT para filtro por fantasia.");
    }
    where.push(`UPPER(TRIM(c.${fantasiaColumn})) LIKE :fantasia`);
    binds.fantasia = `%${input.fantasia.toUpperCase()}%`;
  }

  if (input.cliente) {
    if (!clienteColumn) {
      throw new Error("Campo CLIENTE nao encontrado em PCCLIENT para filtro por cliente.");
    }
    where.push(`UPPER(TRIM(c.${clienteColumn})) LIKE :cliente`);
    binds.cliente = `%${input.cliente.toUpperCase()}%`;
  }

  if (input.codfilial && filialColumn) {
    where.push(`TRIM(c.${filialColumn}) = :codfilialCliente`);
    binds.codfilialCliente = input.codfilial;
  }

  if (!where.length) {
    return input.codcli;
  }

  const rows = await queryRows<{ CODCLI: number }>(
    `
    SELECT c.CODCLI
    FROM ${getQualifiedTableName("PCCLIENT")} c
    WHERE ${where.join("\n      AND ")}
    ORDER BY c.CODCLI
    `,
    binds,
  );

  const codclis = Array.from(
    new Set(
      rows
        .map((row) => Number(row.CODCLI))
        .filter((codcli) => Number.isFinite(codcli) && codcli > 0),
    ),
  );

  if (!codclis.length) {
    throw new Error("Nenhum cliente encontrado em PCCLIENT com os filtros informados.");
  }

  if (input.codcli !== undefined) {
    if (!codclis.includes(input.codcli)) {
      throw new Error("O codcli informado nao corresponde aos dados do cliente em PCCLIENT.");
    }
    return input.codcli;
  }

  if (codclis.length > 1) {
    throw new Error("Mais de um cliente encontrado em PCCLIENT. Informe cgcent (CPF/CNPJ) ou codcli para continuar.");
  }

  return codclis[0];
}

function mapWinthorBoletoRow(row: OracleWinthorBoletoRow): LaraWinthorBoleto {
  const nossonumbco = String(row.NOSSONUMBCO ?? "").trim();
  const codbarra = String(row.CODBARRA ?? "").trim();
  const linhadig = String(row.LINHADIG ?? "").trim();
  return {
    codcli: String(Number(row.CODCLI ?? 0)),
    cliente: String(row.CLIENTE ?? "").trim(),
    codfilial: String(row.CODFILIAL ?? "").trim(),
    numtransvenda: Number(row.NUMTRANSVENDA ?? 0),
    duplicata: String(row.DUPLICATA ?? "").trim(),
    prestacao: String(row.PRESTACAO ?? "").trim(),
    codcob: String(row.CODCOB ?? "").trim(),
    codbanco: Number(row.CODBANCOCM ?? 0),
    numdias_prazo_protesto: Number(row.NUMDIASPRAZOPROTESTO ?? 0),
    valor: roundMoney(toNumber(row.VALOR ?? 0)),
    dtvenc: dateToIsoDate(row.DTVENC),
    nossonumbco,
    codbarra,
    linhadig,
    boleto_disponivel: Boolean(nossonumbco && codbarra && linhadig),
  };
}

async function fetchWinthorBoletoRow(inputRaw: WinthorTituloLookupInput): Promise<OracleWinthorBoletoRow | null> {
  if (!isOracleEnabled()) return null;
  const input = normalizeLookup(inputRaw);
  assertLookup(input);
  const resolvedCodcli = await resolveCodcliFromPcclient(input);
  const binds: Record<string, unknown> = {};
  const filters: string[] = [
    "p.DTPAG IS NULL",
    "NVL(p.VALOR, 0) > 0",
    "NVL(TRIM(p.CODCOB), 'SEM_CODCOB') NOT IN ('TECH', 'SUPP')",
    "NVL(TRIM(p.CODCOBORIG), 'X') <> 'SUPP'",
  ];

  if (input.numtransvenda !== undefined) {
    filters.push("p.NUMTRANSVENDA = :numtransvenda");
    binds.numtransvenda = input.numtransvenda;
  }
  if (resolvedCodcli !== undefined) {
    filters.push("p.CODCLI = :codcli");
    binds.codcli = resolvedCodcli;
  }
  if (input.duplicata) {
    filters.push("TRIM(p.DUPLIC) = :duplicata");
    binds.duplicata = input.duplicata;
  }
  if (input.prestacao) {
    filters.push("TRIM(p.PREST) = :prestacao");
    binds.prestacao = input.prestacao;
  }
  if (input.codfilial) {
    filters.push("TRIM(p.CODFILIAL) = :codfilial");
    binds.codfilial = input.codfilial;
  }

  return queryOne<OracleWinthorBoletoRow>(
    `
    SELECT *
    FROM (
      SELECT
        p.CODCLI,
        TRIM(c.CLIENTE) AS CLIENTE,
        TRIM(p.CODFILIAL) AS CODFILIAL,
        p.NUMTRANSVENDA,
        TRIM(p.DUPLIC) AS DUPLICATA,
        TRIM(p.PREST) AS PRESTACAO,
        TRIM(p.CODCOB) AS CODCOB,
        NVL(p.CODBANCOCM, 0) AS CODBANCOCM,
        NVL(p.NUMDIASPRAZOPROTESTO, NVL(cob.DIASCARENCIA, 5)) AS NUMDIASPRAZOPROTESTO,
        NVL(p.VALOR, 0) AS VALOR,
        p.DTVENC,
        TRIM(p.NOSSONUMBCO) AS NOSSONUMBCO,
        TRIM(p.CODBARRA) AS CODBARRA,
        TRIM(p.LINHADIG) AS LINHADIG
      FROM ${getQualifiedTableName("PCPREST")} p
      LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c ON c.CODCLI = p.CODCLI
      LEFT JOIN ${getQualifiedTableName("PCCOB")} cob ON cob.CODCOB = p.CODCOB
      WHERE ${filters.join("\n        AND ")}
      ORDER BY p.DTVENC DESC, p.NUMTRANSVENDA DESC, p.PREST DESC
    )
    WHERE ROWNUM = 1
    `,
    binds,
  );
}

export async function consultarBoletoWinthor(input: WinthorTituloLookupInput): Promise<LaraWinthorBoleto | null> {
  const row = await fetchWinthorBoletoRow(input);
  return row ? mapWinthorBoletoRow(row) : null;
}

export async function gerarOuRegenerarBoletoWinthor(inputRaw: WinthorGerarBoletoInput): Promise<LaraWinthorBoleto> {
  if (!isOracleEnabled()) {
    throw new Error("Oracle nao configurado para operacao de boleto.");
  }
  const input = normalizeLookup(inputRaw);
  assertLookup(input);
  const before = await fetchWinthorBoletoRow(input);
  if (!before) {
    throw new Error("Titulo nao encontrado para gerar boleto.");
  }
  const beforeMapped = mapWinthorBoletoRow(before);
  if (beforeMapped.boleto_disponivel && !inputRaw.forceRegenerate) {
    return beforeMapped;
  }

  const codbanco = Number(inputRaw.codbanco ?? beforeMapped.codbanco);
  if (!Number.isFinite(codbanco) || codbanco <= 0) {
    throw new Error("Nao foi possivel identificar o banco de cobranca para gerar boleto.");
  }
  const numdiasprotesto = Math.max(0, Number(inputRaw.numdiasprotesto ?? beforeMapped.numdias_prazo_protesto ?? 0));
  const codfilialProc = sanitizeTextFilter(inputRaw.codfilial) || beforeMapped.codfilial || "99";
  const codcobProc = beforeMapped.codcob;
  if (!codcobProc) {
    throw new Error("Titulo sem CODCOB. Nao e possivel gerar boleto.");
  }

  await withOracleConnection(async (connection) => {
    const lockSql = `
      SELECT 1
      FROM ${getQualifiedTableName("PCPREST")}
      WHERE NUMTRANSVENDA = :numtransvenda
        AND TRIM(PREST) = :prestacao
      FOR UPDATE NOWAIT
    `;
    const clearSql = `
      UPDATE ${getQualifiedTableName("PCPREST")}
      SET
        NOSSONUMBCO = NULL,
        CODBARRA = NULL,
        CODBARRA2 = NULL,
        LINHADIG = NULL,
        LINHADIG2 = NULL,
        DIGITAO = NULL,
        NOSSONUMBCO2 = NULL,
        CODBANCOCM2 = NULL,
        DTULTALTER = SYSDATE
      WHERE NUMTRANSVENDA = :numtransvenda
        AND TRIM(PREST) = :prestacao
    `;
    const packageSql = `
      BEGIN
        PKG_DADOSBANCARIOS.P_GERADADOSBANCARIOS(
          :codfilial,
          :codcob,
          :codbanco,
          :numtransvenda,
          :numdiasprotesto,
          :prestacao,
          :filialvirtual,
          :utilizavalorbruto,
          :primeiraimpressao
        );
      END;
    `;
    try {
      await connection.execute(
        lockSql,
        {
          numtransvenda: beforeMapped.numtransvenda,
          prestacao: beforeMapped.prestacao,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.execute(
        clearSql,
        {
          numtransvenda: beforeMapped.numtransvenda,
          prestacao: beforeMapped.prestacao,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.execute(
        packageSql,
        {
          codfilial: codfilialProc,
          codcob: codcobProc,
          codbanco,
          numtransvenda: beforeMapped.numtransvenda,
          numdiasprotesto,
          prestacao: beforeMapped.prestacao,
          filialvirtual: "N",
          utilizavalorbruto: "N",
          primeiraimpressao: inputRaw.primeiraImpressao === false ? "N" : "S",
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  });

  const after = await fetchWinthorBoletoRow({
    numtransvenda: beforeMapped.numtransvenda,
    prestacao: beforeMapped.prestacao,
  });
  if (!after) {
    throw new Error("Titulo nao encontrado apos tentativa de gerar boleto.");
  }
  const afterMapped = mapWinthorBoletoRow(after);
  if (!afterMapped.boleto_disponivel) {
    throw new Error("Boleto nao foi gerado. Campos bancarios permanecem vazios no titulo.");
  }
  return afterMapped;
}

export async function prorrogarTituloWinthor(inputRaw: WinthorProrrogarTituloInput): Promise<WinthorProrrogarTituloResult> {
  if (!isOracleEnabled()) {
    throw new Error("Oracle nao configurado para operacao de prorrogacao.");
  }
  const input = normalizeLookup(inputRaw);
  assertLookup(input);
  const titulo = await fetchWinthorBoletoRow(input);
  if (!titulo) {
    throw new Error("Titulo nao encontrado para prorrogacao.");
  }
  const base = mapWinthorBoletoRow(titulo);
  const novaData = String(inputRaw.novaDataVencimento).trim();
  const codfunc = Math.max(1, Number(inputRaw.codfunc ?? 270));
  const observacao = sanitizeTextFilter(inputRaw.observacao) || sanitizeTextFilter(inputRaw.solicitanteRotina) || "Prorrogacao Lara";
  const tipoProrrog = sanitizeTextFilter(inputRaw.tipoProrrog) || "N";

  await withOracleConnection(async (connection) => {
    const lockSql = `
      SELECT 1
      FROM ${getQualifiedTableName("PCPREST")}
      WHERE NUMTRANSVENDA = :numtransvenda
        AND TRIM(PREST) = :prestacao
      FOR UPDATE NOWAIT
    `;
    const insertLogSql = `
      INSERT INTO ${getQualifiedTableName("PCLOGCR")} (
        CODFILIAL, DUPLIC, PREST, DATA, ROTINA, CODCLI, NUMTRANSVENDA, CODFUNC
      ) VALUES (
        :codfilial, :duplicata, :prestacao, TRUNC(SYSDATE), :rotina, :codcli, :numtransvenda, :codfunc
      )
    `;
    const updateSql = `
      UPDATE ${getQualifiedTableName("PCPREST")}
      SET
        DTVENC = TO_DATE(:novaDataVenc, 'YYYY-MM-DD'),
        DTVENCANTERIOR = TO_DATE(:dtvencAnterior, 'YYYY-MM-DD'),
        DTULTALTER = SYSDATE,
        TIPOPRORROG = :tipoProrrog,
        OBS2 = :observacao,
        DTLANCPRORROG = SYSDATE,
        CODBARRA = NULL,
        LINHADIG = NULL,
        CODFUNCPRORROG = :codfunc,
        CODFUNCULTALTER = :codfunc,
        DTRECEBIMENTOPREVISTO = TO_DATE(:novaDataVenc, 'YYYY-MM-DD')
      WHERE NUMTRANSVENDA = :numtransvenda
        AND TRIM(PREST) = :prestacao
    `;
    try {
      await connection.execute(
        lockSql,
        {
          numtransvenda: base.numtransvenda,
          prestacao: base.prestacao,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.execute(
        insertLogSql,
        {
          codfilial: base.codfilial || "99",
          duplicata: base.duplicata,
          prestacao: base.prestacao,
          rotina: "1231",
          codcli: Number(base.codcli),
          numtransvenda: base.numtransvenda,
          codfunc,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.execute(
        updateSql,
        {
          novaDataVenc: novaData,
          dtvencAnterior: base.dtvenc,
          tipoProrrog,
          observacao,
          codfunc,
          numtransvenda: base.numtransvenda,
          prestacao: base.prestacao,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // noop
      }
      throw error;
    }
  });

  const boleto = await gerarOuRegenerarBoletoWinthor({
    numtransvenda: base.numtransvenda,
    prestacao: base.prestacao,
    codfilial: base.codfilial,
    codbanco: base.codbanco > 0 ? base.codbanco : undefined,
    numdiasprotesto: base.numdias_prazo_protesto,
    forceRegenerate: true,
    primeiraImpressao: false,
  });

  return {
    boleto,
    dtvenc_anterior: base.dtvenc,
    dtvenc_prorrogada: novaData,
  };
}
