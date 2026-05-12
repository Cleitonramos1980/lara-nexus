/**
 * Lara — Conversation Summarizer (Semantic AI)
 *
 * Usa OpenAI para gerar um resumo estruturado do histórico de conversa.
 * O resumo é injetado no prompt do LLM principal para que a Lara tenha
 * memória contextual de longo prazo — não apenas as últimas mensagens.
 *
 * Resultado cacheado em LARA_CONFIGURACOES por wa_id (TTL 6h).
 */

import { env } from "../../config/env.js";
import { laraOperationalStore } from "./operationalStore.js";
import type { LaraMensagem } from "./types.js";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ConversationSummary = {
  stage: "initial_contact" | "negotiation" | "committed" | "escalated" | "resolved" | "unresponsive";
  main_objections: string[];      // objeções principais identificadas
  commitments_made: string[];     // compromissos assumidos pelo cliente
  sentiment_trajectory: "improving" | "worsening" | "stable" | "volatile";
  recommended_approach: string;   // próximo passo ideal (texto livre)
  relationship_score: number;     // 0–100: qualidade geral da relação
  key_facts: string[];            // fatos relevantes (ex: "vai pagar sexta-feira")
  summarized_at: string;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_MESSAGES_TO_SUMMARIZE = 4;
const MAX_MESSAGES_IN_PROMPT = 30;

// ─── Cache em memória ──────────────────────────────────────────────────────────

const _summaryCache = new Map<string, { summary: ConversationSummary; ts: number }>();

// ─── Prompt ────────────────────────────────────────────────────────────────────

function buildSummarizationPrompt(messages: LaraMensagem[]): string {
  const lines = messages
    .slice(-MAX_MESSAGES_IN_PROMPT)
    .map((m) => {
      const who = m.remetente === "cliente" ? "CLIENTE" : "LARA";
      return `[${who}]: ${m.texto}`;
    })
    .join("\n");

  return `Você é um analista de cobrança especializado. Analise esta conversa de cobrança e retorne SOMENTE um JSON válido no seguinte formato, sem markdown, sem texto adicional:

{
  "stage": "initial_contact|negotiation|committed|escalated|resolved|unresponsive",
  "main_objections": ["array de objeções identificadas"],
  "commitments_made": ["array de compromissos assumidos pelo cliente"],
  "sentiment_trajectory": "improving|worsening|stable|volatile",
  "recommended_approach": "descrição do próximo passo ideal em português",
  "relationship_score": número de 0 a 100,
  "key_facts": ["fatos relevantes como datas, valores, acordos"]
}

CONVERSA:
${lines}`;
}

// ─── Chamada OpenAI ─────────────────────────────────────────────────────────────

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
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        max_output_tokens: 500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
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
    if (texts.length === 0 && typeof payload.output_text === "string") {
      texts.push((payload.output_text as string).trim());
    }
    return texts.join("").trim();
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function parseResponse(raw: string): ConversationSummary | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ConversationSummary>;

    const VALID_STAGES = new Set([
      "initial_contact", "negotiation", "committed", "escalated", "resolved", "unresponsive",
    ]);
    const VALID_TRAJECTORIES = new Set(["improving", "worsening", "stable", "volatile"]);

    return {
      stage: VALID_STAGES.has(parsed.stage ?? "") ? (parsed.stage as ConversationSummary["stage"]) : "negotiation",
      main_objections: Array.isArray(parsed.main_objections) ? parsed.main_objections.slice(0, 5) : [],
      commitments_made: Array.isArray(parsed.commitments_made) ? parsed.commitments_made.slice(0, 5) : [],
      sentiment_trajectory: VALID_TRAJECTORIES.has(parsed.sentiment_trajectory ?? "")
        ? (parsed.sentiment_trajectory as ConversationSummary["sentiment_trajectory"])
        : "stable",
      recommended_approach: String(parsed.recommended_approach ?? "Continue o contato padrão.").slice(0, 300),
      relationship_score: Math.max(0, Math.min(100, Number(parsed.relationship_score ?? 50))),
      key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts.slice(0, 8) : [],
      summarized_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Gera ou retorna do cache o resumo semântico da conversa de um cliente.
 * Retorna null se não há mensagens suficientes ou se a API falhar.
 */
export async function summarizeConversation(
  wa_id: string,
  messages: LaraMensagem[],
): Promise<ConversationSummary | null> {
  if (messages.length < MIN_MESSAGES_TO_SUMMARIZE) return null;

  // Verifica cache em memória
  const cached = _summaryCache.get(wa_id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.summary;
  }

  // Verifica cache persistido no Oracle
  const cacheKey = `LARA_CONV_SUMMARY_${wa_id}`;
  try {
    const stored = await laraOperationalStore.getConfiguracao(cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored) as ConversationSummary & { _ts?: number };
      const storedTs = parsed._ts ?? 0;
      if (Date.now() - storedTs < CACHE_TTL_MS) {
        const { _ts: _ignored, ...summary } = parsed;
        _summaryCache.set(wa_id, { summary, ts: storedTs });
        return summary;
      }
    }
  } catch {
    // Cache miss — continua para gerar novo resumo
  }

  try {
    const prompt = buildSummarizationPrompt(messages);
    const raw = await callOpenAI(prompt);
    const summary = parseResponse(raw);
    if (!summary) return null;

    // Salva em ambos os caches
    _summaryCache.set(wa_id, { summary, ts: Date.now() });
    await laraOperationalStore.upsertConfiguracao(
      cacheKey,
      JSON.stringify({ ...summary, _ts: Date.now() }),
    ).catch(() => {});

    return summary;
  } catch {
    return null;
  }
}

/**
 * Invalida o cache de resumo de um cliente (após nova mensagem relevante).
 */
export function invalidateConversationSummary(wa_id: string): void {
  _summaryCache.delete(wa_id);
}

/**
 * Formata o resumo em texto para injeção no prompt principal.
 */
export function formatSummaryForPrompt(summary: ConversationSummary): string {
  const parts: string[] = [];
  parts.push(`Estágio: ${summary.stage} | Sentimento: ${summary.sentiment_trajectory} | Relacionamento: ${summary.relationship_score}/100`);
  if (summary.main_objections.length > 0) {
    parts.push(`Objeções: ${summary.main_objections.join("; ")}`);
  }
  if (summary.commitments_made.length > 0) {
    parts.push(`Compromissos: ${summary.commitments_made.join("; ")}`);
  }
  if (summary.key_facts.length > 0) {
    parts.push(`Fatos: ${summary.key_facts.join("; ")}`);
  }
  parts.push(`Próximo passo: ${summary.recommended_approach}`);
  return parts.join("\n");
}
