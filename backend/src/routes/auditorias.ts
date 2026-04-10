import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditoriaRepo } from "../repositories/sgqRepository.js";

export async function auditoriasRoutes(app: FastifyInstance) {
  const requiredText = z.preprocess((value) => (value == null ? "" : String(value).trim()), z.string().min(1));
  const optionalText = z.preprocess((value) => {
    if (value == null) return undefined;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
  }, z.string().optional());

  app.get("/api/auditorias", async () => auditoriaRepo.list());
  app.post("/api/auditorias", async (req) => {
    const body = z.object({
      tplId: optionalText,
      tplNome: requiredText,
      tipoAuditoria: optionalText,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      local: requiredText,
      auditor: requiredText,
      escopo: optionalText,
      status: requiredText,
      startedAt: requiredText,
      finishedAt: optionalText,
    }).parse(req.body);
    return auditoriaRepo.create(body as any);
  });

  app.get("/api/auditorias/templates", async () => auditoriaRepo.templates());
  app.get("/api/auditorias/templates/:tplId/items", async (req) => {
    const { tplId } = z.object({ tplId: z.string() }).parse(req.params);
    return auditoriaRepo.templateItems(tplId).map((descricao, idx) => ({ id: `${tplId}-${idx + 1}`, descricao }));
  });
}
