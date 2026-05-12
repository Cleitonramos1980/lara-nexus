import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import oracledb, { type BindParameters } from "oracledb";

type OpenTitleRow = {
  NUMTRANSVENDA: number;
  PREST: string;
  DUPLIC: string;
  CODCLI: number;
  CODFILIAL: string;
  CODCOB: string;
  STATUS: string;
  DTEMISSAO: Date | string | null;
  DTVENC: Date | string | null;
  DTPAG: Date | string | null;
  VALOR: number;
  VPAGO: number;
  SALDO_ABERTO: number;
  VALORDESC: number;
  NUMBANCO: number | null;
  NOSSONUMBCO: string | null;
  NUMTRANS: number | null;
};

type CliOptions = {
  limit: number;
  codcli?: number;
  codfilial?: string;
  duplic?: string;
  prest?: string;
  numtransvenda?: number;
  numbanco?: number;
  codcob?: string;
  dtvencInicio?: string;
  dtvencFim?: string;
  somenteVencidos: boolean;
  includeDesd: boolean;
  jsonOut?: string;
  showSql: boolean;
};

function printHelp(): void {
  console.log(`
Consulta de titulos em aberto na PCPREST

Uso:
  npm.cmd run pcprest:abertos -- [opcoes]

Opcoes:
  --limit <n>              Limite de linhas (padrao: 100)
  --codcli <n>             Filtra por cliente
  --codfilial <texto>      Filtra por filial
  --duplic <texto>         Filtra por duplicata
  --prest <texto>          Filtra por parcela
  --numtransvenda <n>      Filtra por NUMTRANSVENDA
  --numbanco <n>           Filtra por NUMBANCO
  --codcob <texto>         Filtra por CODCOB
  --dtvenc-inicio <YYYY-MM-DD>  Vencimento inicial
  --dtvenc-fim <YYYY-MM-DD>     Vencimento final
  --somente-vencidos       So titulos vencidos (DTVENC < hoje)
  --include-desd           Inclui CODCOB = DESD (padrao exclui)
  --json-out <caminho>     Exporta resultado em JSON
  --show-sql               Exibe SQL final e binds
  --help                   Exibe ajuda

Exemplos:
  npm.cmd run pcprest:abertos -- --limit 50
  npm.cmd run pcprest:abertos -- --codcli 1042 --somente-vencidos
  npm.cmd run pcprest:abertos -- --duplic 318070 --json-out docs/pcprest-abertos.json
`);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getOracleConnectString(): string {
  if (process.env.ORACLE_CONNECT_STRING) return process.env.ORACLE_CONNECT_STRING;
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const serviceName = process.env.ORACLE_SERVICE_NAME;
  if (!host || !port || !serviceName) {
    throw new Error(
      "Configure ORACLE_CONNECT_STRING ou ORACLE_HOST/ORACLE_PORT/ORACLE_SERVICE_NAME.",
    );
  }
  return `${host}:${port}/${serviceName}`;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Variavel ${name} nao configurada.`);
  return value.trim();
}

function parseIntStrict(input: string, label: string): number {
  const value = Number(input);
  if (!Number.isInteger(value)) throw new Error(`${label} invalido: ${input}`);
  return value;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 100,
    somenteVencidos: false,
    includeDesd: false,
    showSql: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--limit") {
      if (!next) throw new Error("--limit requer valor");
      options.limit = parseIntStrict(next, "limit");
      i += 1;
      continue;
    }
    if (arg === "--codcli") {
      if (!next) throw new Error("--codcli requer valor");
      options.codcli = parseIntStrict(next, "codcli");
      i += 1;
      continue;
    }
    if (arg === "--codfilial") {
      if (!next) throw new Error("--codfilial requer valor");
      options.codfilial = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--duplic") {
      if (!next) throw new Error("--duplic requer valor");
      options.duplic = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--prest") {
      if (!next) throw new Error("--prest requer valor");
      options.prest = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--numtransvenda") {
      if (!next) throw new Error("--numtransvenda requer valor");
      options.numtransvenda = parseIntStrict(next, "numtransvenda");
      i += 1;
      continue;
    }
    if (arg === "--numbanco") {
      if (!next) throw new Error("--numbanco requer valor");
      options.numbanco = parseIntStrict(next, "numbanco");
      i += 1;
      continue;
    }
    if (arg === "--codcob") {
      if (!next) throw new Error("--codcob requer valor");
      options.codcob = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--dtvenc-inicio") {
      if (!next) throw new Error("--dtvenc-inicio requer valor");
      if (!isValidIsoDate(next)) throw new Error(`Data invalida em --dtvenc-inicio: ${next}`);
      options.dtvencInicio = next;
      i += 1;
      continue;
    }
    if (arg === "--dtvenc-fim") {
      if (!next) throw new Error("--dtvenc-fim requer valor");
      if (!isValidIsoDate(next)) throw new Error(`Data invalida em --dtvenc-fim: ${next}`);
      options.dtvencFim = next;
      i += 1;
      continue;
    }
    if (arg === "--somente-vencidos") {
      options.somenteVencidos = true;
      continue;
    }
    if (arg === "--include-desd") {
      options.includeDesd = true;
      continue;
    }
    if (arg === "--json-out") {
      if (!next) throw new Error("--json-out requer valor");
      options.jsonOut = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--show-sql") {
      options.showSql = true;
      continue;
    }

    throw new Error(`Opcao desconhecida: ${arg}`);
  }

  if (options.limit < 1 || options.limit > 5000) {
    throw new Error("--limit deve estar entre 1 e 5000.");
  }

  return options;
}

function toIsoDate(value: Date | string | null): string {
  if (!value) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toMoney(value: unknown): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function buildWhereClause(options: CliOptions): { whereSql: string; binds: BindParameters } {
  const where: string[] = [];
  const binds: BindParameters = {};

  where.push("p.DTPAG IS NULL");
  where.push("NVL(p.VALOR, 0) > NVL(p.VPAGO, 0)");

  if (!options.includeDesd) {
    where.push("NVL(TRIM(p.CODCOB), 'SEM_CODCOB') <> 'DESD'");
  }
  if (options.codcli !== undefined) {
    where.push("p.CODCLI = :codcli");
    binds.codcli = options.codcli;
  }
  if (options.codfilial) {
    where.push("p.CODFILIAL = :codfilial");
    binds.codfilial = options.codfilial;
  }
  if (options.duplic) {
    where.push("TRIM(p.DUPLIC) = :duplic");
    binds.duplic = options.duplic;
  }
  if (options.prest) {
    where.push("TRIM(p.PREST) = :prest");
    binds.prest = options.prest;
  }
  if (options.numtransvenda !== undefined) {
    where.push("p.NUMTRANSVENDA = :numtransvenda");
    binds.numtransvenda = options.numtransvenda;
  }
  if (options.numbanco !== undefined) {
    where.push("p.NUMBANCO = :numbanco");
    binds.numbanco = options.numbanco;
  }
  if (options.codcob) {
    where.push("TRIM(p.CODCOB) = :codcob");
    binds.codcob = options.codcob;
  }
  if (options.dtvencInicio) {
    where.push("TRUNC(p.DTVENC) >= TO_DATE(:dtvencInicio, 'YYYY-MM-DD')");
    binds.dtvencInicio = options.dtvencInicio;
  }
  if (options.dtvencFim) {
    where.push("TRUNC(p.DTVENC) <= TO_DATE(:dtvencFim, 'YYYY-MM-DD')");
    binds.dtvencFim = options.dtvencFim;
  }
  if (options.somenteVencidos) {
    where.push("TRUNC(p.DTVENC) < TRUNC(SYSDATE)");
  }

  return {
    whereSql: where.length ? where.join("\n  AND ") : "1 = 1",
    binds,
  };
}

async function queryRows<T extends Record<string, unknown>>(
  conn: oracledb.Connection,
  sql: string,
  binds: BindParameters,
): Promise<T[]> {
  const result = await conn.execute<T>(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
  });
  return (result.rows ?? []) as T[];
}

async function run(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const user = getRequiredEnv("ORACLE_USER");
  const password = getRequiredEnv("ORACLE_PASSWORD");
  const connectString = getOracleConnectString();

  const conn = await oracledb.getConnection({
    user,
    password,
    connectString,
  });

  try {
    const { whereSql, binds } = buildWhereClause(options);

    const countSql = `
SELECT
  COUNT(1) AS TOTAL_TITULOS,
  SUM(NVL(p.VALOR, 0)) AS VALOR_TOTAL,
  SUM(NVL(p.VPAGO, 0)) AS VALOR_PAGO_TOTAL,
  SUM(NVL(p.VALOR, 0) - NVL(p.VPAGO, 0)) AS SALDO_ABERTO_TOTAL
FROM PCPREST p
WHERE ${whereSql}
`.trim();

    const dataSql = `
SELECT *
FROM (
  SELECT
    p.NUMTRANSVENDA,
    p.PREST,
    p.DUPLIC,
    p.CODCLI,
    p.CODFILIAL,
    p.CODCOB,
    p.STATUS,
    p.DTEMISSAO,
    p.DTVENC,
    p.DTPAG,
    p.VALOR,
    p.VPAGO,
    (NVL(p.VALOR, 0) - NVL(p.VPAGO, 0)) AS SALDO_ABERTO,
    p.VALORDESC,
    p.NUMBANCO,
    p.NOSSONUMBCO,
    p.NUMTRANS
  FROM PCPREST p
  WHERE ${whereSql}
  ORDER BY p.DTVENC ASC, p.CODFILIAL ASC, p.CODCLI ASC, p.DUPLIC ASC, p.PREST ASC
)
WHERE ROWNUM <= :limite
`.trim();

    const bindsData = { ...binds, limite: options.limit };

    if (options.showSql) {
      console.log("=== COUNT SQL ===");
      console.log(countSql);
      console.log("=== DATA SQL ===");
      console.log(dataSql);
      console.log("=== BINDS ===");
      console.log(JSON.stringify(bindsData, null, 2));
    }

    const summaryRows = await queryRows<{
      TOTAL_TITULOS: number;
      VALOR_TOTAL: number | null;
      VALOR_PAGO_TOTAL: number | null;
      SALDO_ABERTO_TOTAL: number | null;
    }>(conn, countSql, binds);

    const dataRows = await queryRows<OpenTitleRow>(conn, dataSql, bindsData);

    const summary = summaryRows[0] ?? {
      TOTAL_TITULOS: 0,
      VALOR_TOTAL: 0,
      VALOR_PAGO_TOTAL: 0,
      SALDO_ABERTO_TOTAL: 0,
    };

    console.log("Consulta de titulos em aberto na PCPREST");
    console.log(`- Total de titulos (filtro): ${Number(summary.TOTAL_TITULOS ?? 0)}`);
    console.log(`- Valor total: ${toMoney(summary.VALOR_TOTAL)}`);
    console.log(`- Valor pago total: ${toMoney(summary.VALOR_PAGO_TOTAL)}`);
    console.log(`- Saldo aberto total: ${toMoney(summary.SALDO_ABERTO_TOTAL)}`);
    console.log(`- Linhas retornadas (limit ${options.limit}): ${dataRows.length}`);
    console.log("");

    if (dataRows.length) {
      console.table(
        dataRows.map((row) => ({
          NUMTRANSVENDA: row.NUMTRANSVENDA,
          PREST: row.PREST,
          DUPLIC: row.DUPLIC,
          CODCLI: row.CODCLI,
          FILIAL: row.CODFILIAL,
          CODCOB: row.CODCOB,
          DTEMISSAO: toIsoDate(row.DTEMISSAO),
          DTVENC: toIsoDate(row.DTVENC),
          VALOR: toMoney(row.VALOR),
          VPAGO: toMoney(row.VPAGO),
          SALDO_ABERTO: toMoney(row.SALDO_ABERTO),
          STATUS: row.STATUS,
        })),
      );
    }

    if (options.jsonOut) {
      const outPath = resolve(process.cwd(), options.jsonOut);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(
        outPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            connectString,
            filters: options,
            summary: {
              totalTitulos: Number(summary.TOTAL_TITULOS ?? 0),
              valorTotal: toMoney(summary.VALOR_TOTAL),
              valorPagoTotal: toMoney(summary.VALOR_PAGO_TOTAL),
              saldoAbertoTotal: toMoney(summary.SALDO_ABERTO_TOTAL),
            },
            rows: dataRows.map((row) => ({
              ...row,
              DTEMISSAO: toIsoDate(row.DTEMISSAO),
              DTVENC: toIsoDate(row.DTVENC),
              DTPAG: toIsoDate(row.DTPAG),
              VALOR: toMoney(row.VALOR),
              VPAGO: toMoney(row.VPAGO),
              SALDO_ABERTO: toMoney(row.SALDO_ABERTO),
              VALORDESC: toMoney(row.VALORDESC),
            })),
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`JSON gerado em: ${outPath}`);
    }
  } finally {
    await conn.close();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha na consulta: ${message}`);
  process.exitCode = 1;
});

