import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, nextId, appendAudit } from "../repositories/dataStore.js";
import { env } from "../config/env.js";

const SOLICITACAO_STATUS = {
  LINK_GERADO: "LINK_GERADO",
  ENVIADO: "ENVIADO",
  PREENCHIDO: "PREENCHIDO",
  VALIDADO: "VALIDADO",
  RECUSADO: "RECUSADO",
  EXPIRADO: "EXPIRADO",
  CONVERTIDO_EM_ACESSO: "CONVERTIDO_EM_ACESSO",
} as const;

function isSupportedSelfieDataUrl(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return true;

  const lower = normalized.toLowerCase();
  if (lower.startsWith("data:image/jpeg;base64,") || lower.startsWith("data:image/jpg;base64,")) {
    return normalized.includes("/9j/");
  }
  if (lower.startsWith("data:image/png;base64,")) {
    return normalized.includes("iVBOR");
  }
  if (lower.startsWith("data:image/webp;base64,")) {
    return normalized.includes("UklGR");
  }
  return false;
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

function nextOperationalCode(prefix: string, records: Array<{ id?: string; codigo?: string }>): string {
  const year = new Date().getFullYear();
  const regex = new RegExp(`^${prefix}-${year}-(\\d{4})$`);
  let max = 0;
  for (const record of records) {
    const candidate = record.codigo || record.id;
    if (!candidate) continue;
    const match = candidate.match(regex);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${prefix}-${year}-${pad4(max + 1)}`;
}

function buildSolicitacaoLink(req: any, token: string): string {
  const fallbackOrigin = "http://localhost:5173";
  const configuredPublicUrl = env.APP_PUBLIC_URL?.trim();
  const originHeader = typeof req.headers?.origin === "string" && req.headers.origin.trim().length > 0
    ? req.headers.origin.trim()
    : fallbackOrigin;
  const baseUrl = (configuredPublicUrl || originHeader).replace(/\/+$/, "");
  return `${baseUrl}/visitante/cadastro/${token}`;
}

function buildTimelineEvent(
  acessoId: string,
  tipo: string,
  descricao: string,
  usuario: string,
  detalhes?: string,
): any {
  return {
    id: nextId("EVT", (db.operacionalTimeline as any[]).length),
    acessoId,
    tipo,
    descricao,
    dataHora: new Date().toISOString(),
    usuario,
    detalhes,
  };
}

function addSolicitacaoHistorico(
  solicitacao: any,
  tipo: string,
  descricao: string,
  usuario: string,
): void {
  if (!Array.isArray(solicitacao.historico)) {
    solicitacao.historico = [];
  }
  solicitacao.historico.unshift({
    id: nextId("HST", solicitacao.historico.length),
    tipo,
    descricao,
    dataHora: new Date().toISOString(),
    usuario,
  });
}

function refreshExpiredSolicitacoes(): void {
  const nowIso = new Date().toISOString();
  const solicitacoes = db.operacionalSolicitacoesAcesso as any[];
  const acessos = db.operacionalAcessos as any[];

  for (const solicitacao of solicitacoes) {
    if (solicitacao.status !== SOLICITACAO_STATUS.LINK_GERADO && solicitacao.status !== SOLICITACAO_STATUS.ENVIADO) {
      continue;
    }
    if (!solicitacao.expiraEm || solicitacao.expiraEm >= nowIso) {
      continue;
    }

    solicitacao.status = SOLICITACAO_STATUS.EXPIRADO;
    solicitacao.atualizadoEm = nowIso;
    addSolicitacaoHistorico(
      solicitacao,
      SOLICITACAO_STATUS.EXPIRADO,
      "Link expirado automaticamente por validade.",
      "system",
    );

    const acesso = acessos.find((item) => item.id === solicitacao.acessoId);
    if (acesso) {
      acesso.status = "EXPIRADO";
      acesso.ultimaAtualizacao = nowIso;
    }
  }
}

export async function operacionalRoutes(app: FastifyInstance) {
  const createSolicitacaoSchema = z.object({
    tipoAcesso: z.enum(["VISITANTE", "MOTORISTA", "PRESTADOR", "FUNCIONARIO", "ENTREGA"]),
    responsavelInterno: z.string().trim().min(1),
    setorDestino: z.string().trim().min(1),
    unidadePlanta: z.string().trim().min(1),
    validadeHoras: z.coerce.number().int().min(1).max(168).default(24),
    observacaoInterna: z.string().trim().max(1200).optional().or(z.literal("")),
    solicitadoPor: z.string().trim().min(1),
    horarioPrevisto: z.string().datetime().optional(),
  });

  const preencherSolicitacaoSchema = z.object({
    nome: z.string().trim().min(1),
    documento: z.string().trim().min(1),
    empresa: z.string().trim().min(1),
    telefone: z.string().trim().min(1),
    email: z.string().trim().optional().or(z.literal("")),
    possuiVeiculo: z.boolean().default(false),
    placa: z.string().trim().optional().or(z.literal("")),
    tipoVeiculo: z.string().trim().optional().or(z.literal("")),
    modelo: z.string().trim().optional().or(z.literal("")),
    cor: z.string().trim().optional().or(z.literal("")),
    obs: z.string().trim().optional().or(z.literal("")),
    selfieUrl: z.string().trim().optional().or(z.literal("")).refine(
      (value) => isSupportedSelfieDataUrl(value || ""),
      { message: "Selfie invalida. Envie uma imagem JPG, PNG ou WEBP valida." },
    ),
  });

  function currentUser(req: any): string {
    return req?.authUser?.nome ?? "system";
  }

  // -- SOLICITACOES DE ACESSO --
  app.get("/api/operacional/solicitacoes-acesso", async () => {
    refreshExpiredSolicitacoes();
    return db.operacionalSolicitacoesAcesso;
  });

  app.get("/api/operacional/solicitacoes-acesso/:id", async (req, reply) => {
    refreshExpiredSolicitacoes();
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.operacionalSolicitacoesAcesso as any[]).find((s) => s.id === id || s.codigo === id);
    if (!item) return reply.status(404).send({ error: { message: "Solicitacao de acesso nao encontrada." } });
    return item;
  });

  app.post("/api/operacional/solicitacoes-acesso", async (req, reply) => {
    refreshExpiredSolicitacoes();
    const payload = createSolicitacaoSchema.parse(req.body);
    const nowIso = new Date().toISOString();
    const expiraEm = new Date(Date.now() + payload.validadeHoras * 60 * 60 * 1000).toISOString();

    const solicitacoes = db.operacionalSolicitacoesAcesso as any[];
    const acessos = db.operacionalAcessos as any[];
    const visitantes = db.operacionalVisitantes as any[];

    const solicitacaoCodigo = nextOperationalCode("SOL", solicitacoes);
    const acessoCodigo = nextOperationalCode("ACS", acessos);
    const token = randomUUID().replace(/-/g, "");
    const linkPreenchimento = buildSolicitacaoLink(req, token);

    const solicitacao: any = {
      id: solicitacaoCodigo,
      codigo: solicitacaoCodigo,
      token,
      linkPreenchimento,
      status: SOLICITACAO_STATUS.LINK_GERADO,
      tipoAcesso: payload.tipoAcesso,
      responsavelInterno: payload.responsavelInterno,
      setorDestino: payload.setorDestino,
      unidadePlanta: payload.unidadePlanta,
      validadeHoras: payload.validadeHoras,
      observacaoInterna: payload.observacaoInterna || "",
      solicitadoPor: payload.solicitadoPor,
      horarioPrevisto: payload.horarioPrevisto || nowIso,
      expiraEm,
      criadoEm: nowIso,
      atualizadoEm: nowIso,
      acessoId: acessoCodigo,
      visitanteId: null,
      preenchimento: null,
      historico: [] as any[],
    };

    addSolicitacaoHistorico(
      solicitacao,
      SOLICITACAO_STATUS.LINK_GERADO,
      "Solicitacao interna criada e link unico gerado.",
      currentUser(req),
    );

    const acesso = {
      id: acessoCodigo,
      tipo: payload.tipoAcesso,
      nome: "Aguardando preenchimento",
      documento: "-",
      empresa: "-",
      placa: "",
      tipoVeiculo: "",
      responsavelInterno: payload.responsavelInterno,
      setorDestino: payload.setorDestino,
      horarioPrevisto: payload.horarioPrevisto || nowIso,
      status: "AGUARDANDO_PREENCHIMENTO",
      criticidade: "BAIXA",
      motivo: payload.observacaoInterna || "Cadastro aguardando preenchimento via link.",
      planta: payload.unidadePlanta,
      criadoEm: nowIso,
      criadoPor: payload.solicitadoPor,
      ultimaAtualizacao: nowIso,
      obs: payload.observacaoInterna || "",
      solicitacaoId: solicitacao.id,
      linkPreenchimento,
      expiraEm,
      visitanteId: null,
    };

    const visitante = {
      id: nextOperationalCode("VIS", visitantes),
      nome: "Aguardando preenchimento",
      documento: "-",
      empresa: "-",
      telefone: "-",
      email: "",
      responsavelInterno: payload.responsavelInterno,
      setorDestino: payload.setorDestino,
      motivoVisita: payload.observacaoInterna || "Cadastro externo pendente.",
      status: "LINK_ENVIADO",
      possuiVeiculo: false,
      dataVisitaPrevista: nowIso.slice(0, 10),
      criadoEm: nowIso,
      criadoPor: payload.solicitadoPor,
      ultimaAtualizacao: nowIso,
      planta: payload.unidadePlanta,
      linkPreenchimento,
      solicitacaoId: solicitacao.id,
      acessoId: acesso.id,
    };

    solicitacao.visitanteId = visitante.id;
    solicitacoes.unshift(solicitacao);
    acessos.unshift(acesso);
    visitantes.unshift(visitante);

    (db.operacionalTimeline as any[]).unshift(
      buildTimelineEvent(
        acesso.id,
        "LINK_GERADO",
        "Solicitacao criada e link de preenchimento disponibilizado.",
        currentUser(req),
        solicitacao.codigo,
      ),
    );

    appendAudit("CRIAR", "SOLICITACAO_ACESSO", solicitacao.id, "Solicitacao de acesso criada com link unico", currentUser(req));

    return reply.status(201).send({
      solicitacao,
      acesso,
      visitante,
    });
  });

  app.put("/api/operacional/solicitacoes-acesso/:id/enviar", async (req, reply) => {
    refreshExpiredSolicitacoes();
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const solicitacao = (db.operacionalSolicitacoesAcesso as any[]).find((item) => item.id === id || item.codigo === id);
    if (!solicitacao) return reply.status(404).send({ error: { message: "Solicitacao de acesso nao encontrada." } });
    if (solicitacao.status === SOLICITACAO_STATUS.EXPIRADO) {
      return reply.status(409).send({ error: { message: "Link expirado. Gere uma nova solicitacao." } });
    }

    if (solicitacao.status === SOLICITACAO_STATUS.LINK_GERADO) {
      solicitacao.status = SOLICITACAO_STATUS.ENVIADO;
      solicitacao.atualizadoEm = new Date().toISOString();
      addSolicitacaoHistorico(
        solicitacao,
        SOLICITACAO_STATUS.ENVIADO,
        "Solicitacao marcada como link enviado ao visitante.",
        currentUser(req),
      );
      appendAudit("ATUALIZAR", "SOLICITACAO_ACESSO", solicitacao.id, "Solicitacao marcada como enviada", currentUser(req));
    }

    return solicitacao;
  });

  app.get("/api/operacional/solicitacoes-acesso/public/:token", async (req, reply) => {
    refreshExpiredSolicitacoes();
    const { token } = z.object({ token: z.string().min(1) }).parse(req.params);
    const solicitacao = (db.operacionalSolicitacoesAcesso as any[]).find((item) => item.token === token);
    if (!solicitacao) return reply.status(404).send({ error: { message: "Link de solicitacao nao encontrado." } });

    if (solicitacao.status === SOLICITACAO_STATUS.EXPIRADO) {
      return reply.status(410).send({
        status: SOLICITACAO_STATUS.EXPIRADO,
        codigo: solicitacao.codigo,
        expiraEm: solicitacao.expiraEm,
      });
    }

    return {
      id: solicitacao.id,
      codigo: solicitacao.codigo,
      token: solicitacao.token,
      status: solicitacao.status,
      tipoAcesso: solicitacao.tipoAcesso,
      unidadePlanta: solicitacao.unidadePlanta,
      setorDestino: solicitacao.setorDestino,
      responsavelInterno: solicitacao.responsavelInterno,
      expiraEm: solicitacao.expiraEm,
      visitantePreenchido: Boolean(solicitacao.preenchimento),
    };
  });

  app.post("/api/operacional/solicitacoes-acesso/public/:token/preencher", async (req, reply) => {
    refreshExpiredSolicitacoes();
    const { token } = z.object({ token: z.string().min(1) }).parse(req.params);
    const payload = preencherSolicitacaoSchema.parse(req.body);

    const solicitacao = (db.operacionalSolicitacoesAcesso as any[]).find((item) => item.token === token);
    if (!solicitacao) return reply.status(404).send({ error: { message: "Link de solicitacao nao encontrado." } });
    if (solicitacao.status === SOLICITACAO_STATUS.EXPIRADO) {
      return reply.status(410).send({ error: { message: "Link expirado. Solicite um novo acesso." } });
    }
    if (
      solicitacao.status === SOLICITACAO_STATUS.PREENCHIDO
      || solicitacao.status === SOLICITACAO_STATUS.VALIDADO
      || solicitacao.status === SOLICITACAO_STATUS.CONVERTIDO_EM_ACESSO
    ) {
      return reply.status(409).send({ error: { message: "Este link ja foi utilizado." } });
    }

    const nowIso = new Date().toISOString();
    const visitante = (db.operacionalVisitantes as any[]).find((item) => item.id === solicitacao.visitanteId);
    const acesso = (db.operacionalAcessos as any[]).find((item) => item.id === solicitacao.acessoId);
    if (!visitante || !acesso) {
      return reply.status(500).send({ error: { message: "Solicitacao sem vinculos internos validos." } });
    }

    solicitacao.status = SOLICITACAO_STATUS.PREENCHIDO;
    solicitacao.atualizadoEm = nowIso;
    solicitacao.preenchidoEm = nowIso;
    solicitacao.preenchimento = {
      ...payload,
      nome: payload.nome,
      documento: payload.documento,
      empresa: payload.empresa,
      telefone: payload.telefone,
      email: payload.email || "",
      placa: payload.placa || "",
      tipoVeiculo: payload.tipoVeiculo || "",
      modelo: payload.modelo || "",
      cor: payload.cor || "",
      obs: payload.obs || "",
      selfieUrl: payload.selfieUrl || "",
    };
    addSolicitacaoHistorico(
      solicitacao,
      SOLICITACAO_STATUS.PREENCHIDO,
      "Visitante finalizou o preenchimento externo.",
      payload.nome,
    );

    visitante.nome = payload.nome;
    visitante.documento = payload.documento;
    visitante.empresa = payload.empresa;
    visitante.telefone = payload.telefone;
    visitante.email = payload.email || "";
    visitante.possuiVeiculo = payload.possuiVeiculo;
    visitante.status = "CADASTRO_PREENCHIDO";
    visitante.ultimaAtualizacao = nowIso;
    visitante.selfieUrl = payload.selfieUrl || "";
    visitante.placa = payload.placa || "";
    visitante.tipoVeiculo = payload.tipoVeiculo || "";
    visitante.modelo = payload.modelo || "";
    visitante.cor = payload.cor || "";
    visitante.obs = payload.obs || "";

    acesso.nome = payload.nome;
    acesso.documento = payload.documento;
    acesso.empresa = payload.empresa;
    acesso.placa = payload.placa || "";
    acesso.tipoVeiculo = payload.tipoVeiculo || "";
    acesso.status = "AGUARDANDO_VALIDACAO";
    acesso.ultimaAtualizacao = nowIso;
    acesso.selfieUrl = payload.selfieUrl || "";
    acesso.obs = payload.obs || acesso.obs;
    acesso.visitanteId = visitante.id;

    (db.operacionalTimeline as any[]).unshift(
      buildTimelineEvent(
        acesso.id,
        "CADASTRO_PREENCHIDO",
        "Visitante concluiu o formulario externo pelo link unico.",
        payload.nome,
      ),
    );

    appendAudit(
      "PREENCHER",
      "SOLICITACAO_ACESSO",
      solicitacao.id,
      `Formulario externo preenchido por ${payload.nome}`,
      payload.nome,
    );

    return {
      status: "ok",
      solicitacao,
      acesso,
      visitante,
    };
  });

  // ── ACESSOS ──
  app.get("/api/operacional/acessos", async () => {
    refreshExpiredSolicitacoes();
    return db.operacionalAcessos;
  });
  app.get("/api/operacional/acessos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.operacionalAcessos as any[]).find((a) => a.id === id);
    if (!item) return reply.status(404).send({ error: { message: "Acesso não encontrado." } });
    return item;
  });
  app.post("/api/operacional/acessos", async (req) => {
    const body = req.body as any;
    const rec = { ...body, id: nextId("ACS", (db.operacionalAcessos as any[]).length), criadoEm: new Date().toISOString(), ultimaAtualizacao: new Date().toISOString() };
    (db.operacionalAcessos as any[]).push(rec);
    appendAudit("CRIAR", "ACESSO", rec.id, "Acesso criado", (req as any).authUser?.nome ?? "system");
    return rec;
  });
  app.put("/api/operacional/acessos/:id/liberar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const idx = (db.operacionalAcessos as any[]).findIndex((a) => a.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Acesso não encontrado." } });
    (db.operacionalAcessos as any[])[idx] = { ...(db.operacionalAcessos as any[])[idx], status: "ENTRADA_LIBERADA", horarioReal: new Date().toISOString(), ultimaAtualizacao: new Date().toISOString() };
    appendAudit("LIBERAR", "ACESSO", id, "Entrada liberada", (req as any).authUser?.nome ?? "system");
    return (db.operacionalAcessos as any[])[idx];
  });
  app.put("/api/operacional/acessos/:id/saida", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const idx = (db.operacionalAcessos as any[]).findIndex((a) => a.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Acesso não encontrado." } });
    (db.operacionalAcessos as any[])[idx] = { ...(db.operacionalAcessos as any[])[idx], status: "SAIDA_REGISTRADA", horarioSaida: new Date().toISOString(), ultimaAtualizacao: new Date().toISOString() };
    appendAudit("SAIDA", "ACESSO", id, "Saída registrada", (req as any).authUser?.nome ?? "system");
    return (db.operacionalAcessos as any[])[idx];
  });

  // ── VISITANTES ──
  app.get("/api/operacional/visitantes", async () => {
    refreshExpiredSolicitacoes();
    return db.operacionalVisitantes;
  });
  app.get("/api/operacional/visitantes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.operacionalVisitantes as any[]).find((v) => v.id === id);
    if (!item) return reply.status(404).send({ error: { message: "Visitante não encontrado." } });
    return item;
  });
  app.post("/api/operacional/visitantes", async (req) => {
    const body = req.body as any;
    const rec = { ...body, id: nextId("VIS", (db.operacionalVisitantes as any[]).length), criadoEm: new Date().toISOString(), ultimaAtualizacao: new Date().toISOString() };
    (db.operacionalVisitantes as any[]).push(rec);
    appendAudit("CRIAR", "VISITANTE", rec.id, "Visitante criado", (req as any).authUser?.nome ?? "system");
    return rec;
  });
  app.put("/api/operacional/visitantes/:id/aprovar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const idx = (db.operacionalVisitantes as any[]).findIndex((v) => v.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Visitante não encontrado." } });
    (db.operacionalVisitantes as any[])[idx] = { ...(db.operacionalVisitantes as any[])[idx], status: "APROVADO", ultimaAtualizacao: new Date().toISOString() };
    appendAudit("APROVAR", "VISITANTE", id, "Visitante aprovado", (req as any).authUser?.nome ?? "system");
    return (db.operacionalVisitantes as any[])[idx];
  });

  // ── VEÍCULOS VISITANTES ──
  app.get("/api/operacional/veiculos-visitantes", async () => db.operacionalVeiculosVisitantes);

  // ── FROTA ──
  app.get("/api/operacional/frota", async () => db.operacionalFrota);
  app.get("/api/operacional/frota/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.operacionalFrota as any[]).find((v) => v.id === id);
    if (!item) return reply.status(404).send({ error: { message: "Veículo não encontrado." } });
    return item;
  });
  app.get("/api/operacional/frota/deslocamentos", async () => db.operacionalDeslocamentos);
  app.post("/api/operacional/frota/despacho", async (req) => {
    const body = req.body as any;
    const rec = { ...body, id: nextId("DSL", (db.operacionalDeslocamentos as any[]).length), status: "EM_ROTA", horarioSaida: new Date().toISOString() };
    (db.operacionalDeslocamentos as any[]).push(rec);
    appendAudit("DESPACHO", "FROTA", rec.id, "Despacho registrado", (req as any).authUser?.nome ?? "system");
    return rec;
  });
  app.put("/api/operacional/frota/:id/movimentacao", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = (db.operacionalFrota as any[]).findIndex((v) => v.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Veículo não encontrado." } });
    (db.operacionalFrota as any[])[idx] = {
      ...(db.operacionalFrota as any[])[idx],
      status: body.status || (db.operacionalFrota as any[])[idx].status,
      quilometragem: body.quilometragem ?? (db.operacionalFrota as any[])[idx].quilometragem,
      ultimaMovimentacao: new Date().toISOString(),
    };
    // Log movimentacao
    (db.operacionalMovimentacoesFrota as any[]).push({
      id: nextId("MOV", (db.operacionalMovimentacoesFrota as any[]).length),
      veiculoId: id,
      statusAnterior: "",
      statusNovo: body.status || "",
      descricao: body.observacao || "Movimentação registrada",
      dataHora: new Date().toISOString(),
      usuario: (req as any).authUser?.nome ?? "system",
      docaNome: body.docaId,
      km: body.quilometragem,
    });
    appendAudit("MOVIMENTACAO", "FROTA", id, `Status: ${body.status}`, (req as any).authUser?.nome ?? "system");
    return (db.operacionalFrota as any[])[idx];
  });
  app.get("/api/operacional/frota/movimentacoes", async () => db.operacionalMovimentacoesFrota);

  // ── TERCEIROS ──
  app.get("/api/operacional/transportadoras", async () => db.operacionalTransportadoras);
  app.get("/api/operacional/motoristas-terceiros", async () => db.operacionalMotoristasTerceiros);
  app.get("/api/operacional/veiculos-terceiros", async () => db.operacionalVeiculosTerceiros);
  app.get("/api/operacional/operacoes", async () => db.operacionalOperacoes);
  app.get("/api/operacional/agendamentos", async () => db.operacionalAgendamentos);

  // ── PÁTIO / DOCAS ──
  app.get("/api/operacional/docas", async () => db.operacionalDocas);
  app.get("/api/operacional/fila-patio", async () => db.operacionalFilaPatio);

  // ── MONITORAMENTO ──
  app.get("/api/operacional/alertas", async () => db.operacionalAlertas);
  app.get("/api/operacional/excecoes", async () => db.operacionalExcecoes);

  // ── DASHBOARD ──
  app.get("/api/operacional/dashboard", async () => db.operacionalDashboard);

  // ── NF TRÂNSITO ──
  app.get("/api/operacional/nf-transito", async () => db.operacionalNFsTransito);
  app.get("/api/operacional/nf-transito/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.operacionalNFsTransito as any[]).find((nf) => nf.id === id);
    if (!item) return reply.status(404).send({ error: { message: "NF não encontrada." } });
    return item;
  });
  app.get("/api/operacional/excecoes-fiscais", async () => db.operacionalExcecoesFiscais);
  app.put("/api/operacional/nf-transito/:id/confirmar-recebimento", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const idx = (db.operacionalNFsTransito as any[]).findIndex((nf) => nf.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "NF não encontrada." } });
    (db.operacionalNFsTransito as any[])[idx] = {
      ...(db.operacionalNFsTransito as any[])[idx],
      status: "RECEBIMENTO_CONFIRMADO",
      dataEntregaReal: new Date().toISOString(),
      criticidade: "VERDE",
      scoreRisco: 0,
    };
    appendAudit("CONFIRMAR_RECEBIMENTO", "NF_TRANSITO", id, "Recebimento confirmado", (req as any).authUser?.nome ?? "system");
    return (db.operacionalNFsTransito as any[])[idx];
  });

  // ── TIMELINE ──
  app.get("/api/operacional/timeline/:acessoId", async (req) => {
    const { acessoId } = z.object({ acessoId: z.string() }).parse(req.params);
    const timeline = (db.operacionalTimeline as any[]).filter(
      (item) => !item.acessoId || item.acessoId === acessoId,
    );
    return timeline;
  });
}
