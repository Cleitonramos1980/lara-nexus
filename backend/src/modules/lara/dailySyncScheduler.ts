import { env } from "../../config/env.js";
import { isOracleEnabled } from "../../db/oracle.js";
import { laraOperationalStore } from "./operationalStore.js";
import { laraService } from "./service.js";

type LoggerLike = {
  info?: (payload: Record<string, unknown>, message?: string) => void;
  warn?: (payload: Record<string, unknown>, message?: string) => void;
  error?: (payload: Record<string, unknown>, message?: string) => void;
};

type LaraSyncSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  timeZone: string;
  limit: number;
  includeDesd: boolean;
  startupRun: boolean;
};

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
};

const TICK_MS = 60_000;
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIntSafe(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function readConfigValue(configMap: Map<string, string>, key: string): string | null {
  return configMap.get(key.toUpperCase()) ?? null;
}

function getDateParts(now: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: map.get("year") || "0000",
    month: map.get("month") || "01",
    day: map.get("day") || "01",
    hour: Number(map.get("hour") || "0"),
    minute: Number(map.get("minute") || "0"),
  };
}

function makeDateKey(parts: DateParts): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function hasReachedSchedule(parts: DateParts, hour: number, minute: number): boolean {
  if (parts.hour > hour) return true;
  if (parts.hour === hour && parts.minute >= minute) return true;
  return false;
}

async function loadSettings(): Promise<LaraSyncSettings> {
  const configs = await laraOperationalStore.listConfiguracoes().catch(() => []);
  const configMap = new Map(configs.map((item) => [String(item.chave).toUpperCase(), String(item.valor)]));

  const timeZoneValue = readConfigValue(configMap, "LARA_SYNC_DAILY_TIMEZONE") || env.LARA_SYNC_DAILY_TIMEZONE;

  return {
    enabled: parseBool(readConfigValue(configMap, "LARA_SYNC_DAILY_ATIVO"), env.LARA_SYNC_DAILY_ENABLED),
    hour: parseIntSafe(readConfigValue(configMap, "LARA_SYNC_DAILY_HORA"), env.LARA_SYNC_DAILY_HOUR, 0, 23),
    minute: parseIntSafe(readConfigValue(configMap, "LARA_SYNC_DAILY_MINUTO"), env.LARA_SYNC_DAILY_MINUTE, 0, 59),
    timeZone: String(timeZoneValue || "America/Sao_Paulo"),
    limit: parseIntSafe(readConfigValue(configMap, "LARA_SYNC_DAILY_LIMIT"), env.LARA_SYNC_DAILY_LIMIT, 100, 100000),
    includeDesd: parseBool(readConfigValue(configMap, "LARA_SYNC_DAILY_INCLUDE_DESD"), env.LARA_SYNC_DAILY_INCLUDE_DESD),
    startupRun: parseBool(readConfigValue(configMap, "LARA_SYNC_STARTUP_RUN"), env.LARA_SYNC_STARTUP_RUN),
  };
}

export function startLaraDailySyncScheduler(logger?: LoggerLike): () => void {
  let stopped = false;
  let running = false;
  let retryAfterMs = 0;

  const runTick = async (reason: "startup" | "timer"): Promise<void> => {
    if (stopped || running) return;
    if (!isOracleEnabled()) return;
    if (Date.now() < retryAfterMs) return;

    const settings = await loadSettings();
    if (!settings.enabled) return;

    let parts: DateParts;
    try {
      parts = getDateParts(new Date(), settings.timeZone);
    } catch {
      try {
        parts = getDateParts(new Date(), env.LARA_SYNC_DAILY_TIMEZONE);
      } catch {
        parts = getDateParts(new Date(), "UTC");
      }
    }

    const reachedSchedule = hasReachedSchedule(parts, settings.hour, settings.minute);
    const shouldRunNow = reason === "startup" ? (settings.startupRun || reachedSchedule) : reachedSchedule;
    if (!shouldRunNow) return;

    const dataRef = makeDateKey(parts);
    const successKey = `pcprest-sync-diario:${dataRef}`;
    const alreadySynced = await laraOperationalStore.findIntegrationByIdempotency(successKey);
    if (alreadySynced) return;

    running = true;
    try {
      const result = await laraService.recarregarTitulosOracle({
        limit: settings.limit,
        includeDesd: settings.includeDesd,
      });

      await laraOperationalStore.addIntegrationLog({
        integracao: "oracle-winthor",
        tipo: "pcprest-sync-diario",
        request_json: {
          motivo: reason,
          data_ref: dataRef,
          hora_programada: `${String(settings.hour).padStart(2, "0")}:${String(settings.minute).padStart(2, "0")}`,
          timezone: settings.timeZone,
          include_desd: settings.includeDesd,
          limit: settings.limit,
        },
        response_json: result as unknown as Record<string, unknown>,
        status_operacao: "sincronizado",
        idempotency_key: successKey,
      });

      retryAfterMs = 0;
      logger?.info?.(
        {
          modulo: "lara-sync",
          dataRef,
          totalTitulos: result.totalTitulos,
          totalClientes: result.totalClientes,
        },
        "Sincronizacao diaria da PCPREST concluida",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retryAfterMs = Date.now() + RETRY_AFTER_ERROR_MS;

      await laraOperationalStore.addIntegrationLog({
        integracao: "oracle-winthor",
        tipo: "pcprest-sync-diario",
        request_json: {
          motivo: reason,
          data_ref: dataRef,
          timezone: settings.timeZone,
          limit: settings.limit,
        },
        status_operacao: "erro",
        erro_resumo: message.slice(0, 900),
        idempotency_key: `pcprest-sync-diario:erro:${dataRef}:${Date.now()}`,
      });

      logger?.error?.(
        {
          modulo: "lara-sync",
          dataRef,
          erro: message,
          proximaTentativaEmMs: RETRY_AFTER_ERROR_MS,
        },
        "Falha na sincronizacao diaria da PCPREST",
      );
    } finally {
      running = false;
    }
  };

  void runTick("startup");
  const timer = setInterval(() => {
    void runTick("timer");
  }, TICK_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}


