import type { FastifyInstance } from "fastify";
import { executeOracle, isOracleEnabled } from "../db/oracle.js";
import { env } from "../config/env.js";
import { getObservabilitySnapshot } from "../utils/observability.js";

const RETRYABLE_ORACLE_CODES = new Set([
  "NJS-040",
  "NJS-500",
  "NJS-501",
  "NJS-503",
  "ORA-03113",
  "ORA-03114",
  "ORA-12537",
  "ORA-12541",
  "ORA-12547",
  "ORA-12571",
]);

const RETRYABLE_ORACLE_MESSAGE_FRAGMENTS = [
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "QUEUE TIMEOUT",
];

type OracleErrorLike = {
  code?: unknown;
  message?: unknown;
  isRecoverable?: unknown;
};

function isErpMirrorFallbackEnabled(): boolean {
  return Boolean(env.AUDITORIA_CARTAO_ENABLE_ERP_MIRROR_FALLBACK);
}

function isErpFallbackEffective(): boolean {
  return isErpMirrorFallbackEnabled();
}

function normalizeOracleErrorCode(error: unknown): string {
  const code = (error as OracleErrorLike | undefined)?.code;
  return typeof code === "string" ? code.toUpperCase().trim() : "";
}

function normalizeOracleErrorMessage(error: unknown): string {
  const message = (error as OracleErrorLike | undefined)?.message;
  return typeof message === "string" ? message.trim() : "";
}

function isRetryableOracleError(error: unknown): boolean {
  const code = normalizeOracleErrorCode(error);
  if (code && RETRYABLE_ORACLE_CODES.has(code)) return true;

  const message = normalizeOracleErrorMessage(error).toUpperCase();
  if (!message) return false;
  return RETRYABLE_ORACLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function toSafeOracleDetail(error: unknown): string {
  const message = normalizeOracleErrorMessage(error);
  if (!message) return "Falha ao consultar Oracle/ERP.";
  return message.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" | ");
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function executeOracleHealthWithRetry(maxAttempts = 2): Promise<{ STATUS?: string } | undefined> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await executeOracle<{ STATUS: string }>("SELECT 'OK' AS STATUS FROM DUAL");
      return result.rows?.[0] as { STATUS?: string } | undefined;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isRetryableOracleError(error);
      if (!shouldRetry) break;
      await wait(250 * attempt);
    }
  }

  throw lastError;
}

async function getOracleHealthStatus(app: FastifyInstance): Promise<{
  status: "OK" | "DOWN";
  detail?: string;
  fallbackEspelhoErp: boolean;
}> {
  const fallbackEspelhoErp = isErpFallbackEffective();

  try {
    const row = await executeOracleHealthWithRetry(2);
    return {
      status: row?.STATUS === "OK" ? "OK" : "DOWN",
      detail: row?.STATUS === "OK" ? undefined : "Oracle respondeu sem status valido.",
      fallbackEspelhoErp,
    };
  } catch (error) {
    app.log.warn(
      {
        code: normalizeOracleErrorCode(error) || undefined,
        recoverable: Boolean((error as OracleErrorLike | undefined)?.isRecoverable),
      },
      "Falha na validacao de conexao Oracle/ERP",
    );

    return {
      status: "DOWN",
      detail: toSafeOracleDetail(error),
      fallbackEspelhoErp,
    };
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    if (!isOracleEnabled()) {
      return { status: "OK", oracle: "not-configured" };
    }

    const health = await getOracleHealthStatus(app);
    if (health.status === "OK") {
      return { status: "OK", oracle: "connected" };
    }

    return {
      status: "DEGRADED",
      oracle: "disconnected",
      detail: health.detail || "Oracle/ERP indisponivel.",
    };
  });

  app.get("/api/health/oracle", async () => {
    if (!isOracleEnabled()) {
      return {
        status: "SKIPPED",
        detail: "Oracle nao configurado",
        fallbackEspelhoErp: isErpFallbackEffective(),
      };
    }

    const health = await getOracleHealthStatus(app);
    if (health.status === "OK") {
      return {
        status: "OK",
        fallbackEspelhoErp: health.fallbackEspelhoErp,
      };
    }

    return {
      status: "DOWN",
      detail: health.detail || "Oracle/ERP indisponivel para conciliacao real.",
      fallbackEspelhoErp: health.fallbackEspelhoErp,
    };
  });

  app.get("/api/metrics", async () => getObservabilitySnapshot());
}
