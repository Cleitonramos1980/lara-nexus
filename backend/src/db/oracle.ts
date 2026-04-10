import oracledb from "oracledb";
import { env, getOracleConnectString, hasOracleConfig } from "../config/env.js";

type BindParameters = Record<string, unknown>;
type OracleResult<T = unknown> = { rows?: T[] };

let initialized = false;

export async function initOraclePool(): Promise<void> {
  if (initialized) return;
  if (!hasOracleConfig()) return;

  oracledb.fetchAsString = [oracledb.CLOB];

  await oracledb.createPool({
    user: env.ORACLE_USER,
    password: env.ORACLE_PASSWORD,
    connectString: getOracleConnectString(),
    poolAlias: env.ORACLE_POOL_ALIAS,
    poolMin: env.ORACLE_POOL_MIN,
    poolMax: env.ORACLE_POOL_MAX,
    poolIncrement: env.ORACLE_POOL_INCREMENT,
    stmtCacheSize: env.ORACLE_STMT_CACHE_SIZE,
  });

  initialized = true;
}

export function isOracleEnabled(): boolean {
  return hasOracleConfig();
}

export async function closeOraclePool(): Promise<void> {
  if (!initialized) return;
  await oracledb.getPool(env.ORACLE_POOL_ALIAS).close(10);
  initialized = false;
}

export async function withOracleConnection<T>(handler: (connection: any) => Promise<T>): Promise<T> {
  const pool = oracledb.getPool(env.ORACLE_POOL_ALIAS);
  const connection = await pool.getConnection();
  try {
    return await handler(connection);
  } finally {
    await connection.close();
  }
}

export async function executeOracle<T = unknown>(
  sql: string,
  binds: BindParameters = {},
  options?: Record<string, unknown>,
): Promise<OracleResult<T>> {
  return withOracleConnection(async (connection) => {
    return (await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      ...(options ?? {}),
    })) as OracleResult<T>;
  });
}
