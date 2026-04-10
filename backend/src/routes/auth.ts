import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { adminRepo } from "../repositories/sgqRepository.js";
import { signAuthToken } from "../utils/jwt.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);

    const users = adminRepo.getUsuarios();
    const user = users.find((u) => u.email.toLowerCase() === body.email.toLowerCase());

    if (!user || !user.ativo) {
      return reply.status(401).send({ error: { message: "Usuario nao encontrado ou inativo." } });
    }

    if (body.password !== env.AUTH_STATIC_PASSWORD) {
      return reply.status(401).send({ error: { message: "Credenciais invalidas." } });
    }

    const token = signAuthToken({
      sub: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
    });

    return {
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        ativo: user.ativo,
      },
      expiresIn: 8 * 60 * 60,
    };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const authUser = (req as any).authUser as {
      sub: string;
      nome: string;
      email: string;
      perfil: string;
    } | undefined;
    if (!authUser) {
      return reply.status(401).send({ error: { message: "Nao autenticado." } });
    }
    return {
      id: authUser.sub,
      nome: authUser.nome,
      email: authUser.email,
      perfil: authUser.perfil,
    };
  });
}
