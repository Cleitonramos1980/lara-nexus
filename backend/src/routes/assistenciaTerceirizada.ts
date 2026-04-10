import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  mockAssistenciasTerceirizadas,
  mockItensEmAssistencia,
  mockMovimentacoes,
} from "../repositories/seedAssistenciaTerceirizadaData.js";

let assistencias = [...mockAssistenciasTerceirizadas];
let itens = [...mockItensEmAssistencia];
let movimentacoes = [...mockMovimentacoes];
let nextATId = 4;
let nextIAId = 6;
let nextMOVId = 8;

function diffDays(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export async function assistenciaTerceirizadaRoutes(app: FastifyInstance) {
  // Dashboard
  app.get("/api/assistencia-terceirizada/dashboard", async () => {
    const ativas = assistencias.filter((a) => a.status === "ATIVA");
    const emPoder = itens.filter((i) => !["DEVOLVIDO", "ENCERRADO"].includes(i.status));
    const pecas = emPoder.filter((i) => i.tipoItem === "PECA");
    const equips = emPoder.filter((i) => i.tipoItem === "EQUIPAMENTO");
    const envios = movimentacoes.filter((m) => m.tipoMovimentacao.startsWith("ENVIO"));
    const retornos = movimentacoes.filter((m) => m.tipoMovimentacao.startsWith("RETORNO"));
    const semRetorno = emPoder.filter((i) => diffDays(i.dataEnvio) > 15);

    const volumes: Record<string, number> = {};
    emPoder.forEach((i) => { volumes[i.assistenciaNome] = (volumes[i.assistenciaNome] || 0) + i.quantidade; });
    const maiorVolume = Object.entries(volumes).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return {
      totalAssistencias: ativas.length,
      totalPecasEmPoder: pecas.reduce((s, i) => s + (i.quantidade - i.quantidadeRetornada), 0),
      totalEquipamentosEmPoder: equips.reduce((s, i) => s + (i.quantidade - i.quantidadeRetornada), 0),
      enviosNoPeriodo: envios.length,
      retornosNoPeriodo: retornos.length,
      itensSemRetornoMaisDias: semRetorno.length,
      assistenciaMaiorVolume: maiorVolume,
    };
  });

  // CRUD Assistências
  app.get("/api/assistencia-terceirizada", async () => assistencias);
  app.get("/api/assistencia-terceirizada/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return assistencias.find((a) => a.id === id) || null;
  });
  app.post("/api/assistencia-terceirizada", async (req) => {
    const body = req.body as any;
    const novo: any = { ...body, id: `AT-${String(nextATId++).padStart(3, "0")}`, criadoAt: new Date().toISOString().slice(0, 10), atualizadoAt: new Date().toISOString().slice(0, 10) };
    assistencias.push(novo);
    return novo;
  });
  app.put("/api/assistencia-terceirizada/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = assistencias.findIndex((a) => a.id === id);
    if (idx < 0) return null;
    assistencias[idx] = { ...assistencias[idx], ...body, atualizadoAt: new Date().toISOString().slice(0, 10) };
    return assistencias[idx];
  });

  // Itens
  app.get("/api/assistencia-terceirizada/itens", async () => itens);
  app.get("/api/assistencia-terceirizada/itens/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return itens.find((i) => i.id === id) || null;
  });
  app.post("/api/assistencia-terceirizada/itens/enviar", async (req) => {
    const body = req.body as any;
    const assistencia = assistencias.find((a) => a.id === body.assistenciaId);
    const novoItem: any = {
      ...body,
      id: `IA-${String(nextIAId++).padStart(3, "0")}`,
      assistenciaNome: assistencia?.nome || body.assistenciaNome || "",
      quantidadeRetornada: 0,
      status: "ENVIADO",
    };
    itens.push(novoItem);

    const tipoMov = body.tipoItem === "EQUIPAMENTO" ? "ENVIO_EQUIPAMENTO" : "ENVIO_PECA";
    const mov: any = {
      id: `MOV-${String(nextMOVId++).padStart(3, "0")}`,
      itemId: novoItem.id,
      assistenciaId: novoItem.assistenciaId,
      assistenciaNome: novoItem.assistenciaNome,
      tipoMovimentacao: tipoMov,
      codigoItem: novoItem.codigoItem,
      descricaoItem: novoItem.descricao,
      quantidade: novoItem.quantidade,
      status: "ENVIADO",
      usuario: novoItem.responsavelEnvio,
      dataHora: new Date().toISOString(),
    };
    movimentacoes.push(mov);
    return novoItem;
  });

  app.post("/api/assistencia-terceirizada/itens/:id/retorno", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = req.body as any;
    const idx = itens.findIndex((i) => i.id === id);
    if (idx < 0) return null;

    const item = itens[idx];
    const novaQtdRetornada = (item.quantidadeRetornada || 0) + (body.quantidadeRetornada || 0);
    const finalStatus = novaQtdRetornada >= item.quantidade ? "DEVOLVIDO" : item.status;

    itens[idx] = {
      ...item,
      quantidadeRetornada: novaQtdRetornada,
      status: body.condicaoRetorno === "CONSERTADO" ? "CONSERTADO" : finalStatus,
      dataRetorno: body.dataRetorno || new Date().toISOString().slice(0, 10),
      observacao: body.laudoObservacao || item.observacao,
    };

    const tipoMov = item.tipoItem === "EQUIPAMENTO" ? "RETORNO_EQUIPAMENTO" : "RETORNO_PECA";
    const mov: any = {
      id: `MOV-${String(nextMOVId++).padStart(3, "0")}`,
      itemId: item.id,
      assistenciaId: item.assistenciaId,
      assistenciaNome: item.assistenciaNome,
      tipoMovimentacao: tipoMov,
      codigoItem: item.codigoItem,
      descricaoItem: item.descricao,
      quantidade: body.quantidadeRetornada || 0,
      status: itens[idx].status,
      usuario: body.responsavelRecebimento || "",
      dataHora: new Date().toISOString(),
      condicaoRetorno: body.condicaoRetorno,
      laudoObservacao: body.laudoObservacao,
    };
    movimentacoes.push(mov);
    return itens[idx];
  });

  // Movimentações
  app.get("/api/assistencia-terceirizada/movimentacoes", async () =>
    [...movimentacoes].sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime())
  );
  app.get("/api/assistencia-terceirizada/movimentacoes/item/:itemId", async (req) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    return movimentacoes.filter((m) => m.itemId === itemId).sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
  });
  app.get("/api/assistencia-terceirizada/movimentacoes/assistencia/:assistenciaId", async (req) => {
    const { assistenciaId } = z.object({ assistenciaId: z.string() }).parse(req.params);
    return movimentacoes.filter((m) => m.assistenciaId === assistenciaId).sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
  });
}
