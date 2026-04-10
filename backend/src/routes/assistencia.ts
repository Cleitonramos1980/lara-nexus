import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assistRepo } from "../repositories/sgqRepository.js";
import { getEstoquePlanta, getMateriais } from "../repositories/erpRepository.js";
import { optionalStringOrNumberAsString, optionalText, requiredText } from "../types/validators.js";

const numberFromInput = z.preprocess((value) => {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = Number(value.replace(",", "."));
    return Number.isFinite(normalized) ? normalized : value;
  }
  return value;
}, z.number().finite());

const positiveNumberFromInput = z.preprocess((value) => {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = Number(value.replace(",", "."));
    return Number.isFinite(normalized) ? normalized : value;
  }
  return value;
}, z.number().finite().positive());

const transitionMap: Record<string, { from: string[]; to: string | ((decisao?: string) => string) }> = {
  SUBMETER_PARA_RECEBIMENTO: { from: ["ABERTA"], to: "AGUARDANDO_RECEBIMENTO" },
  CONFIRMAR_RECEBIMENTO: { from: ["AGUARDANDO_RECEBIMENTO"], to: "RECEBIDO" },
  INICIAR_INSPECAO: { from: ["RECEBIDO"], to: "EM_INSPECAO" },
  FINALIZAR_INSPECAO: {
    from: ["EM_INSPECAO"],
    to: (decisao) => (decisao === "REPARAR" ? "AGUARDANDO_PECAS" : "AGUARDANDO_VALIDACAO"),
  },
  SOLICITAR_PECAS: { from: ["EM_INSPECAO"], to: "AGUARDANDO_PECAS" },
  INICIAR_REPARO: { from: ["AGUARDANDO_PECAS"], to: "EM_REPARO" },
  ENVIAR_PARA_VALIDACAO: { from: ["EM_REPARO"], to: "AGUARDANDO_VALIDACAO" },
  APROVAR_VALIDACAO: { from: ["AGUARDANDO_VALIDACAO"], to: "CONCLUIDA" },
  ENCERRAR_OS: { from: ["CONCLUIDA"], to: "ENCERRADA" },
  CANCELAR_OS: {
    from: ["ABERTA", "AGUARDANDO_RECEBIMENTO", "RECEBIDO", "EM_INSPECAO", "AGUARDANDO_PECAS", "EM_REPARO", "AGUARDANDO_VALIDACAO", "CONCLUIDA"],
    to: "CANCELADA",
  },
};

function toEstoqueView(materiais: any[], estoque: any[]) {
  return materiais.map((m) => {
    const get = (planta: string) => estoque.find((e) => e.codmat === m.codmat && e.planta === planta)?.qtdDisponivel ?? 0;
    return {
      codMaterial: m.codmat,
      descricao: m.descricao,
      un: m.un,
      categoria: m.categoria,
      estoqueMAO: get("MAO"),
      estoqueBEL: get("BEL"),
      estoqueAGR: get("AGR"),
    };
  });
}

export async function assistenciaRoutes(app: FastifyInstance) {
  app.get("/api/assistencia/dashboard", async () => assistRepo.dashboard());

  app.get("/api/assistencia/os", async () => assistRepo.listOS());
  app.get("/api/assistencia/os/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return assistRepo.getOS(id);
  });
  app.post("/api/assistencia/os", async (req) => {
    const body = z.object({
      origemTipo: requiredText,
      origemId: optionalText,
      codcli: requiredText,
      clienteNome: requiredText,
      numPedido: optionalStringOrNumberAsString,
      nfVenda: optionalStringOrNumberAsString,
      codprod: optionalStringOrNumberAsString,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      tipoOs: requiredText,
      status: requiredText,
      prioridade: requiredText,
      tecnicoResponsavel: requiredText,
      descricaoProblema: requiredText,
      laudoInspecao: optionalText,
      decisaoTecnica: optionalText,
      dataAbertura: requiredText,
      dataPrevista: requiredText,
      dataConclusao: optionalText,
      recebimentoConfirmado: z.boolean().optional(),
      relatorioReparo: optionalText,
      validacaoAprovada: z.boolean().optional(),
      mensagemEncerramento: optionalText,
    }).parse(req.body);
    return assistRepo.createOS(body as any);
  });

  app.put("/api/assistencia/os/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ status: z.string() }).parse(req.body);
    const os = assistRepo.updateStatusOS(id, body.status);
    if (!os) return reply.status(404).send({ error: { message: "OS não encontrada" } });
    return os;
  });

  app.post("/api/assistencia/os/:id/transition", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      event: z.string(),
      usuario: z.string(),
      perfil: z.string(),
      papel: z.string(),
      motivo: z.string().optional(),
      decisaoInspecao: z.string().optional(),
      detalhes: z.string().optional(),
    }).parse(req.body);

    const os = assistRepo.getOS(id);
    if (!os) return reply.status(404).send({ error: { message: "OS não encontrada" } });

    const t = transitionMap[body.event];
    if (!t) return reply.status(400).send({ error: { message: "Evento inválido" } });
    if (!t.from.includes(os.status)) {
      return reply.status(400).send({ error: { message: `Transição inválida: ${body.event} em ${os.status}` } });
    }

    const newStatus = typeof t.to === "function" ? t.to(body.decisaoInspecao) : t.to;
    assistRepo.updateStatusOS(id, newStatus);
    const log = assistRepo.appendTransition({
      osId: id,
      oldStatus: os.status,
      newStatus,
      usuario: body.usuario,
      perfil: body.perfil,
      papel: body.papel,
      planta: os.planta,
      motivo: body.motivo,
      detalhes: body.detalhes,
    });

    return { newStatus, log };
  });

  app.get("/api/assistencia/requisicoes", async () => assistRepo.listReq());
  app.get("/api/assistencia/requisicoes/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return assistRepo.getReq(id);
  });
  app.post("/api/assistencia/requisicoes", async (req) => {
    const body = z.object({
      osId: z.string(),
      cdResponsavel: z.enum(["MAO", "BEL", "AGR"]),
      plantaDestino: z.enum(["MAO", "BEL", "AGR"]),
      status: z.string(),
      prioridade: z.string().optional(),
      observacao: optionalText,
      criadoAt: z.string(),
      atualizadoAt: z.string(),
      itens: z.array(z.object({
        codMaterial: optionalStringOrNumberAsString,
        descricao: requiredText,
        un: requiredText,
        qtdSolicitada: positiveNumberFromInput,
        qtdAtendida: numberFromInput.optional(),
        qtdRecebida: numberFromInput.optional(),
        situacao: z.string().optional(),
        observacao: optionalText,
        observacaoAtendente: optionalText,
      })),
    }).parse(req.body);
    return assistRepo.createReq(body as any);
  });

  app.put("/api/assistencia/requisicoes/:id/status", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ status: z.string(), itens: z.array(z.any()).optional(), observacao: z.string().optional() }).parse(req.body);
    return assistRepo.updateReqStatus(id, body as any);
  });

  app.post("/api/assistencia/requisicoes/:id/receber", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      itensRecebidos: z.array(z.object({ codMaterial: z.string(), qtdRecebida: z.number() })),
      observacao: z.string().optional(),
    }).parse(req.body);
    const reqMat = assistRepo.getReq(id);
    if (!reqMat) return null;
    const itens = reqMat.itens.map((i) => {
      const r = body.itensRecebidos.find((it) => it.codMaterial === i.codMaterial);
      const qtdRecebida = r?.qtdRecebida ?? 0;
      return {
        ...i,
        qtdRecebida,
        qtdAtendida: qtdRecebida,
        situacao: qtdRecebida >= i.qtdSolicitada ? "ATENDIDO" : qtdRecebida > 0 ? "PARCIAL" : "INDISPONIVEL",
      };
    });
    return assistRepo.updateReqStatus(id, {
      status: "RECEBIDA_ASSISTENCIA",
      observacao: body.observacao,
      itens,
      atualizadoAt: new Date().toISOString().slice(0, 10),
    });
  });

  app.get("/api/assistencia/consumos", async () => assistRepo.listConsumo());
  app.get("/api/assistencia/consumos/:osId", async (req) => {
    const { osId } = z.object({ osId: z.string() }).parse(req.params);
    return assistRepo.listConsumoByOS(osId);
  });
  app.post("/api/assistencia/consumos", async (req) => {
    const body = z.object({
      osId: z.string(),
      reqId: z.string().optional(),
      codMaterial: z.string(),
      descricao: z.string(),
      un: z.string(),
      qtdConsumida: z.number(),
      tecnico: z.string(),
      dataConsumo: z.string(),
      observacao: z.string().optional(),
    }).parse(req.body);
    return assistRepo.createConsumo(body as any);
  });

  app.get("/api/assistencia/estoque", async () => {
    const materiais = await getMateriais({});
    const estoque = await getEstoquePlanta();
    return toEstoqueView(materiais, estoque);
  });

  app.get("/api/os-transition-log", async (req) => {
    const q = z.object({ osId: z.string().optional() }).parse(req.query);
    if (q.osId) return assistRepo.listTransitionByOS(q.osId);
    return assistRepo.listTransitionAll();
  });

  app.post("/api/os-transition-log", async (req) => {
    const body = z.object({
      osId: z.string(),
      oldStatus: z.string(),
      newStatus: z.string(),
      usuario: z.string(),
      perfil: z.string(),
      papel: z.string(),
      planta: z.string(),
      motivo: z.string().optional(),
      detalhes: z.string().optional(),
      timestamp: z.string().optional(),
    }).parse(req.body);
    return assistRepo.appendTransition(body);
  });
}


