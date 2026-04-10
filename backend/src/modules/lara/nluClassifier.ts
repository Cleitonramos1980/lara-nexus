import { env } from "../../config/env.js";
import type { LaraIntent } from "./utils.js";
import { detectIntent, safeText } from "./utils.js";

type IntentLexicon = Record<LaraIntent, string[]>;
type CircuitStateName = "closed" | "open" | "half_open";

export type NluResult = {
  intent: LaraIntent;
  confidence: number;
  method: "openai" | "nlu" | "regex-fallback";
  scores: Record<LaraIntent, number>;
  classifier: {
    attempted_openai: boolean;
    used_openai: boolean;
    provider: "openai" | "local";
    model: string;
    request_id?: string;
    fallback_reason?: string;
    raw_intent?: string;
    reason?: string;
    retry_attempts?: number;
    circuit_state?: CircuitStateName;
  };
};

export type IntentClassifierHealthSnapshot = {
  enabled: boolean;
  openai_configured: boolean;
  provider: "openai-hybrid";
  model: string;
  circuit_state: CircuitStateName;
  circuit_consecutive_failures: number;
  circuit_failure_threshold: number;
  circuit_cooldown_ms: number;
  circuit_open_until: string;
  retry_max_attempts: number;
  retry_base_delay_ms: number;
};

class OpenAiClassifierError extends Error {
  retryable: boolean;
  statusCode?: number;
  requestId?: string;
  attempts: number;

  constructor(
    message: string,
    input?: {
      retryable?: boolean;
      statusCode?: number;
      requestId?: string;
      attempts?: number;
    },
  ) {
    super(message);
    this.name = "OpenAiClassifierError";
    this.retryable = Boolean(input?.retryable);
    this.statusCode = input?.statusCode;
    this.requestId = input?.requestId;
    this.attempts = Math.max(1, input?.attempts ?? 1);
  }
}

const INTENTS: LaraIntent[] = [
  "solicitar_boleto",
  "solicitar_pix",
  "confirmacao_contexto",
  "promessa_pagamento",
  "falar_humano",
  "optout",
  "neutro",
];

const LEXICON: IntentLexicon = {
  solicitar_boleto: ["boleto", "segunda via", "linha digitavel", "codigo de barras", "fatura"],
  solicitar_pix: ["pix", "copia e cola", "chave pix", "qr code"],
  confirmacao_contexto: ["ok", "pode", "manda", "envia", "confirmo", "certo"],
  promessa_pagamento: ["vou pagar", "pagarei", "pago", "promessa", "amanha", "hoje", "dia"],
  falar_humano: ["atendente", "humano", "operador", "supervisor", "gerente"],
  optout: ["pare", "parar", "remover", "descadastrar", "opt out", "nao quero mensagem"],
  neutro: [],
};

const OPENAI_CLASSIFIER_SYSTEM_PROMPT = [
  "Voce classifica intencao de mensagens de cobranca no WhatsApp.",
  "Retorne somente JSON valido sem markdown.",
  "Formato obrigatorio:",
  "{\"intent\":\"<valor>\",\"confidence\":0.0,\"reason\":\"<texto curto>\"}",
  "intent deve ser exatamente um de:",
  INTENTS.join(", "),
  "confidence deve ser numero entre 0 e 1.",
  "Se houver ambiguidade, use intent=neutro e confidence <= 0.55.",
].join("\n");

const openAiCircuit = {
  state: "closed" as CircuitStateName,
  consecutiveFailures: 0,
  openedAtMs: 0,
  halfOpenProbeInFlight: false,
};

function getCircuitConfig() {
  return {
    failureThreshold: Math.max(1, env.OPENAI_CB_FAILURE_THRESHOLD),
    cooldownMs: Math.max(1000, env.OPENAI_CB_COOLDOWN_MS),
  };
}

function refreshCircuitState(nowMs: number): CircuitStateName {
  if (openAiCircuit.state !== "open") return openAiCircuit.state;
  const { cooldownMs } = getCircuitConfig();
  if (openAiCircuit.openedAtMs > 0 && nowMs - openAiCircuit.openedAtMs >= cooldownMs) {
    openAiCircuit.state = "half_open";
    openAiCircuit.halfOpenProbeInFlight = false;
  }
  return openAiCircuit.state;
}

function reserveCircuitPermission(nowMs: number): { allowed: boolean; reason?: string } {
  const current = refreshCircuitState(nowMs);
  if (current === "open") {
    return { allowed: false, reason: "circuit-open" };
  }
  if (current === "half_open") {
    if (openAiCircuit.halfOpenProbeInFlight) {
      return { allowed: false, reason: "circuit-half-open-probe-in-flight" };
    }
    openAiCircuit.halfOpenProbeInFlight = true;
  }
  return { allowed: true };
}

function markCircuitSuccess(): void {
  openAiCircuit.state = "closed";
  openAiCircuit.consecutiveFailures = 0;
  openAiCircuit.openedAtMs = 0;
  openAiCircuit.halfOpenProbeInFlight = false;
}

function markCircuitFailure(nowMs: number): void {
  const { failureThreshold } = getCircuitConfig();
  if (openAiCircuit.state === "half_open") {
    openAiCircuit.state = "open";
    openAiCircuit.openedAtMs = nowMs;
    openAiCircuit.consecutiveFailures = Math.max(openAiCircuit.consecutiveFailures + 1, failureThreshold);
    openAiCircuit.halfOpenProbeInFlight = false;
    return;
  }
  openAiCircuit.consecutiveFailures += 1;
  if (openAiCircuit.consecutiveFailures >= failureThreshold) {
    openAiCircuit.state = "open";
    openAiCircuit.openedAtMs = nowMs;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreIntent(tokens: string[], text: string, terms: string[]): number {
  if (!terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    const normalizedTerm = term
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (normalizedTerm.includes(" ")) {
      if (text.includes(normalizedTerm)) score += 2;
      continue;
    }
    if (tokens.includes(normalizedTerm)) score += 1;
  }
  return score;
}

function normalizeScores(rawScores: Record<LaraIntent, number>): Record<LaraIntent, number> {
  const total = Object.values(rawScores).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return rawScores;
  const normalized = { ...rawScores };
  for (const key of Object.keys(normalized) as LaraIntent[]) {
    normalized[key] = Number((normalized[key] / total).toFixed(4));
  }
  return normalized;
}

function normalizeToken(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_ -]/g, "");
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Number(Math.max(0, Math.min(1, n)).toFixed(4));
}

function toScoresFromTopIntent(intent: LaraIntent, confidence: number): Record<LaraIntent, number> {
  const clamped = clampConfidence(confidence, 0.5);
  const residual = Number(((1 - clamped) / Math.max(1, INTENTS.length - 1)).toFixed(4));
  const scores = {} as Record<LaraIntent, number>;
  for (const item of INTENTS) {
    scores[item] = item === intent ? clamped : residual;
  }
  return normalizeScores(scores);
}

function mapOpenAiIntent(rawIntent: unknown): LaraIntent | null {
  const normalized = normalizeToken(String(rawIntent ?? ""));
  if (!normalized) return null;

  if (normalized === "solicitar_boleto" || normalized === "boleto") return "solicitar_boleto";
  if (normalized === "solicitar_pix" || normalized === "pix") return "solicitar_pix";
  if (normalized === "confirmacao_contexto" || normalized === "confirmacao") return "confirmacao_contexto";
  if (normalized === "promessa_pagamento" || normalized === "promessa") return "promessa_pagamento";
  if (normalized === "falar_humano" || normalized === "humano") return "falar_humano";
  if (normalized === "optout" || normalized === "opt_out" || normalized === "opt-out") return "optout";
  if (normalized === "neutro") return "neutro";
  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const direct = raw.trim();
  if (!direct) return null;

  const candidates = [direct];
  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(direct.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // noop
    }
  }
  return null;
}

function extractOpenAiOutputText(payload: unknown): string {
  if (!isRecord(payload)) return "";

  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

  const output = payload.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      } else if (isRecord(part.text) && typeof part.text.value === "string" && part.text.value.trim()) {
        chunks.push(part.text.value.trim());
      }
    }
  }
  return chunks.join("\n").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAiOnce(messageText: string): Promise<{
  intent: LaraIntent;
  confidence: number;
  reason: string;
  requestId: string;
  rawIntent?: string;
}> {
  const baseUrl = String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/responses`;
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new OpenAiClassifierError("OPENAI_API_KEY ausente.", { retryable: false });
  }

  const controller = new AbortController();
  const timeoutMs = env.OPENAI_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: OPENAI_CLASSIFIER_SYSTEM_PROMPT,
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: messageText,
              },
            ],
          },
        ],
        max_output_tokens: 180,
      }),
      signal: controller.signal,
    });

    const requestId = response.headers.get("x-request-id") || "";
    const payloadUnknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const text = extractOpenAiOutputText(payloadUnknown);
      const retryable = response.status === 429 || response.status >= 500;
      throw new OpenAiClassifierError(
        `OpenAI HTTP ${response.status}. ${text || "Falha ao classificar intencao."}`.trim(),
        { retryable, statusCode: response.status, requestId },
      );
    }

    const outputText = extractOpenAiOutputText(payloadUnknown);
    const parsed = tryParseJsonObject(outputText);
    if (!parsed) {
      throw new OpenAiClassifierError("OpenAI retornou formato nao parseavel para JSON.", { retryable: false, requestId });
    }

    const mappedIntent = mapOpenAiIntent(parsed.intent);
    if (!mappedIntent) {
      throw new OpenAiClassifierError("OpenAI retornou intent invalida.", { retryable: false, requestId });
    }

    return {
      intent: mappedIntent,
      confidence: clampConfidence(parsed.confidence, 0.65),
      reason: String(parsed.reason ?? "").trim(),
      requestId,
      rawIntent: String(parsed.intent ?? "").trim() || undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenAiClassifierError(`Timeout ao chamar OpenAI (${timeoutMs}ms).`, { retryable: true });
    }
    if (error instanceof OpenAiClassifierError) throw error;
    throw new OpenAiClassifierError(toErrorMessage(error), { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyIntentWithOpenAi(messageText: string): Promise<{
  intent: LaraIntent;
  confidence: number;
  reason: string;
  requestId: string;
  rawIntent?: string;
  attempts: number;
}> {
  const now = Date.now();
  const reservation = reserveCircuitPermission(now);
  if (!reservation.allowed) {
    const { cooldownMs } = getCircuitConfig();
    const openUntil = openAiCircuit.openedAtMs > 0
      ? new Date(openAiCircuit.openedAtMs + cooldownMs).toISOString()
      : "";
    throw new OpenAiClassifierError(
      `Circuit breaker OpenAI ativo (${reservation.reason || "sem detalhe"}). ${openUntil ? `Reabre em ${openUntil}.` : ""}`.trim(),
      { retryable: false },
    );
  }

  const maxAttempts = Math.max(1, env.OPENAI_RETRY_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(50, env.OPENAI_RETRY_BASE_DELAY_MS);
  let lastError: OpenAiClassifierError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await callOpenAiOnce(messageText);
      markCircuitSuccess();
      return {
        ...result,
        attempts: attempt,
      };
    } catch (error) {
      const normalizedError = error instanceof OpenAiClassifierError
        ? error
        : new OpenAiClassifierError(toErrorMessage(error), { retryable: true });
      normalizedError.attempts = attempt;
      lastError = normalizedError;

      const canRetry = normalizedError.retryable && attempt < maxAttempts;
      if (canRetry) {
        const jitter = Math.floor(Math.random() * 80);
        const waitMs = baseDelayMs * (2 ** (attempt - 1)) + jitter;
        await sleep(waitMs);
        continue;
      }

      markCircuitFailure(Date.now());
      throw normalizedError;
    }
  }

  const fallbackError = lastError ?? new OpenAiClassifierError("Falha desconhecida no classificador OpenAI.", { retryable: false });
  markCircuitFailure(Date.now());
  throw fallbackError;
}

export function getIntentClassifierHealthSnapshot(): IntentClassifierHealthSnapshot {
  const now = Date.now();
  const state = refreshCircuitState(now);
  const { failureThreshold, cooldownMs } = getCircuitConfig();
  const openUntilMs = state === "open" && openAiCircuit.openedAtMs > 0
    ? openAiCircuit.openedAtMs + cooldownMs
    : 0;

  return {
    enabled: Boolean(env.LARA_AI_CLASSIFIER_ENABLED),
    openai_configured: Boolean(String(env.OPENAI_API_KEY || "").trim()),
    provider: "openai-hybrid",
    model: env.OPENAI_MODEL,
    circuit_state: state,
    circuit_consecutive_failures: openAiCircuit.consecutiveFailures,
    circuit_failure_threshold: failureThreshold,
    circuit_cooldown_ms: cooldownMs,
    circuit_open_until: openUntilMs ? new Date(openUntilMs).toISOString() : "",
    retry_max_attempts: env.OPENAI_RETRY_MAX_ATTEMPTS,
    retry_base_delay_ms: env.OPENAI_RETRY_BASE_DELAY_MS,
  };
}

export function classifyIntentWithNlu(messageText: string): NluResult {
  const normalizedText = safeText(messageText)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalizedText) {
    return {
      intent: "neutro",
      confidence: 1,
      method: "nlu",
      scores: {
        solicitar_boleto: 0,
        solicitar_pix: 0,
        confirmacao_contexto: 0,
        promessa_pagamento: 0,
        falar_humano: 0,
        optout: 0,
        neutro: 1,
      },
      classifier: {
        attempted_openai: false,
        used_openai: false,
        provider: "local",
        model: "local-nlu-v1",
        circuit_state: getIntentClassifierHealthSnapshot().circuit_state,
      },
    };
  }

  const tokens = tokenize(normalizedText);
  const scoreMap: Record<LaraIntent, number> = {
    solicitar_boleto: scoreIntent(tokens, normalizedText, LEXICON.solicitar_boleto),
    solicitar_pix: scoreIntent(tokens, normalizedText, LEXICON.solicitar_pix),
    confirmacao_contexto: scoreIntent(tokens, normalizedText, LEXICON.confirmacao_contexto),
    promessa_pagamento: scoreIntent(tokens, normalizedText, LEXICON.promessa_pagamento),
    falar_humano: scoreIntent(tokens, normalizedText, LEXICON.falar_humano),
    optout: scoreIntent(tokens, normalizedText, LEXICON.optout),
    neutro: 0,
  };

  const ranked = (Object.entries(scoreMap) as Array<[LaraIntent, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (topScore <= 0) {
    const fallbackIntent = detectIntent(messageText);
    return {
      intent: fallbackIntent,
      confidence: fallbackIntent === "neutro" ? 0.55 : 0.72,
      method: "regex-fallback",
      scores: normalizeScores({
        ...scoreMap,
        [fallbackIntent]: 1,
      }),
      classifier: {
        attempted_openai: false,
        used_openai: false,
        provider: "local",
        model: "local-regex-fallback-v1",
        circuit_state: getIntentClassifierHealthSnapshot().circuit_state,
      },
    };
  }

  const margin = Math.max(0, topScore - secondScore);
  const confidence = Number(Math.min(0.99, 0.5 + topScore * 0.15 + margin * 0.2).toFixed(4));

  return {
    intent: topIntent,
    confidence,
    method: "nlu",
    scores: normalizeScores(scoreMap),
    classifier: {
      attempted_openai: false,
      used_openai: false,
      provider: "local",
      model: "local-nlu-v1",
      circuit_state: getIntentClassifierHealthSnapshot().circuit_state,
    },
  };
}

export async function classifyIntentWithAiFallback(messageText: string): Promise<NluResult> {
  const nluFallback = classifyIntentWithNlu(messageText);
  const openAiEnabled = Boolean(env.LARA_AI_CLASSIFIER_ENABLED);
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  const healthSnapshot = getIntentClassifierHealthSnapshot();

  if (!openAiEnabled || !apiKey) {
    return {
      ...nluFallback,
      classifier: {
        ...nluFallback.classifier,
        circuit_state: healthSnapshot.circuit_state,
      },
    };
  }

  try {
    const result = await classifyIntentWithOpenAi(messageText);
    return {
      intent: result.intent,
      confidence: result.confidence,
      method: "openai",
      scores: toScoresFromTopIntent(result.intent, result.confidence),
      classifier: {
        attempted_openai: true,
        used_openai: true,
        provider: "openai",
        model: env.OPENAI_MODEL,
        request_id: result.requestId || undefined,
        raw_intent: result.rawIntent,
        reason: result.reason || undefined,
        retry_attempts: result.attempts,
        circuit_state: getIntentClassifierHealthSnapshot().circuit_state,
      },
    };
  } catch (error) {
    const normalizedError = error instanceof OpenAiClassifierError
      ? error
      : new OpenAiClassifierError(toErrorMessage(error), { retryable: false });
    return {
      ...nluFallback,
      classifier: {
        ...nluFallback.classifier,
        attempted_openai: true,
        used_openai: false,
        provider: "local",
        model: env.OPENAI_MODEL,
        fallback_reason: toErrorMessage(normalizedError).slice(0, 300),
        request_id: normalizedError.requestId,
        retry_attempts: normalizedError.attempts,
        circuit_state: getIntentClassifierHealthSnapshot().circuit_state,
      },
    };
  }
}
