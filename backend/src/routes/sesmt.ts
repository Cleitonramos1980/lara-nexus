import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sesmtRepo } from "../repositories/sesmtRepository.js";
import type { SesmtAttachment } from "../types/sesmt.js";

const allowedAttachmentExt = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
]);
const allowedAttachmentMime = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

function isAllowedAttachment(fileName: string): boolean {
  return allowedAttachmentExt.has(path.extname(fileName || "").toLowerCase());
}

function isAllowedAttachmentMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  if (allowedAttachmentMime.has(normalized)) return true;
  if (normalized.startsWith("image/")) return true;
  return false;
}

type AuthenticatedRequest = FastifyRequest & {
  authUser?: {
    perfil?: string;
    sub?: string;
    nome?: string;
  };
};

function authContext(req: AuthenticatedRequest) {
  return {
    profile: String(req?.authUser?.perfil || "AUDITOR"),
    userId: String(req?.authUser?.sub || "anonymous"),
    userName: String(req?.authUser?.nome || "system"),
  };
}

function sendHandledError(reply: FastifyReply, error: unknown) {
  const statusCode = Number(
    typeof error === "object" && error && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : 500,
  );
  const message = error instanceof Error ? error.message : "Erro interno no modulo SESMT/SST.";
  return reply.status(statusCode).send({ error: { message } });
}

function parseSpecificFilters(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Filtro especifico invalido."), { statusCode: 400 });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Filtro especifico invalido."), { statusCode: 400 });
  }

  const entries = Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => [key, String(value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export async function sesmtRoutes(app: FastifyInstance) {
  app.get("/api/sesmt/menu", async (req, reply) => {
    try {
      const ctx = authContext(req);
      return sesmtRepo.listMenu(ctx.profile);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/modules", async (req, reply) => {
    try {
      const ctx = authContext(req);
      return sesmtRepo.listModuleDefinitions(ctx.profile);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/executive-views", async (req, reply) => {
    try {
      const ctx = authContext(req);
      return sesmtRepo.listExecutiveViews(ctx.profile);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/lookups", async (req, reply) => {
    try {
      const ctx = authContext(req);
      return sesmtRepo.getLookups(ctx.profile, ctx.userId);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({
        search: z.string().optional(),
        unidade: z.string().optional(),
        status: z.string().optional(),
      }).parse(req.query);
      return await sesmtRepo.listDossieColaboradores({
        ...ctx,
        ...query,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores/:id/dossie", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      return await sesmtRepo.getColaboradorDossie({
        ...ctx,
        colaboradorId: params.id,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores/:id/dossie/timeline", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      return await sesmtRepo.getColaboradorDossieTimeline({
        ...ctx,
        colaboradorId: params.id,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores/:id/dossie/documentos", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      return await sesmtRepo.getColaboradorDossieDocumentos({
        ...ctx,
        colaboradorId: params.id,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores/:id/dossie/alertas", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      return await sesmtRepo.getColaboradorDossieAlertas({
        ...ctx,
        colaboradorId: params.id,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/colaboradores/:id/dossie/relatorio", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      return await sesmtRepo.getColaboradorDossieRelatorio({
        ...ctx,
        colaboradorId: params.id,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.post("/api/sesmt/colaboradores/:id/dossie/exportar", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const payload = z.object({
        formato: z.enum(["PDF", "XLSX", "JSON"]).optional(),
        incluirSigiloso: z.boolean().optional(),
      }).passthrough().parse(req.body ?? {});
      return await sesmtRepo.exportColaboradorDossie({
        ...ctx,
        colaboradorId: params.id,
        payload,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/dashboard/painel-mestre", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({
        unidade: z.string().optional(),
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
      }).parse(req.query);
      return sesmtRepo.getMasterDashboard(ctx.profile, ctx.userId, ctx.userName, query);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/dashboard/indice-maturidade", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({ unidade: z.string().optional() }).parse(req.query);
      return sesmtRepo.getMaturityDashboard(ctx.profile, ctx.userId, ctx.userName, query);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/dashboard/painel-preditivo", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({ unidade: z.string().optional() }).parse(req.query);
      return sesmtRepo.getPredictiveDashboard(ctx.profile, ctx.userId, ctx.userName, query);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/dashboard/indicadores", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({ unidade: z.string().optional() }).parse(req.query);
      return sesmtRepo.getIndicatorsDashboard(ctx.profile, ctx.userId, ctx.userName, query);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/dashboard/gerencial-ocupacional", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const query = z.object({ unidade: z.string().optional() }).parse(req.query);
      return sesmtRepo.getGerencialOcupacionalDashboard(ctx.profile, ctx.userId, ctx.userName, query);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/modules/:moduleKey/records", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string().min(1) }).parse(req.params);
      const query = z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().optional(),
        status: z.string().optional(),
        unidade: z.string().optional(),
        responsavel: z.string().optional(),
        criticidade: z.string().optional(),
        nr: z.string().optional(),
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
        sortBy: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        specificFilters: z.string().optional(),
      }).parse(req.query);

      const { specificFilters: specificFiltersRaw, ...restQuery } = query;
      const specificFilters = parseSpecificFilters(specificFiltersRaw);

      return sesmtRepo.listRecords({
        ...ctx,
        moduleKey: params.moduleKey,
        ...restQuery,
        specificFilters,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/modules/:moduleKey/favorite-preset", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string().min(1) }).parse(req.params);
      return sesmtRepo.getFavoritePreset({
        ...ctx,
        moduleKey: params.moduleKey,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.put("/api/sesmt/modules/:moduleKey/favorite-preset", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string().min(1) }).parse(req.params);
      const payload = z.object({
        presetKey: z.string().nullable().optional(),
        status: z.string().optional(),
        criticidade: z.string().optional(),
        unidade: z.string().optional(),
        sortBy: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        specificFilters: z.record(z.string()).optional(),
        clear: z.boolean().optional(),
      }).parse(req.body);

      return sesmtRepo.saveFavoritePreset({
        ...ctx,
        moduleKey: params.moduleKey,
        payload,
      });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/modules/:moduleKey/records/:id", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string(), id: z.string() }).parse(req.params);
      return sesmtRepo.getRecordById({ ...ctx, ...params });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.post("/api/sesmt/modules/:moduleKey/records", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string() }).parse(req.params);
      return sesmtRepo.createRecord({ ...ctx, moduleKey: params.moduleKey, payload: req.body });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.put("/api/sesmt/modules/:moduleKey/records/:id", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string(), id: z.string() }).parse(req.params);
      return sesmtRepo.updateRecord({ ...ctx, ...params, payload: req.body });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.post("/api/sesmt/modules/:moduleKey/records/:id/evidencias", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string(), id: z.string() }).parse(req.params);
      const payload = z.object({
        descricao: z.string().min(1),
        tipo: z.string().optional(),
        data: z.string().optional(),
        responsavel: z.string().optional(),
        anexoId: z.string().optional(),
      }).parse(req.body);
      return sesmtRepo.addEvidence({ ...ctx, ...params, payload });
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.post("/api/sesmt/modules/:moduleKey/records/:id/anexos", async (req, reply) => {
    try {
      const ctx = authContext(req);
      const params = z.object({ moduleKey: z.string(), id: z.string() }).parse(req.params);
      await sesmtRepo.getRecordById({ ...ctx, ...params });

      const relativeDir = path.join("uploads", "sesmt", params.moduleKey, params.id);
      const absoluteDir = path.resolve(process.cwd(), relativeDir);
      await mkdir(absoluteDir, { recursive: true });

      const uploaded: SesmtAttachment[] = [];
      const rejected: Array<{ nomeArquivo: string; motivo: string }> = [];
      const parts = req.parts();

      for await (const part of parts) {
        if (part.type !== "file" || !part.filename) continue;
        if (!isAllowedAttachment(part.filename)) {
          rejected.push({ nomeArquivo: part.filename, motivo: "Extensao nao permitida." });
          continue;
        }
        if (!isAllowedAttachmentMime(part.mimetype)) {
          rejected.push({ nomeArquivo: part.filename, motivo: "Tipo MIME nao permitido." });
          continue;
        }

        const buffer = await part.toBuffer();
        if (!buffer.length) continue;
        if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
          rejected.push({
            nomeArquivo: part.filename,
            motivo: `Arquivo excede o limite de ${Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB.`,
          });
          continue;
        }

        const safeFileName = part.filename.replace(/[^\w.-]/g, "_");
        const storedName = `${Date.now()}-${randomUUID()}-${safeFileName}`;
        const relativePath = path.join(relativeDir, storedName).replace(/\\/g, "/");
        const absolutePath = path.resolve(process.cwd(), relativePath);

        await writeFile(absolutePath, buffer);

        const attachment = sesmtRepo.addAttachmentMetadata({
          ...ctx,
          ...params,
          attachment: {
            nomeArquivo: part.filename,
            mimeType: part.mimetype || "application/octet-stream",
            tamanho: buffer.length,
            caminho: relativePath,
          },
        });

        uploaded.push(attachment);
      }

      if (uploaded.length === 0 && rejected.length > 0) {
        return reply.status(400).send({ error: { message: "Nenhum anexo valido foi enviado." }, rejected });
      }

      return { uploaded, rejected };
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });

  app.get("/api/sesmt/access-audit", async (req, reply) => {
    try {
      const ctx = authContext(req);
      return sesmtRepo.listAccessAudit(ctx.profile);
    } catch (error) {
      return sendHandledError(reply, error);
    }
  });
}

