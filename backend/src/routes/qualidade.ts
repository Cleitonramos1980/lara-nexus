import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { qualidadeRepo } from "../repositories/sgqRepository.js";

export async function qualidadeRoutes(app: FastifyInstance) {
  const stringOrNumberAsString = z.union([z.string(), z.number()]).transform((value) => String(value));
  const requiredText = z.preprocess((value) => (value == null ? "" : String(value).trim()), z.string().min(1));
  const optionalText = z.preprocess((value) => {
    if (value == null) return undefined;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
  }, z.string().optional());

  app.get("/api/dashboard/qualidade", async () => qualidadeRepo.dashboard());

  app.get("/api/garantias", async () => qualidadeRepo.listGarantias());
  app.post("/api/garantias", async (req) => {
    const body = z.object({
      codcli: stringOrNumberAsString,
      clienteNome: requiredText,
      numPedido: stringOrNumberAsString,
      numNfVenda: stringOrNumberAsString,
      numNfTroca: stringOrNumberAsString.optional(),
      codprod: stringOrNumberAsString.optional(),
      defeito: requiredText,
      descricao: optionalText,
      plantaResp: z.enum(["MAO", "BEL", "AGR"]),
      status: requiredText,
      custoEstimado: z.number().optional(),
      obs: optionalText,
      encerradoAt: optionalText,
    }).parse(req.body);
    return qualidadeRepo.createGarantia(body as any);
  });
  app.put("/api/garantias/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ status: z.string().optional(), encerradoAt: z.string().optional(), obs: z.string().optional() }).parse(req.body);
    return qualidadeRepo.updateGarantia(id, body as any);
  });

  app.get("/api/nc", async () => qualidadeRepo.listNcs());
  app.post("/api/nc", async (req) => {
    const body = z.object({
      codcli: stringOrNumberAsString.optional(),
      clienteNome: optionalText,
      numPedido: stringOrNumberAsString.optional(),
      numNf: stringOrNumberAsString.optional(),
      codprod: stringOrNumberAsString.optional(),
      motivoId: requiredText,
      tipoNc: requiredText,
      gravidade: requiredText,
      descricao: requiredText,
      causaRaiz: optionalText,
      planoAcao: optionalText,
      responsavel: requiredText,
      prazo: requiredText,
      status: requiredText,
      planta: z.enum(["MAO", "BEL", "AGR"]),
      encerradoAt: optionalText,
      origem: optionalText,
      origemId: optionalText,
    }).parse(req.body);
    return qualidadeRepo.createNc(body as any);
  });
  app.put("/api/nc/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ status: z.string().optional(), encerradoAt: z.string().optional(), planoAcao: z.string().optional() }).parse(req.body);
    return qualidadeRepo.updateNc(id, body as any);
  });

  app.get("/api/capa", async () => qualidadeRepo.listCapas());
  app.post("/api/capa", async (req) => {
    const body = z.object({
      origemTipo: requiredText,
      origemId: stringOrNumberAsString,
      descricaoProblema: requiredText,
      causaRaiz: optionalText,
      planoAcao: optionalText,
      criterioEficacia: optionalText,
      responsavel: requiredText,
      dataInicio: requiredText,
      dataPrazo: requiredText,
      dataConclusao: optionalText,
      status: requiredText,
    }).parse(req.body);
    return qualidadeRepo.createCapa(body as any);
  });
}
