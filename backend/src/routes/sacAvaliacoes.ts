import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, nextId, appendAudit } from "../repositories/dataStore.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildAvaliacaoLink(token: string): string {
  return `/avaliacao?token=${token}`;
}

export async function sacAvaliacoesRoutes(app: FastifyInstance) {
  // GET /api/sac/avaliacoes — list with optional filters
  app.get("/api/sac/avaliacoes", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    let list = db.sacAvaliacoes;
    if (q.atendimentoId) list = list.filter((a) => a.atendimentoId === q.atendimentoId);
    if (q.statusEnvio) list = list.filter((a) => a.statusEnvio === q.statusEnvio);
    if (q.statusResposta) list = list.filter((a) => a.statusResposta === q.statusResposta);
    if (q.planta) list = list.filter((a) => a.planta === q.planta);
    return list;
  });

  // GET /api/sac/avaliacoes/public?token=... — PUBLIC (no auth)
  app.get("/api/sac/avaliacoes/public", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.query);
    const avaliacao = db.sacAvaliacoes.find((a) => a.token === token);
    if (!avaliacao) return reply.status(404).send({ error: { message: "Avaliação não encontrada." } });
    return {
      id: avaliacao.id,
      atendimentoId: avaliacao.atendimentoId,
      codcli: avaliacao.codcli,
      clienteNome: avaliacao.clienteNome,
      statusResposta: avaliacao.statusResposta,
      dataEnvio: avaliacao.dataEnvio,
      nota: avaliacao.nota,
      comentario: avaliacao.comentario,
    };
  });

  // POST /api/sac/avaliacoes/public/responder — PUBLIC (no auth)
  app.post("/api/sac/avaliacoes/public/responder", async (req, reply) => {
    const body = z.object({
      token: z.string().min(1),
      nota: z.number().min(1).max(10),
      comentario: z.string().optional(),
    }).parse(req.body);

    const idx = db.sacAvaliacoes.findIndex((a) => a.token === body.token);
    if (idx < 0) return reply.status(404).send({ error: { message: "Avaliação não encontrada." } });

    const avaliacao = db.sacAvaliacoes[idx];
    if (avaliacao.statusResposta === "RESPONDIDA") {
      return reply.status(400).send({ error: { message: "Avaliação já foi respondida." } });
    }

    db.sacAvaliacoes[idx] = {
      ...avaliacao,
      nota: body.nota,
      comentario: body.comentario,
      statusResposta: "RESPONDIDA",
      dataResposta: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    appendAudit("RESPONDER", "SAC_AVALIACAO", avaliacao.id, `Nota ${body.nota} — ${body.comentario ?? "sem comentário"}`, "publico");
    return db.sacAvaliacoes[idx];
  });

  // GET /api/sac/avaliacoes/:id
  app.get("/api/sac/avaliacoes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const avaliacao = db.sacAvaliacoes.find((a) => a.id === id);
    if (!avaliacao) return reply.status(404).send({ error: { message: "Avaliação não encontrada." } });
    return avaliacao;
  });

  // POST /api/sac/atendimentos/:id/avaliacao/link — generate or retrieve link
  app.post("/api/sac/atendimentos/:id/avaliacao/link", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const atendimento = db.atendimentos.find((a) => a.id === id);
    if (!atendimento) return reply.status(404).send({ error: { message: "Atendimento não encontrado." } });

    let existing = db.sacAvaliacoes.find((a) => a.atendimentoId === id);
    if (existing) return existing;

    const token = randomUUID();
    const avaliacao = {
      id: nextId("AVAL", db.sacAvaliacoes.length),
      atendimentoId: id,
      codcli: atendimento.codcli,
      clienteNome: atendimento.clienteNome,
      telefone: atendimento.telefone,
      planta: atendimento.plantaResp,
      responsavelAtendimento: (req as any).authUser?.nome,
      encerradoAt: atendimento.encerradoAt,
      token,
      link: buildAvaliacaoLink(token),
      canalEnvio: "WHATSAPP" as const,
      statusEnvio: "NAO_ENVIADA" as const,
      statusResposta: "NAO_RESPONDIDA" as const,
      envioLogs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.sacAvaliacoes.push(avaliacao);
    appendAudit("GERAR_LINK", "SAC_AVALIACAO", avaliacao.id, `Link gerado para atendimento ${id}`, (req as any).authUser?.nome ?? "system");
    return avaliacao;
  });

  // POST /api/sac/atendimentos/:id/avaliacao/enviar
  app.post("/api/sac/atendimentos/:id/avaliacao/enviar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ regenerateToken: z.boolean().optional() }).parse(req.body ?? {});

    let idx = db.sacAvaliacoes.findIndex((a) => a.atendimentoId === id);
    if (idx < 0) {
      // auto-generate
      const atendimento = db.atendimentos.find((a) => a.id === id);
      if (!atendimento) return reply.status(404).send({ error: { message: "Atendimento não encontrado." } });
      const token = randomUUID();
      const avaliacao = {
        id: nextId("AVAL", db.sacAvaliacoes.length),
        atendimentoId: id,
        codcli: atendimento.codcli,
        clienteNome: atendimento.clienteNome,
        telefone: atendimento.telefone,
        planta: atendimento.plantaResp,
        token,
        link: buildAvaliacaoLink(token),
        canalEnvio: "WHATSAPP" as const,
        statusEnvio: "ENVIADA" as const,
        statusResposta: "NAO_RESPONDIDA" as const,
        dataEnvio: new Date().toISOString(),
        envioLogs: [{
          id: randomUUID(),
          data: new Date().toISOString(),
          canal: "WHATSAPP" as const,
          telefone: atendimento.telefone,
          status: "ENVIADA" as const,
          provider: "internal",
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.sacAvaliacoes.push(avaliacao);
      appendAudit("ENVIAR", "SAC_AVALIACAO", avaliacao.id, `Pesquisa enviada para ${atendimento.telefone}`, (req as any).authUser?.nome ?? "system");
      return avaliacao;
    }

    const avaliacao = db.sacAvaliacoes[idx];
    const newToken = body.regenerateToken ? randomUUID() : avaliacao.token;

    db.sacAvaliacoes[idx] = {
      ...avaliacao,
      token: newToken,
      link: buildAvaliacaoLink(newToken),
      statusEnvio: "ENVIADA",
      dataEnvio: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      envioLogs: [
        ...avaliacao.envioLogs,
        {
          id: randomUUID(),
          data: new Date().toISOString(),
          canal: "WHATSAPP" as const,
          telefone: avaliacao.telefone,
          status: "ENVIADA" as const,
          provider: "internal",
        },
      ],
    };

    appendAudit("ENVIAR", "SAC_AVALIACAO", avaliacao.id, `Pesquisa enviada/reenviada`, (req as any).authUser?.nome ?? "system");
    return db.sacAvaliacoes[idx];
  });

  // POST /api/sac/avaliacoes/:id/reenviar
  app.post("/api/sac/avaliacoes/:id/reenviar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ regenerateToken: z.boolean().optional() }).parse(req.body ?? {});

    const idx = db.sacAvaliacoes.findIndex((a) => a.id === id);
    if (idx < 0) return reply.status(404).send({ error: { message: "Avaliação não encontrada." } });

    const avaliacao = db.sacAvaliacoes[idx];
    const newToken = body.regenerateToken ? randomUUID() : avaliacao.token;

    db.sacAvaliacoes[idx] = {
      ...avaliacao,
      token: newToken,
      link: buildAvaliacaoLink(newToken),
      statusEnvio: "ENVIADA",
      dataEnvio: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      envioLogs: [
        ...avaliacao.envioLogs,
        {
          id: randomUUID(),
          data: new Date().toISOString(),
          canal: "WHATSAPP" as const,
          telefone: avaliacao.telefone,
          status: "ENVIADA" as const,
          provider: "internal",
        },
      ],
    };

    appendAudit("REENVIAR", "SAC_AVALIACAO", avaliacao.id, `Pesquisa reenviada`, (req as any).authUser?.nome ?? "system");
    return db.sacAvaliacoes[idx];
  });

  // GET /api/sac/historico-cliente
  app.get("/api/sac/historico-cliente", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const codcli = q.codcli?.trim();
    const cgcent = q.cgcent?.trim();
    const cliente = q.cliente?.trim()?.toLowerCase();

    const matchAtend = (a: { codcli: string; cgcent: string; clienteNome: string }) => {
      if (codcli && a.codcli === codcli) return true;
      if (cgcent && a.cgcent === cgcent) return true;
      if (cliente && a.clienteNome.toLowerCase().includes(cliente)) return true;
      return !codcli && !cgcent && !cliente;
    };

    return {
      atendimentos: db.atendimentos.filter(matchAtend),
      garantias: db.garantias.filter((g) => (codcli && g.codcli === codcli) || (cliente && g.clienteNome.toLowerCase().includes(cliente!))),
      ncs: db.ncs.filter((n) => (codcli && n.codcli === codcli) || (cliente && n.clienteNome?.toLowerCase().includes(cliente!))),
      capa: db.capas,
      avaliacoes: db.sacAvaliacoes.filter((a) => (codcli && a.codcli === codcli) || (cliente && a.clienteNome.toLowerCase().includes(cliente!))),
    };
  });

  // GET /api/sac/dashboard/avaliacoes
  app.get("/api/sac/dashboard/avaliacoes", async () => {
    const avaliacoes = db.sacAvaliacoes;
    const enviadas = avaliacoes.filter((a) => a.statusEnvio !== "NAO_ENVIADA");
    const respondidas = avaliacoes.filter((a) => a.statusResposta === "RESPONDIDA");
    const notas = respondidas.filter((a) => a.nota != null).map((a) => a.nota!);
    const notaMedia = notas.length > 0 ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 100) / 100 : 0;

    const distribuicaoNota = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
      name: String(n),
      value: notas.filter((nota) => nota === n).length,
    }));

    const byPlanta = avaliacoes.reduce((acc, a) => {
      const key = a.planta || "N/A";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byAtendente = avaliacoes.reduce((acc, a) => {
      const key = a.responsavelAtendimento || "N/A";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalPesquisasEnviadas: enviadas.length,
      totalPesquisasRespondidas: respondidas.length,
      taxaResposta: enviadas.length > 0 ? Math.round((respondidas.length / enviadas.length) * 10000) / 100 : 0,
      notaMedia,
      percentualNotasAltas: notas.length > 0 ? Math.round((notas.filter((n) => n >= 8).length / notas.length) * 10000) / 100 : 0,
      percentualNotasBaixas: notas.length > 0 ? Math.round((notas.filter((n) => n <= 3).length / notas.length) * 10000) / 100 : 0,
      pesquisasNaoRespondidas: enviadas.length - respondidas.length,
      evolucaoNotaPorPeriodo: [] as Array<{ periodo: string; notaMedia: number }>,
      avaliacoesPorPlanta: Object.entries(byPlanta).map(([name, value]) => ({ name, value })),
      avaliacoesPorAtendente: Object.entries(byAtendente).map(([name, value]) => ({ name, value })),
      distribuicaoNota,
    };
  });
}
