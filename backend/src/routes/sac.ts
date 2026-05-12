import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { sacRepo } from "../repositories/sgqRepository.js";
import { appendAudit } from "../repositories/dataStore.js";
import {
  optionalStringOrNumberAsString,
  optionalText,
  requiredText,
  stringOrNumberAsString,
} from "../types/validators.js";

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".avi",
]);

function isAllowedAttachment(fileName: string, mimeType: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  if (ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) return true;
  if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) return true;
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType);
}

export async function sacRoutes(app: FastifyInstance) {
  app.get("/api/sac/dashboard", async () => sacRepo.dashboard());
  app.get("/api/sac/atendimentos", async () => sacRepo.list());
  app.get("/api/sac/atendimentos/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return sacRepo.getById(id);
  });

  app.post("/api/sac/atendimentos", async (req) => {
    const body = z.object({
      codcli: stringOrNumberAsString,
      clienteNome: requiredText,
      cgcent: stringOrNumberAsString,
      telefone: z.preprocess((value) => (value == null ? "" : String(value)), z.string()).default(""),
      canal: requiredText,
      tipoContato: requiredText,
      descricao: requiredText,
      plantaResp: z.enum(["MAO", "BEL", "AGR"]),
      numPedido: optionalStringOrNumberAsString,
      numNfVenda: optionalStringOrNumberAsString,
      codprod: optionalStringOrNumberAsString,
      produtoRelacionado: optionalText,
      status: optionalText,
    }).parse(req.body);
    return sacRepo.create(body as any);
  });

  app.put("/api/sac/atendimentos/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      status: optionalText,
      descricao: optionalText,
      codprod: optionalStringOrNumberAsString,
      produtoRelacionado: optionalText,
      timeline: z.array(z.object({ id: z.string(), data: z.string(), usuario: z.string(), acao: z.string(), descricao: z.string() })).optional(),
    }).parse(req.body);
    return sacRepo.update(id, body as any);
  });

  app.post("/api/sac/atendimentos/:id/anexos", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const atendimento = sacRepo.getById(id);
    if (!atendimento) {
      return reply.status(404).send({ message: "Atendimento não encontrado." });
    }

    const relativeDir = path.join("uploads", "sac", id);
    const absoluteDir = path.resolve(process.cwd(), relativeDir);
    await mkdir(absoluteDir, { recursive: true });

    const filesPayload: Array<{ nomeArquivo: string; mimeType: string; tamanho: number; caminho: string }> = [];
    const rejected: Array<{ nomeArquivo: string; motivo: string }> = [];
    const parts = (req as any).parts();

    for await (const part of parts) {
      if (part.type !== "file") continue;
      if (!part.filename) continue;
      const mimeType = part.mimetype || "application/octet-stream";

      if (!isAllowedAttachment(part.filename, mimeType)) {
        rejected.push({
          nomeArquivo: part.filename,
          motivo: "Tipo de arquivo não permitido.",
        });
        appendAudit(
          "UPLOAD_REJEITADO",
          "SAC_ANEXO",
          id,
          `Arquivo rejeitado (${part.filename}) - tipo ${mimeType}`,
          "system",
        );
        continue;
      }

      const fileBuffer = await part.toBuffer();
      if (!fileBuffer.length) continue;

      const safeFileName = part.filename.replace(/[^\w.\-]/g, "_");
      const storedName = `${Date.now()}-${randomUUID()}-${safeFileName}`;
      const relativePath = path.join(relativeDir, storedName).replace(/\\/g, "/");
      const absolutePath = path.resolve(process.cwd(), relativePath);

      await writeFile(absolutePath, fileBuffer);

      filesPayload.push({
        nomeArquivo: part.filename,
        mimeType,
        tamanho: fileBuffer.length,
        caminho: relativePath,
      });
    }

    const anexos = sacRepo.addAnexos(id, filesPayload);
    if (anexos.length === 0 && rejected.length > 0) {
      return reply.status(400).send({
        error: { message: "Nenhum anexo válido foi enviado." },
        rejected,
      });
    }

    return { atendimentoId: id, uploaded: anexos.length, anexos, rejected };
  });
}

