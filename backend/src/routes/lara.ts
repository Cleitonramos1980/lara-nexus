import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireRole } from "../utils/authorization.js";
import { dateToIsoDateTime } from "../modules/lara/utils.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { laraService } from "../modules/lara/service.js";
import { laraOperationalStore } from "../modules/lara/operationalStore.js";
import { getTableColumns } from "../modules/lara/oracleRepository.js";
import { sendTextMessage, isWhatsAppConfigured } from "../modules/lara/whatsappTemplateManager.js";
import {
  bradescoPixWebhookBodySchema,
  bradescoBolepixOperationBodySchema,
  bradescoBolepixWebhookBodySchema,
  caseBodySchema,
  escalarAtendimentoBodySchema,
  laraOrquestracaoMensagemBodySchema,
  laraOrquestracaoRespostaQuerySchema,
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
  pagamentoBolepixBodySchema,
  pagamentoPixBodySchema,
  processarMensagemBodySchema,
  promessaBodySchema,
  recarregarTitulosBodySchema,
  reguaConfigPutBodySchema,
  reguaDispararClienteBodySchema,
  reguaDisparoTesteBodySchema,
  syncJanelaBodySchema,
  winthorBoletoConsultaBodySchema,
  winthorBoletoGerarBodySchema,
  winthorProrrogarTituloBodySchema,
  webhookReguaResultadoSchema,
  webhookWhatsappInboundSchema,
  webhookWhatsappStatusSchema,
} from "../modules/lara/schemas.js";

// Ações que NÃO devem gerar resposta automática ao cliente
const ACOES_SEM_REPLY = new Set(["optout_aplicado", "pausar_contato", "duplicado"]);

// Valida token compartilhado nos webhooks inbound (ALTA-2)
function assertInboundWebhookToken(req: FastifyRequest): boolean {
  const configured = String(env.LARA_INBOUND_WEBHOOK_TOKEN ?? "").trim();
  if (!configured) return true; // token nao configurado = aceita (backward compat)
  const provided =
    String(req.headers["x-lara-webhook-token"] ?? "").trim() ||
    String((req.query as Record<string, unknown>)["token"] ?? "").trim();
  return provided === configured;
}

async function sendWithRetry(
  waId: string,
  mensagem: string,
  logger?: { error?: (...args: unknown[]) => void },
  context?: Record<string, unknown>,
): Promise<boolean> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sendTextMessage(waId, mensagem);
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  logger?.error?.(
    { wa_id: waId, ...context, erro: String(lastErr), attempts: MAX_ATTEMPTS },
    "Falha ao enviar mensagem WhatsApp apos tentativas",
  );
  return false;
}

function splitPaymentMessage(
  mensagem: string,
  payloadWhatsapp?: Record<string, unknown>,
): { texto: string; codigo: string } {
  const pixCode = String(payloadWhatsapp?.pix_copia_cola ?? "").trim();
  const linhaDigitavel = String(payloadWhatsapp?.linha_digitavel ?? "").trim();
  const codigo = pixCode || linhaDigitavel;

  if (!codigo) return { texto: mensagem, codigo: "" };

  const idx = mensagem.indexOf(codigo);
  if (idx <= 0) return { texto: mensagem, codigo: "" };

  return {
    texto: mensagem.slice(0, idx).trimEnd(),
    codigo,
  };
}

async function enviarRespostaWhatsApp(
  waId: string,
  resultado: { mensagem?: string; acao?: string; payload_whatsapp?: Record<string, unknown>; codcli?: string },
  logger?: { error?: (...args: unknown[]) => void },
): Promise<void> {
  const mensagem = String(resultado.mensagem ?? "").trim();
  if (!mensagem) return;
  if (ACOES_SEM_REPLY.has(String(resultado.acao ?? ""))) return;
  if (!isWhatsAppConfigured()) return;

  const { texto, codigo } = splitPaymentMessage(mensagem, resultado.payload_whatsapp);

  const textoEnviado = await sendWithRetry(waId, texto, logger, { acao: resultado.acao });
  if (!textoEnviado) {
    void laraOperationalStore.addIntegrationLog({
      integracao: "whatsapp",
      tipo: "ERRO_ENVIO_WHATSAPP",
      request_json: { wa_id: waId, acao: resultado.acao, codcli: resultado.codcli ?? null },
      response_json: { status: "RESPOSTA_GERADA_NAO_ENVIADA", mensagem_tentada: texto.slice(0, 200) },
      status_operacao: "erro",
      erro_resumo: "Falha no envio apos 3 tentativas",
      idempotency_key: `err_envio:${waId}:${dateToIsoDateTime(new Date())}`,
    });
  }

  if (codigo) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await sendWithRetry(waId, codigo, logger, { acao: resultado.acao, parte: "codigo_pagamento" });
  }
}

function validateMetaWebhookSignature(req: FastifyRequest, rawBody: string): boolean {
  const appSecret = String(env.WHATSAPP_APP_SECRET ?? "").trim();
  if (!appSecret) return true;
  const sigHeader = getHeader(req, "x-hub-signature-256");
  if (!sigHeader) return false;
  const hmac = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const expected = `sha256=${hmac}`;
  if (sigHeader.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sigHeader, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

type RateLimitEntry = {
  windowStart: number;
  count: number;
};

const webhookRateLimitStore = new Map<string, RateLimitEntry>();
let rateLimitCache = {
  updatedAt: 0,
  valuePerMinute: 60,
};

// Limpa entradas expiradas a cada 10 min para evitar crescimento ilimitado
setInterval(() => {
  const cutoff = Date.now() - 120_000; // entradas com mais de 2 min são removidas
  for (const [key, entry] of webhookRateLimitStore) {
    if (entry.windowStart < cutoff) webhookRateLimitStore.delete(key);
  }
}, 10 * 60 * 1000).unref();

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

function getHeader(req: FastifyRequest, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function validateBradescoPixSecret(req: FastifyRequest): {
  configured: boolean;
  valid: boolean;
  missing: boolean;
} {
  const configuredSecret = String(env.BRADESCO_PIX_WEBHOOK_SECRET ?? "").trim();
  if (!configuredSecret) {
    return { configured: false, valid: false, missing: true };
  }
  const provided =
    getHeader(req, "x-bradesco-webhook-secret")
    || getHeader(req, "x-webhook-secret")
    || getHeader(req, "x-bradesco-secret");
  return {
    configured: true,
    valid: provided === configuredSecret,
    missing: !provided,
  };
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
    requireRole(req, ["ADMIN", "FINANCEIRO"]);
    const body = recarregarTitulosBodySchema.parse(req.body);
    return laraService.recarregarTitulosOracle(body);
  });

  app.post("/api/lara/admin/purge-invalid-codcob", async (req) => {
    requireRole(req, ["ADMIN"]);
    return laraOperationalStore.purgeInvalidCodcob(["341", "756", "BK"]);
  });

  // Busca raw no Oracle sem filtros de CODCOB/DTPAG (uso em diagnóstico)
  app.get("/api/lara/admin/oracle-pcprest", async (req) => {
    requireRole(req, ["ADMIN"]);
    const { codcli, duplic, numtransvenda } = z.object({
      codcli: z.coerce.number().int().positive().optional(),
      duplic: z.string().trim().optional(),
      numtransvenda: z.coerce.number().int().optional(),
    }).parse(req.query);
    const { isOracleEnabled, withOracleConnection } = await import("../db/oracle.js");
    const oracledb = (await import("oracledb")).default;
    if (!isOracleEnabled()) return { rows: [], error: "Oracle não configurado" };
    const wheres: string[] = [];
    const binds: Record<string, unknown> = {};
    if (codcli) { wheres.push("p.CODCLI = :codcli"); binds.codcli = codcli; }
    if (duplic) { wheres.push("TRIM(p.DUPLIC) = :duplic"); binds.duplic = duplic; }
    if (numtransvenda) { wheres.push("p.NUMTRANSVENDA = :numtransvenda"); binds.numtransvenda = numtransvenda; }
    const where = wheres.length ? `AND ${wheres.join(" AND ")}` : "";
    return withOracleConnection(async (conn: any) => {
      const r = await conn.execute(
        `SELECT p.CODCLI, TRIM(p.DUPLIC) AS DUPLIC, TRIM(p.PREST) AS PREST,
                p.NUMTRANSVENDA, TRIM(p.CODCOB) AS CODCOB,
                NVL(p.VALOR,0) AS VALOR, p.DTVENC, p.DTPAG,
                TRIM(p.STATUS) AS STATUS
         FROM PCPREST p
         WHERE 1=1 ${where}
         ORDER BY p.DTVENC DESC FETCH FIRST 20 ROWS ONLY`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return { rows: r.rows };
    });
  });

  // Injeta título diretamente no cache (uso em testes — bypassa Oracle)
  app.post("/api/lara/admin/inject-titulo-teste", async (req) => {
    requireRole(req, ["ADMIN"]);
    const body = z.object({
      codcli: z.coerce.number().int().positive(),
      duplicata: z.string().min(1),
      prestacao: z.string().default("1"),
      valor: z.number().positive(),
      vencimento: z.string(),
      codcob: z.string().default("422"),
      dias_atraso: z.number().int().default(0),
    }).parse(req.body);

    const titulo = {
      id: `TIT-${body.codcli}-${body.duplicata}-${body.prestacao}`,
      duplicata: body.duplicata,
      prestacao: body.prestacao,
      numtransvenda: 0,
      numnota: 0,
      codcli: String(body.codcli),
      cliente: `Cliente ${body.codcli}`,
      fantasia: `Cliente ${body.codcli}`,
      telefone: "",
      valor: body.valor,
      vlreceber: body.valor,
      vldesc: 0,
      cmulta_prev: 0,
      percmulta: 0,
      vencimento: body.vencimento,
      dtemissao: body.vencimento,
      dtrecebimento_previsto: "",
      dias_atraso: body.dias_atraso,
      codcob: body.codcob,
      cobranca: body.codcob,
      rca: "",
      etapa_regua: "D+30",
      status_atendimento: "Em aberto",
      boleto_disponivel: false,
      pix_disponivel: true,
      titulo_com_data_prevista: false,
      ultima_acao: `[TESTE] Injetado via admin (CODCOB=${body.codcob})`,
      responsavel: "Admin",
      filial: "",
    };

    // Buscar nome do cliente no cache
    const clienteExistente = await laraService.getCliente(body.codcli);
    if (clienteExistente) {
      titulo.cliente = clienteExistente.cliente || titulo.cliente;
      titulo.fantasia = clienteExistente.cliente || titulo.fantasia;
      titulo.telefone = clienteExistente.telefone || "";
    }

    await laraOperationalStore.upsertTitulosCacheBatch([titulo as any]);

    // Atualizar total_aberto do cliente
    if (clienteExistente) {
      clienteExistente.total_aberto = (clienteExistente.total_aberto || 0) + body.valor;
      clienteExistente.qtd_titulos = (clienteExistente.qtd_titulos || 0) + 1;
      if (!clienteExistente.titulo_mais_antigo || body.vencimento < clienteExistente.titulo_mais_antigo) {
        clienteExistente.titulo_mais_antigo = body.vencimento;
      }
      await laraOperationalStore.upsertClientesCacheBatch([clienteExistente]);
    }

    return { status: "ok", titulo_id: titulo.id, cliente: titulo.cliente };
  });

  // Remove título do cache por ID (uso em testes)
  app.delete("/api/lara/admin/titulo-cache/:id", async (req) => {
    requireRole(req, ["ADMIN"]);
    const { id } = req.params as { id: string };
    if (!id) throw new Error("id obrigatório");
    await laraOperationalStore.deleteTituloCacheById(id);
    return { status: "ok", deletado: id };
  });

  // Sync forçado para clientes fora do CODCOB padrão (uso em testes)
  app.post("/api/lara/admin/forcar-sync-codcli", async (req) => {
    requireRole(req, ["ADMIN"]);
    const { codcli, limit } = z.object({
      codcli: z.coerce.number().int().positive(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).parse(req.body);
    return laraService.recarregarTitulosOracle({ codcli, limit: limit ?? 200, skipCodcobFilter: true });
  });

  app.get("/api/lara/admin/pcfilial-columns", async (req) => {
    requireRole(req, ["ADMIN"]);
    const cols = await getTableColumns("PCFILIAL");
    return { columns: [...cols].sort() };
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

  app.post("/api/lara/orquestracao/mensagens", async (req, reply) => {
    const body = laraOrquestracaoMensagemBodySchema.parse(req.body);
    const tenantHeader = req.headers["x-lara-tenant-id"];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    const result = await laraService.processarMensagemOrquestracao({
      ...body,
      tenant_id: body.tenant_id || String(tenantId || "default"),
      correlation_id: (req as any).correlationId,
    });
    return reply.status(result.status === "error" ? 200 : 202).send(result);
  });

  app.get("/api/lara/orquestracao/respostas", async (req) => {
    const query = laraOrquestracaoRespostaQuerySchema.parse(req.query);
    const tenantHeader = req.headers["x-lara-tenant-id"];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    return laraService.consultarRespostaOrquestracao({
      ...query,
      tenant_id: String(tenantId || "default"),
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
      status: "pendente",
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

  app.post("/api/lara/pagamentos/bolepix", async (req) => {
    const body = pagamentoBolepixBodySchema.parse(req.body);
    const payload = await laraService.enviarPagamento("bolepix", {
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
    requireRole(req, ["ADMIN", "FINANCEIRO"]);
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

  // Regra: se o cliente possuir mais de um título em aberto, todos são enviados
  // em UMA ÚNICA mensagem (duplicata + valor + vencimento de cada um).
  // Com título único, despacha o template WhatsApp da etapa correspondente.
  app.post("/api/lara/regua/disparar-cliente", async (req) => {
    const body = reguaDispararClienteBodySchema.parse(req.body);
    return laraService.dispararReguaClienteConsolidado({ codcli: body.codcli });
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

  // Atualiza status de um case (ex: pendente → em_atendimento → resolvido)
  app.patch("/api/lara/cases/:id/status", async (req, reply) => {
    requireRole(req, ["ADMIN", "FINANCEIRO", "OPERACIONAL"]);
    const { id } = req.params as { id: string };
    const { status, responsavel } = req.body as { status: string; responsavel?: string };
    if (!status) return reply.status(400).send({ error: "status obrigatorio" });
    await laraOperationalStore.updateCaseStatus(id, status, responsavel);
    return { status: "ok", case_id: id, novo_status: status };
  });

  // Envia mensagem manual do atendente para o cliente via uazapi/WhatsApp
  app.post("/api/lara/atendimento-humano/enviar", async (req, reply) => {
    requireRole(req, ["ADMIN", "FINANCEIRO", "OPERACIONAL"]);
    const { wa_id, mensagem, operador, case_id, codcli: codcliBody } = req.body as {
      wa_id: string; mensagem: string; operador?: string; case_id?: string; codcli?: string | number;
    };
    if (!wa_id || !mensagem) return reply.status(400).send({ error: "wa_id e mensagem obrigatorios" });

    const { sendText, isUazapiConfigured } = await import("../modules/lara/uazapiService.js");
    const { sendTextMessage, isWhatsAppConfigured } = await import("../modules/lara/whatsappTemplateManager.js");

    // Texto enviado ao WhatsApp inclui assinatura do operador para o cliente identificar o humano
    const nomeOperador = (operador ?? "Atendente").trim();
    const mensagemWhatsApp = `👤 *${nomeOperador}:*\n${mensagem}`;

    if (isUazapiConfigured()) {
      // bypassDedup: mensagens do operador humano nunca devem ser bloqueadas por dedup
      await sendText(wa_id, mensagemWhatsApp, { bypassDedup: true });
    } else if (isWhatsAppConfigured()) {
      await sendTextMessage(wa_id, mensagemWhatsApp);
    } else {
      return reply.status(503).send({ error: "Nenhum canal de mensagens configurado." });
    }

    // Resolve o codcli: usa o do body ou busca no histórico pelo wa_id
    let codcliResolved: number | null = codcliBody ? Number(codcliBody) : null;
    if (!codcliResolved) {
      const msgs = await laraOperationalStore.listMessagesByWaId(wa_id);
      const found = msgs.find((m) => m.codcli != null && Number(m.codcli) > 0);
      codcliResolved = found ? Number(found.codcli) : null;
    }

    await laraOperationalStore.addMessageLog({
      wa_id,
      codcli: codcliResolved,
      cliente: "",
      telefone: wa_id,
      message_text: mensagem,
      direction: "OUTBOUND",
      origem: "atendimento-humano",
      etapa: "",
      duplics: "",
      valor_total: 0,
      payload_json: JSON.stringify({ case_id, operador }),
      status: "enviado",
      sent_at: dateToIsoDateTime(new Date()),
      received_at: "",
      message_type: "texto",
      operator_name: operador ?? "Atendente",
      idempotency_key: `human:${wa_id}:${Date.now()}`,
    });

    if (case_id) {
      await laraOperationalStore.updateCaseStatus(case_id, "em_atendimento", operador).catch(() => {});
    }
    return { status: "ok", enviado: true };
  });

  app.get("/api/lara/optout", async (req) => {
    const query = listOptoutQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listOptoutsPaged(query);
    return laraService.listOptouts(query);
  });

  app.post("/api/lara/optout", async (req) => {
    requireRole(req, ["ADMIN", "FINANCEIRO", "OPERACIONAL"]);
    const body = optoutBodySchema.parse(req.body);
    const item = await laraService.setOptout(body);
    return { status: "ok", item };
  });

  app.delete("/api/lara/optout/:id", async (req, reply) => {
    requireRole(req, ["ADMIN", "FINANCEIRO"]);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const removed = await laraService.removeOptout(id);
    if (!removed) return reply.status(404).send({ error: { message: "Registro de opt-out não encontrado." } });
    return { status: "ok" };
  });

  app.get("/api/lara/promessas", async (req) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(10000).optional() }).parse(req.query);
    const rows = await laraService.listPromessas();
    return query.limit ? rows.slice(0, query.limit) : rows;
  });

  app.get("/api/lara/logs", async (req) => {
    const query = listLogsQuerySchema.parse(req.query);
    if (query.page_size || query.cursor) return laraService.listLogsPaged(query);
    return laraService.listLogs(query);
  });

  // Logs dedicados de IA (OpenAI) com detalhes de request/response
  app.get("/api/lara/ai-logs", async (req) => {
    const { limit } = (req.query ?? {}) as { limit?: string };
    const limitNum = Math.max(1, Math.min(2000, Number(limit ?? 200)));
    const rows = await laraOperationalStore.listIntegrationLogs("openai", limitNum);
    return rows.map((row) => {
      let reqParsed: Record<string, unknown> = {};
      let resParsed: Record<string, unknown> = {};
      try { reqParsed = JSON.parse(row.request_json); } catch { /* noop */ }
      try { resParsed = JSON.parse(row.response_json); } catch { /* noop */ }
      return {
        id:              row.id,
        created_at:      row.created_at,
        tipo:            row.tipo,
        status:          row.status_operacao,
        erro:            row.erro_resumo || null,
        model:           reqParsed.model ?? "gpt-4o-mini",
        intent:          reqParsed.intent ?? null,
        action:          reqParsed.action ?? null,
        total:           reqParsed.total ?? null,
        titulos:         reqParsed.titulos ?? null,
        provider:        resParsed.provider ?? "openai",
        request_id:      resParsed.request_id ?? null,
        message_preview: resParsed.message_preview ?? null,
      };
    });
  });

  app.get("/api/lara/compliance/auditoria", async (req) => {
    const query = listComplianceAuditQuerySchema.parse(req.query);
    return laraService.listComplianceAuditPaged(query);
  });

  app.post("/api/lara/bradesco/pix/webhook", async (req, reply) => {
    await assertWebhookRateLimit(req, "bradesco-pix-webhook");
    const secretValidation = validateBradescoPixSecret(req);
    if (secretValidation.configured && !secretValidation.valid) {
      return reply.status(401).send({
        status: "unauthorized_webhook",
        process_code: "ERR_PIX_WEBHOOK_SECRET_INVALID",
        message: "Segredo do webhook Bradesco PIX invalido.",
      });
    }
    const body = bradescoPixWebhookBodySchema.parse(req.body);
    return laraService.processarWebhookBradescoPix({
      ...body,
      webhook_secret_validated: secretValidation.valid,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/pix/reconciliar", async (req, reply) => {
    await assertWebhookRateLimit(req, "bradesco-pix-reconciliar");
    const secretValidation = validateBradescoPixSecret(req);
    if (secretValidation.configured && !secretValidation.valid) {
      return reply.status(401).send({
        status: "unauthorized_webhook",
        process_code: "ERR_PIX_WEBHOOK_SECRET_INVALID",
        message: "Segredo do webhook Bradesco PIX invalido.",
      });
    }
    const body = bradescoPixWebhookBodySchema.parse(req.body);
    return laraService.reconciliarBradescoPix({
      ...body,
      webhook_secret_validated: secretValidation.valid,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/token/test", async (req) =>
    laraService.validarTokenBradescoBolepix({
      correlation_id: (req as any).correlationId,
    }));

  app.post("/api/lara/bradesco/bolepix/gerar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    return laraService.gerarBolepixBradesco({
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/alterar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    const txId = String(body.txId ?? "").trim();
    if (!txId) {
      return {
        status: "invalid_payload",
        process_status: "invalid_payload",
        message: "Campo txId é obrigatório para alteração de BolePix.",
      };
    }
    return laraService.alterarBolepixBradesco({
      txId,
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/consultar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    return laraService.consultarBolepixBradesco({
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/listar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    return laraService.listarLiquidadosBolepixBradesco({
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/baixar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    return laraService.baixarBoletoBradesco({
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/webhook/cadastrar", async (req) => {
    const body = bradescoBolepixOperationBodySchema.parse(req.body);
    return laraService.cadastrarWebhookBolepixBradesco({
      payload: body.payload,
      idempotency_key: body.idempotency_key,
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/bradesco/bolepix/webhook/pagamento", async (req) => {
    await assertWebhookRateLimit(req, "bradesco-bolepix-pagamento");
    const body = bradescoBolepixWebhookBodySchema.parse(req.body);
    return laraService.registrarWebhookPagamentoBolepix({
      event_id: body.event_id,
      tenant_id: body.tenant_id,
      payload: body.payload ?? (body as Record<string, unknown>),
      correlation_id: (req as any).correlationId,
    });
  });

  app.post("/api/lara/webhooks/whatsapp-inbound", async (req, reply) => {
    if (!assertInboundWebhookToken(req)) {
      return reply.status(401).send({ error: "Token de webhook invalido." });
    }
    const body = webhookWhatsappInboundSchema.parse(req.body);
    await assertWebhookRateLimit(req, "whatsapp-inbound", {
      tenantId: body.tenant_id,
      waId: body.wa_id,
    });
    let resultado: Awaited<ReturnType<typeof laraService.processarMensagemInbound>>;
    try {
      resultado = await laraService.processarMensagemInbound({
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
    } catch (errInbound) {
      req.log.error?.({ wa_id: body.wa_id, erro: String(errInbound) }, "ERRO_INESPERADO_FLUXO_LARA");
      void laraOperationalStore.addIntegrationLog({
        integracao: "whatsapp",
        tipo: "ERRO_INESPERADO_FLUXO_LARA",
        request_json: { wa_id: body.wa_id, origem: "webhook-whatsapp-inbound" },
        response_json: { erro: String(errInbound) },
        status_operacao: "erro",
        erro_resumo: String(errInbound).slice(0, 500),
        idempotency_key: `err_inbound:${body.wa_id}:${dateToIsoDateTime(new Date())}`,
        correlation_id: (req as any).correlationId,
      });
      const msgSegura = "Tive uma dificuldade para concluir essa consulta agora. Vou registrar seu atendimento para a equipe verificar e dar continuidade.";
      if (body.canal === "WHATSAPP" || !body.canal) {
        await enviarRespostaWhatsApp(body.wa_id, { mensagem: msgSegura, acao: "erro_inesperado" }, req.log);
      }
      return { status: "erro", mensagem: msgSegura, acao: "erro_inesperado", wa_id: body.wa_id };
    }
    if (body.canal === "WHATSAPP" || !body.canal) {
      await enviarRespostaWhatsApp(body.wa_id, resultado, req.log);
    }
    return resultado;
  });

  app.post("/api/lara/webhooks/whatsapp-status", async (req, reply) => {
    if (!assertInboundWebhookToken(req)) {
      return reply.status(401).send({ error: "Token de webhook invalido." });
    }
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

  app.post("/api/lara/webhooks/regua-resultado", async (req, reply) => {
    if (!assertInboundWebhookToken(req)) {
      return reply.status(401).send({ error: "Token de webhook invalido." });
    }
    await assertWebhookRateLimit(req, "regua-resultado");
    const body = webhookReguaResultadoSchema.parse(req.body);
    return laraService.registrarWebhookReguaResultado({
      ...body,
      correlation_id: (req as any).correlationId,
    });
  });

  // ── Análise de Sentimento ─────────────────────────────────────────────────
  app.post("/api/lara/analise/sentimento", async (req) => {
    const { message_text } = z.object({ message_text: z.string().min(1) }).parse(req.body);
    return laraService.analisarSentimento(message_text);
  });

  // ── Score de Propensão ────────────────────────────────────────────────────
  app.get("/api/lara/clientes/:codcli/propensity", async (req) => {
    const { codcli } = z.object({ codcli: z.coerce.number() }).parse(req.params);
    return laraService.calcularPropensityScore(codcli);
  });

  // ── Negociação Autônoma ───────────────────────────────────────────────────
  app.get("/api/lara/negociacao/politicas", async () => {
    return laraService.listPoliticasNegociacao();
  });

  app.put("/api/lara/negociacao/politicas/:etapa", async (req) => {
    requireRole(req, ["ADMIN", "FINANCEIRO"]);
    const { etapa } = z.object({ etapa: z.string() }).parse(req.params);
    const body = z.object({
      desconto_maximo_pct: z.number().min(0).max(50),
      parcelas_maximas: z.number().int().min(1).max(24),
      entrada_minima_pct: z.number().min(0).max(100),
      ativo: z.boolean(),
    }).parse(req.body);
    return laraService.upsertPoliticaNegociacao({ etapa_regua: etapa, ...body });
  });

  app.get("/api/lara/negociacao/historico", async (req) => {
    const { limit, codcli } = z.object({
      limit: z.coerce.number().int().min(1).max(2000).optional(),
      codcli: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const rows = await laraOperationalStore.listNegociacoes(limit ?? 500);
    if (codcli) return rows.filter((r) => r.codcli === String(codcli));
    return rows;
  });

  app.post("/api/lara/negociacao/simular", async (req) => {
    requireRole(req, ["ADMIN", "FINANCEIRO"]);
    const body = z.object({
      codcli: z.number(),
      duplicatas: z.array(z.string()).optional(),
    }).parse(req.body);
    return laraService.simularNegociacao(body.codcli, body.duplicatas);
  });

  // ── Portal Self-Service ───────────────────────────────────────────────────
  app.post("/api/lara/portal/gerar-token", async (req) => {
    const body = z.object({ codcli: z.number(), wa_id: z.string().optional() }).parse(req.body);
    return laraService.gerarPortalToken(body.codcli, body.wa_id);
  });

  // Rota pública do portal (sem autenticação Lara) — rate limit por IP para evitar enumeração
  app.get("/api/lara/portal/:token", { config: { skipLaraAuth: true } } as any, async (req, reply) => {
    await assertWebhookRateLimit(req, "portal-get", {});
    const { token } = z.object({ token: z.string().min(10).max(128) }).parse(req.params);
    return laraService.getPortalData(token);
  });

  app.post("/api/lara/portal/:token/pagar", { config: { skipLaraAuth: true } } as any, async (req, reply) => {
    await assertWebhookRateLimit(req, "portal-pagar", {});
    const { token } = z.object({ token: z.string().min(10).max(128) }).parse(req.params);
    const body = z.object({
      forma: z.enum(["pix", "boleto", "negociacao"]),
      proposta_index: z.number().optional(),
    }).parse(req.body);
    return laraService.processarPagamentoPortal(token, body.forma, body.proposta_index);
  });

  // ── Feedback de Interações ────────────────────────────────────────────────
  app.post("/api/lara/feedback/registrar", async (req) => {
    const body = z.object({
      wa_id: z.string(),
      codcli: z.string().optional(),
      etapa: z.string().optional(),
      acao: z.string(),
      canal: z.string().default("WHATSAPP"),
      hora_envio: z.number().int().min(0).max(23),
      resultado: z.enum(["respondeu", "pagou", "ignorou", "optout", "escalou"]),
      tempo_resposta_min: z.number().optional(),
    }).parse(req.body);
    return laraService.registrarFeedbackInteracao(body);
  });

  app.get("/api/lara/feedback/insights", async (req) => {
    const query = z.object({
      etapa: z.string().optional(),
      dias: z.coerce.number().default(30),
    }).parse(req.query);
    return laraService.getInsightsFeedback(query.etapa, query.dias);
  });

  // ── A/B Testing ───────────────────────────────────────────────────────────
  app.get("/api/lara/regua/ab-test/:etapa", async (req) => {
    const { etapa } = z.object({ etapa: z.string() }).parse(req.params);
    return laraService.getAbTestAnalysis(etapa);
  });

  // ── Alertas Inteligentes do Dashboard ────────────────────────────────────
  app.get("/api/lara/dashboard/alertas", async (req) => {
    const query = z.object({ filial: z.string().optional() }).parse(req.query);
    return laraService.getAlertasInteligentes(query.filial);
  });

  // ── Dashboard Preditivo (Leading Indicators) ──────────────────────────────
  app.get("/api/lara/dashboard/preditivo", async (req) => {
    const query = z.object({ filial: z.string().optional() }).parse(req.query);
    return laraService.getDashboardPreditivo(query.filial);
  });

  // ── Escalação Estruturada para Humano ─────────────────────────────────────
  app.post("/api/lara/escalacao/humano", async (req) => {
    const body = z.object({
      wa_id: z.string(),
      codcli: z.number().optional(),
      motivo: z.string(),
      etapa: z.string().optional(),
      valor_total: z.number().optional(),
      duplicatas: z.array(z.string()).optional(),
      urgencia: z.enum(["baixa", "normal", "alta", "critica"]).default("normal"),
    }).parse(req.body);
    return laraService.escalarComContexto({
      waId: body.wa_id,
      codcli: body.codcli,
      motivo: body.motivo,
      etapa: body.etapa,
      valor_total: body.valor_total,
      duplicatas: body.duplicatas,
      urgencia: body.urgencia,
    });
  });

  // ── Análise de Sentimento de uma conversa ─────────────────────────────────
  app.get("/api/lara/conversas/:waId/sentimento", async (req) => {
    const { waId } = z.object({ waId: z.string() }).parse(req.params);
    return laraService.getSentimentoConversa(waId);
  });

  // ── Webhook nativo Meta (WhatsApp Business Cloud API) ────────────────────
  // GET: verificação do endpoint pelo painel Meta (challenge-response)
  app.get("/api/lara/webhook/meta", async (req, reply) => {
    const query = req.query as Record<string, string>;
    const mode      = query["hub.mode"];
    const token     = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    const configuredToken = String(env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
    if (!configuredToken) {
      return reply.status(503).send({ error: "WHATSAPP_VERIFY_TOKEN não configurado." });
    }
    if (mode === "subscribe" && token === configuredToken) {
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: "Token de verificação inválido." });
  });

  // POST: recebe eventos nativos da Meta (mensagens + status de entrega)
  app.post("/api/lara/webhook/meta", async (req, reply) => {
    // Valida X-Hub-Signature-256 quando WHATSAPP_APP_SECRET estiver configurado
    if (String(env.WHATSAPP_APP_SECRET ?? "").trim()) {
      const rawBody = String((req as any).rawBody ?? JSON.stringify(req.body ?? {}));
      if (!validateMetaWebhookSignature(req, rawBody)) {
        return reply.status(403).send({ error: "Assinatura X-Hub-Signature-256 invalida." });
      }
    }

    const raw = req.body as Record<string, unknown>;

    // A Meta exige 200 imediato — processamos em background
    reply.status(200).send({ received: true });

    if (!raw || raw.object !== "whatsapp_business_account") return;

    const entries = Array.isArray(raw.entry) ? raw.entry as unknown[] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const changes = Array.isArray((entry as any).changes) ? (entry as any).changes as unknown[] : [];
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const value = (change as any).value as Record<string, unknown> | undefined;
        if (!value || value.messaging_product !== "whatsapp") continue;

        // ── Mensagens recebidas ────────────────────────────────────────────
        const messages = Array.isArray(value.messages) ? value.messages as unknown[] : [];
        const contacts = Array.isArray(value.contacts) ? value.contacts as unknown[] : [];

        for (const msg of messages) {
          if (!msg || typeof msg !== "object") continue;
          const m = msg as Record<string, unknown>;

          const waId        = String(m.from ?? "").trim();
          const messageId   = String(m.id ?? "").trim();
          const msgType     = String(m.type ?? "text");
          const tsRaw       = Number(m.timestamp ?? 0);
          const receivedAt  = tsRaw ? new Date(tsRaw * 1000).toISOString() : new Date().toISOString();

          // Extrai texto de acordo com o tipo
          let messageText = "";
          if (msgType === "text" && m.text && typeof m.text === "object") {
            messageText = String((m.text as any).body ?? "").trim();
          } else if (msgType === "interactive" && m.interactive && typeof m.interactive === "object") {
            const inter = m.interactive as Record<string, unknown>;
            const btnReply = inter.button_reply as Record<string, unknown> | undefined;
            const listReply = inter.list_reply as Record<string, unknown> | undefined;
            messageText = String(btnReply?.title ?? listReply?.title ?? "").trim();
          } else if (["image", "document", "audio", "video", "sticker"].includes(msgType)) {
            messageText = `[${msgType.toUpperCase()}]`;
          } else if (msgType === "location" && m.location && typeof m.location === "object") {
            const loc = m.location as Record<string, unknown>;
            messageText = `[LOCALIZACAO: ${loc.latitude},${loc.longitude}]`;
          } else {
            messageText = `[${msgType.toUpperCase()}]`;
          }

          if (!waId || !messageText) continue;

          // Nome do contato se disponível
          const contact = contacts.find((c: any) => c?.wa_id === waId) as any;
          const profileName = String(contact?.profile?.name ?? "").trim();

          await assertWebhookRateLimit(req, "meta-inbound", { waId }).catch(() => {});

          await laraService.processarMensagemInbound({
            event_id:    messageId || undefined,
            wa_id:       waId,
            telefone:    waId,
            message_text: messageText,
            origem:      "webhook-meta-nativo",
            tenant_id:   "default",
            jurisdicao:  "BR",
            canal:       "WHATSAPP",
            received_at: receivedAt,
            payload:     { ...m, _profile_name: profileName, _raw_type: msgType },
            correlation_id: (req as any).correlationId,
          }).then((resultado) => {
            return enviarRespostaWhatsApp(waId, resultado, req.log);
          }).catch((err: unknown) => {
            req.log.error(
              { modulo: "webhook-meta", wa_id: waId, message_id: messageId, erro: String(err) },
              "Erro ao processar mensagem inbound Meta",
            );
          });
        }

        // ── Status de entrega ──────────────────────────────────────────────
        const statuses = Array.isArray(value.statuses) ? value.statuses as unknown[] : [];
        for (const st of statuses) {
          if (!st || typeof st !== "object") continue;
          const s = st as Record<string, unknown>;

          const waId      = String(s.recipient_id ?? "").trim();
          const messageId = String(s.id ?? "").trim();
          const status    = String(s.status ?? "").trim();
          const tsRaw     = Number(s.timestamp ?? 0);
          const timestamp = tsRaw ? new Date(tsRaw * 1000).toISOString() : undefined;

          if (!status) continue;

          await laraService.registrarWebhookStatus({
            event_id:   messageId || undefined,
            message_id: messageId || undefined,
            wa_id:      waId || undefined,
            status,
            timestamp,
            payload:    s as Record<string, unknown>,
            correlation_id: (req as any).correlationId,
          }).catch((err: unknown) => {
            req.log.error(
              { modulo: "webhook-meta", wa_id: waId, message_id: messageId, erro: String(err) },
              "Erro ao registrar status Meta",
            );
          });
        }
      }
    }
  });

  // ── Status dos templates WhatsApp ─────────────────────────────────────────
  app.get("/api/lara/whatsapp/templates", async () => {
    const { listTemplates, isWhatsAppConfigured } = await import(
      "../modules/lara/whatsappTemplateManager.js"
    );
    if (!isWhatsAppConfigured()) {
      return { configured: false, templates: [] };
    }
    const all = await listTemplates();
    const laraNames = new Set([
      "lara_vencimento_d3",
      "lara_aviso_vencimento_d0",
      "lara_cobranca_d3",
      "lara_cobranca_d7",
      "lara_cobranca_d15",
      "lara_cobranca_d30",
      "lara_boleto_gerado",
      "lara_pix_disponivel",
      "lara_promessa_confirmada",
      "lara_pix_confirmado",
    ]);
    const templates = all
      .filter((t) => laraNames.has(t.name))
      .map((t) => ({
        name:            t.name,
        status:          t.status,
        category:        t.category,
        rejected_reason: t.rejected_reason ?? null,
        id:              t.id,
      }));
    const summary = {
      total:    laraNames.size,
      approved: templates.filter((t) => t.status === "APPROVED").length,
      pending:  templates.filter((t) => t.status === "PENDING").length,
      rejected: templates.filter((t) => t.status === "REJECTED").length,
      missing:  laraNames.size - templates.length,
    };
    return { configured: true, summary, templates };
  });
}

