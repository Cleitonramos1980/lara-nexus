type HttpMetric = {
  count: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
};

type OracleMetric = {
  count: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
};

const httpMetrics = new Map<string, HttpMetric>();
const oracleMetrics = new Map<string, OracleMetric>();

function toFixedNumber(value: number): number {
  return Number(value.toFixed(2));
}

export function trackHttpRequestMetric(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const key = `${input.method.toUpperCase()} ${input.route}`;
  const current = httpMetrics.get(key) ?? { count: 0, errorCount: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += input.durationMs;
  current.maxMs = Math.max(current.maxMs, input.durationMs);
  if (input.statusCode >= 400) current.errorCount += 1;
  httpMetrics.set(key, current);
}

export function trackOracleQueryMetric(input: {
  queryLabel: string;
  durationMs: number;
  success: boolean;
}): void {
  const key = input.queryLabel;
  const current = oracleMetrics.get(key) ?? { count: 0, errorCount: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += input.durationMs;
  current.maxMs = Math.max(current.maxMs, input.durationMs);
  if (!input.success) current.errorCount += 1;
  oracleMetrics.set(key, current);
}

export function getObservabilitySnapshot(): {
  generatedAt: string;
  http: Array<{
    route: string;
    count: number;
    errorCount: number;
    avgMs: number;
    maxMs: number;
  }>;
  oracle: Array<{
    queryLabel: string;
    count: number;
    errorCount: number;
    avgMs: number;
    maxMs: number;
  }>;
} {
  return {
    generatedAt: new Date().toISOString(),
    http: Array.from(httpMetrics.entries())
      .map(([route, metric]) => ({
        route,
        count: metric.count,
        errorCount: metric.errorCount,
        avgMs: toFixedNumber(metric.totalMs / Math.max(1, metric.count)),
        maxMs: toFixedNumber(metric.maxMs),
      }))
      .sort((a, b) => b.count - a.count),
    oracle: Array.from(oracleMetrics.entries())
      .map(([queryLabel, metric]) => ({
        queryLabel,
        count: metric.count,
        errorCount: metric.errorCount,
        avgMs: toFixedNumber(metric.totalMs / Math.max(1, metric.count)),
        maxMs: toFixedNumber(metric.maxMs),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

