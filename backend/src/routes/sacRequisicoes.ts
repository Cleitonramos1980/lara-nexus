import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sacReqRepo } from "../repositories/sgqRepository.js";
import {
  optionalStringOrNumberAsString,
  optionalText,
  requiredText,
  stringOrNumberAsString,
} from "../types/validators.js";

const itemSchema = z.object({
  codmat: stringOrNumberAsString,
  descricaoMaterial: requiredText,
  un: requiredText,
  qtdSolicitada: z.number(),
  qtdAtendida: z.number().optional(),
  situacao: optionalText,
  observacao: optionalText,
  observacaoAtendente: optionalText,
});

export async function sacReqRoutes(app: FastifyInstance) {
  app.get("/api/sac/requisicoes/dashboard", async () => sacReqRepo.dashboard());
  app.get("/api/sac/requisicoes", async () => sacReqRepo.list());
  app.get("/api/sac/requisicoes/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return sacReqRepo.getById(id);
  });

  app.post("/api/sac/requisicoes", async (req) => {
    const body = z.object({
      atendimentoId: optionalText,
      codcli: stringOrNumberAsString,
      clienteNome: requiredText,
      cgcent: stringOrNumberAsString,
      numPedido: optionalStringOrNumberAsString,
      numNfVenda: optionalStringOrNumberAsString,
      codprod: optionalStringOrNumberAsString,
      produtoRelacionado: optionalText,
      plantaCd: z.enum(["MAO", "BEL", "AGR"]),
      motivo: requiredText,
      prioridade: requiredText,
      observacoes: z.preprocess((value) => (value == null ? "" : String(value)), z.string()),
      status: requiredText,
      atendidoAt: optionalText,
      atendidoPor: optionalText,
      observacoesAtendimento: optionalText,
      itens: z.array(itemSchema),
    }).parse(req.body);

    return sacReqRepo.create(body as any);
  });

  app.post("/api/sac/requisicoes/:id/atender", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      status: requiredText,
      itens: z.array(itemSchema),
      observacoesAtendimento: z.preprocess((value) => (value == null ? "" : String(value)), z.string()),
      atendidoPor: requiredText,
    }).parse(req.body);
    return sacReqRepo.atender(id, body as any);
  });
}
