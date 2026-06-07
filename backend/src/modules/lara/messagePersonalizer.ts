/**
 * Lara — Personalizador de Mensagens por IA v1
 *
 * Usa OpenAI para gerar mensagens de cobrança personalizadas por cliente,
 * substituindo templates fixos por texto adaptado a:
 *   • Nome, valor, etapa, histórico de sentimento
 *   • Tom recomendado (empático/neutro/assertivo)
 *   • Melhor abordagem aprendida pelo feedback aggregator
 *
 * Circuit breaker: após N falhas consecutivas, cai para template base.
 * Timeout: configurável via env OPENAI_TIMEOUT_MS.
 */

import { env } from "../../config/env.js";
import { safeText } from "./utils.js";
import type { SentimentResult } from "./sentimentAnalyzer.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PersonalizationInput = {
  nomeCliente: string;
  valorTotal: number;
  etapa: string;
  diasAtraso: number;
  duplicatas: string[];
  tom: "empático" | "neutro" | "assertivo";
  contextoSentimento?: SentimentResult | null;
  templateBase: string;
  empresa?: string;
  linkPortal?: string;
};

export type PersonalizationResult = {
  mensagem: string;
  method: "openai" | "template";
  fallback_reason?: string;
};

// ─── Circuit Breaker (compartilhado com nluClassifier) ────────────────────────

type CircuitState = "closed" | "open" | "half_open";

const personalizerCircuit = {
  state: "closed" as CircuitState,
  consecutiveFailures: 0,
  openedAtMs: 0,
};

const FAILURE_THRESHOLD = Math.max(1, env.OPENAI_CB_FAILURE_THRESHOLD ?? 5);
const COOLDOWN_MS = Math.max(1000, env.OPENAI_CB_COOLDOWN_MS ?? 60_000);
const TIMEOUT_MS = Math.max(3000, env.OPENAI_TIMEOUT_MS ?? 8_000);
const MODEL = env.OPENAI_MODEL ?? "gpt-4o-mini";

function refreshCircuit(nowMs: number): CircuitState {
  if (personalizerCircuit.state === "open") {
    if (nowMs - personalizerCircuit.openedAtMs >= COOLDOWN_MS) {
      personalizerCircuit.state = "half_open";
    }
  }
  return personalizerCircuit.state;
}

function circuitAllowed(nowMs: number): boolean {
  return refreshCircuit(nowMs) !== "open";
}

function onSuccess(): void {
  personalizerCircuit.state = "closed";
  personalizerCircuit.consecutiveFailures = 0;
  personalizerCircuit.openedAtMs = 0;
}

function onFailure(nowMs: number): void {
  personalizerCircuit.consecutiveFailures += 1;
  if (personalizerCircuit.consecutiveFailures >= FAILURE_THRESHOLD) {
    personalizerCircuit.state = "open";
    personalizerCircuit.openedAtMs = nowMs;
  }
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function saudacaoHoraria(): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Manaus", hour: "numeric", hour12: false })
      .format(new Date()),
  );
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

function buildSystemPrompt(): string {
  const saudacao = saudacaoHoraria();
  return [
    "Você é a Lara, assistente de cobranças educada e profissional.",
    "Gere uma mensagem WhatsApp curta (máx 3 parágrafos) para cobrar um cliente.",
    `Regras:`,
    `- Sempre inicie com a saudação: "${saudacao}!" seguida do primeiro nome do cliente. Exemplo: "${saudacao}, João!"`,
    "- Seja direta e clara.",
    "- Nunca ameace, nunca use maiúsculas excessivas.",
    "- Se o tom for 'empático', reconheça a situação antes de cobrar.",
    "- Se o tom for 'assertivo', seja firme mas cortês.",
    "- Se o tom for 'neutro', seja informativo e objetivo.",
    "- Inclua o valor e etapa.",
    "- Termine com uma call-to-action clara (pagar, negociar ou entrar em contato).",
    "- Responda SOMENTE com o texto da mensagem, sem markdown, sem aspas, sem prefixo.",
  ].join("\n");
}

function buildUserPrompt(input: PersonalizationInput): string {
  const valor = input.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const nome = input.nomeCliente.split(" ")[0];
  const sentimentoCtx = input.contextoSentimento
    ? `Sentimento atual do cliente: ${input.contextoSentimento.valence} (stress ${input.contextoSentimento.stress_level}/3). Palavras detectadas: ${input.contextoSentimento.keywords_detectadas.slice(0, 3).join(", ")}.`
    : "Sem histórico de sentimento.";

  const partes: string[] = [
    `Nome do cliente: ${nome}`,
    `Valor em aberto: ${valor}`,
    `Etapa da régua: ${input.etapa} (${input.diasAtraso > 0 ? `${input.diasAtraso} dias em atraso` : "preventivo"})`,
    `Tom desejado: ${input.tom}`,
    sentimentoCtx,
    input.linkPortal ? `Link do portal de pagamento: ${input.linkPortal}` : "",
    input.empresa ? `Empresa: ${input.empresa}` : "",
    `Template base (use como referência, mas personalize): "${input.templateBase}"`,
  ];

  return partes.filter(Boolean).join("\n");
}

// ─── Call OpenAI ──────────────────────────────────────────────────────────────

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente");

  const baseUrl = String(env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: buildSystemPrompt() }] },
          { role: "user",   content: [{ type: "input_text", text: prompt }] },
        ],
        max_output_tokens: 300,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    // Extrai texto da resposta no formato Responses API
    const output = (payload.output as unknown[]) ?? [];
    const texts: string[] = [];
    for (const item of output) {
      const content = (item as Record<string, unknown>).content as unknown[];
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string" && p.text.trim()) texts.push(p.text.trim());
      }
    }
    // Fallback para output_text
    if (texts.length === 0 && typeof payload.output_text === "string") {
      texts.push(payload.output_text.trim());
    }

    const text = texts.join(" ").trim();
    if (!text) throw new Error("OpenAI retornou texto vazio");
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Fallback: interpola template base ────────────────────────────────────────

function interpolateTemplate(template: string, input: PersonalizationInput): string {
  const nome = input.nomeCliente.split(" ")[0];
  const valor = input.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dupl = input.duplicatas.slice(0, 3).join(", ");

  return safeText(template)
    .replace(/\{cliente\}/gi, nome)
    .replace(/\{nome\}/gi, nome)
    .replace(/\{valor\}/gi, valor)
    .replace(/\{duplicata\}/gi, dupl)
    .replace(/\{duplicatas\}/gi, dupl)
    .replace(/\{etapa\}/gi, input.etapa)
    .replace(/\{empresa\}/gi, input.empresa ?? "nossa empresa")
    .replace(/\{link_portal\}/gi, input.linkPortal ?? "")
    .replace(/\{dias_atraso\}/gi, String(input.diasAtraso));
}

// ─── Função Principal ─────────────────────────────────────────────────────────

export async function personalizeMessage(input: PersonalizationInput): Promise<PersonalizationResult> {
  const fallback = interpolateTemplate(input.templateBase, input);

  if (!env.LARA_AI_RESPONSE_ENABLED || !env.OPENAI_API_KEY) {
    return { mensagem: fallback, method: "template", fallback_reason: "ai_disabled" };
  }

  const nowMs = Date.now();
  if (!circuitAllowed(nowMs)) {
    return { mensagem: fallback, method: "template", fallback_reason: "circuit_open" };
  }

  try {
    const prompt = buildUserPrompt(input);
    const generated = await callOpenAI(prompt);
    onSuccess();
    return { mensagem: generated, method: "openai" };
  } catch (err) {
    onFailure(Date.now());
    const reason = err instanceof Error ? err.message : String(err);
    return { mensagem: fallback, method: "template", fallback_reason: reason };
  }
}

export function getPersonalizerHealth() {
  return {
    circuit_state: personalizerCircuit.state,
    consecutive_failures: personalizerCircuit.consecutiveFailures,
    failure_threshold: FAILURE_THRESHOLD,
    cooldown_ms: COOLDOWN_MS,
    model: MODEL,
    enabled: Boolean(env.LARA_AI_RESPONSE_ENABLED && env.OPENAI_API_KEY),
  };
}
