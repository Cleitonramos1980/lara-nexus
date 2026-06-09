import "dotenv/config";
import { z } from "zod";

const weakSecretValues = new Set([
  "change-me",
  "dev-secret-key-change-in-production",
  "123",
  "123456",
  "password",
  "senha",
  "troque-por-uma-chave-com-32-caracteres-ou-mais",
  "troque-por-uma-senha-forte",
]);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3333),
  APP_PUBLIC_URL: z.string().url().optional(),
  JWT_SECRET_KEY: z.string().min(32, "JWT_SECRET_KEY deve ter no minimo 32 caracteres."),
  ORACLE_USER: z.string().optional(),
  ORACLE_PASSWORD: z.string().optional(),
  ORACLE_CONNECT_STRING: z.string().optional(),
  ORACLE_HOST: z.string().optional(),
  ORACLE_PORT: z.coerce.number().optional(),
  ORACLE_SERVICE_NAME: z.string().optional(),
  ORACLE_SCHEMA: z.string().optional(),
  ORACLE_POOL_MIN: z.coerce.number().default(1),
  ORACLE_POOL_MAX: z.coerce.number().default(10),
  ORACLE_POOL_INCREMENT: z.coerce.number().default(1),
  ORACLE_POOL_ALIAS: z.string().default("sgqPool"),
  ORACLE_STMT_CACHE_SIZE: z.coerce.number().default(30),
  ORACLE_AUTO_ENSURE_AUX_TABLES: booleanFromEnv.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  UPLOAD_MAX_FILES: z.coerce.number().default(10),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().default(100),
  AUTH_STATIC_PASSWORD: z.string().min(1, "AUTH_STATIC_PASSWORD nao pode ser vazia."),
  ALLOW_WEAK_AUTH_STATIC_PASSWORD: booleanFromEnv.default(false),
  AUDITORIA_CARTAO_ENABLE_ERP_MIRROR_FALLBACK: booleanFromEnv.default(false),
  LARA_API_KEY: z.string().optional(),
  CORS_ALLOWED_ORIGIN: z.string().optional(),
  LARA_SCHEDULERS_ENABLED: booleanFromEnv.default(true),
  BRADESCO_PIX_WEBHOOK_SECRET: z.string().optional(),
  // WhatsApp Business Cloud API
  WHATSAPP_WABA_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v22.0"),
  WHATSAPP_BUSINESS_NAME: z.string().default("Empresa"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8).optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  LARA_SYNC_DAILY_ENABLED: booleanFromEnv.default(false),
  LARA_SYNC_DAILY_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  LARA_SYNC_DAILY_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  LARA_SYNC_DAILY_TIMEZONE: z.string().default("America/Manaus"),
  LARA_SYNC_DAILY_LIMIT: z.coerce.number().int().min(100).max(100000).default(30000),
  LARA_SYNC_DAILY_INCLUDE_DESD: booleanFromEnv.default(false),
  LARA_SYNC_STARTUP_RUN: booleanFromEnv.default(true),
  LARA_AI_CLASSIFIER_ENABLED: booleanFromEnv.default(true),
  LARA_AI_RESPONSE_ENABLED: booleanFromEnv.default(true),
  LARA_AI_RESPONSE_MAX_TOKENS: z.coerce.number().int().min(80).max(800).default(280),
  LARA_PIX_AUTO_BAIXA_HABILITADO: booleanFromEnv.default(false),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  OPENAI_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  OPENAI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).max(5000).default(250),
  OPENAI_CB_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
  OPENAI_CB_COOLDOWN_MS: z.coerce.number().int().min(1000).max(900000).default(60000),
  // uazapiGO WhatsApp API (canal alternativo ao Meta Cloud API)
  UAZAPI_BASE_URL: z.string().url().optional(),
  UAZAPI_TOKEN: z.string().optional(),
  UAZAPI_WEBHOOK_SECRET: z.string().optional(),
  // Piloto: lista de codcli autorizados para envio (vazio = sem restricao)
  LARA_PILOT_CODCLIS: z.string().optional(),
  // Alertas operacionais via WhatsApp (numero no formato 5592999999999)
  LARA_ALERT_WHATSAPP_NUMBER: z.string().optional(),
  // Quantas falhas consecutivas de sync antes de alertar (default: 2)
  LARA_ALERT_SYNC_FALHAS_MAX: z.coerce.number().int().min(1).max(10).default(2),
  // Cooldown entre alertas de escalacao humana em minutos (default: 10)
  LARA_ALERT_HUMANO_COOLDOWN_MIN: z.coerce.number().int().min(1).max(60).default(10),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

if (weakSecretValues.has(env.JWT_SECRET_KEY.trim().toLowerCase())) {
  throw new Error("JWT_SECRET_KEY esta usando um valor fraco/inseguro.");
}

const isProduction = env.NODE_ENV === "production";
const allowWeakAuthPassword = env.ALLOW_WEAK_AUTH_STATIC_PASSWORD && !isProduction;
const authPassword = env.AUTH_STATIC_PASSWORD.trim();

if (!allowWeakAuthPassword && authPassword.length < 8) {
  throw new Error("AUTH_STATIC_PASSWORD deve ter no minimo 8 caracteres.");
}

if (!allowWeakAuthPassword && weakSecretValues.has(authPassword.toLowerCase())) {
  throw new Error("AUTH_STATIC_PASSWORD esta usando um valor fraco/inseguro.");
}

export function hasOracleConfig(): boolean {
  return Boolean(env.ORACLE_USER && env.ORACLE_PASSWORD && (env.ORACLE_CONNECT_STRING || (env.ORACLE_HOST && env.ORACLE_PORT && env.ORACLE_SERVICE_NAME)));
}

export function getOracleConnectString(): string {
  if (env.ORACLE_CONNECT_STRING) return env.ORACLE_CONNECT_STRING;
  return `${env.ORACLE_HOST}:${env.ORACLE_PORT}/${env.ORACLE_SERVICE_NAME}`;
}

/**
 * Retorna o conjunto de codcli autorizados para envio de mensagens.
 * Se vazio, não há restrição (produção plena).
 */
export function getPilotCodclis(): Set<number> {
  const raw = env.LARA_PILOT_CODCLIS ?? "";
  if (!raw.trim()) return new Set();
  return new Set(
    raw.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n > 0),
  );
}

/** Retorna true se o codcli está autorizado a receber mensagens no modo piloto. */
export function isPilotAllowed(codcli: number | null | undefined): boolean {
  const pilot = getPilotCodclis();
  if (pilot.size === 0) return true; // sem restrição
  if (!codcli || codcli <= 0) return false;
  return pilot.has(codcli);
}
