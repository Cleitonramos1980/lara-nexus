import { executeOracle, isOracleEnabled } from "../db/oracle.js";
import { trackOracleQueryMetric } from "../utils/observability.js";

type BindParameters = Record<string, unknown>;

function getQueryLabel(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
  const fromMatch = normalized.match(/\bFROM\s+([A-Z0-9_.$]+)/);
  if (fromMatch?.[1]) return fromMatch[1];
  const updateMatch = normalized.match(/\bUPDATE\s+([A-Z0-9_.$]+)/);
  if (updateMatch?.[1]) return `UPDATE:${updateMatch[1]}`;
  const insertMatch = normalized.match(/\bINTO\s+([A-Z0-9_.$]+)/);
  if (insertMatch?.[1]) return `INSERT:${insertMatch[1]}`;
  return normalized.slice(0, 60);
}

export async function queryRows<T>(sql: string, binds: BindParameters = {}): Promise<T[]> {
  if (!isOracleEnabled()) return [];
  const startedAt = Date.now();
  const queryLabel = getQueryLabel(sql);
  try {
    const result = await executeOracle<T>(sql, binds);
    trackOracleQueryMetric({
      queryLabel,
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return (result.rows as T[] | undefined) ?? [];
  } catch (error) {
    trackOracleQueryMetric({
      queryLabel,
      durationMs: Date.now() - startedAt,
      success: false,
    });
    throw error;
  }
}

export async function queryOne<T>(sql: string, binds: BindParameters = {}): Promise<T | null> {
  const rows = await queryRows<T>(sql, binds);
  return rows[0] ?? null;
}

export async function execDml(sql: string, binds: BindParameters = {}): Promise<void> {
  if (!isOracleEnabled()) return;
  const startedAt = Date.now();
  const queryLabel = getQueryLabel(sql);
  try {
    await executeOracle(sql, binds);
    trackOracleQueryMetric({
      queryLabel,
      durationMs: Date.now() - startedAt,
      success: true,
    });
  } catch (error) {
    trackOracleQueryMetric({
      queryLabel,
      durationMs: Date.now() - startedAt,
      success: false,
    });
    throw error;
  }
}
