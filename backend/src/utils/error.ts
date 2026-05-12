import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { env } from "../config/env.js";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function setErrorHandler(app: any): void {
  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request as any).correlationId ?? request.id;
    const typedError = error as Error & { statusCode?: number; code?: string };
    const statusCode = error instanceof AppError
      ? error.statusCode
      : error instanceof ZodError
        ? 400
        : typeof typedError.statusCode === "number"
          ? typedError.statusCode
          : 500;
    const zodIssues = error instanceof ZodError ? error.issues : undefined;
    const isUploadTooLarge =
      typedError.code === "FST_REQ_FILE_TOO_LARGE"
      || (error.message || "").toLowerCase().includes("file too large");
    const message = isUploadTooLarge
      ? `Arquivo excede o limite de ${env.UPLOAD_MAX_FILE_SIZE_MB} MB para upload.`
      : error.message || "Erro interno";

    request.log.error(
      {
        requestId,
        statusCode,
        message,
        originalMessage: error.message,
        code: typedError.code,
        zodIssues,
      },
      "request failed",
    );

    reply.status(isUploadTooLarge ? 413 : statusCode).send({
      error: {
        message,
        requestId,
        issues: zodIssues,
      },
    });
  });
}
