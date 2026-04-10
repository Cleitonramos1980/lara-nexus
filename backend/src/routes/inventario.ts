import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { inventarioRepository } from "../repositories/inventario/inventarioRepository.js";

function actorFromReq(req: any): { userId?: string; userName?: string; profile?: string } {
  return {
    userId: req?.authUser?.sub ? String(req.authUser.sub) : undefined,
    userName: req?.authUser?.nome ? String(req.authUser.nome) : undefined,
    profile: req?.authUser?.perfil ? String(req.authUser.perfil) : undefined,
  };
}

function sendError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Erro interno no modulo de inventario.";
  const statusCode = Number((error as any)?.statusCode ?? 500);
  return reply.status(statusCode).send({ error: { message } });
}

const contagemBodySchema = z.object({
  id: z.string().optional(),
  numero: z.string().optional(),
  tarefaId: z.string().optional(),
  data: z.string().optional(),
  lojaId: z.string().min(1),
  departamentoId: z.string().min(1),
  frequencia: z.string().optional(),
  responsavel: z.string().optional(),
  status: z.string().optional(),
  itens: z.array(z.any()).optional(),
});

const checklistCreateSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(3),
  unidade: z.string().min(1),
  dataPrevistaInventario: z.string().optional(),
  dataPrevista: z.string().optional(),
  tipoInventario: z.string().optional(),
  tipo: z.string().optional(),
  responsavelGeral: z.string().optional(),
  responsavel: z.string().optional(),
  observacoes: z.string().optional(),
});

const checklistUpdateSchema = z.object({
  nome: z.string().optional(),
  unidade: z.string().optional(),
  dataPrevistaInventario: z.string().optional(),
  tipoInventario: z.string().optional(),
  responsavelGeral: z.string().optional(),
  statusGeral: z.enum(["ABERTO", "EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"]).optional(),
  observacoes: z.string().optional(),
  bloquearConclusaoPorNc: z.boolean().optional(),
});

const checklistItemUpdateSchema = z.object({
  status: z.enum(["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO", "CANCELADO", "NAO_APLICAVEL"]).optional(),
  responsavel: z.string().optional(),
  data: z.string().optional(),
  setor: z.string().optional(),
  criticidade: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
  evidencia: z.string().optional(),
  evidenciaResumo: z.string().optional(),
  nc: z.boolean().optional(),
  planoAcao: z.string().optional(),
  observacao: z.string().optional(),
});

const checklistEvidenceSchema = z.object({
  nomeArquivo: z.string().optional(),
  caminho: z.string().optional(),
  mimeType: z.string().optional(),
  tamanho: z.number().optional(),
  descricao: z.string().optional(),
});

export async function inventarioRoutes(app: FastifyInstance) {
  app.get("/api/inventario/lojas", async (req, reply) => {
    try {
      return await inventarioRepository.listLojas();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/departamentos", async (_req, reply) => {
    try {
      return await inventarioRepository.listDepartamentos();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/frequencias", async (_req, reply) => {
    try {
      return await inventarioRepository.listFrequencias();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/tarefas", async (_req, reply) => {
    try {
      return await inventarioRepository.listTarefas();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/contagens", async (_req, reply) => {
    try {
      return await inventarioRepository.listContagens();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/contagens/:id", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const contagem = await inventarioRepository.getContagemById(id);
      if (!contagem) return reply.status(404).send({ error: { message: "Contagem nao encontrada." } });
      return contagem;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/inventario/contagens", async (req, reply) => {
    try {
      const body = contagemBodySchema.parse(req.body);
      return await inventarioRepository.createContagem(body, actorFromReq(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/inventario/contagens/:id", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({}).passthrough().parse(req.body);
      const updated = await inventarioRepository.updateContagem(id, body, actorFromReq(req));
      if (!updated) return reply.status(404).send({ error: { message: "Contagem nao encontrada." } });
      return updated;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/inventario/contagens/:id/validar", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ validadoPor: z.string().min(1) }).parse(req.body);
      const updated = await inventarioRepository.validarContagem(id, body.validadoPor, actorFromReq(req));
      if (!updated) return reply.status(404).send({ error: { message: "Contagem nao encontrada." } });
      return updated;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/inventario/contagens/:id/recontagem", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ solicitadoPor: z.string().min(1) }).parse(req.body);
      const updated = await inventarioRepository.solicitarRecontagem(id, body.solicitadoPor, actorFromReq(req));
      if (!updated) return reply.status(404).send({ error: { message: "Contagem nao encontrada." } });
      return updated;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/divergencias", async (_req, reply) => {
    try {
      return await inventarioRepository.listDivergencias();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/dashboard", async (_req, reply) => {
    try {
      return await inventarioRepository.getDashboard();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/checklists/dashboard", async (_req, reply) => {
    try {
      return await inventarioRepository.getChecklistDashboard();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/checklists", async (_req, reply) => {
    try {
      return await inventarioRepository.listChecklists();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/inventario/checklists", async (req, reply) => {
    try {
      const body = checklistCreateSchema.parse(req.body);
      return await inventarioRepository.createChecklist(body, actorFromReq(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/inventario/checklists/:id", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = checklistUpdateSchema.parse(req.body);
      const updated = await inventarioRepository.updateChecklist(id, body, actorFromReq(req));
      if (!updated) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
      return updated;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/api/inventario/checklists/:id", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const deleted = await inventarioRepository.deleteChecklist(id, actorFromReq(req));
      if (!deleted) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/inventario/checklists/:checklistId/itens/:itemId", async (req, reply) => {
    try {
      const { checklistId, itemId } = z.object({
        checklistId: z.string(),
        itemId: z.string(),
      }).parse(req.params);
      const body = checklistItemUpdateSchema.parse(req.body);
      const updated = await inventarioRepository.updateChecklistItem(checklistId, itemId, body, actorFromReq(req));
      if (!updated) return reply.status(404).send({ error: { message: "Item de checklist nao encontrado." } });
      return updated;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/checklists/:checklistId/itens/:itemId/historico", async (req, reply) => {
    try {
      const { checklistId, itemId } = z.object({
        checklistId: z.string(),
        itemId: z.string(),
      }).parse(req.params);
      return await inventarioRepository.listChecklistItemHistorico(checklistId, itemId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/inventario/checklists/:checklistId/itens/:itemId/evidencias", async (req, reply) => {
    try {
      const { checklistId, itemId } = z.object({
        checklistId: z.string(),
        itemId: z.string(),
      }).parse(req.params);
      const body = checklistEvidenceSchema.parse(req.body);
      return await inventarioRepository.addChecklistItemEvidence(checklistId, itemId, body, actorFromReq(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/inventario/checklists/:id", async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const checklist = await inventarioRepository.getChecklistById(id);
      if (!checklist) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
      return checklist;
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

