import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getClientes,
  getEstoquePlanta,
  getItensPedidoByNumped,
  getMateriais,
  getNfTroca,
  getNfVenda,
  getPedidoItens,
  getPedidos,
  getPedidosByCodcli,
  searchSacClientesDirectOracle,
} from "../repositories/erpRepository.js";

export async function erpRoutes(app: FastifyInstance) {
  app.get("/api/erp/clientes", async (req) => {
    const q = z.object({ nome: z.string().optional(), cgcent: z.string().optional(), telefone: z.string().optional() }).parse(req.query);
    return getClientes(q);
  });

  app.get("/api/erp/clientes-sac-busca", async (req) => {
    const q = z
      .object({
        codcli: z.string().optional().transform((v) => v?.trim()),
        cgcent: z.string().optional().transform((v) => v?.trim()),
        telent: z.string().optional().transform((v) => v?.trim()),
      })
      .parse(req.query);
    return searchSacClientesDirectOracle(q);
  });

  app.get("/api/erp/pedidos", async (req) => {
    const q = z.object({ codcli: z.string().optional() }).parse(req.query);
    return getPedidos(q.codcli);
  });

  app.get("/api/erp/pedidos-por-cliente", async (req) => {
    const q = z.object({ codcli: z.string().optional().transform((v) => v?.trim()) }).parse(req.query);
    return getPedidosByCodcli(q.codcli);
  });

  app.get("/api/erp/nf-venda", async (req) => {
    const q = z.object({ codcli: z.string().optional(), numnf: z.string().optional() }).parse(req.query);
    return getNfVenda(q);
  });

  app.get("/api/erp/nf-troca", async (req) => {
    const q = z.object({ codcli: z.string().optional(), numnf: z.string().optional() }).parse(req.query);
    return getNfTroca(q);
  });

  app.get("/api/erp/pedido-itens", async (req) => {
    const q = z.object({ numped: z.string().optional() }).parse(req.query);
    return getPedidoItens(q.numped);
  });

  app.get("/api/erp/pedido-itens-por-pedido", async (req) => {
    const q = z.object({ numped: z.string().optional().transform((v) => v?.trim()) }).parse(req.query);
    return getItensPedidoByNumped(q.numped);
  });

  app.get("/api/erp/materiais", async (req) => {
    const q = z.object({ codigo: z.string().optional(), descricao: z.string().optional(), categoria: z.string().optional() }).parse(req.query);
    return getMateriais(q);
  });

  app.get("/api/erp/estoque-planta", async (req) => {
    const q = z.object({ codmat: z.string().optional() }).parse(req.query);
    return getEstoquePlanta(q.codmat);
  });
}
