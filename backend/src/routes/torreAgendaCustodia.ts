import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, nextId, appendAudit } from "../repositories/dataStore.js";

export async function torreAgendaCustodiaRoutes(app: FastifyInstance) {
  // ══════════════════════════════════════════════════
  // PHASE 1 — TORRE DE CONTROLE DE EXCEÇÕES
  // ══════════════════════════════════════════════════

  app.get("/api/operacional/torre-controle/excecoes", async () => db.torreExcecoes);

  app.get("/api/operacional/torre-controle/kpis", async () => {
    const list = db.torreExcecoes as any[];
    const active = list.filter((e: any) => e.status !== "RESOLVIDA" && e.status !== "ENCERRADA");
    return {
      totalAbertas: active.length,
      criticas: active.filter((e: any) => e.criticidade === "CRITICA").length,
      slaEstourado: active.filter((e: any) => e.prazo && new Date(e.prazo) < new Date()).length,
      semResponsavel: active.filter((e: any) => !e.responsavel).length,
      nfsEmRisco: active.filter((e: any) => e.categoria === "NF_TRANSITO").length,
      docasCongestionadas: active.filter((e: any) => e.categoria === "PATIO" && e.titulo?.includes("oca")).length,
      permanenciaFora: active.filter((e: any) => e.titulo?.toLowerCase().includes("permanência") || e.titulo?.toLowerCase().includes("permanencia")).length,
      pendenciasDocumentais: active.filter((e: any) => e.categoria === "DOCUMENTACAO" || e.categoria === "TRANSPORTADORA").length,
      transportadorasIrregulares: active.filter((e: any) => e.categoria === "TRANSPORTADORA").length,
      semTratativa: active.filter((e: any) => !e.tratativa).length,
      resolvidasHoje: list.filter((e: any) => e.status === "RESOLVIDA" && e.atualizadoEm?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      reincidentes: active.filter((e: any) => e.reincidencias > 0).length,
    };
  });

  app.get("/api/operacional/torre-controle/excecoes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.torreExcecoes as any[]).find((e) => e.id === id);
    if (!item) return reply.status(404).send({ error: { message: "Exceção não encontrada." } });
    return item;
  });

  app.put("/api/operacional/torre-controle/excecoes/:id/responsavel", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { responsavel } = req.body as any;
    const idx = (db.torreExcecoes as any[]).findIndex((e) => e.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Exceção não encontrada." } });
    const exc = (db.torreExcecoes as any[])[idx];
    exc.responsavel = responsavel;
    exc.atualizadoEm = new Date().toISOString();
    exc.historico.push({
      id: `H-${Date.now()}`, tipo: "ATRIBUICAO", descricao: `Responsável atribuído: ${responsavel}`,
      dataHora: new Date().toISOString(), usuario: (req as any).authUser?.nome ?? "system",
    });
    appendAudit("ATRIBUIR_RESPONSAVEL", "TORRE_EXCECAO", id, `Responsável: ${responsavel}`, (req as any).authUser?.nome ?? "system");
    return exc;
  });

  app.put("/api/operacional/torre-controle/excecoes/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status, justificativa } = req.body as any;
    const idx = (db.torreExcecoes as any[]).findIndex((e) => e.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Exceção não encontrada." } });
    const exc = (db.torreExcecoes as any[])[idx];
    const prev = exc.status;
    exc.status = status;
    exc.atualizadoEm = new Date().toISOString();
    if (justificativa) exc.justificativa = justificativa;
    exc.historico.push({
      id: `H-${Date.now()}`, tipo: "STATUS", descricao: `Status: ${prev} → ${status}${justificativa ? ` — ${justificativa}` : ""}`,
      dataHora: new Date().toISOString(), usuario: (req as any).authUser?.nome ?? "system",
    });
    appendAudit("MUDAR_STATUS", "TORRE_EXCECAO", id, `${prev} → ${status}`, (req as any).authUser?.nome ?? "system");
    return exc;
  });

  app.put("/api/operacional/torre-controle/excecoes/:id/tratativa", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { tratativa } = req.body as any;
    const idx = (db.torreExcecoes as any[]).findIndex((e) => e.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Exceção não encontrada." } });
    const exc = (db.torreExcecoes as any[])[idx];
    exc.tratativa = tratativa;
    exc.atualizadoEm = new Date().toISOString();
    if (exc.status === "ABERTA") exc.status = "EM_TRATATIVA";
    exc.historico.push({
      id: `H-${Date.now()}`, tipo: "TRATATIVA", descricao: `Tratativa: ${tratativa}`,
      dataHora: new Date().toISOString(), usuario: (req as any).authUser?.nome ?? "system",
    });
    appendAudit("REGISTRAR_TRATATIVA", "TORRE_EXCECAO", id, tratativa, (req as any).authUser?.nome ?? "system");
    return exc;
  });

  app.post("/api/operacional/torre-controle/excecoes", async (req) => {
    const body = req.body as any;
    const rec = {
      ...body,
      id: nextId("TOR", (db.torreExcecoes as any[]).length),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      historico: [{ id: `H-${Date.now()}`, tipo: "CRIACAO", descricao: "Exceção criada", dataHora: new Date().toISOString(), usuario: (req as any).authUser?.nome ?? "system" }],
      tags: body.tags || [],
      reincidencias: 0,
    };
    (db.torreExcecoes as any[]).push(rec);
    appendAudit("CRIAR", "TORRE_EXCECAO", rec.id, rec.titulo, (req as any).authUser?.nome ?? "system");
    return rec;
  });

  // ══════════════════════════════════════════════════
  // PHASE 2 — AGENDAMENTO INTELIGENTE DE DOCA / PÁTIO
  // ══════════════════════════════════════════════════

  app.get("/api/operacional/agendamentos-dock", async () => db.agendamentosSlots);
  app.get("/api/operacional/dock-capacity", async () => db.agendamentoDockCapacity);
  app.get("/api/operacional/agendamento-kpis", async () => {
    const list = db.agendamentosSlots as any[];
    const active = list.filter((s: any) => new Date(s.dataHoraPrevista).toDateString() === new Date().toDateString());
    return {
      taxaOcupacao: 32,
      tempoMedioEspera: 42,
      tempoMedioOperacao: 68,
      atrasosDia: active.filter((s: any) => s.status === "ATRASADO").length,
      dentroJanela: active.length > 0 ? Math.round(active.filter((s: any) => s.sla >= 80).length / active.length * 100) : 100,
      noShow: active.filter((s: any) => s.status === "NAO_COMPARECEU").length,
      remarcacoes: active.filter((s: any) => s.status === "REMARCADO").length,
      conflitoAgenda: 1,
      permanenciaMedia: 95,
      throughputDoca: 3.2,
    };
  });

  app.post("/api/operacional/agendamentos-dock", async (req) => {
    const body = req.body as any;
    const rec = {
      ...body,
      id: nextId("AGD", (db.agendamentosSlots as any[]).length),
      codigo: `AGD-${String((db.agendamentosSlots as any[]).length + 1).padStart(3, "0")}`,
      status: body.status || "AGENDADO",
      sla: 100,
      pendencias: body.pendencias || [],
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    (db.agendamentosSlots as any[]).push(rec);
    appendAudit("CRIAR", "AGENDAMENTO", rec.id, `Agendamento ${rec.codigo}`, (req as any).authUser?.nome ?? "system");
    return rec;
  });

  app.put("/api/operacional/agendamentos-dock/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = (db.agendamentosSlots as any[]).findIndex((s) => s.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Agendamento não encontrado." } });
    (db.agendamentosSlots as any[])[idx] = { ...(db.agendamentosSlots as any[])[idx], ...body, atualizadoEm: new Date().toISOString() };
    appendAudit("EDITAR", "AGENDAMENTO", id, `Status: ${body.status || "update"}`, (req as any).authUser?.nome ?? "system");
    return (db.agendamentosSlots as any[])[idx];
  });

  app.put("/api/operacional/agendamentos-dock/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status, observacao } = req.body as any;
    const idx = (db.agendamentosSlots as any[]).findIndex((s) => s.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Agendamento não encontrado." } });
    const slot = (db.agendamentosSlots as any[])[idx];
    slot.status = status;
    slot.atualizadoEm = new Date().toISOString();
    if (status === "CHEGOU" && !slot.dataHoraRealChegada) slot.dataHoraRealChegada = new Date().toISOString();
    if (observacao) slot.observacoes = (slot.observacoes ? slot.observacoes + "\n" : "") + observacao;
    appendAudit("STATUS_AGENDAMENTO", "AGENDAMENTO", id, `Status → ${status}`, (req as any).authUser?.nome ?? "system");

    // Generate torre exception for delays
    if (status === "ATRASADO" || status === "NAO_COMPARECEU") {
      const exc = {
        id: nextId("TOR", (db.torreExcecoes as any[]).length),
        titulo: status === "ATRASADO" ? `Atraso no agendamento ${slot.codigo}` : `No-show: ${slot.codigo}`,
        descricao: `${slot.transportadoraNome} — ${slot.tipoOperacao} na ${slot.docaPrevistaNome || "doca"}`,
        categoria: "PATIO", criticidade: status === "NAO_COMPARECEU" ? "ALTA" : "MEDIA",
        status: "ABERTA", origem: "Agendamento", origemId: id, origemRota: `/patio/agendamento/${id}`,
        criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
        prazo: new Date(Date.now() + 4 * 3600000).toISOString(), reincidencias: 0,
        acaoSugerida: status === "NAO_COMPARECEU" ? "Contatar transportadora" : "Verificar status do veículo",
        historico: [{ id: `H-${Date.now()}`, tipo: "CRIACAO", descricao: "Gerada automaticamente do agendamento", dataHora: new Date().toISOString(), usuario: "Sistema" }],
        tags: ["agendamento", status.toLowerCase()], planta: slot.planta || "MAO",
      };
      (db.torreExcecoes as any[]).push(exc);
    }

    return slot;
  });

  app.put("/api/operacional/agendamentos-dock/:id/doca", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { docaId, docaNome } = req.body as any;
    const idx = (db.agendamentosSlots as any[]).findIndex((s) => s.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Agendamento não encontrado." } });
    const slot = (db.agendamentosSlots as any[])[idx];
    slot.docaRealId = docaId;
    slot.docaRealNome = docaNome;
    slot.atualizadoEm = new Date().toISOString();
    appendAudit("ALOCAR_DOCA", "AGENDAMENTO", id, `Doca: ${docaNome}`, (req as any).authUser?.nome ?? "system");
    return slot;
  });

  // ══════════════════════════════════════════════════
  // PHASE 3 — CADEIA DE CUSTÓDIA DIGITAL
  // ══════════════════════════════════════════════════

  app.get("/api/operacional/custodia", async () => db.custodias);
  app.get("/api/operacional/custodia/kpis", async () => {
    const list = db.custodias as any[];
    const active = list.filter((c: any) => c.status !== "ENCERRADA");
    return {
      nfsEmTransito: active.filter((c: any) => ["EM_TRANSITO", "SAIU_PORTARIA", "EM_RISCO"].includes(c.status)).length,
      nfsEmRisco: active.filter((c: any) => c.status === "EM_RISCO" || c.scoreRisco > 50).length,
      nfsAtrasadas: active.filter((c: any) => c.diasEmTransito > 5).length,
      nfsSemConfirmacao: active.filter((c: any) => c.statusAceite === "PENDENTE").length,
      nfsComDivergencia: active.filter((c: any) => c.divergencia).length,
      entregasComRessalva: list.filter((c: any) => c.status === "ENTREGUE_COM_RESSALVA").length,
      devolucoes: list.filter((c: any) => c.status === "DEVOLVIDA").length,
      leadTimeMedio: active.length > 0 ? +(active.reduce((s: number, c: any) => s + c.diasEmTransito, 0) / active.length).toFixed(1) : 0,
      slaRota: 68,
      envelhecimentoMedio: active.length > 0 ? +(active.reduce((s: number, c: any) => s + c.diasEmTransito, 0) / active.length).toFixed(1) : 0,
    };
  });

  app.get("/api/operacional/custodia/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = (db.custodias as any[]).find((c) => c.id === id);
    if (!item) return reply.status(404).send({ error: { message: "Custódia não encontrada." } });
    return item;
  });

  app.post("/api/operacional/custodia/:id/evento", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = (db.custodias as any[]).findIndex((c) => c.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Custódia não encontrada." } });
    const cust = (db.custodias as any[])[idx];
    const evento = {
      id: `CE-${Date.now()}`,
      etapa: body.etapa,
      descricao: body.descricao,
      dataHora: new Date().toISOString(),
      localizacao: body.localizacao,
      responsavel: (req as any).authUser?.nome ?? body.responsavel ?? "system",
      tipo: body.tipo,
    };
    cust.eventos.push(evento);
    cust.atualizadoEm = new Date().toISOString();

    // Update status based on event type
    const statusMap: Record<string, string> = {
      CHEGADA: "CHEGADA_REGISTRADA", ENTREGA: "ENTREGUE",
      DEVOLUCAO: "DEVOLVIDA", ENCERRAMENTO: "ENCERRADA",
    };
    if (statusMap[body.tipo]) cust.status = statusMap[body.tipo];
    if (body.tipo === "CHEGADA") cust.dataChegadaDestino = new Date().toISOString();
    if (body.tipo === "ENTREGA") cust.dataEntrega = new Date().toISOString();

    appendAudit("EVENTO_CUSTODIA", "CUSTODIA", id, `${body.tipo}: ${body.descricao}`, (req as any).authUser?.nome ?? "system");

    // Generate torre exception for critical events
    if (body.tipo === "DIVERGENCIA" || body.tipo === "DEVOLUCAO") {
      const exc = {
        id: nextId("TOR", (db.torreExcecoes as any[]).length),
        titulo: body.tipo === "DEVOLUCAO" ? `Devolução: ${cust.nfNumero}` : `Divergência: ${cust.nfNumero}`,
        descricao: body.descricao,
        categoria: "NF_TRANSITO", criticidade: body.tipo === "DEVOLUCAO" ? "CRITICA" : "ALTA",
        status: "ABERTA", origem: "Custódia", origemId: id, origemRota: `/custodia/${id}`,
        criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
        prazo: new Date(Date.now() + 8 * 3600000).toISOString(), reincidencias: 0,
        historico: [{ id: `H-${Date.now()}`, tipo: "CRIACAO", descricao: "Gerada pela cadeia de custódia", dataHora: new Date().toISOString(), usuario: "Sistema" }],
        tags: ["custodia", body.tipo.toLowerCase()], planta: cust.planta || "MAO",
      };
      (db.torreExcecoes as any[]).push(exc);
    }

    return cust;
  });

  app.post("/api/operacional/custodia/:id/evidencia", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = (db.custodias as any[]).findIndex((c) => c.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Custódia não encontrada." } });
    const cust = (db.custodias as any[])[idx];
    const ev = {
      id: `EV-${Date.now()}`,
      tipo: body.tipo,
      descricao: body.descricao,
      dataHora: new Date().toISOString(),
      responsavel: (req as any).authUser?.nome ?? body.responsavel ?? "system",
      observacao: body.observacao,
      url: body.url,
      categoria: body.categoria,
      etapaRelacionada: body.etapaRelacionada,
      nomeArquivo: body.nomeArquivo,
      mimeType: body.mimeType,
      tamanhoArquivo: body.tamanhoArquivo,
    };
    cust.evidencias.push(ev);
    appendAudit("EVIDENCIA_CUSTODIA", "CUSTODIA", id, `${body.tipo}: ${body.descricao}`, (req as any).authUser?.nome ?? "system");
    return cust;
  });

  app.put("/api/operacional/custodia/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status, recebedorNome, statusAceite, divergencia } = req.body as any;
    const idx = (db.custodias as any[]).findIndex((c) => c.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Custódia não encontrada." } });
    const cust = (db.custodias as any[])[idx];
    cust.status = status;
    if (recebedorNome) cust.recebedorNome = recebedorNome;
    if (statusAceite) cust.statusAceite = statusAceite;
    if (divergencia) cust.divergencia = divergencia;
    if (status === "ENTREGUE" || status === "ENTREGUE_COM_RESSALVA") {
      cust.dataEntrega = new Date().toISOString();
      cust.scoreRisco = 0;
    }
    appendAudit("STATUS_CUSTODIA", "CUSTODIA", id, `Status → ${status}`, (req as any).authUser?.nome ?? "system");
    return cust;
  });
}
