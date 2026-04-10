import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { governancaQualidadeRepo } from "../repositories/sgqRepository.js";
import { optionalText, requiredText } from "../types/validators.js";

const finiteNumber = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().finite());

const optionalFiniteNumber = z.preprocess((value) => {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().finite().optional());

export async function governancaQualidadeRoutes(app: FastifyInstance) {
  app.get("/api/qualidade/documentos", async () => governancaQualidadeRepo.listDocumentos());
  app.post("/api/qualidade/documentos", async (req) => {
    const body = z.object({
      codigo: requiredText,
      titulo: requiredText,
      tipo: requiredText,
      status: requiredText,
      versaoAtual: requiredText,
      responsavel: requiredText,
      setor: requiredText,
      validadeAt: optionalText,
      aprovadoPor: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createDocumento(body);
  });
  app.put("/api/qualidade/documentos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      codigo: z.string().optional(),
      titulo: z.string().optional(),
      tipo: z.string().optional(),
      status: z.string().optional(),
      versaoAtual: z.string().optional(),
      responsavel: z.string().optional(),
      setor: z.string().optional(),
      validadeAt: z.string().optional(),
      aprovadoPor: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateDocumento(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "Documento nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/treinamentos", async () => governancaQualidadeRepo.listTreinamentos());
  app.post("/api/qualidade/treinamentos", async (req) => {
    const body = z.object({
      titulo: requiredText,
      tipo: requiredText,
      cargoAlvo: requiredText,
      instrutor: requiredText,
      cargaHoraria: finiteNumber,
      status: requiredText,
      dataPlanejada: requiredText,
      dataRealizacao: optionalText,
      validadeMeses: optionalFiniteNumber,
      observacoes: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createTreinamento(body);
  });
  app.put("/api/qualidade/treinamentos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      titulo: z.string().optional(),
      tipo: z.string().optional(),
      cargoAlvo: z.string().optional(),
      instrutor: z.string().optional(),
      cargaHoraria: optionalFiniteNumber,
      status: z.string().optional(),
      dataPlanejada: z.string().optional(),
      dataRealizacao: z.string().optional(),
      validadeMeses: optionalFiniteNumber,
      observacoes: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateTreinamento(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "Treinamento nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/treinamentos/participantes", async (req) => {
    const q = z.object({ treinamentoId: z.string().optional() }).parse(req.query);
    return governancaQualidadeRepo.listParticipantes(q.treinamentoId);
  });
  app.post("/api/qualidade/treinamentos/participantes", async (req) => {
    const body = z.object({
      treinamentoId: requiredText,
      colaborador: requiredText,
      cargo: requiredText,
      resultado: requiredText,
      status: requiredText,
      concluidoAt: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.addParticipante(body);
  });
  app.put("/api/qualidade/treinamentos/participantes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      colaborador: z.string().optional(),
      cargo: z.string().optional(),
      resultado: z.string().optional(),
      status: z.string().optional(),
      concluidoAt: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateParticipante(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "Participante nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/mudancas", async () => governancaQualidadeRepo.listMudancas());
  app.post("/api/qualidade/mudancas", async (req) => {
    const body = z.object({
      titulo: requiredText,
      descricao: requiredText,
      tipo: requiredText,
      area: requiredText,
      solicitante: requiredText,
      risco: requiredText,
      status: requiredText,
      dataSolicitacao: requiredText,
      dataImplementacao: optionalText,
      aprovador: optionalText,
      planoValidacao: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createMudanca(body);
  });
  app.put("/api/qualidade/mudancas/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      titulo: z.string().optional(),
      descricao: z.string().optional(),
      tipo: z.string().optional(),
      area: z.string().optional(),
      solicitante: z.string().optional(),
      risco: z.string().optional(),
      status: z.string().optional(),
      dataSolicitacao: z.string().optional(),
      dataImplementacao: z.string().optional(),
      aprovador: z.string().optional(),
      planoValidacao: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateMudanca(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "Mudanca nao encontrada" } });
    return updated;
  });

  app.get("/api/qualidade/fornecedores", async () => governancaQualidadeRepo.listFornecedores());
  app.post("/api/qualidade/fornecedores", async (req) => {
    const body = z.object({
      codigo: requiredText,
      nome: requiredText,
      categoria: requiredText,
      status: requiredText,
      score: finiteNumber,
      ultimaAvaliacaoAt: optionalText,
      responsavel: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createFornecedor(body);
  });
  app.put("/api/qualidade/fornecedores/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      codigo: z.string().optional(),
      nome: z.string().optional(),
      categoria: z.string().optional(),
      status: z.string().optional(),
      score: optionalFiniteNumber,
      ultimaAvaliacaoAt: z.string().optional(),
      responsavel: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateFornecedor(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "Fornecedor nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/scar", async (req) => {
    const q = z.object({ fornecedorId: z.string().optional() }).parse(req.query);
    return governancaQualidadeRepo.listScars(q.fornecedorId);
  });
  app.post("/api/qualidade/scar", async (req) => {
    const body = z.object({
      fornecedorId: requiredText,
      titulo: requiredText,
      descricao: requiredText,
      status: requiredText,
      gravidade: requiredText,
      responsavel: requiredText,
      prazo: requiredText,
      dataAbertura: requiredText,
      dataFechamento: optionalText,
      acaoCorretiva: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createScar(body);
  });
  app.put("/api/qualidade/scar/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      titulo: z.string().optional(),
      descricao: z.string().optional(),
      status: z.string().optional(),
      gravidade: z.string().optional(),
      responsavel: z.string().optional(),
      prazo: z.string().optional(),
      dataAbertura: z.string().optional(),
      dataFechamento: z.string().optional(),
      acaoCorretiva: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateScar(id, body);
    if (!updated) return reply.status(404).send({ error: { message: "SCAR nao encontrada" } });
    return updated;
  });

  app.get("/api/qualidade/metrologia/instrumentos", async () => governancaQualidadeRepo.listInstrumentosMetrologia());
  app.post("/api/qualidade/metrologia/instrumentos", async (req) => {
    const body = z.object({
      codigo: requiredText,
      descricao: requiredText,
      tipo: requiredText,
      fabricante: optionalText,
      numeroSerie: optionalText,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      local: requiredText,
      statusCalibracao: requiredText,
      ultimaCalibracaoAt: optionalText,
      proximaCalibracaoAt: requiredText,
      incerteza: optionalFiniteNumber,
      responsavel: requiredText,
    }).parse(req.body);
    return governancaQualidadeRepo.createInstrumentoMetrologia(body as any);
  });
  app.put("/api/qualidade/metrologia/instrumentos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      codigo: z.string().optional(),
      descricao: z.string().optional(),
      tipo: z.string().optional(),
      fabricante: z.string().optional(),
      numeroSerie: z.string().optional(),
      planta: z.enum(["MAO", "BEL", "AGR"]).optional(),
      local: z.string().optional(),
      statusCalibracao: z.string().optional(),
      ultimaCalibracaoAt: z.string().optional(),
      proximaCalibracaoAt: z.string().optional(),
      incerteza: optionalFiniteNumber,
      responsavel: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateInstrumentoMetrologia(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Instrumento nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/metrologia/msa", async (req) => {
    const q = z.object({ instrumentoId: z.string().optional() }).parse(req.query);
    return governancaQualidadeRepo.listEstudosMsa(q.instrumentoId);
  });
  app.post("/api/qualidade/metrologia/msa", async (req) => {
    const body = z.object({
      instrumentoId: requiredText,
      caracteristica: requiredText,
      metodo: requiredText,
      rrPercent: finiteNumber,
      ndc: finiteNumber,
      resultado: requiredText,
      estudadoAt: requiredText,
      responsavel: requiredText,
      observacoes: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createEstudoMsa(body as any);
  });
  app.put("/api/qualidade/metrologia/msa/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      instrumentoId: z.string().optional(),
      caracteristica: z.string().optional(),
      metodo: z.string().optional(),
      rrPercent: optionalFiniteNumber,
      ndc: optionalFiniteNumber,
      resultado: z.string().optional(),
      estudadoAt: z.string().optional(),
      responsavel: z.string().optional(),
      observacoes: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateEstudoMsa(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Estudo MSA nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/kpis-industriais", async (req) => {
    const q = z.object({
      planta: z.enum(["MAO", "BEL", "AGR"]).optional(),
      linha: z.string().optional(),
    }).parse(req.query);
    return governancaQualidadeRepo.listIndicadoresIndustriais(q);
  });
  app.get("/api/qualidade/kpis-industriais/resumo", async (req) => {
    const q = z.object({
      planta: z.enum(["MAO", "BEL", "AGR"]).optional(),
      linha: z.string().optional(),
    }).parse(req.query);
    return governancaQualidadeRepo.resumoIndicadoresIndustriais(q);
  });
  app.post("/api/qualidade/kpis-industriais", async (req) => {
    const body = z.object({
      data: requiredText,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      linha: requiredText,
      oee: finiteNumber,
      fpy: finiteNumber,
      scrapRate: finiteNumber,
      reworkRate: finiteNumber,
      mtbfHoras: finiteNumber,
      mttrHoras: finiteNumber,
      paradasNaoPlanejadas: optionalFiniteNumber,
      fonte: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createIndicadorIndustrial(body as any);
  });
  app.put("/api/qualidade/kpis-industriais/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      data: z.string().optional(),
      planta: z.enum(["MAO", "BEL", "AGR"]).optional(),
      linha: z.string().optional(),
      oee: optionalFiniteNumber,
      fpy: optionalFiniteNumber,
      scrapRate: optionalFiniteNumber,
      reworkRate: optionalFiniteNumber,
      mtbfHoras: optionalFiniteNumber,
      mttrHoras: optionalFiniteNumber,
      paradasNaoPlanejadas: optionalFiniteNumber,
      fonte: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateIndicadorIndustrial(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Indicador nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/risco-sla/regras", async (req) => {
    const q = z.object({ origemTipo: z.string().optional() }).parse(req.query);
    return governancaQualidadeRepo.listRegrasRiscoSla(q.origemTipo);
  });
  app.post("/api/qualidade/risco-sla/regras", async (req) => {
    const body = z.object({
      origemTipo: requiredText,
      criticidade: requiredText,
      pontuacaoMin: finiteNumber,
      pontuacaoMax: finiteNumber,
      slaHoras: finiteNumber,
      resposta: requiredText,
    }).parse(req.body);
    return governancaQualidadeRepo.createRegraRiscoSla(body as any);
  });
  app.put("/api/qualidade/risco-sla/regras/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      origemTipo: z.string().optional(),
      criticidade: z.string().optional(),
      pontuacaoMin: optionalFiniteNumber,
      pontuacaoMax: optionalFiniteNumber,
      slaHoras: optionalFiniteNumber,
      resposta: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateRegraRiscoSla(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Regra de risco/SLA nao encontrada" } });
    return updated;
  });

  app.get("/api/qualidade/risco-sla/avaliacoes", async (req) => {
    const q = z.object({
      origemTipo: z.string().optional(),
      refreshStatus: z.preprocess((value) => String(value ?? "").toLowerCase(), z.enum(["", "1", "true"]).optional()),
    }).parse(req.query);
    if (q.refreshStatus === "1" || q.refreshStatus === "true") {
      governancaQualidadeRepo.refreshAvaliacoesRiscoSlaStatus();
    }
    return governancaQualidadeRepo.listAvaliacoesRiscoSla(q.origemTipo);
  });
  app.post("/api/qualidade/risco-sla/avaliacoes", async (req) => {
    const body = z.object({
      origemTipo: requiredText,
      origemId: requiredText,
      criticidade: requiredText,
      impacto: finiteNumber,
      recorrencia: finiteNumber,
      detectabilidade: finiteNumber,
      justificativa: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createAvaliacaoRiscoSla(body as any);
  });

  app.get("/api/qualidade/auditorias-camadas", async () => governancaQualidadeRepo.listAuditoriasCamadas());
  app.post("/api/qualidade/auditorias-camadas", async (req) => {
    const body = z.object({
      camada: requiredText,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      area: requiredText,
      processo: requiredText,
      auditor: requiredText,
      frequencia: requiredText,
      status: requiredText,
      proximaExecucaoAt: requiredText,
      ultimaExecucaoAt: optionalText,
      score: optionalFiniteNumber,
      achados: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createAuditoriaCamada(body as any);
  });
  app.put("/api/qualidade/auditorias-camadas/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      camada: z.string().optional(),
      planta: z.enum(["MAO", "BEL", "AGR"]).optional(),
      area: z.string().optional(),
      processo: z.string().optional(),
      auditor: z.string().optional(),
      frequencia: z.string().optional(),
      status: z.string().optional(),
      proximaExecucaoAt: z.string().optional(),
      ultimaExecucaoAt: z.string().optional(),
      score: optionalFiniteNumber,
      achados: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateAuditoriaCamada(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Auditoria em camada nao encontrada" } });
    return updated;
  });

  app.get("/api/qualidade/fornecedores/gates", async (req) => {
    const q = z.object({ fornecedorId: z.string().optional() }).parse(req.query);
    return governancaQualidadeRepo.listGatesFornecedores(q.fornecedorId);
  });
  app.post("/api/qualidade/fornecedores/gates", async (req) => {
    const body = z.object({
      fornecedorId: requiredText,
      coreTool: requiredText,
      status: requiredText,
      evidencia: optionalText,
      validadoPor: optionalText,
      validadoAt: optionalText,
      observacoes: optionalText,
    }).parse(req.body);
    return governancaQualidadeRepo.createGateFornecedor(body as any);
  });
  app.put("/api/qualidade/fornecedores/gates/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      coreTool: z.string().optional(),
      status: z.string().optional(),
      evidencia: z.string().optional(),
      validadoPor: z.string().optional(),
      validadoAt: z.string().optional(),
      observacoes: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateGateFornecedor(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Gate de fornecedor nao encontrado" } });
    return updated;
  });

  app.get("/api/qualidade/iso9001/readiness", async () => governancaQualidadeRepo.listIsoReadiness());
  app.get("/api/qualidade/iso9001/readiness/resumo", async () => governancaQualidadeRepo.resumoIsoReadiness());
  app.post("/api/qualidade/iso9001/readiness", async (req) => {
    const body = z.object({
      clausula: requiredText,
      titulo: requiredText,
      status: requiredText,
      responsavel: requiredText,
      prazo: requiredText,
      evidencia: optionalText,
      ultimaRevisaoAt: optionalText,
      risco: requiredText,
    }).parse(req.body);
    return governancaQualidadeRepo.createIsoReadiness(body as any);
  });
  app.put("/api/qualidade/iso9001/readiness/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      clausula: z.string().optional(),
      titulo: z.string().optional(),
      status: z.string().optional(),
      responsavel: z.string().optional(),
      prazo: z.string().optional(),
      evidencia: z.string().optional(),
      ultimaRevisaoAt: z.string().optional(),
      risco: z.string().optional(),
    }).parse(req.body);
    const updated = governancaQualidadeRepo.updateIsoReadiness(id, body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Item ISO readiness nao encontrado" } });
    return updated;
  });
}
