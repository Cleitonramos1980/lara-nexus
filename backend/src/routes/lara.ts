import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { laraService } from "../modules/lara/service.js";
import {
  caseBodySchema,
  escalarAtendimentoBodySchema,
  listAtendimentosQuerySchema,
  listCasesQuerySchema,
  listClientesQuerySchema,
  listComplianceAuditQuerySchema,
  listConversasQuerySchema,
  listLogsQuerySchema,
  listOptoutQuerySchema,
  listTitulosQuerySchema,
  optoutBodySchema,
  pagamentoBoletoBodySchema,
  pagamentoPixBodySchema,
  processarMensagemBodySchema,
  promessaBodySchema,
  recarregarTitulosBodySchema,
  reguaConfigPutBodySchema,
  reguaDisparoTesteBodySchema,
  syncJanelaBodySchema,
  winthorBoletoConsultaBodySchema,
  winthorBoletoGerarBodySchema,
  winthorProrrogarTituloBodySchema,
  webhookReguaResultadoSchema,
  webhookWhatsappInboundSchema,
  webhookWhatsappStatusSchema,
} from "../modules/lara/schemas.js";

type RateLimitEntry = {
  windowStart: number;
  count: number;
};

const webhookRateLimitStore = new Map<string, RateLimitEntry>();
let rateLimitCache = {
  updatedAt: 0,
  valuePerMinute: 60,
};

async function getRateLimitPerMinute(): Promise<number> {
  const now = Date.now();
  if (now - rateLimitCache.updatedAt < 30_000) {
    return rateLimitCache.valuePerMinute;
  }
  const configs = await laraService.listConfiguracoes();
  const cfg = configs.find((item) => item.chave === "RATE_LIMIT_WEBHOOK_POR_MIN");
  const parsed = Number(cfg?.valor ?? 60);
  rateLimitCache = {
    updatedAt: now,
    valuePerMinute: Number.isFinite(parsed) && parsed > 0 ? parsed : 60,
  };
  return rateLimitCache.valuePerMinute;
}

async function assertWebhookRateLimit(
  req: FastifyRequest,
  webhookName: string,
  input?: { tenantId?: string; waId?: string },
): Promise<void> {
  const limit = await getRateLimitPerMinute();
  const ip = req.ip ?? "unknown-ip";
  const tenantId = String(input?.tenantId || req.headers["x-lara-tenant-id"] || "default");
  const waId = String(input?.waId || "").trim();
  const key = `${webhookName}:${tenantId}:${waId || ip}`;
  const now = Date.now();
  const windowMs = 60_000;
  const current = webhookRateLimitStore.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    webhookRateLimitStore.set(key, { windowStart: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    const error = new Error(`Rate limit excedido para ${webhookName}. Limite por minuto: ${limit}.`);
    (error as any).statusCode = 429;
    throw error;
  }
  current.count += 1;
  webhookRateLimitStore.set(key, current);
}

export async function laraRoutes(app: FastifyInstance) {
  app.get("/api/lara/dashboard", async (req) => {
    const query = z.object({
      filial: z.string().trim().optional(),
      filiais: z.string().trim().optional(),
      canal: z.string().trim().optional(),
    }).parse(req.query);
    const filiais = query.filiais
      ? query.filiais.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    return laraService.getDashboard({
      filial: query.filial,
      filiais,
      canal: query.canal,
    });
  });
  app.get("/api/lara/filiais", async () => laraService.listFiliais());

  app.get("/api/lara/monitoramento/health", async () => laraService.getMonitoramentoHealth());
  app.get("/api/lara/monitoramento/resumo-operacional", async () => laraService.getResumoOperacional());
  app.get("/api/lara/sincronizacao/ultima", async () => laraService.getStatusSincronizacaoDiaria());
  app.put("/api/lara/sincronizacao/janela", async (req) => {
    const body = syncJanelaBodySchema.parse(req.body);
    return laraService.updateJanelaSincronizacao(body);
  });

  app.get("/api/lara/clientes", async (req) => {
    const query = listClientesQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) {
      return laraService.listClientesPaged(query);
    }
    return laraService.listClientes(query);
  });

  app.get("/api/lara/clientes/:codcli", async (req, reply) => {
    const { codcli } = z.object({ codcli: z.coerce.number().int().positive() }).parse(req.params);
    const cliente = await laraService.getCliente(codcli);
    if (!cliente) return reply.status(404).send({ error: { message: "Cliente não encontrado." } });
    return cliente;
  });

  app.get("/api/lara/clientes/:codcli/titulos", async (req) => {
    const { codcli } = z.object({ codcli: z.coerce.number().int().positive() }).parse(req.params);
    return laraService.listTitulos({ codcli, limit: 5000 });
  });

  app.get("/api/lara/clientes/:codcli/conversas", async (req) => {
    const { codcli } = z.object({ codcli: z.coerce.number().int().positive() }).parse(req.params);
    const conversas = await laraService.listConversas();
    return conversas.filter((item) => item.codcli === String(codcli));
  });

  app.get("/api/lara/clientes/:codcli/cases", async (req) => {
    const { codcli } = z.object({ codcli: z.coerce.number().int().positive() }).parse(req.params);
    return laraService.listCasesByCodcli(codcli);
  });

  app.get("/api/lara/titulos", async (req) => {
    const query = listTitulosQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) {
      return laraService.listTitulosPaged(query);
    }
    return laraService.listTitulos(query);
  });

  app.get("/api/lara/titulos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const titulo = await laraService.getTitulo(id);
    if (!titulo) return reply.status(404).send({ error: { message: "Título não encontrado." } });
    return titulo;
  });

  app.post("/api/lara/titulos/recarregar-oracle", async (req) => {
    const body = recarregarTitulosBodySchema.parse(req.body);
    return laraService.recarregarTitulosOracle(body);
  });

  app.get("/api/lara/conversas", async (req) => {
    const query = listConversasQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listConversasPaged(query);
    return laraService.listConversas(query);
  });

  app.get("/api/lara/conversas/:waId", async (req, reply) => {
    const { waId } = z.object({ waId: z.string().min(3) }).parse(req.params);
    const conversa = await laraService.getConversa(waId);
    if (!conversa) return reply.status(404).send({ error: { message: "Conversa não encontrada." } });
    return conversa;
  });

  app.get("/api/lara/atendimentos", async (req) => {
    const query = listAtendimentosQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listAtendimentosPaged(query);
    return laraService.listAtendimentos(query);
  });

  app.post("/api/lara/atendimentos/processar-mensagem", async (req) => {
    const body = processarMensagemBodySchema.parse(req.body);
    const tenantHeader = req.headers["x-lara-tenant-id"];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    return laraService.processarMensagemInbound({
      ...body,
      tenant_id: body.tenant_id || String(tenantId || "default"),
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/atendimentos/escalar", async (req) => {
    const body = escalarAtendimentoBodySchema.parse(req.body);
    const caseItem = await laraService.createCase({
      wa_id: body.wa_id,
      codcli: body.codcli,
      cliente: body.cliente,
      tipo_case: body.tipo_case,
      etapa: body.etapa,
      duplicatas: body.duplicatas?.join(", "),
      valor_total: body.valor_total,
      forma_pagamento: "",
      detalhe: body.detalhe,
      origem: body.origem,
      responsavel: body.responsavel,
      status: "escalado",
    });
    return {
      status: "ok",
      case: caseItem,
    };
  });

  app.post("/api/lara/pagamentos/boleto", async (req) => {
    const body = pagamentoBoletoBodySchema.parse(req.body);
    const payload = await laraService.enviarPagamento("boleto", {
      wa_id: body.wa_id,
      codcli: body.codcli,
      cliente: body.cliente,
      duplicatas: body.duplicatas,
      origem: body.origem,
      solicitante: body.solicitante,
    });
    return { status: "ok", payload };
  });

  app.post("/api/lara/pagamentos/pix", async (req) => {
    const body = pagamentoPixBodySchema.parse(req.body);
    const payload = await laraService.enviarPagamento("pix", {
      wa_id: body.wa_id,
      codcli: body.codcli,
      cliente: body.cliente,
      duplicatas: body.duplicatas,
      origem: body.origem,
      solicitante: body.solicitante,
    });
    return { status: "ok", payload };
  });

  app.post("/api/lara/pagamentos/promessa", async (req) => {
    const body = promessaBodySchema.parse(req.body);
    const promessa = await laraService.registrarPromessa({
      wa_id: body.wa_id,
      codcli: body.codcli,
      cliente: body.cliente,
      duplicatas: body.duplicatas,
      valor_total: body.valor_total,
      data_prometida: body.data_prometida,
      observacao: body.observacao,
      origem: body.origem,
    });
    return { status: "ok", promessa };
  });

  app.post("/api/lara/winthor/boleto/consultar", async (req) => {
    const body = winthorBoletoConsultaBodySchema.parse(req.body);
    return laraService.consultarBoletoWinthor(body);
  });

  app.post("/api/lara/winthor/boleto/gerar", async (req) => {
    const body = winthorBoletoGerarBodySchema.parse(req.body);
    return laraService.gerarBoletoWinthor({
      ...body,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/winthor/titulo/prorrogar", async (req) => {
    const body = winthorProrrogarTituloBodySchema.parse(req.body);
    return laraService.prorrogarTituloWinthor({
      ...body,
      correlation_id: (req as any).correlationId,
    });
  });

  app.get("/api/lara/regua/ativa", async () => {
    const [resumo, execucoes] = await Promise.all([
      laraService.buildReguaAtivaResumo(),
      laraService.listReguaExecucoes(200),
    ]);
    return { ...resumo, execucoes };
  });

  app.get("/api/lara/regua/config", async () => {
    const [templates, configuracoes] = await Promise.all([
      laraService.listReguaTemplates(),
      laraService.listConfiguracoes(),
    ]);
    return { templates, configuracoes };
  });

  app.put("/api/lara/regua/config", async (req) => {
    const body = reguaConfigPutBodySchema.parse(req.body);
    await laraService.saveReguaConfig(body);
    const [templates, configuracoes] = await Promise.all([
      laraService.listReguaTemplates(),
      laraService.listConfiguracoes(),
    ]);
    return { status: "ok", templates, configuracoes };
  });

  app.get("/api/lara/regua/execucoes", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }).parse(req.query);
    return laraService.listReguaExecucoes(limit ?? 200);
  });

  app.post("/api/lara/regua/disparar-teste", async (req) => {
    const body = reguaDisparoTesteBodySchema.parse(req.body);
    return laraService.registrarWebhookReguaResultado({
      event_id: `manual-${Date.now()}`,
      ...body,
      status: "disparo-teste",
      correlation_id: (req as any).correlationId,
    });
  });

  app.get("/api/lara/cases", async (req) => {
    const query = listCasesQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listCasesPaged(query);
    return laraService.listCases(query);
  });

  app.post("/api/lara/cases", async (req) => {
    const body = caseBodySchema.parse(req.body);
    const caseItem = await laraService.createCase(body);
    return { status: "ok", case: caseItem };
  });

  app.get("/api/lara/optout", async (req) => {
    const query = listOptoutQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listOptoutsPaged(query);
    return laraService.listOptouts(query);
  });

  app.post("/api/lara/optout", async (req) => {
    const body = optoutBodySchema.parse(req.body);
    const item = await laraService.setOptout(body);
    return { status: "ok", item };
  });

  app.delete("/api/lara/optout/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const removed = await laraService.removeOptout(id);
    if (!removed) return reply.status(404).send({ error: { message: "Registro de opt-out não encontrado." } });
    return { status: "ok" };
  });

  app.get("/api/lara/logs", async (req) => {
    const query = listLogsQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listLogsPaged(query);
    return laraService.listLogs(query);
  });

  app.get("/api/lara/compliance/auditoria", async (req) => {
    const query = listComplianceAuditQuerySchema.parse(req.query);
    return laraService.listComplianceAuditPaged(query);
  });

  app.post("/api/lara/webhooks/whatsapp-inbound", async (req) => {
    const body = webhookWhatsappInboundSchema.parse(req.body);
    await assertWebhookRateLimit(req, "whatsapp-inbound", {
      tenantId: body.tenant_id,
      waId: body.wa_id,
    });
    return laraService.processarMensagemInbound({
      event_id: body.event_id,
      wa_id: body.wa_id,
      telefone: body.telefone,
      message_text: body.message_text,
      origem: "webhook-whatsapp-inbound",
      tenant_id: body.tenant_id,
      jurisdicao: body.jurisdicao,
      canal: body.canal,
      received_at: body.received_at,
      payload: body.payload,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/webhooks/whatsapp-status", async (req) => {
    const body = webhookWhatsappStatusSchema.parse(req.body);
    await assertWebhookRateLimit(req, "whatsapp-status", { waId: body.wa_id });
    return laraService.registrarWebhookStatus({
      event_id: body.event_id,
      message_id: body.message_id,
      wa_id: body.wa_id,
      status: body.status,
      timestamp: body.timestamp,
      payload: body.payload,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/webhooks/regua-resultado", async (req) => {
    await assertWebhookRateLimit(req, "regua-resultado");
    const body = webhookReguaResultadoSchema.parse(req.body);
    return laraService.registrarWebhookReguaResultado({
      ...body,
      correlation_id: (req as any).correlationId,
    });
  });
}
