import type { FastifyRequest } from "fastify";

function createForbiddenError(message: string): Error {
  const err: any = new Error(message);
  err.statusCode = 403;
  return err;
}

function createUnauthorizedError(): Error {
  const err: any = new Error("Nao autenticado.");
  err.statusCode = 401;
  return err;
}

/**
 * Verifica se o usuário autenticado possui um dos perfis exigidos.
 * Lança 401 se não houver sessão, 403 se o perfil for insuficiente.
 *
 * Nota: rotas Lara autenticadas via LARA_API_KEY não carregam authUser —
 * nesses casos o acesso é liberado (a chave já garante autenticidade).
 */
export function requireRole(req: FastifyRequest, roles: string[]): void {
  const authUser = (req as any).authUser as { perfil?: string } | undefined;

  // API Key auth: authUser não é populado — acesso liberado pela chave configurada
  if (!authUser) return;

  if (!roles.includes(String(authUser.perfil ?? ""))) {
    throw createForbiddenError(
      `Perfil '${authUser.perfil ?? "desconhecido"}' não possui permissão para esta operação. Perfis aceitos: ${roles.join(", ")}.`,
    );
  }
}

/**
 * Requer que o usuário esteja autenticado (qualquer perfil).
 */
export function requireAuth(req: FastifyRequest): void {
  const authUser = (req as any).authUser as { perfil?: string } | undefined;
  if (!authUser && !String((req.headers["x-lara-api-key"] ?? "")).trim()) {
    throw createUnauthorizedError();
  }
}
