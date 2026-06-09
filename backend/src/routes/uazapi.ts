/**
 * Rotas uazapiGO — Integração direta sem n8n
 *
 * Públicas (chamadas pelo uazapiGO):
 *   POST /api/lara/webhook/uazapi      — recebe mensagens e status do WhatsApp
 *
 * Protegidas (uso interno / admin):
 *   GET  /api/lara/uazapi/status       — status da instância conectada
 *   POST /api/lara/uazapi/configurar-webhook — configura webhook na instância
 *   POST /api/lara/uazapi/enviar-texto — envio manual de texto (testes)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { laraService } from "../modules/lara/service.js";
import {
  uazapiService,
  sendText,
  sendTyping,
} from "../modules/lara/uazapiService.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extrai o número limpo do JID uazapiGO.
 * "5511999999999@s.whatsapp.net" → "5511999999999"
 * "5511999999999@c.us"          → "5511999999999"
 * "5511999999999"               → "5511999999999"
 */
function jidToPhone(jid: string): string {
  return jid.replace(/@(s\.whatsapp\.net|c\.us|lid)$/, "").trim();
}

/**
 * Valida assinatura do webhook usando o segredo configurado.
 * Se UAZAPI_WEBHOOK_SECRET não estiver configurado, aceita tudo.
 */
function isValidSignature(
  rawBody: string,
  headerSecret: string | undefined,
): boolean {
  const configured = String(env.UAZAPI_WEBHOOK_SECRET ?? "").trim();
  if (!configured) return true; // sem secret configurado → aceita
  return headerSecret?.trim() === configured;
}

/**
 * Envia resposta ao cliente via uazapiGO com retry (até 3 tentativas).
 */
async function sendWithRetry(
  waId: string,
  mensagem: string,
  logger?: { error?: (...a: unknown[]) => void },
  context?: Record<string, unknown>,
): Promise<boolean> {
  const MAX = 3;
  let lastErr: string | undefined;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const res = await sendText(waId, mensagem, { readchat: true });

    if (res.ok) return true;
    if (res.status === "dedup") return false; // silencioso para duplicatas

    lastErr = res.error;
    if (attempt < MAX) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }

  logger?.error?.(
    { wa_id: waId, ...context, erro: lastErr, attempts: MAX },
    "[uazapi] Falha ao enviar mensagem após tentativas",
  );
  return false;
}

// ─── Schemas de validação ─────────────────────────────────────────────────────

// Payload "messages" do uazapiGO — suporta formato free (data.{campo}) e cramos (message.{campo})
const uazapiMessageDataSchema = z.object({
  id: z.string().optional(),
  messageid: z.string().optional(),
  chatid: z.string().optional(),
  sender: z.string().optional(),
  sender_pn: z.string().optional(), // cramos: número real quando sender é @lid
  senderName: z.string().optional(),
  isGroup: z.boolean().default(false),
  fromMe: z.boolean().default(false),
  messageType: z.string().optional(),
  text: z.string().optional().default(""),
  buttonOrListid: z.string().optional(),
  messageTimestamp: z.number().optional(),
  wasSentByApi: z.boolean().default(false),
  status: z.string().optional(),
  type: z.string().optional(), // cramos usa "type" em vez de "messageType"
});

// Suporta payload do servidor free (event + data) e do cramos pago (EventType + message)
const uazapiWebhookBodySchema = z.object({
  event: z.string().optional(),      // formato free
  EventType: z.string().optional(),  // formato cramos
  instance: z.string().optional(),
  instanceName: z.string().optional(), // cramos
  data: z.unknown().optional(),      // formato free: dados da mensagem
  message: z.unknown().optional(),   // formato cramos: dados da mensagem
}).refine(
  (d) => Boolean(d.event ?? d.EventType),
  { message: "Payload deve ter 'event' ou 'EventType'" }
);

/** Extrai o event name normalizado independente do formato do servidor */
function extractEventName(body: { event?: string; EventType?: string }): string {
  return (body.event ?? body.EventType ?? "").toLowerCase();
}

/** Extrai os dados da mensagem independente do formato do servidor */
function extractMessageData(body: { data?: unknown; message?: unknown }): unknown {
  return body.data ?? body.message;
}

const configurarWebhookBodySchema = z.object({
  webhook_url: z.string().url("URL inválida"),
  events: z.array(z.string()).optional(),
  exclude_messages: z.array(z.string()).optional(),
});

const enviarTextoBodySchema = z.object({
  number: z.string().min(10, "Número inválido"),
  text: z.string().min(1, "Texto não pode ser vazio"),
  delay: z.number().int().min(0).max(10000).optional(),
});

// ─── Rotas ────────────────────────────────────────────────────────────────────

export async function uazapiRoutes(app: FastifyInstance): Promise<void> {
  // ── WEBHOOK (público — chamado pelo uazapiGO) ─────────────────────────────
  app.post(
    "/api/lara/webhook/uazapi",
    { config: { skipLaraAuth: true } },
    async (request, reply) => {
      // Validar segredo opcional
      const headerSecret = request.headers["x-webhook-secret"] as string | undefined;
      const rawBody: string = (request as unknown as { rawBody?: string }).rawBody ?? "";

      if (!isValidSignature(rawBody, headerSecret)) {
        request.log.warn("[uazapi/webhook] Assinatura inválida — requisição ignorada");
        return reply.status(401).send({ error: "Unauthorized" });
      }

      // Responder 200 imediatamente (uazapiGO não espera processamento)
      reply.status(200).send({ ok: true });

      // Processar em background
      setImmediate(async () => {
        try {
          const parsed = uazapiWebhookBodySchema.safeParse(request.body);
          if (!parsed.success) return;

          const event = extractEventName(parsed.data);
          const data  = extractMessageData(parsed.data);

          // ── Evento de conexão ────────────────────────────────────────────
          if (event === "connection") {
            const connData = data as Record<string, unknown> | undefined;
            request.log.info(
              { status: connData?.status },
              "[uazapi] Evento de conexão recebido",
            );
            return;
          }

          // ── Atualização de status de mensagem ────────────────────────────
          if (event === "messages_update") {
            request.log.debug({ data }, "[uazapi] messages_update recebido");
            return;
          }

          // ── Mensagem recebida ────────────────────────────────────────────
          if (event !== "messages") return;

          const msgParsed = uazapiMessageDataSchema.safeParse(data);
          if (!msgParsed.success) return;

          const msg = msgParsed.data;

          // Ignorar: mensagens enviadas pela própria API, grupos, fromMe
          if (msg.wasSentByApi) return;
          if (msg.fromMe) return;
          if (msg.isGroup) return;

          // Extrair número: cramos usa sender_pn quando sender é @lid
          const rawChatid = msg.chatid ?? msg.sender_pn ?? msg.sender ?? "";
          if (!rawChatid) return;

          // Normalizar para garantir 13 dígitos (adiciona o 9 se necessário)
          const rawPhone = jidToPhone(rawChatid);
          const waId = rawPhone.length === 12 && rawPhone.startsWith("55")
            ? rawPhone.slice(0, 4) + "9" + rawPhone.slice(4)
            : rawPhone;
          if (!waId) return;

          // Texto pode vir do campo text ou da resposta de botão/lista
          const messageText = (
            msg.buttonOrListid?.trim() ||
            msg.text?.trim() ||
            ""
          );
          if (!messageText) return;

          const eventId = msg.id ?? msg.messageid;
          const receivedAt = msg.messageTimestamp
            ? new Date(msg.messageTimestamp).toISOString()
            : new Date().toISOString();

          // Mostra "Digitando..." enquanto o LLM processa (cancelado ao enviar a resposta)
          sendTyping(waId, 20000).catch(() => {});

          // Processar via engine da Lara (mesmo fluxo do canal Meta)
          const result = await laraService.processarMensagemInbound({
            event_id: eventId,
            wa_id: waId,
            telefone: waId,
            message_text: messageText,
            origem: "uazapi-webhook",
            canal: "WHATSAPP",
            received_at: receivedAt,
            operator_name: msg.senderName,
            payload: {
              messageType: msg.messageType,
              buttonOrListid: msg.buttonOrListid,
            },
          });

          // Enviar resposta ao cliente se houver mensagem e não for ação silenciosa
          const ACOES_SEM_REPLY = new Set(["optout_aplicado", "pausar_contato", "duplicado"]);
          if (
            result.mensagem &&
            result.acao &&
            !ACOES_SEM_REPLY.has(result.acao)
          ) {
            await sendWithRetry(waId, result.mensagem, request.log, {
              acao: result.acao,
              event_id: eventId,
            });

            // Se houver código PIX ou linha digitável, enviar como segunda mensagem
            const pixCode = String(result.payload_whatsapp?.pix_copia_cola ?? "").trim();
            const linhaDigitavel = String(result.payload_whatsapp?.linha_digitavel ?? "").trim();
            const codigo = pixCode || linhaDigitavel;

            if (codigo) {
              await new Promise((r) => setTimeout(r, 800));
              await sendWithRetry(waId, codigo, request.log, {
                acao: "envio_codigo",
                event_id: eventId,
              });
            }
          }
        } catch (err) {
          request.log.error(
            { err },
            "[uazapi/webhook] Erro ao processar mensagem recebida",
          );
        }
      });
    },
  );

  // ── STATUS DA INSTÂNCIA (protegido) ───────────────────────────────────────
  app.get("/api/lara/uazapi/status", async (_request, reply) => {
    if (!uazapiService.isConfigured()) {
      return reply.status(503).send({
        ok: false,
        error: "uazapiGO não configurado. Defina UAZAPI_BASE_URL e UAZAPI_TOKEN no .env",
      });
    }

    const status = await uazapiService.getInstanceStatus();
    return reply.send({ ok: true, ...status });
  });

  // ── CONFIGURAR WEBHOOK (protegido) ────────────────────────────────────────
  app.post("/api/lara/uazapi/configurar-webhook", async (request, reply) => {
    if (!uazapiService.isConfigured()) {
      return reply.status(503).send({
        ok: false,
        error: "uazapiGO não configurado. Defina UAZAPI_BASE_URL e UAZAPI_TOKEN no .env",
      });
    }

    const parsed = configurarWebhookBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: parsed.error.issues });
    }

    const { webhook_url, events, exclude_messages } = parsed.data;

    const result = await uazapiService.configureWebhook(
      webhook_url,
      events ?? ["messages", "messages_update", "connection"],
      exclude_messages ?? ["wasSentByApi", "fromMeYes"],
    );

    if (!result.ok) {
      return reply.status(502).send({ ok: false, error: result.error });
    }

    request.log.info(
      { webhook_url },
      "[uazapi] Webhook configurado com sucesso",
    );

    return reply.send({
      ok: true,
      message: "Webhook configurado com sucesso no uazapiGO",
      webhook_url,
    });
  });

  // ── VER WEBHOOK ATUAL (protegido) ─────────────────────────────────────────
  app.get("/api/lara/uazapi/webhook", async (_request, reply) => {
    if (!uazapiService.isConfigured()) {
      return reply.status(503).send({ ok: false, error: "uazapiGO não configurado" });
    }

    const result = await uazapiService.getWebhookConfig();

    if (!result.ok) {
      return reply.status(502).send({ ok: false, error: result.error });
    }

    return reply.send({ ok: true, webhook: result.data });
  });

  // ── ENVIAR TEXTO MANUAL (protegido — testes) ──────────────────────────────
  app.post("/api/lara/uazapi/enviar-texto", async (request, reply) => {
    if (!uazapiService.isConfigured()) {
      return reply.status(503).send({ ok: false, error: "uazapiGO não configurado" });
    }

    const parsed = enviarTextoBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: parsed.error.issues });
    }

    const { number, text, delay } = parsed.data;

    const result = await uazapiService.sendText(number, text, { delay });

    if (!result.ok) {
      return reply.status(502).send({ ok: false, error: result.error });
    }

    return reply.send({ ok: true, messageid: result.messageid, status: result.status });
  });
}
