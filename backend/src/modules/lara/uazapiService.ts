/**
 * uazapiGO v2 — WhatsApp Client Service
 *
 * Canal alternativo ao Meta Cloud API. Conecta número WhatsApp diretamente
 * via uazapiGO sem necessidade de templates aprovados pela Meta.
 *
 * Env: UAZAPI_BASE_URL, UAZAPI_TOKEN, UAZAPI_WEBHOOK_SECRET
 */

import { env } from "../../config/env.js";

// ─── Tipos da uazapiGO API ────────────────────────────────────────────────────

export type UazapiMediaType =
  | "image"
  | "video"
  | "videoplay"
  | "document"
  | "audio"
  | "myaudio"
  | "ptt"
  | "ptv"
  | "sticker";

export type UazapiMenuType = "button" | "list" | "poll" | "carousel";

export interface UazapiSendOptions {
  delay?: number;
  readchat?: boolean;
  readmessages?: boolean;
  replyid?: string;
  track_source?: string;
  track_id?: string;
  async?: boolean;
}

export interface UazapiSendTextInput extends UazapiSendOptions {
  number: string;
  text: string;
  linkPreview?: boolean;
}

export interface UazapiSendMediaInput extends UazapiSendOptions {
  number: string;
  type: UazapiMediaType;
  file: string;
  text?: string;
  docName?: string;
}

export interface UazapiSendMenuInput extends UazapiSendOptions {
  number: string;
  type: UazapiMenuType;
  text: string;
  choices: string[];
  footerText?: string;
  listButton?: string;
  selectableCount?: number;
  imageButton?: string;
}

export interface UazapiSendPaymentInput extends UazapiSendOptions {
  number: string;
  amount: number;
  pixKey?: string;
  pixType?: "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP";
  pixName?: string;
  boletoCode?: string;
  fileUrl?: string;
  fileName?: string;
  paymentLink?: string;
  title?: string;
  text?: string;
  footer?: string;
  itemName?: string;
  invoiceNumber?: string;
}

export interface UazapiInstanceStatus {
  connected: boolean;
  loggedIn: boolean;
  status: string;
  profileName?: string;
  phone?: string;
}

export interface UazapiWebhookConfig {
  url: string;
  events: string[];
  excludeMessages?: string[];
  enabled?: boolean;
  addUrlEvents?: boolean;
}

export interface UazapiSendResponse {
  id?: string;
  messageid?: string;
  status?: string;
  error?: string;
  ok: boolean;
}

// ─── Deduplicação ────────────────────────────────────────────────────────────

const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 min — igual ao whatsappTemplateManager

const _dedupCache = new Map<string, number>();

function _isDuplicate(key: string): boolean {
  const ts = _dedupCache.get(key);
  if (ts && Date.now() - ts < DEDUP_TTL_MS) return true;
  _dedupCache.set(key, Date.now());
  // Limpeza periódica para evitar vazamento de memória
  if (_dedupCache.size > 5000) {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [k, v] of _dedupCache) {
      if (v < cutoff) _dedupCache.delete(k);
    }
  }
  return false;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function _uazapiFetch<T = unknown>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  const baseUrl = String(env.UAZAPI_BASE_URL ?? "").replace(/\/$/, "");
  const token = String(env.UAZAPI_TOKEN ?? "").trim();

  if (!baseUrl || !token) {
    return { ok: false, data: null, error: "UAZAPI_BASE_URL ou UAZAPI_TOKEN não configurado" };
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        token,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const errMsg =
        (json && typeof json === "object" && "error" in json)
          ? String((json as Record<string, unknown>).error)
          : `HTTP ${res.status}`;
      return { ok: false, data: null, error: errMsg };
    }

    return { ok: true, data: json as T, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

export function isUazapiConfigured(): boolean {
  return (
    Boolean(env.UAZAPI_BASE_URL?.trim()) &&
    Boolean(env.UAZAPI_TOKEN?.trim())
  );
}

/**
 * Verifica o status da instância conectada.
 */
export async function getInstanceStatus(): Promise<UazapiInstanceStatus> {
  const result = await _uazapiFetch<Record<string, unknown>>("/instance/status", "GET");

  if (!result.ok || !result.data) {
    return { connected: false, loggedIn: false, status: "unknown" };
  }

  const status = result.data.status as Record<string, unknown> | undefined;
  const instance = result.data.instance as Record<string, unknown> | undefined;

  return {
    connected: Boolean(status?.connected ?? false),
    loggedIn: Boolean(status?.loggedIn ?? false),
    status: String(instance?.status ?? "unknown"),
    profileName: instance?.profileName ? String(instance.profileName) : undefined,
    phone: String(
      (status?.jid as Record<string, unknown>)?.user ?? instance?.owner ?? ""
    ) || undefined,
  };
}

/**
 * Envia mensagem de texto simples.
 * Retorna false se a mensagem for duplicada (enviada nos últimos 10 min).
 */
export async function sendText(
  number: string,
  text: string,
  options?: UazapiSendOptions & { bypassDedup?: boolean },
): Promise<UazapiSendResponse> {
  if (!options?.bypassDedup) {
    const dedupKey = `text:${number}:${text.slice(0, 80)}`;
    if (_isDuplicate(dedupKey)) {
      return { ok: false, error: "dedup: mensagem já enviada recentemente", status: "dedup" };
    }
  }

  const { bypassDedup: _, ...sendOptions } = options ?? {};
  const body: UazapiSendTextInput = { number, text, ...sendOptions };
  const result = await _uazapiFetch<Record<string, unknown>>("/send/text", "POST", body);

  return {
    ok: result.ok,
    id: result.data?.id ? String(result.data.id) : undefined,
    messageid: result.data?.messageid ? String(result.data.messageid) : undefined,
    status: result.data?.status ? String(result.data.status) : undefined,
    error: result.error ?? undefined,
  };
}

/**
 * Envia mídia (imagem, vídeo, documento, áudio, etc.).
 */
export async function sendMedia(
  input: UazapiSendMediaInput,
): Promise<UazapiSendResponse> {
  const result = await _uazapiFetch<Record<string, unknown>>("/send/media", "POST", input);

  return {
    ok: result.ok,
    id: result.data?.id ? String(result.data.id) : undefined,
    messageid: result.data?.messageid ? String(result.data.messageid) : undefined,
    status: result.data?.status ? String(result.data.status) : undefined,
    error: result.error ?? undefined,
  };
}

/**
 * Envia menu interativo (botões, lista, enquete ou carousel).
 *
 * Exemplos de choices:
 *   button → ["Pagar agora|pagar", "Negociar|negociar", "Falar com humano|humano"]
 *   list   → ["[Opções de Pagamento]", "PIX|pix|Rápido e grátis", "Boleto|boleto|Vence em 3 dias"]
 *   poll   → ["Sim, quero pagar", "Não posso agora", "Já paguei"]
 */
export async function sendMenu(
  input: UazapiSendMenuInput,
): Promise<UazapiSendResponse> {
  const result = await _uazapiFetch<Record<string, unknown>>("/send/menu", "POST", input);

  return {
    ok: result.ok,
    id: result.data?.id ? String(result.data.id) : undefined,
    messageid: result.data?.messageid ? String(result.data.messageid) : undefined,
    status: result.data?.status ? String(result.data.status) : undefined,
    error: result.error ?? undefined,
  };
}

/**
 * Envia solicitação de pagamento com botão nativo do WhatsApp.
 * Suporta PIX, boleto e link de checkout em uma única mensagem.
 */
export async function sendRequestPayment(
  input: UazapiSendPaymentInput,
): Promise<UazapiSendResponse> {
  const dedupKey = `payment:${input.number}:${input.amount}:${input.pixKey ?? input.boletoCode ?? ""}`;
  if (_isDuplicate(dedupKey)) {
    return { ok: false, error: "dedup: cobrança já enviada recentemente", status: "dedup" };
  }

  const result = await _uazapiFetch<Record<string, unknown>>("/send/request-payment", "POST", input);

  return {
    ok: result.ok,
    id: result.data?.id ? String(result.data.id) : undefined,
    messageid: result.data?.messageid ? String(result.data.messageid) : undefined,
    status: result.data?.status ? String(result.data.status) : undefined,
    error: result.error ?? undefined,
  };
}

/**
 * Configura o webhook no uazapiGO para receber eventos.
 * Deve ser chamado uma vez na inicialização ou via endpoint admin.
 */
export async function configureWebhook(
  webhookUrl: string,
  events: string[] = ["messages", "messages_update", "connection"],
  excludeMessages: string[] = ["wasSentByApi", "fromMeYes"],
): Promise<{ ok: boolean; error?: string }> {
  const config: UazapiWebhookConfig = {
    url: webhookUrl,
    events,
    excludeMessages,
    enabled: true,
  };

  const result = await _uazapiFetch("/webhook", "POST", config);

  return { ok: result.ok, error: result.error ?? undefined };
}

/**
 * Retorna a configuração atual do webhook na instância uazapiGO.
 */
export async function getWebhookConfig(): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const result = await _uazapiFetch("/webhook", "GET");
  return { ok: result.ok, data: result.data ?? undefined, error: result.error ?? undefined };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const uazapiService = {
  isConfigured: isUazapiConfigured,
  getInstanceStatus,
  sendText,
  sendMedia,
  sendMenu,
  sendRequestPayment,
  configureWebhook,
  getWebhookConfig,
} as const;
