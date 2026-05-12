import { randomUUID } from "node:crypto";
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

export type OracleOpenTitleRow = {
  CODCLI: number;
  CLIENTE: string | null;
  FANTASIA: string | null;
  DOCUMENTO: string | null;
  TELEFONE: string | null;
  DUPLICATA: string;
  PRESTACAO: string;
  NUMTRANSVENDA: number;
  NUMNOTA: number;
  VALOR: number;
  VLRECEBER: number;
  VLDESC: number;
  CMULTA_PREV: number;
  PERCMULTA: number;
  DTVENC: Date | string | null;
  DTEMISSAO: Date | string | null;
  DTRECEBIMENTO_PREVISTO: Date | string | null;
  DIAS_ATRASO: number;
  CODCOB: string | null;
  COBRANCA: string | null;
  RCA: string | null;
  FILIAL: string | null;
  STATUS_TITULO: string | null;
  TITULO_COM_DATA_PREVISTA: string;
};

export type OpenTitleQueryOptions = {
  codcli?: number;
  duplicata?: string;
  prestacao?: string;
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

export type OraclePixTitleMatchRow = {
  CODCLI: number;
  CLIENTE: string | null;
  DUPLICATA: string | null;
  PRESTACAO: string | null;
  VALOR: number;
  VPAGO: number;
  SALDO_ABERTO: number;
  DTPAG: Date | string | null;
  DTVENC: Date | string | null;
  CODCOB: string | null;
  STATUS_TITULO: string | null;
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

export async function getTableColumns(tableName: string): Promise<Set<string>> {
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
    "PSA_TELWHATS", // coluna WhatsApp explícita (maior prioridade)
    "WHATSAPP",
    "TELCOB",
    "TELCOB1",
    "TELCOB2",
    "TELCEL",
    "TELCELENT",    // celular empresa/entidade
    "TELENT",       // telefone entidade — usado no Winthor AM
    "TELRES",
    "TELCOM1",
    "TELCOM2",
    "TELEFONE",
    "FONE1",
    "FONE2",
  ];
  return candidates.filter((column) => columns.has(column));
}

function buildPhoneExpression(alias: string, columns: Set<string>): string {
  const phoneColumns = resolvePhoneColumns(columns);
  if (!phoneColumns.length) return "''";
  if (phoneColumns.length === 1) return `TRIM(${alias}.${phoneColumns[0]})`;
  // COALESCE percorre todas as colunas em prioridade e retorna o primeiro valor não-nulo/não-vazio.
  // Necessário pois algumas colunas (TELCOB, TELCEL…) podem existir mas estar vazias para o cliente.
  const parts = phoneColumns.map((col) => `NULLIF(TRIM(${alias}.${col}), '')`);
  return `COALESCE(${parts.join(", ")})`;
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
  const pcfColumns = await getTableColumns("PCFILIAL");
  const nomeFilialCol = firstAvailableColumn(pcfColumns, ["NOMEFIL", "NOMEFILIAL", "NOME", "FANTASIA", "RAZAOSOCIAL"]);

  const CODCOB_ATIVOS = `('341','756','BK')`;

  const extraWhere: string[] = [];
  const binds: Record<string, unknown> = {};

  if (options.codcli !== undefined) {
    extraWhere.push("p.CODCLI = :codcli");
    binds.codcli = options.codcli;
  }

  const duplicata = sanitizeTextFilter(options.duplicata);
  if (duplicata) {
    extraWhere.push("TRIM(p.DUPLIC) = :duplicata");
    binds.duplicata = duplicata;
  }

  const prestacao = sanitizeTextFilter(options.prestacao);
  if (prestacao) {
    extraWhere.push("TRIM(p.PREST) = :prestacao");
    binds.prestacao = prestacao;
  }

  const extraWhereClause = extraWhere.length > 0 ? `AND ${extraWhere.join("\n      AND ")}` : "";

  const coreSql = `
    SELECT
      p.CODCLI,
      TRIM(c.CLIENTE)                                            AS CLIENTE,
      TRIM(NVL(c.FANTASIA, c.CLIENTE))                          AS FANTASIA,
      ${docExpr}                                                 AS DOCUMENTO,
      ${phoneExpr}                                               AS TELEFONE,
      TRIM(p.DUPLIC)                                             AS DUPLICATA,
      TRIM(p.PREST)                                             AS PRESTACAO,
      NVL(p.NUMTRANSVENDA, 0)                                   AS NUMTRANSVENDA,
      NVL(fn.NUMNOTA, 0)                                        AS NUMNOTA,
      CASE
        WHEN (NVL(p.DTRECEBIMENTOPREVISTO, p.DTVENC) > p.DTVENC
              AND NVL(p.TXPERMPREVISTO, 0) > 0)
        THEN p.DTRECEBIMENTOPREVISTO
        ELSE p.DTVENC
      END                                                        AS DTVENC,
      p.DTEMISSAO,
      p.DTRECEBIMENTOPREVISTO                                    AS DTRECEBIMENTO_PREVISTO,
      f_qtdiasvencidos(
        p.DTVENC,
        TRUNC(SYSDATE),
        p.CODCOB,
        p.CODFILIAL,
        (SELECT NVL(pf.USADIAUTILFILIAL,'N') FROM ${getQualifiedTableName("PCFILIAL")} pf WHERE pf.CODIGO = p.CODFILIAL)
      )                                                          AS DIAS_ATRASO,
      NVL(p.VALOR, 0)                                           AS VALOR,
      NVL(p.VALOR, 0) - NVL(p.VALORDESC, 0)                    AS VLRECEBER,
      NVL(p.VALORDESC, 0)                                       AS VLDESC,
      CASE
        WHEN p.CODCOB IN ('DESD','ESTR','CANC','CRED','BNF','BNFT','BNFR','BNTR','BNRP','DEVP','DEVT','TR') THEN 0
        ELSE CASE
          WHEN f_qtdiasvencidos(
            p.DTVENC, NVL(p.DTPAG, TRUNC(SYSDATE)), p.CODCOB, p.CODFILIAL,
            (SELECT NVL(pf.USADIAUTILFILIAL,'N') FROM ${getQualifiedTableName("PCFILIAL")} pf WHERE pf.CODIGO = p.CODFILIAL)
          ) > 0
          THEN ROUND(
            NVL(p.VALOR, p.VALORORIG) *
            NVL((SELECT NVL(cc.PERCMULTA,0) FROM ${getQualifiedTableName("PCCOB")} cc WHERE cc.CODCOB = p.CODCOB AND ROWNUM = 1), 0)
            / 100, 2)
          ELSE 0
        END
      END                                                        AS CMULTA_PREV,
      NVL(b.PERCMULTA, 0)                                       AS PERCMULTA,
      TRIM(p.CODCOB)                                            AS CODCOB,
      TRIM(b.COBRANCA)                                          AS COBRANCA,
      ${nomeFilialCol
        ? `NVL(TRIM(pfl.${nomeFilialCol}), TRIM(TO_CHAR(p.CODFILIAL)))`
        : `TRIM(TO_CHAR(p.CODFILIAL))`}                         AS FILIAL,
      TRIM(u.NOME)                                              AS RCA,
      TRIM(p.STATUS)                                            AS STATUS_TITULO,
      CASE WHEN p.DTRECEBIMENTOPREVISTO >= TRUNC(SYSDATE) THEN '*' ELSE '' END AS TITULO_COM_DATA_PREVISTA
    FROM ${getQualifiedTableName("PCPREST")} p
    LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c   ON c.CODCLI    = p.CODCLI
    LEFT JOIN ${getQualifiedTableName("PCCOB")} b      ON b.CODCOB    = p.CODCOB
    LEFT JOIN ${getQualifiedTableName("PCUSUARI")} u   ON u.CODUSUR   = p.CODUSUR
    LEFT JOIN ${getQualifiedTableName("PCNFSAID")} fn  ON fn.NUMTRANSVENDA = p.NUMTRANSVENDA
                                                       AND p.NUMTRANSVENDA > 0
    LEFT JOIN ${getQualifiedTableName("PCFILIAL")} pfl ON pfl.CODIGO  = p.CODFILIAL
    WHERE p.DTPAG IS NULL
      AND NVL(p.VALOR, 0) <> 0
      AND TRIM(p.CODCOB) IN ${CODCOB_ATIVOS}
      ${extraWhereClause}
  `;

  const normalizedLimit = Math.max(0, Math.trunc(Number(options.limit ?? 0)));
  const normalizedOffset = Math.max(0, Math.trunc(Number(options.offset ?? 0)));

  if (normalizedLimit > 0) {
    const pagedSql = `
      SELECT
        CODCLI, CLIENTE, FANTASIA, DOCUMENTO, TELEFONE,
        DUPLICATA, PRESTACAO, NUMTRANSVENDA, NUMNOTA,
        VALOR, VLRECEBER, VLDESC, CMULTA_PREV, PERCMULTA,
        DTVENC, DTEMISSAO, DTRECEBIMENTO_PREVISTO, DIAS_ATRASO,
        CODCOB, COBRANCA, FILIAL, RCA, STATUS_TITULO, TITULO_COM_DATA_PREVISTA
      FROM (
        SELECT q.*, ROW_NUMBER() OVER (
          ORDER BY q.CODCLI ASC, q.DTVENC ASC, q.DUPLICATA ASC, q.PRESTACAO ASC
        ) AS RN
        FROM ( ${coreSql} ) q
      )
      WHERE RN > :offsetRows AND RN <= (:offsetRows + :limitRows)
      ORDER BY RN
    `;
    binds.offsetRows = normalizedOffset;
    binds.limitRows = normalizedLimit;
    return queryRows<OracleOpenTitleRow>(pagedSql, binds);
  }

  return queryRows<OracleOpenTitleRow>(
    `${coreSql} ORDER BY p.CODCLI ASC, p.DTVENC ASC, p.DUPLIC ASC, p.PREST ASC`,
    binds,
  );
}

export async function listTopOpenClientsFromOracle(limit = 100): Promise<OracleTopClientRow[]> {
  if (!isOracleEnabled()) return [];
  const pccColumns = await getTableColumns("PCCLIENT");
  const docExpr = buildDocumentExpression("c", pccColumns);
  const phoneExpr = buildPhoneExpression("c", pccColumns);
  const pcfColumns = await getTableColumns("PCFILIAL");
  const nomeFilialCol = firstAvailableColumn(pcfColumns, ["NOMEFIL", "NOMEFILIAL", "NOME", "FANTASIA", "RAZAOSOCIAL"]);
  const CODCOB_ATIVOS = `('341','756','BK')`;
  const filialExpr = nomeFilialCol
    ? `MAX(NVL(TRIM(pfl.${nomeFilialCol}), TRIM(TO_CHAR(p.CODFILIAL))))`
    : `MAX(TRIM(TO_CHAR(p.CODFILIAL)))`;

  return queryRows<OracleTopClientRow>(
    `
    SELECT * FROM (
      SELECT
        p.CODCLI,
        MAX(TRIM(c.CLIENTE)) AS CLIENTE,
        MAX(${docExpr}) AS DOCUMENTO,
        MAX(${phoneExpr}) AS TELEFONE,
        ${filialExpr} AS FILIAL,
        SUM(CASE WHEN p.DTVENC <= TRUNC(SYSDATE) THEN NVL(p.VALOR, 0) - NVL(p.VALORDESC, 0) ELSE 0 END) AS TOTAL_ABERTO,
        SUM(CASE WHEN p.DTVENC <= TRUNC(SYSDATE) THEN 1 ELSE 0 END) AS QTD_TITULOS,
        MIN(CASE WHEN p.DTVENC <= TRUNC(SYSDATE) THEN p.DTVENC END) AS TITULO_MAIS_ANTIGO,
        MIN(CASE WHEN p.DTVENC >= TRUNC(SYSDATE) THEN p.DTVENC END) AS PROXIMO_VENCIMENTO,
        MAX(
          f_qtdiasvencidos(p.DTVENC, TRUNC(SYSDATE), p.CODCOB, p.CODFILIAL,
            (SELECT NVL(pf.USADIAUTILFILIAL,'N') FROM ${getQualifiedTableName("PCFILIAL")} pf WHERE pf.CODIGO = p.CODFILIAL))
        ) AS MAX_DIAS_ATRASO
      FROM ${getQualifiedTableName("PCPREST")} p
      LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c   ON c.CODCLI = p.CODCLI
      LEFT JOIN ${getQualifiedTableName("PCFILIAL")} pfl ON pfl.CODIGO = p.CODFILIAL
      WHERE p.DTPAG IS NULL
        AND NVL(p.VALOR, 0) <> 0
        AND TRIM(p.CODCOB) IN ${CODCOB_ATIVOS}
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

  const CODCOB_ATIVOS = `('341','756','BK')`;
  const row = await queryOne<{
    TOTAL_ABERTO: number;
    QTD_TITULOS: number;
    MAX_DIAS_ATRASO: number;
  }>(
    `
    SELECT
      NVL(SUM(NVL(p.VALOR, 0) - NVL(p.VALORDESC, 0)), 0) AS TOTAL_ABERTO,
      COUNT(1) AS QTD_TITULOS,
      NVL(MAX(
        f_qtdiasvencidos(p.DTVENC, TRUNC(SYSDATE), p.CODCOB, p.CODFILIAL,
          (SELECT NVL(pf.USADIAUTILFILIAL,'N') FROM ${getQualifiedTableName("PCFILIAL")} pf WHERE pf.CODIGO = p.CODFILIAL))
      ), 0) AS MAX_DIAS_ATRASO
    FROM ${getQualifiedTableName("PCPREST")} p
    WHERE p.CODCLI = :codcli
      AND p.DTPAG IS NULL
      AND NVL(p.VALOR, 0) <> 0
      AND TRIM(p.CODCOB) IN ${CODCOB_ATIVOS}
    `,
    { codcli },
  );

  return {
    totalAberto: roundMoney(toNumber((row as any)?.TOTAL_ABERTO ?? 0)),
    qtdTitulos: Number((row as any)?.QTD_TITULOS ?? 0),
    maxDiasAtraso: Number((row as any)?.MAX_DIAS_ATRASO ?? 0),
  };
}

export async function listPixIdentifierColumns(): Promise<string[]> {
  if (!isOracleEnabled()) return [];
  const columns = await getTableColumns("PCPREST");
  const candidates = [
    "TXID",
    "PIXTXID",
    "PIX_TXID",
    "IDTXID",
    "ID_CONCILIACAO",
    "IDCONCILIACAO",
    "IDCONCILIACAORECEBEDOR",
    "ID_CONCILIACAO_RECEBEDOR",
    "E2EID",
    "ENDTOENDID",
    "END_TO_END_ID",
    "IDTRANSACAO",
    "ID_TRANSACAO",
    "NSUTEF",
    "NSUHOST",
    "NSUPIX",
    "NSUPAGDIGITAL",
    "PSA_LINKPIX",
  ];
  return candidates.filter((column) => columns.has(column));
}

export async function findTitlesByPixIdentifiers(input: {
  txid?: string;
  endToEndId?: string;
  limit?: number;
}): Promise<OraclePixTitleMatchRow[]> {
  if (!isOracleEnabled()) return [];
  const txid = String(input.txid ?? "").trim();
  const endToEndId = String(input.endToEndId ?? "").trim();
  if (!txid && !endToEndId) return [];

  const identifierColumns = await listPixIdentifierColumns();
  if (!identifierColumns.length) return [];

  const filters: string[] = [];
  const binds: Record<string, unknown> = {};
  for (const column of identifierColumns) {
    if (txid) {
      const bindName = `txid_${column}`;
      binds[bindName] = txid;
      if (column.includes("LINKPIX")) {
        filters.push(`INSTR(TRIM(TO_CHAR(p.${column})), :${bindName}) > 0`);
      } else {
        filters.push(`TRIM(TO_CHAR(p.${column})) = :${bindName}`);
      }
    }
    if (endToEndId) {
      const bindName = `e2e_${column}`;
      binds[bindName] = endToEndId;
      filters.push(`TRIM(TO_CHAR(p.${column})) = :${bindName}`);
    }
  }

  if (!filters.length) return [];
  binds.limitRows = Math.max(1, Math.min(Math.trunc(Number(input.limit ?? 25)), 100));

  return queryRows<OraclePixTitleMatchRow>(
    `
    SELECT *
    FROM (
      SELECT
        p.CODCLI,
        TRIM(c.CLIENTE) AS CLIENTE,
        TRIM(p.DUPLIC) AS DUPLICATA,
        TRIM(p.PREST) AS PRESTACAO,
        NVL(p.VALOR, 0) AS VALOR,
        NVL(p.VPAGO, 0) AS VPAGO,
        NVL(p.VALOR, 0) - NVL(p.VPAGO, 0) AS SALDO_ABERTO,
        p.DTPAG,
        p.DTVENC,
        TRIM(p.CODCOB) AS CODCOB,
        TRIM(p.STATUS) AS STATUS_TITULO
      FROM ${getQualifiedTableName("PCPREST")} p
      LEFT JOIN ${getQualifiedTableName("PCCLIENT")} c ON c.CODCLI = p.CODCLI
      WHERE ${filters.map((filter) => `(${filter})`).join("\n        OR ")}
      ORDER BY p.DTVENC DESC, p.CODCLI ASC
    )
    WHERE ROWNUM <= :limitRows
    `,
    binds,
  );
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

export type BaixaPixResult = {
  rows_updated: number;
  duplicata: string;
  prestacao: string;
  codcli: number;
  valor_pago: number;
  dtpag: string;
};

/**
 * Baixa financeira completa de um título via PIX confirmado.
 *
 * Executa em uma única transação Oracle:
 *   1. Lê e incrementa PROXNUMLANC em PCCONSUM (FOR UPDATE)
 *   2. Lê NUMTRANSVENDA / CODCOB / PREST / CODFILIAL do PCPREST
 *   3. Lê saldo atual do banco 1007 em PCMOVCR para calcular VLSALDO
 *   4. Insere movimento de crédito em PCMOVCR (padrão BAIXA PIX)
 *   5. Atualiza PCPREST: DTPAG, DTBAIXA, VPAGO, CODBANCOBAIXA, NUMTRANS, OBS2
 *   6. COMMIT
 */
export async function baixarTituloOracle(input: {
  duplicata: string;
  prestacao: string;
  codcli: number;
  valor_pago: number;
  dtpag?: Date;
  txid?: string;
  endToEndId?: string;
}): Promise<BaixaPixResult> {
  if (!isOracleEnabled()) {
    throw new Error("Oracle não habilitado — baixa automática indisponível.");
  }

  const dtpag = input.dtpag ?? new Date();
  const dtpagStr = dateToIsoDate(dtpag) ?? new Date().toISOString().slice(0, 10);
  const obs2 = `PIX-AUTO TXID:${(input.txid ?? "").slice(0, 30)} E2E:${(input.endToEndId ?? "").slice(0, 30)}`.slice(0, 80);
  const valorPago = roundMoney(input.valor_pago);
  let rowsUpdated = 0;

  await withOracleConnection(async (connection) => {
    // ── 1. Reservar número de lançamento (PROXNUMLANC) ──────────────────────
    const pconsumResult = await connection.execute(
      `SELECT PROXNUMLANC FROM ${getQualifiedTableName("PCCONSUM")} FOR UPDATE`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const numLanc = Number((pconsumResult.rows as Array<{ PROXNUMLANC: number }>)[0]?.PROXNUMLANC ?? 0);
    if (!numLanc) throw new Error("PCCONSUM sem PROXNUMLANC — baixa cancelada.");

    await connection.execute(
      `UPDATE ${getQualifiedTableName("PCCONSUM")} SET PROXNUMLANC = PROXNUMLANC + 1`,
      {},
    );

    // ── 2. Ler dados do título necessários para PCMOVCR e baixa ─────────────
    // Quando prestacao não é informada (salva como "" em LARA_PIX_COBRANCAS),
    // busca pelo título mais recente em aberto para esse CODCLI+DUPLIC.
    const hasPrest = input.prestacao.trim() !== "";
    const titleSql = hasPrest
      ? `SELECT NVL(p.NUMTRANSVENDA, 0)         AS NUMTRANSVENDA,
                NVL(TRIM(p.CODCOB), 'D')         AS CODCOB,
                TRIM(p.PREST)                    AS PREST,
                NVL(p.VALOR, 0) - NVL(p.VPAGO, 0) AS SALDO_ABERTO
           FROM ${getQualifiedTableName("PCPREST")} p
          WHERE p.CODCLI       = :codcli
            AND TRIM(p.DUPLIC) = TRIM(:duplicata)
            AND TRIM(p.PREST)  = TRIM(:prestacao)
            AND p.DTPAG IS NULL`
      : `SELECT NVL(p.NUMTRANSVENDA, 0)         AS NUMTRANSVENDA,
                NVL(TRIM(p.CODCOB), 'D')         AS CODCOB,
                TRIM(p.PREST)                    AS PREST,
                NVL(p.VALOR, 0) - NVL(p.VPAGO, 0) AS SALDO_ABERTO
           FROM ${getQualifiedTableName("PCPREST")} p
          WHERE p.CODCLI       = :codcli
            AND TRIM(p.DUPLIC) = TRIM(:duplicata)
            AND p.DTPAG IS NULL
            FETCH FIRST 1 ROW ONLY`;
    const titleBinds = hasPrest
      ? { codcli: input.codcli, duplicata: input.duplicata, prestacao: input.prestacao }
      : { codcli: input.codcli, duplicata: input.duplicata };
    const titleResult = await connection.execute(titleSql, titleBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const titleRows = titleResult.rows as Array<Record<string, unknown>>;
    if (!titleRows || titleRows.length === 0) {
      // Título não encontrado ou já pago — aborta sem tocar PCMOVCR
      throw new Error(
        `Titulo nao encontrado em PCPREST para baixa: CODCLI=${input.codcli} DUPLIC=${input.duplicata}${hasPrest ? ` PREST=${input.prestacao}` : ""} (DTPAG IS NULL).`,
      );
    }
    const titleRow = titleRows[0];
    const numtransvenda = Number(titleRow.NUMTRANSVENDA ?? 0);
    const codcob        = String(titleRow.CODCOB    ?? "D").trim();
    const prest         = String(titleRow.PREST     ?? input.prestacao).trim();
    // Usa saldo_aberto do Oracle como valor da baixa (fonte autoritativa)
    const saldoAberto   = roundMoney(Number(titleRow.SALDO_ABERTO ?? input.valor_pago));
    const valorBaixa    = saldoAberto > 0 ? saldoAberto : valorPago;

    // ── 3. Saldo atual do banco 1007 para calcular novo VLSALDO ─────────────
    const saldoResult = await connection.execute(
      `SELECT NVL(MAX(VLSALDO), 0) AS VLSALDO
         FROM ${getQualifiedTableName("PCMOVCR")}
        WHERE CODBANCO = 1007`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const saldoAtual = Number((saldoResult.rows as Array<{ VLSALDO: number }>)[0]?.VLSALDO ?? 0);
    const novoSaldo  = roundMoney(saldoAtual + valorBaixa);

    const now    = dtpag;
    const hora   = now.getHours();
    const minuto = now.getMinutes();
    const historico = `BAIXA PIX TRANSACAO ${numtransvenda} PREST:${prest}`.slice(0, 200);

    // ── 4. Inserir movimento em PCMOVCR ─────────────────────────────────────
    await connection.execute(
      `INSERT INTO ${getQualifiedTableName("PCMOVCR")} (
         NUMTRANS, DATA,        CODBANCO, CODCOB,  VALOR,
         TIPO,     HISTORICO,   NUMCARR,  VLSALDO,
         HORA,     MINUTO,      CODFUNC,  INDICE,
         DATACOMPLETA,          CODROTINALANC
       ) VALUES (
         :numtrans, TRUNC(SYSDATE), 1007, :codcob, :valor,
         'D',      :historico,  :numcarr, :vlsaldo,
         :hora,    :minuto,     309,      'A',
         SYSDATE,               9850
       )`,
      {
        numtrans  : numLanc,
        codcob,
        valor     : valorBaixa,
        historico,
        numcarr   : numtransvenda,
        vlsaldo   : novoSaldo,
        hora,
        minuto,
      },
    );

    // ── 5. Baixar título na PCPREST ──────────────────────────────────────────
    // Usa PREST real lido do Oracle (fix: prestacao pode chegar vazia do LARA_PIX_COBRANCAS)
    const updateResult = await connection.execute(
      `UPDATE ${getQualifiedTableName("PCPREST")}
          SET DTPAG         = TO_DATE(:dtpag, 'YYYY-MM-DD'),
              DTBAIXA       = TO_DATE(:dtpag, 'YYYY-MM-DD'),
              VPAGO         = :valorPago,
              CODBANCOBAIXA = 1007,
              NUMTRANS      = :numtrans,
              ROTINAPAG     = NULL,
              DTULTALTER    = SYSDATE,
              OBS2          = :obs2
        WHERE CODCLI       = :codcli
          AND TRIM(DUPLIC) = TRIM(:duplicata)
          AND TRIM(PREST)  = TRIM(:prest)
          AND DTPAG IS NULL`,
      {
        dtpag     : dtpagStr,
        valorPago : valorBaixa,
        numtrans  : numLanc,
        obs2,
        codcli    : input.codcli,
        duplicata : input.duplicata,
        prest,
      },
    );
    rowsUpdated = Number(updateResult.rowsAffected ?? 0);

    // ── 6. Commit da transação ───────────────────────────────────────────────
    await connection.commit();
  });

  return {
    rows_updated: rowsUpdated,
    duplicata : input.duplicata,
    prestacao : input.prestacao,
    codcli    : input.codcli,
    valor_pago: valorPago,  // valor original recebido; VPAGO gravado usa saldo_aberto do Oracle
    dtpag     : dtpagStr,
  };
}

export async function registrarPixCobranca(input: {
  txid: string;
  codcli: number;
  duplicata: string;
  prestacao: string;
  valor: number;
  provider: "bradesco" | "interno";
  tenantId?: string;
}): Promise<void> {
  if (!isOracleEnabled() || !input.txid.trim() || !input.duplicata.trim()) return;
  const id = `PIX-${randomUUID()}`;
  await withOracleConnection(async (connection) => {
    await connection.execute(
      `INSERT INTO ${getQualifiedTableName("LARA_PIX_COBRANCAS")}
         (ID, TXID, CODCLI, DUPLICATA, PRESTACAO, VALOR, PROVIDER, TENANT_ID)
       VALUES (:id, :txid, :codcli, :duplicata, :prestacao, :valor, :provider, :tenantId)`,
      {
        id,
        txid: input.txid.trim().slice(0, 35),
        codcli: input.codcli,
        duplicata: input.duplicata.trim(),
        prestacao: input.prestacao.trim(),
        valor: roundMoney(input.valor),
        provider: input.provider,
        tenantId: input.tenantId ?? "default",
      },
      { autoCommit: true },
    );
  });
}

export type PixCobrancaRow = {
  codcli: number;
  duplicata: string;
  prestacao: string;
  valor: number;
  provider: string;
  pago: boolean;
};

export async function findCobrancasByTxid(txid: string): Promise<PixCobrancaRow[]> {
  if (!isOracleEnabled() || !txid.trim()) return [];
  const rows = await queryRows<{
    CODCLI: number;
    DUPLICATA: string;
    PRESTACAO: string;
    VALOR: number;
    PROVIDER: string;
    PAGO: number;
  }>(
    `SELECT CODCLI, DUPLICATA, PRESTACAO, VALOR, PROVIDER, PAGO
     FROM ${getQualifiedTableName("LARA_PIX_COBRANCAS")}
     WHERE TRIM(TXID) = TRIM(:txid)
     ORDER BY CREATED_AT ASC`,
    { txid: txid.trim() },
  );
  return rows.map((row) => ({
    codcli: Number((row as any).CODCLI),
    duplicata: String((row as any).DUPLICATA || ""),
    prestacao: String((row as any).PRESTACAO || ""),
    valor: roundMoney(toNumber((row as any).VALOR)),
    provider: String((row as any).PROVIDER || ""),
    pago: Number((row as any).PAGO) === 1,
  }));
}

export async function marcarPixCobrancaPago(txid: string, dtpag: Date): Promise<void> {
  if (!isOracleEnabled() || !txid.trim()) return;
  const dtpagStr = dateToIsoDate(dtpag) ?? new Date().toISOString().slice(0, 10);
  await withOracleConnection(async (connection) => {
    await connection.execute(
      `UPDATE ${getQualifiedTableName("LARA_PIX_COBRANCAS")}
       SET PAGO = 1, DTPAG = TO_DATE(:dtpag, 'YYYY-MM-DD'), UPDATED_AT = SYSTIMESTAMP
       WHERE TRIM(TXID) = TRIM(:txid)`,
      { dtpag: dtpagStr, txid: txid.trim() },
      { autoCommit: true },
    );
  });
}
