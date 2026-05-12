import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as repo from "../repositories/inspecoes/oracleInspecoesRepository.js";

export async function inspecoesRoutes(app: FastifyInstance) {
  // ── Modelos ──
  app.get("/api/inspecoes/modelos", async () => repo.listModelos());

  app.get("/api/inspecoes/modelos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = await repo.getModeloById(id);
    if (!item) return reply.status(404).send({ error: { message: "Modelo não encontrado" } });
    return item;
  });

  app.post("/api/inspecoes/modelos", async (req) => {
    return repo.createModelo(req.body as any);
  });

  app.put("/api/inspecoes/modelos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const updated = await repo.updateModelo(id, req.body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Modelo não encontrado" } });
    return updated;
  });

  // ── Execuções ──
  app.get("/api/inspecoes/execucoes", async () => repo.listExecucoes());

  app.get("/api/inspecoes/execucoes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = await repo.getExecucaoById(id);
    if (!item) return reply.status(404).send({ error: { message: "Execução não encontrada" } });
    return item;
  });

  app.post("/api/inspecoes/execucoes", async (req) => {
    return repo.createExecucao(req.body as any);
  });

  // ── Tipos NC ──
  app.get("/api/inspecoes/tipos-nc", async () => repo.listTiposNc());

  app.post("/api/inspecoes/tipos-nc", async (req) => {
    return repo.createTipoNc(req.body as any);
  });

  app.put("/api/inspecoes/tipos-nc/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const updated = await repo.updateTipoNc(id, req.body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Tipo NC não encontrado" } });
    return updated;
  });

  // ── Padrões de Mola ──
  app.get("/api/inspecoes/molas/padroes", async () => repo.listPadroesMola());

  app.post("/api/inspecoes/molas/padroes", async (req) => {
    return repo.createPadraoMola(req.body as any);
  });

  app.put("/api/inspecoes/molas/padroes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const updated = await repo.updatePadraoMola(id, req.body as any);
    if (!updated) return reply.status(404).send({ error: { message: "Padrão não encontrado" } });
    return updated;
  });

  // ── Inspeções de Mola ──
  app.get("/api/inspecoes/molas", async () => repo.listInspecoesMola());

  app.get("/api/inspecoes/molas/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const item = await repo.getInspecaoMolaById(id);
    if (!item) return reply.status(404).send({ error: { message: "Inspeção de mola não encontrada" } });
    return item;
  });

  app.post("/api/inspecoes/molas", async (req) => {
    return repo.createInspecaoMola(req.body as any);
  });

  // ── Máquinas de Mola ──
  app.get("/api/inspecoes/molas/maquinas", async () => repo.listMaquinasMola());

  // ── Setores ──
  app.get("/api/inspecoes/setores", async () => repo.listSetores());

  // ── Usuário-Setor mapping ──
  app.get("/api/inspecoes/usuario-setor", async () => repo.listUsuarioSetor());

  app.get("/api/inspecoes/usuario-setor/:userId", async (req) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.params);
    const { perfil } = (req.query as any) ?? {};
    return repo.getSetoresByUserId(userId, perfil);
  });

  app.post("/api/inspecoes/usuario-setor", async (req) => {
    return repo.addUsuarioSetor(req.body as any);
  });

  app.delete("/api/inspecoes/usuario-setor/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const removed = await repo.removeUsuarioSetor(id);
    if (!removed) return reply.status(404).send({ error: { message: "Mapeamento não encontrado" } });
    return { ok: true };
  });
}
