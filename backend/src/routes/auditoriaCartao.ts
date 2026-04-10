import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as XLSX from "xlsx";
import { appendAudit, db, nextId } from "../repositories/dataStore.js";
import { persistCollections } from "../repositories/persistentCollectionStore.js";
import {
  concStatusValues,
  consolidadoStatusValues,
  divergenciaTipoValues,
  tratamentoStatusValues,
  type AuditoriaCartaoImportacao,
  type AuditoriaCartaoImportacaoItem,
  type ConciliacaoStatus,
  type DivergenciaTipo,
  type OperadoraCartao,
  importacoesStore,
  itensStore,
  divergenciasStore,
  logsStore,
  matchesStore,
  ajustesStore,
} from "../modules/auditoriaCartao/types.js";
import {
  addLog,
  currentUser,
  ensureConfiguracao,
  normalizeComparable,
  nowIso,
  round2,
  registrarAjuste,
} from "../modules/auditoriaCartao/state.js";
import { AppError } from "../utils/error.js";
import { normalizarLinhaRede, linhaValida, statusVendaDeveSerIgnorado } from "../modules/auditoriaCartao/normalization.js";
import { executarConciliacaoImportacao } from "../modules/auditoriaCartao/matching.js";
import { buildDashboard, buildLinhaDetalhe, calcularPainelDiario, filtroPeriodo } from "../modules/auditoriaCartao/dashboard.js";
import { env } from "../config/env.js";
import { isOracleEnabled } from "../db/oracle.js";
import { buscarVendasErpConsolidacao } from "../repositories/auditoriaCartaoOracleRepository.js";
import {
  atualizarTratativaConsolidadoDia,
  buscarDetalheConsolidadoDia,
  processarPainelConsolidadoDia,
  processarPainelConsolidadoFilial,
} from "../modules/auditoriaCartao/consolidadoDia.js";
import {
  atualizarTratativaPcprestPlanilha,
  pcprestPlanilhaMatchStatusValues,
  processarPcprestPlanilha,
} from "../modules/auditoriaCartao/pcprestPlanilha.js";
import { toCsv, toPagination, sumBy } from "../modules/auditoriaCartao/helpers.js";

const concStatusSchema = z.enum(concStatusValues);
const consolidadoStatusSchema = z.enum(consolidadoStatusValues);
const divergenciaTipoSchema = z.enum(divergenciaTipoValues);
const tratamentoStatusSchema = z.enum(tratamentoStatusValues);
const operadoraSchema = z.enum(["REDE"]);
const pcprestPlanilhaStatusSchema = z.enum(pcprestPlanilhaMatchStatusValues);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "no", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean().optional());

const configuracaoSchema = z.object({
  toleranciaValor: z.coerce.number().min(0).max(1000),
  janelaHorarioMinutos: z.coerce.number().int().min(0).max(720),
  prioridadeChaves: z.array(z.string().min(1)).min(1),
  pesosChaves: z.record(z.coerce.number().min(0).max(100)).optional(),
  regrasPorOperadora: z.record(z.string(), z.record(z.any())).optional(),
  mapeamentoEstabelecimentoFilial: z.array(z.object({
    numeroEstabelecimento: z.string().min(1),
    codfilial: z.string().min(1),
  })).optional(),
  regraParceladoVista: z.string().default("PADRAO"),
  tratamentoCancelamento: z.string().default("SEPARAR"),
  tratamentoChargeback: z.string().default("SEPARAR"),
});

const DIVERGENCIA_PRIORITY: DivergenciaTipo[] = [
  "DIVERGENCIA_VALOR",
  "DIVERGENCIA_PARCELAS",
  "DIVERGENCIA_FILIAL",
  "DIVERGENCIA_STATUS",
  "NAO_ENCONTRADO_NO_ERP",
  "NAO_ENCONTRADO_NA_OPERADORA",
  "DUPLICIDADE",
  "CANCELADA",
  "CHARGEBACK",
  "PENDENTE_REVISAO",
];

const processamentosAtivos = new Set<string>();
const LOOP_YIELD_INTERVAL = 50;
const AUDITORIA_CARTAO_PERSIST_KEYS: Array<keyof typeof db> = [
  "auditoriaCartaoImportacoes",
  "auditoriaCartaoImportacaoItens",
  "auditoriaCartaoMatches",
  "auditoriaCartaoDivergencias",
  "auditoriaCartaoLogs",
  "auditoriaCartaoAjustesManuais",
  "auditoriaCartaoConsolidadoDia",
  "auditoriaCartaoRegras",
];

function persistAuditoriaCartaoState(): void {
  void persistCollections(AUDITORIA_CARTAO_PERSIST_KEYS).catch((error) => {
    console.error("Falha ao persistir estado da Auditoria Cartao.", error);
  });
}

function reconciliarImportacoesOrfas(usuario: string): void {
  let houveAlteracao = false;

  for (const importacao of importacoesStore()) {
    if (importacao.statusProcessamento !== "PROCESSANDO") continue;
    if (processamentosAtivos.has(importacao.id)) continue;

    importacao.statusProcessamento = "ERRO";
    importacao.processadoEm = nowIso();
    importacao.observacaoErro =
      "Processamento interrompido (reinicio do backend ou falha de conexao). Reprocese ou exclua esta importacao.";

    addLog(
      importacao.id,
      "ERRO",
      "Processamento interrompido sem sessao ativa no backend.",
      usuario,
      { motivo: "PROCESSAMENTO_INTERROMPIDO" },
    );
    houveAlteracao = true;
  }

  if (houveAlteracao) persistAuditoriaCartaoState();
}

async function maybeYieldLoop(index: number): Promise<void> {
  if (index <= 0 || index % LOOP_YIELD_INTERVAL !== 0) return;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function marcarImportacaoComErro(
  importacao: AuditoriaCartaoImportacao,
  usuario: string,
  error: unknown,
): void {
  importacao.statusProcessamento = "ERRO";
  importacao.observacaoErro = error instanceof Error ? error.message : "Erro desconhecido ao processar importacao";
  importacao.processadoEm = nowIso();

  addLog(importacao.id, "ERRO", "Falha no processamento da importacao", usuario, {
    erro: importacao.observacaoErro,
  });
  persistAuditoriaCartaoState();
}

function agendarProcessamentoImportacao(
  importacao: AuditoriaCartaoImportacao,
  usuario: string,
  executar: () => Promise<void>,
): boolean {
  if (processamentosAtivos.has(importacao.id)) return false;
  processamentosAtivos.add(importacao.id);

  setImmediate(() => {
    void (async () => {
      try {
        await executar();
      } catch (error) {
        marcarImportacaoComErro(importacao, usuario, error);
      } finally {
        processamentosAtivos.delete(importacao.id);
      }
    })();
  });

  return true;
}

async function processarUploadEmSegundoPlano(
  importacao: AuditoriaCartaoImportacao,
  arquivoBuffer: Buffer,
  usuario: string,
): Promise<void> {
  const workbook = XLSX.read(arquivoBuffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Arquivo sem abas para processamento.");

  const worksheet = workbook.Sheets[firstSheetName];
  const linhasRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: true });
  if (linhasRaw.length === 0) throw new Error("Arquivo sem linhas de dados.");

  const regra = ensureConfiguracao(usuario);
  const novosItens: AuditoriaCartaoImportacaoItem[] = [];
  let validas = 0;
  let invalidas = 0;
  let ignoradasStatusVenda = 0;

  for (let i = 0; i < linhasRaw.length; i += 1) {
    await maybeYieldLoop(i);
    const linha = linhasRaw[i];
    const normalizada = normalizarLinhaRede(importacao.id, i + 1, linha, regra);

    if (statusVendaDeveSerIgnorado(normalizada.statusVenda)) {
      invalidas += 1;
      ignoradasStatusVenda += 1;
      continue;
    }

    if (linhaValida(normalizada)) validas += 1;
    else invalidas += 1;

    novosItens.push({
      id: nextId("ACIIT", itensStore().length + novosItens.length),
      importacaoId: importacao.id,
      linhaOrigem: i + 1,
      jsonOrigem: linha,
      camposNormalizados: normalizada,
      hashConciliacao: normalizada.hashConciliacao,
      statusConciliacao: "PENDENTE_REVISAO",
    });
  }

  db.auditoriaCartaoImportacaoItens = [...itensStore(), ...novosItens];
  importacao.totalLinhas = linhasRaw.length;
  importacao.totalValidas = validas;
  importacao.totalInvalidas = invalidas;

  addLog(importacao.id, "NORMALIZACAO", "Linhas normalizadas com sucesso", usuario, {
    totalLinhas: linhasRaw.length,
    totalValidas: validas,
    totalInvalidas: invalidas,
    totalIgnoradasStatusVenda: ignoradasStatusVenda,
  });

  if (novosItens.length === 0) {
    importacao.statusProcessamento = "CONCLUIDO";
    importacao.processadoEm = nowIso();
    addLog(importacao.id, "CONCILIACAO", "Nenhum item elegivel para conciliacao apos filtros de status da operadora", usuario, {
      totalLinhas: linhasRaw.length,
      totalIgnoradasStatusVenda: ignoradasStatusVenda,
    });
    appendAudit(
      "AUDITORIA_CARTAO_UPLOAD",
      "AUDITORIA_CARTAO_IMPORTACAO",
      importacao.id,
      `Importacao ${importacao.nomeArquivo} concluida sem itens elegiveis para conciliacao.`,
      usuario,
    );
    persistAuditoriaCartaoState();
    return;
  }

  await executarConciliacaoImportacao(importacao, novosItens, usuario);
  appendAudit(
    "AUDITORIA_CARTAO_UPLOAD",
    "AUDITORIA_CARTAO_IMPORTACAO",
    importacao.id,
    `Importacao ${importacao.nomeArquivo} processada. Conciliadas: ${importacao.totalConciliadas}; Divergentes: ${importacao.totalDivergentes}`,
    usuario,
  );
  persistAuditoriaCartaoState();
}

export async function auditoriaCartaoRoutes(app: FastifyInstance) {
  const isFallbackEspelhoErpAtivo = () => Boolean(env.AUDITORIA_CARTAO_ENABLE_ERP_MIRROR_FALLBACK);

  app.get("/api/auditoria-cartao/dashboard", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
    }).parse(req.query);

    const dashboard = buildDashboard(query.periodStart, query.periodEnd);
    const ultimoLogConsultaErp = [...logsStore()]
      .filter((log) => log.etapa === "CONSULTA_ERP" || log.etapa === "CONSULTA_ERP_SEM_DADOS")
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];

    const oracleConfigurado = isOracleEnabled();
    const fallbackEspelhoAtivo = isFallbackEspelhoErpAtivo();
    const indicadoresMascarados = !oracleConfigurado && fallbackEspelhoAtivo;

    return {
      ...dashboard,
      totalNaoEncontradoNaOperadora: indicadoresMascarados ? null : dashboard.totalNaoEncontradoNaOperadora,
      valorNaoEncontradoNaOperadora: indicadoresMascarados ? null : dashboard.valorNaoEncontradoNaOperadora,
      diagnosticoErp: {
        oracleConfigurado,
        fallbackEspelhoAtivo,
        indicadoresMascarados,
        ultimaConsulta: ultimoLogConsultaErp
          ? {
              importacaoId: ultimoLogConsultaErp.importacaoId,
              etapa: ultimoLogConsultaErp.etapa,
              mensagem: ultimoLogConsultaErp.mensagem,
              payloadResumo: ultimoLogConsultaErp.payloadResumo || {},
              criadoEm: ultimoLogConsultaErp.criadoEm,
            }
          : null,
      },
    };
  });

  app.get("/api/auditoria-cartao/diagnostico/erp-sem-rede", async (req, reply) => {
    const query = z.object({
      periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      filial: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(2000).optional(),
    }).parse(req.query);

    if (!isOracleEnabled()) {
      throw new AppError(
        "Oracle nao configurado. Nao e possivel localizar vendas do ERP sem o arquivo da Rede em modo real.",
        412,
      );
    }

    const chaveOperadora = (dataVenda: string, filial: string, valor: number) =>
      `${dataVenda}|${normalizeComparable(filial || "SEM_FILIAL")}|${round2(valor).toFixed(2)}`;

    const itensOperadora = itensStore()
      .filter((item) => filtroPeriodo(item.camposNormalizados.dataVenda, query.periodStart, query.periodEnd))
      .filter((item) => {
        if (!query.filial) return true;
        return normalizeComparable(item.camposNormalizados.codfilialArquivo || "").includes(normalizeComparable(query.filial));
      });

    const operadoraPorChave = new Map<string, number>();
    for (const item of itensOperadora) {
      const valorOperadora = item.camposNormalizados.valorBrutoAtualizado > 0
        ? item.camposNormalizados.valorBrutoAtualizado
        : item.camposNormalizados.valorBruto;
      const chave = chaveOperadora(
        item.camposNormalizados.dataVenda,
        item.camposNormalizados.codfilialArquivo,
        valorOperadora,
      );
      operadoraPorChave.set(chave, (operadoraPorChave.get(chave) || 0) + 1);
    }

    const vendasErp = (await buscarVendasErpConsolidacao({
      periodoInicial: query.periodStart,
      periodoFinal: query.periodEnd,
      limite: 250000,
    }))
      .filter((item) => {
        if (!query.filial) return true;
        return normalizeComparable(item.codfilial || "").includes(normalizeComparable(query.filial));
      })
      .sort((a, b) => {
        if (a.dataVenda !== b.dataVenda) return b.dataVenda.localeCompare(a.dataVenda);
        if (a.codfilial !== b.codfilial) return a.codfilial.localeCompare(b.codfilial);
        return b.valorBruto - a.valorBruto;
      });

    const semMatchNaRede: Array<{
      dataVenda: string;
      filial: string;
      valorErp: number;
      parcelas: number;
      referenciaErpId: string;
      numeroPedido: string;
      nsuCv: string;
      autorizacao: string;
      tid: string;
      bandeira: string;
      modalidade: string;
      codCobranca: string;
      chaveComparacao: string;
    }> = [];

    for (const vendaErp of vendasErp) {
      const chave = chaveOperadora(vendaErp.dataVenda, vendaErp.codfilial, vendaErp.valorBruto);
      const saldoOperadora = operadoraPorChave.get(chave) || 0;

      if (saldoOperadora > 0) {
        operadoraPorChave.set(chave, saldoOperadora - 1);
        continue;
      }

      semMatchNaRede.push({
        dataVenda: vendaErp.dataVenda,
        filial: vendaErp.codfilial,
        valorErp: round2(vendaErp.valorBruto),
        parcelas: vendaErp.parcelas,
        referenciaErpId: vendaErp.referenciaErpId,
        numeroPedido: vendaErp.numeroPedido,
        nsuCv: vendaErp.nsuCv,
        autorizacao: vendaErp.autorizacao,
        tid: vendaErp.tid,
        bandeira: vendaErp.bandeira,
        modalidade: vendaErp.modalidade,
        codCobranca: vendaErp.codCobranca || "",
        chaveComparacao: chave,
      });
    }

    const limit = query.limit || 500;
    const amostra = semMatchNaRede.slice(0, limit);
    const valorTotalSemMatch = round2(sumBy(semMatchNaRede, (item) => item.valorErp));

    return {
      periodo: {
        inicio: query.periodStart,
        fim: query.periodEnd,
        filial: query.filial || "TODAS",
      },
      resumo: {
        totalOperadoraNoPeriodo: itensOperadora.length,
        totalErpNoPeriodo: vendasErp.length,
        totalSemMatchNaRede: semMatchNaRede.length,
        valorTotalSemMatchNaRede: valorTotalSemMatch,
        chaveComparacao: "data+filial+valor",
      },
      itens: amostra,
      truncado: semMatchNaRede.length > amostra.length,
    };
  });

  app.get("/api/auditoria-cartao/painel-diario", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      statusDia: z.enum(["OK", "ATENCAO", "CRITICO"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    let painel = calcularPainelDiario(itensStore(), query.periodStart, query.periodEnd);
    if (query.statusDia) painel = painel.filter((item) => item.statusDia === query.statusDia);
    return toPagination(painel, query.page, query.limit);
  });

  app.get("/api/auditoria-cartao/consolidado-dia", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      status: consolidadoStatusSchema.or(z.literal("TODOS")).optional(),
      tratativa: tratamentoStatusSchema.or(z.literal("TODOS")).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    const result = processarPainelConsolidadoDia({
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      bandeira: query.bandeira,
      tipo: query.tipo,
      status: query.status,
      tratativa: query.tratativa,
    }, currentUser(req));

    return {
      resumo: result.resumo,
      linhas: toPagination(result.linhas, query.page, query.limit),
    };
  });

  app.get("/api/auditoria-cartao/consolidado-filial", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      status: consolidadoStatusSchema.or(z.literal("TODOS")).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    const result = processarPainelConsolidadoFilial({
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      filial: query.filial,
      bandeira: query.bandeira,
      tipo: query.tipo,
      status: query.status,
    }, currentUser(req));

    return {
      resumo: result.resumo,
      linhas: toPagination(result.linhas, query.page, query.limit),
    };
  });

  app.get("/api/auditoria-cartao/pcprest-planilha/resumo", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      statusMatch: pcprestPlanilhaStatusSchema.or(z.literal("TODOS")).optional(),
      tratativa: tratamentoStatusSchema.or(z.literal("TODOS")).optional(),
      somenteFaltantes: booleanQuerySchema,
      somenteDivergencias: booleanQuerySchema,
      somenteDuplicidades: booleanQuerySchema,
      valorExato: z.coerce.number().optional(),
      nsuOuAutorizacao: z.string().optional(),
      duplicataOuTitulo: z.string().optional(),
      nossoNumero: z.string().optional(),
      arquivoId: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).optional(),
    }).parse(req.query);

    const safeLimit = Math.min(query.limit ?? 200, 200);
    const usuario = currentUser(req);
    const result = await processarPcprestPlanilha({
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      filial: query.filial,
      bandeira: query.bandeira,
      tipo: query.tipo,
      statusMatch: query.statusMatch,
      tratativa: query.tratativa,
      somenteFaltantes: query.somenteFaltantes,
      somenteDivergencias: query.somenteDivergencias,
      somenteDuplicidades: query.somenteDuplicidades,
      valorExato: query.valorExato,
      nsuOuAutorizacao: query.nsuOuAutorizacao,
      duplicataOuTitulo: query.duplicataOuTitulo,
      nossoNumero: query.nossoNumero,
      arquivoId: query.arquivoId,
    });

    addLog("PCPREST_PLANILHA", "PCPREST_PLANILHA_RESUMO", "Validacao reversa PCPREST -> Planilha processada (resumo)", usuario, {
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      filial: query.filial || "TODAS",
      totalLinhasResumo: result.linhasResumo.length,
      totalDetalhes: result.linhasDetalhe.length,
      diagnostico: result.diagnostico,
    });

    return {
      cards: result.cards,
      diagnostico: result.diagnostico,
      linhas: toPagination(result.linhasResumo, query.page, safeLimit),
    };
  });

  app.get("/api/auditoria-cartao/pcprest-planilha/detalhe", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      data: z.string().optional(),
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      statusMatch: pcprestPlanilhaStatusSchema.or(z.literal("TODOS")).optional(),
      tratativa: tratamentoStatusSchema.or(z.literal("TODOS")).optional(),
      somenteFaltantes: booleanQuerySchema,
      somenteDivergencias: booleanQuerySchema,
      somenteDuplicidades: booleanQuerySchema,
      valorExato: z.coerce.number().optional(),
      nsuOuAutorizacao: z.string().optional(),
      duplicataOuTitulo: z.string().optional(),
      nossoNumero: z.string().optional(),
      arquivoId: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).optional(),
    }).parse(req.query);

    const safeLimit = Math.min(query.limit ?? 200, 200);
    const usuario = currentUser(req);
    const periodoDetalheInicio = query.data || query.periodStart;
    const periodoDetalheFim = query.data || query.periodEnd;
    const result = await processarPcprestPlanilha({
      periodStart: periodoDetalheInicio,
      periodEnd: periodoDetalheFim,
      filial: query.filial,
      bandeira: query.bandeira,
      tipo: query.tipo,
      statusMatch: query.statusMatch,
      tratativa: query.tratativa,
      somenteFaltantes: query.somenteFaltantes,
      somenteDivergencias: query.somenteDivergencias,
      somenteDuplicidades: query.somenteDuplicidades,
      valorExato: query.valorExato,
      nsuOuAutorizacao: query.nsuOuAutorizacao,
      duplicataOuTitulo: query.duplicataOuTitulo,
      nossoNumero: query.nossoNumero,
      arquivoId: query.arquivoId,
    });

    let detalhes = result.linhasDetalhe;
    if (query.data) detalhes = detalhes.filter((item) => item.dataErp === query.data);
    if (query.filial) detalhes = detalhes.filter((item) => normalizeComparable(item.filialErp).includes(normalizeComparable(query.filial || "")));

    const resumoSelecionado = query.data && query.filial
      ? result.linhasResumo.find((item) => item.data === query.data && normalizeComparable(item.filial) === normalizeComparable(query.filial || ""))
      : null;

    addLog("PCPREST_PLANILHA", "PCPREST_PLANILHA_DETALHE", "Detalhe da validacao reversa PCPREST -> Planilha consultado", usuario, {
      periodStart: periodoDetalheInicio,
      periodEnd: periodoDetalheFim,
      data: query.data,
      filial: query.filial,
      totalDetalhesRetornados: detalhes.length,
    });

    return {
      cards: result.cards,
      diagnostico: result.diagnostico,
      resumo: resumoSelecionado,
      registros: toPagination(detalhes, query.page, safeLimit),
    };
  });

  app.post("/api/auditoria-cartao/pcprest-planilha/tratativa", async (req) => {
    const body = z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      filial: z.string().min(1),
      statusTratativa: tratamentoStatusSchema.optional(),
      motivo: z.string().optional(),
      observacao: z.string().optional(),
      revisado: z.boolean().optional(),
    }).parse(req.body);

    const usuario = currentUser(req);
    const atualizada = atualizarTratativaPcprestPlanilha(
      body.data,
      body.filial,
      {
        statusTratativa: body.statusTratativa,
        motivo: body.motivo,
        observacao: body.observacao,
        revisado: body.revisado,
      },
      usuario,
    );

    addLog("PCPREST_PLANILHA", "PCPREST_PLANILHA_TRATATIVA", "Tratativa da validacao reversa PCPREST -> Planilha atualizada", usuario, {
      data: body.data,
      filial: body.filial,
      statusTratativa: atualizada.statusTratativa,
    });

    return atualizada;
  });

  app.post("/api/auditoria-cartao/pcprest-planilha/reprocessar", async (req) => {
    const body = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      arquivoId: z.string().optional(),
    }).optional().parse(req.body);

    const usuario = currentUser(req);
    const result = await processarPcprestPlanilha({
      periodStart: body?.periodStart,
      periodEnd: body?.periodEnd,
      filial: body?.filial,
      bandeira: body?.bandeira,
      tipo: body?.tipo,
      arquivoId: body?.arquivoId,
    });

    addLog("PCPREST_PLANILHA", "PCPREST_PLANILHA_REPROCESSAR", "Reprocessamento da validacao reversa PCPREST -> Planilha executado", usuario, {
      periodStart: body?.periodStart,
      periodEnd: body?.periodEnd,
      filial: body?.filial || "TODAS",
      totalLinhasResumo: result.linhasResumo.length,
      totalDetalhes: result.linhasDetalhe.length,
    });

    return {
      cards: result.cards,
      diagnostico: result.diagnostico,
      linhas: toPagination(result.linhasResumo, 1, 200),
    };
  });

  app.post("/api/auditoria-cartao/consolidado-dia/reprocessar", async (req) => {
    const usuario = currentUser(req);
    const body = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
    }).optional().parse(req.body);

    const result = processarPainelConsolidadoDia({
      periodStart: body?.periodStart,
      periodEnd: body?.periodEnd,
      bandeira: body?.bandeira,
      tipo: body?.tipo,
    }, usuario);

    addLog("CONSOLIDADO_DIA", "CONSOLIDADO_DIA_REPROCESSAMENTO", "Reprocessamento consolidado por dia executado", usuario, {
      nivelConciliacao: "CONSOLIDADO_DIA",
      periodStart: body?.periodStart,
      periodEnd: body?.periodEnd,
      totalDias: result.linhas.length,
    });

    return result;
  });

  app.get("/api/auditoria-cartao/consolidado-dia/:data/detalhe", async (req, reply) => {
    const params = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params);
    const query = z.object({
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipo: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).optional(),
    }).parse(req.query);
    const safeLimit = Math.min(query.limit ?? 200, 200);

    const detalhe = buscarDetalheConsolidadoDia(params.data, {
      filial: query.filial,
      bandeira: query.bandeira,
      tipo: query.tipo,
    }, query.page, safeLimit);

    if (!detalhe) return reply.status(404).send({ error: { message: "Detalhe consolidado nao encontrado para a data informada." } });
    return detalhe;
  });

  app.post("/api/auditoria-cartao/consolidado-dia/:data/tratativa", async (req, reply) => {
    const params = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params);
    const body = z.object({
      statusTratativa: tratamentoStatusSchema.optional(),
      motivoTratativa: z.string().optional(),
      observacao: z.string().optional(),
      revisado: z.boolean().optional(),
    }).parse(req.body);

    const usuario = currentUser(req);
    processarPainelConsolidadoDia({ periodStart: params.data, periodEnd: params.data }, usuario);
    const atualizado = atualizarTratativaConsolidadoDia(params.data, body, usuario);
    if (!atualizado) return reply.status(404).send({ error: { message: "Registro consolidado nao encontrado para tratativa." } });

    registrarAjuste(
      "CONSOLIDADO_DIA",
      `CONSOLIDADO_DIA:${params.data}`,
      "TRATATIVA_CONSOLIDADO_DIA",
      "",
      atualizado.statusTratativa,
      body.observacao || body.motivoTratativa || "",
      usuario,
    );

    addLog("CONSOLIDADO_DIA", "TRATATIVA_CONSOLIDADO_DIA", "Tratativa do consolidado por dia atualizada", usuario, {
      nivelConciliacao: "CONSOLIDADO_DIA",
      dataReferencia: params.data,
      statusTratativa: atualizado.statusTratativa,
      motivoTratativa: atualizado.motivoTratativa,
    });

    return atualizado;
  });

  app.get("/api/auditoria-cartao/dias/:data", async (req, reply) => {
    const params = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params);
    const query = z.object({
      filial: z.string().optional(),
      statusConciliacao: concStatusSchema.optional(),
      modalidade: z.string().optional(),
      tipo: z.string().optional(),
      bandeira: z.string().optional(),
      parcelas: z.coerce.number().int().optional(),
      valorMin: z.coerce.number().optional(),
      valorMax: z.coerce.number().optional(),
      nsu: z.string().optional(),
      autorizacao: z.string().optional(),
      numeroPedido: z.string().optional(),
      cnpjEstabelecimento: z.string().optional(),
      somenteDivergencias: z.coerce.boolean().optional(),
      somenteNaoLocalizados: z.coerce.boolean().optional(),
      somenteCanceladas: z.coerce.boolean().optional(),
      somenteChargeback: z.coerce.boolean().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).optional(),
    }).parse(req.query);
    const safeLimit = Math.min(query.limit ?? 200, 200);

    const linhas = itensStore().filter((item) => item.camposNormalizados.dataVenda === params.data);

    let detalhe = linhas.map(buildLinhaDetalhe);

    if (query.filial) detalhe = detalhe.filter((item) => normalizeComparable(item.filial).includes(normalizeComparable(query.filial || "")));
    if (query.statusConciliacao) detalhe = detalhe.filter((item) => item.statusConciliacao === query.statusConciliacao);
    if (query.modalidade) detalhe = detalhe.filter((item) => normalizeComparable(item.modalidade).includes(normalizeComparable(query.modalidade || "")));
    if (query.tipo) detalhe = detalhe.filter((item) => normalizeComparable(item.modalidade).includes(normalizeComparable(query.tipo || "")));
    if (query.bandeira) detalhe = detalhe.filter((item) => normalizeComparable(item.bandeira).includes(normalizeComparable(query.bandeira || "")));
    if (typeof query.parcelas === "number") detalhe = detalhe.filter((item) => item.parcelas === query.parcelas);
    if (typeof query.valorMin === "number") detalhe = detalhe.filter((item) => item.valorOperadora >= (query.valorMin ?? 0));
    if (typeof query.valorMax === "number") detalhe = detalhe.filter((item) => item.valorOperadora <= (query.valorMax ?? Number.MAX_SAFE_INTEGER));
    if (query.nsu) detalhe = detalhe.filter((item) => normalizeComparable(item.nsuCv).includes(normalizeComparable(query.nsu || "")));
    if (query.autorizacao) detalhe = detalhe.filter((item) => normalizeComparable(item.autorizacao).includes(normalizeComparable(query.autorizacao || "")));
    if (query.numeroPedido) detalhe = detalhe.filter((item) => normalizeComparable(item.numeroPedido).includes(normalizeComparable(query.numeroPedido || "")));
    if (query.cnpjEstabelecimento) {
      const byItem = new Map(itensStore().map((item) => [item.id, item.camposNormalizados.cnpjEstabelecimento]));
      detalhe = detalhe.filter((item) => normalizeComparable(byItem.get(item.itemId) || "").includes(normalizeComparable(query.cnpjEstabelecimento || "")));
    }

    if (query.somenteDivergencias) detalhe = detalhe.filter((item) => item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO");
    if (query.somenteNaoLocalizados) detalhe = detalhe.filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP");
    if (query.somenteCanceladas) detalhe = detalhe.filter((item) => item.cancelada);
    if (query.somenteChargeback) detalhe = detalhe.filter((item) => item.chargeback);

    detalhe.sort((a, b) => Math.abs(b.diferencaValor) - Math.abs(a.diferencaValor));

    let auditoriaInversa = divergenciasStore()
      .filter((item) => item.tipoDivergencia === "NAO_ENCONTRADO_NA_OPERADORA")
      .filter((item) => item.importacaoId !== "CONSOLIDADO_DIA")
      .filter((item) => item.dataVenda === params.data);

    if (query.filial) {
      auditoriaInversa = auditoriaInversa.filter((item) =>
        normalizeComparable(item.filial).includes(normalizeComparable(query.filial || "")));
    }
    if (query.bandeira) {
      auditoriaInversa = auditoriaInversa.filter((item) =>
        normalizeComparable(item.bandeira).includes(normalizeComparable(query.bandeira || "")));
    }

    if (detalhe.length === 0 && auditoriaInversa.length === 0) {
      return reply.status(404).send({ error: { message: "Nao ha registros para a data informada." } });
    }

    const valorNaoRecebidasNoArquivo = round2(sumBy(auditoriaInversa, (item) => item.valorErp));
    const naoRecebidasNoArquivo = auditoriaInversa.length;

    const quantidadeConciliadas = detalhe.filter((item) => ["CONCILIADO_EXATO", "CONCILIADO_APROXIMADO"].includes(item.statusConciliacao)).length;
    const quantidadeDivergenciasOperadora = detalhe.filter((item) =>
      item.statusConciliacao.startsWith("DIVERGENCIA")
      || item.statusConciliacao === "DUPLICIDADE"
      || item.statusConciliacao === "PENDENTE_REVISAO").length;
    const totalComparado = detalhe.length + naoRecebidasNoArquivo;

    const resumo = {
      data: params.data,
      quantidadeVendas: totalComparado,
      quantidadeConciliadas,
      quantidadeDivergencias: quantidadeDivergenciasOperadora + naoRecebidasNoArquivo,
      valorOperadora: round2(sumBy(detalhe, (item) => item.valorOperadora)),
      valorErp: round2(sumBy(detalhe, (item) => item.valorErp) + valorNaoRecebidasNoArquivo),
      diferencaTotal: round2(sumBy(detalhe, (item) => item.valorOperadora - item.valorErp) - valorNaoRecebidasNoArquivo),
      naoLocalizadas: detalhe.filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP").length,
      naoRecebidasNoArquivo,
      valorNaoRecebidasNoArquivo,
      canceladas: detalhe.filter((item) => item.statusConciliacao === "CANCELADA").length,
      chargebacks: detalhe.filter((item) => item.statusConciliacao === "CHARGEBACK").length,
      percentualConciliacao: totalComparado > 0
        ? round2((quantidadeConciliadas / totalComparado) * 100)
        : 0,
    };

    const agrupar = (selector: (item: typeof detalhe[number]) => string) => {
      const map = new Map<string, { chave: string; quantidade: number; valor: number }>();
      for (const row of detalhe) {
        const key = selector(row) || "SEM_INFO";
        if (!map.has(key)) map.set(key, { chave: key, quantidade: 0, valor: 0 });
        const ref = map.get(key)!;
        ref.quantidade += 1;
        ref.valor = round2(ref.valor + row.diferencaValor);
      }
      return Array.from(map.values());
    };

    return {
      resumo,
      agrupamentos: {
        porFilial: agrupar((item) => item.filial),
        porBandeira: agrupar((item) => item.bandeira),
        porModalidade: agrupar((item) => item.modalidade),
        porParcelas: agrupar((item) => String(item.parcelas)),
        porStatus: agrupar((item) => item.statusConciliacao),
      },
      vendas: toPagination(detalhe, query.page, safeLimit),
      divergencias: detalhe.filter((item) => item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO"),
      auditoriaInversa: auditoriaInversa.map((item) => ({
        id: item.id,
        referenciaErpId: item.referenciaErpId || "",
        codCobranca: item.codCobranca || "",
        filial: item.filial,
        bandeira: item.bandeira,
        valorErp: item.valorErp,
        descricao: item.descricao,
        statusTratativa: item.statusTratativa,
        revisado: item.revisado,
      })),
    };
  });

  app.get("/api/auditoria-cartao/vendas/:itemId", async (req, reply) => {
    const params = z.object({ itemId: z.string() }).parse(req.params);
    const item = itensStore().find((record) => record.id === params.itemId);
    if (!item) return reply.status(404).send({ error: { message: "Venda nao encontrada." } });

    const match = matchesStore().find((record) => record.itemImportadoId === item.id) || null;
    const divergencias = divergenciasStore().filter((record) => record.itemImportadoId === item.id);
    const importacao = importacoesStore().find((record) => record.id === item.importacaoId) || null;
    const historico = logsStore().filter((record) => record.importacaoId === item.importacaoId);
    const valorItem = item.camposNormalizados.valorBrutoAtualizado > 0
      ? item.camposNormalizados.valorBrutoAtualizado
      : item.camposNormalizados.valorBruto;
    const valorItemRounded = round2(valorItem);

    const lancamentosRelacionados = itensStore()
      .filter((record) => {
        if (record.camposNormalizados.dataVenda !== item.camposNormalizados.dataVenda) return false;
        if (normalizeComparable(record.camposNormalizados.codfilialArquivo) !== normalizeComparable(item.camposNormalizados.codfilialArquivo)) return false;
        const valorRegistro = record.camposNormalizados.valorBrutoAtualizado > 0
          ? record.camposNormalizados.valorBrutoAtualizado
          : record.camposNormalizados.valorBruto;
        return round2(valorRegistro) === valorItemRounded;
      })
      .sort((a, b) => {
        const horaA = a.camposNormalizados.horaVenda || "";
        const horaB = b.camposNormalizados.horaVenda || "";
        if (horaA === horaB) return a.id.localeCompare(b.id);
        return horaA.localeCompare(horaB);
      })
      .map((record) => {
        const valorOperadora = record.camposNormalizados.valorBrutoAtualizado > 0
          ? record.camposNormalizados.valorBrutoAtualizado
          : record.camposNormalizados.valorBruto;
        return {
          itemId: record.id,
          importacaoId: record.importacaoId,
          linhaOrigem: record.linhaOrigem,
          dataVenda: record.camposNormalizados.dataVenda,
          horaVenda: record.camposNormalizados.horaVenda,
          filial: record.camposNormalizados.codfilialArquivo,
          bandeira: record.camposNormalizados.bandeira,
          numeroPedido: record.camposNormalizados.numeroPedido,
          nsuCv: record.camposNormalizados.nsuCv,
          autorizacao: record.camposNormalizados.autorizacao,
          tid: record.camposNormalizados.tid,
          valorOperadora,
          statusConciliacao: record.statusConciliacao,
        };
      });

    return {
      item,
      match,
      divergencias,
      importacao,
      historico,
      lancamentosRelacionados,
      trilhaAuditoria: {
        statusConciliacao: item.statusConciliacao,
        scoreMatch: match?.scoreMatch || 0,
        regraAplicada: match?.regraMatch || "SEM_MATCH",
        motivoDivergencia: item.camposNormalizados.motivoDivergencia,
      },
    };
  });

  app.get("/api/auditoria-cartao/divergencias", async (req) => {
    const query = z.object({
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      filial: z.string().optional(),
      tipoDivergencia: divergenciaTipoSchema.optional(),
      statusTratativa: tratamentoStatusSchema.optional(),
      revisado: z.coerce.boolean().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    let records = divergenciasStore();
    if (query.periodStart) {
      const periodStart = query.periodStart;
      records = records.filter((item) => item.dataVenda >= periodStart);
    }
    if (query.periodEnd) {
      const periodEnd = query.periodEnd;
      records = records.filter((item) => item.dataVenda <= periodEnd);
    }
    if (query.filial) records = records.filter((item) => normalizeComparable(item.filial).includes(normalizeComparable(query.filial || "")));
    if (query.tipoDivergencia) records = records.filter((item) => item.tipoDivergencia === query.tipoDivergencia);
    if (query.statusTratativa) records = records.filter((item) => item.statusTratativa === query.statusTratativa);
    if (typeof query.revisado === "boolean") records = records.filter((item) => item.revisado === query.revisado);

    records = [...records].sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
    return toPagination(records, query.page, query.limit);
  });

  app.post("/api/auditoria-cartao/divergencias/:id/reclassificar", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      tipoDivergencia: divergenciaTipoSchema,
      observacao: z.string().optional(),
    }).parse(req.body);

    const divergence = divergenciasStore().find((item) => item.id === params.id);
    if (!divergence) return reply.status(404).send({ error: { message: "Divergencia nao encontrada." } });

    const usuario = currentUser(req);
    const before = divergence.tipoDivergencia;
    divergence.tipoDivergencia = body.tipoDivergencia;
    divergence.statusTratativa = "EM_ANALISE";
    divergence.atualizadoEm = nowIso();
    divergence.atualizadoPor = usuario;
    divergence.observacao = [divergence.observacao, body.observacao || ""].filter(Boolean).join("\n");

    if (divergence.itemImportadoId) {
      const item = itensStore().find((record) => record.id === divergence.itemImportadoId);
      if (item) {
        item.statusConciliacao = body.tipoDivergencia as ConciliacaoStatus;
        item.camposNormalizados.statusConciliacao = body.tipoDivergencia as ConciliacaoStatus;
        item.camposNormalizados.motivoDivergencia = `Reclassificado manualmente para ${body.tipoDivergencia}`;
      }
    }

    registrarAjuste(
      divergence.importacaoId,
      divergence.id,
      "RECLASSIFICAR",
      before,
      body.tipoDivergencia,
      body.observacao || "",
      usuario,
    );

    addLog(divergence.importacaoId, "AJUSTE_MANUAL", "Divergencia reclassificada manualmente", usuario, {
      divergenciaId: divergence.id,
      antes: before,
      depois: body.tipoDivergencia,
    });

    return divergence;
  });

  app.post("/api/auditoria-cartao/divergencias/:id/revisar", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      revisado: z.boolean(),
      observacao: z.string().optional(),
    }).parse(req.body);

    const divergence = divergenciasStore().find((item) => item.id === params.id);
    if (!divergence) return reply.status(404).send({ error: { message: "Divergencia nao encontrada." } });

    const usuario = currentUser(req);
    const before = divergence.statusTratativa;
    divergence.revisado = body.revisado;
    divergence.statusTratativa = body.revisado ? "REVISADA" : "ABERTA";
    divergence.atualizadoEm = nowIso();
    divergence.atualizadoPor = usuario;
    divergence.observacao = [divergence.observacao, body.observacao || ""].filter(Boolean).join("\n");

    registrarAjuste(
      divergence.importacaoId,
      divergence.id,
      "REVISAR",
      before,
      divergence.statusTratativa,
      body.observacao || "",
      usuario,
    );

    addLog(divergence.importacaoId, "TRATATIVA", "Divergencia marcada como revisada", usuario, {
      divergenciaId: divergence.id,
      revisado: body.revisado,
    });

    return divergence;
  });

  app.post("/api/auditoria-cartao/divergencias/:id/observacao", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ observacao: z.string().min(1) }).parse(req.body);

    const divergence = divergenciasStore().find((item) => item.id === params.id);
    if (!divergence) return reply.status(404).send({ error: { message: "Divergencia nao encontrada." } });

    const usuario = currentUser(req);
    const timestamp = new Date().toLocaleString("pt-BR");
    const novaNota = `[${timestamp}] ${usuario}: ${body.observacao}`;

    divergence.observacao = [divergence.observacao, novaNota].filter(Boolean).join("\n");
    divergence.atualizadoEm = nowIso();
    divergence.atualizadoPor = usuario;

    registrarAjuste(
      divergence.importacaoId,
      divergence.id,
      "OBSERVACAO",
      "",
      "",
      body.observacao,
      usuario,
    );

    addLog(divergence.importacaoId, "TRATATIVA", "Observacao manual adicionada", usuario, {
      divergenciaId: divergence.id,
    });

    return divergence;
  });

  app.get("/api/auditoria-cartao/importacoes", async (req) => {
    reconciliarImportacoesOrfas(currentUser(req));

    const query = z.object({
      operadora: operadoraSchema.optional(),
      status: z.enum(["PENDENTE", "PROCESSANDO", "CONCLUIDO", "ERRO"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    let records = [...importacoesStore()].sort((a, b) => b.dataUpload.localeCompare(a.dataUpload));
    if (query.operadora) records = records.filter((item) => item.operadora === query.operadora);
    if (query.status) records = records.filter((item) => item.statusProcessamento === query.status);

    return toPagination(records, query.page, query.limit);
  });

  app.get("/api/auditoria-cartao/importacoes/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    reconciliarImportacoesOrfas(currentUser(req));
    const record = importacoesStore().find((item) => item.id === params.id);
    if (!record) return reply.status(404).send({ error: { message: "Importacao nao encontrada." } });

    const itens = itensStore().filter((item) => item.importacaoId === record.id);
    const logs = logsStore().filter((item) => item.importacaoId === record.id);

    return {
      ...record,
      itens,
      logs,
    };
  });

  app.post("/api/auditoria-cartao/upload", async (req, reply) => {
    const usuario = currentUser(req);

    let operadora: OperadoraCartao = "REDE";
    let arquivoNome = "";
    let arquivoBuffer: Buffer | null = null;

    const parts = (req as any).parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "operadora") {
          const parsed = operadoraSchema.safeParse(String(part.value || "").trim().toUpperCase());
          if (parsed.success) operadora = parsed.data;
        }
        continue;
      }

      if (part.type === "file" && !arquivoBuffer) {
        arquivoNome = String(part.filename || "importacao-rede.xlsx");
        arquivoBuffer = await part.toBuffer();
      }
    }

    if (!arquivoBuffer || arquivoBuffer.length === 0) {
      return reply.status(400).send({ error: { message: "Arquivo nao informado." } });
    }

    const hashArquivo = createHash("sha256").update(arquivoBuffer).digest("hex");
    const duplicates = importacoesStore().filter((item) => item.hashArquivo === hashArquivo && item.operadora === operadora);
    const duplicateAtivo = duplicates.find((item) => item.statusProcessamento !== "ERRO");
    if (duplicateAtivo) {
      return reply.status(409).send({
        error: { message: "Arquivo ja processado anteriormente." },
        importacaoExistenteId: duplicateAtivo.id,
      });
    }

    const importacao: AuditoriaCartaoImportacao = {
      id: nextId("ACI", importacoesStore().length),
      operadora,
      nomeArquivo: arquivoNome,
      hashArquivo,
      periodoInicial: "",
      periodoFinal: "",
      dataUpload: nowIso(),
      usuarioUpload: usuario,
      statusProcessamento: "PROCESSANDO",
      layoutOrigem: "REDE_XLSX",
      totalLinhas: 0,
      totalValidas: 0,
      totalInvalidas: 0,
      totalConciliadas: 0,
      totalDivergentes: 0,
      totalNaoLocalizadas: 0,
      totalCanceladas: 0,
      totalChargebacks: 0,
    };

    importacoesStore().unshift(importacao);
    addLog(importacao.id, "UPLOAD", "Arquivo recebido para processamento", usuario, {
      nomeArquivo: arquivoNome,
      hashArquivo,
    });
    persistAuditoriaCartaoState();

    const agendado = agendarProcessamentoImportacao(importacao, usuario, async () => {
      await processarUploadEmSegundoPlano(importacao, arquivoBuffer, usuario);
    });

    if (!agendado) {
      marcarImportacaoComErro(importacao, usuario, "Ja existe um processamento ativo para esta importacao.");
      return reply.status(409).send({ error: { message: "Importacao ja esta em processamento." } });
    }

    return reply.status(202).send({
      importacao,
      processamento: {
        assincrono: true,
        status: "PROCESSANDO",
        mensagem: "Upload recebido. Processamento iniciado em segundo plano.",
      },
    });
  });

  app.post("/api/auditoria-cartao/importacoes/:id/reprocessar", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const usuario = currentUser(req);
    const importacao = importacoesStore().find((item) => item.id === params.id);
    if (!importacao) return reply.status(404).send({ error: { message: "Importacao nao encontrada." } });
    if (processamentosAtivos.has(importacao.id)) {
      return reply.status(409).send({ error: { message: "Importacao ja esta em processamento." } });
    }

    const itens = itensStore().filter((item) => item.importacaoId === importacao.id);
    if (itens.length === 0) return reply.status(409).send({ error: { message: "Importacao sem itens para reprocessar." } });

    importacao.statusProcessamento = "PROCESSANDO";
    importacao.observacaoErro = undefined;
    importacao.processadoEm = undefined;

    addLog(importacao.id, "REPROCESSAMENTO", "Reprocessamento solicitado manualmente", usuario);

    const agendado = agendarProcessamentoImportacao(importacao, usuario, async () => {
      await executarConciliacaoImportacao(importacao, itens, usuario);
      appendAudit(
        "AUDITORIA_CARTAO_REPROCESSAR_IMPORTACAO",
        "AUDITORIA_CARTAO_IMPORTACAO",
        importacao.id,
        `Importacao ${importacao.nomeArquivo} reprocessada. Conciliadas: ${importacao.totalConciliadas}; Divergentes: ${importacao.totalDivergentes}`,
        usuario,
      );
      persistAuditoriaCartaoState();
    });

    if (!agendado) {
      return reply.status(409).send({ error: { message: "Importacao ja esta em processamento." } });
    }

    return {
      importacao,
      processamento: {
        assincrono: true,
        status: "PROCESSANDO",
        mensagem: "Reprocessamento iniciado em segundo plano.",
      },
    };
  });

  app.delete("/api/auditoria-cartao/importacoes/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const usuario = currentUser(req);

    if (processamentosAtivos.has(params.id)) {
      return reply.status(409).send({
        error: {
          message: "Importacao esta em processamento ativo. Aguarde concluir ou tente novamente em instantes.",
        },
      });
    }

    const indexImportacao = importacoesStore().findIndex((item) => item.id === params.id);
    if (indexImportacao < 0) {
      return reply.status(404).send({ error: { message: "Importacao nao encontrada." } });
    }

    const [importacaoRemovida] = importacoesStore().splice(indexImportacao, 1);
    const itensDaImportacao = itensStore().filter((item) => item.importacaoId === importacaoRemovida.id);
    const itemIds = new Set(itensDaImportacao.map((item) => item.id));

    const totalItensRemovidos = itensDaImportacao.length;
    const totalMatchesRemovidos = matchesStore().filter((item) => item.importacaoId === importacaoRemovida.id || itemIds.has(item.itemImportadoId)).length;
    const totalDivergenciasRemovidas = divergenciasStore().filter((item) => item.importacaoId === importacaoRemovida.id || (item.itemImportadoId ? itemIds.has(item.itemImportadoId) : false)).length;
    const totalLogsRemovidos = logsStore().filter((item) => item.importacaoId === importacaoRemovida.id).length;
    const totalAjustesRemovidos = ajustesStore().filter((item) => item.importacaoId === importacaoRemovida.id).length;

    db.auditoriaCartaoImportacaoItens = itensStore().filter((item) => item.importacaoId !== importacaoRemovida.id);
    db.auditoriaCartaoMatches = matchesStore().filter((item) => item.importacaoId !== importacaoRemovida.id && !itemIds.has(item.itemImportadoId));
    db.auditoriaCartaoDivergencias = divergenciasStore().filter((item) => {
      if (item.importacaoId === importacaoRemovida.id) return false;
      if (item.itemImportadoId && itemIds.has(item.itemImportadoId)) return false;
      return true;
    });
    db.auditoriaCartaoLogs = logsStore().filter((item) => item.importacaoId !== importacaoRemovida.id);
    db.auditoriaCartaoAjustesManuais = ajustesStore().filter((item) => item.importacaoId !== importacaoRemovida.id);

    // Reconstroi snapshots/linhas consolidadas para evitar valores residuais apos exclusao.
    db.auditoriaCartaoConsolidadoDia = [];
    db.auditoriaCartaoDivergencias = divergenciasStore().filter((item) => item.importacaoId !== "CONSOLIDADO_DIA");
    processarPainelConsolidadoDia({}, usuario);

    appendAudit(
      "AUDITORIA_CARTAO_EXCLUIR_IMPORTACAO",
      "AUDITORIA_CARTAO_IMPORTACAO",
      importacaoRemovida.id,
      `Importacao ${importacaoRemovida.nomeArquivo} excluida. Itens: ${totalItensRemovidos}; Matches: ${totalMatchesRemovidos}; Divergencias: ${totalDivergenciasRemovidas}.`,
      usuario,
    );

    return {
      ok: true,
      importacaoId: importacaoRemovida.id,
      removidos: {
        itens: totalItensRemovidos,
        matches: totalMatchesRemovidos,
        divergencias: totalDivergenciasRemovidas,
        logs: totalLogsRemovidos,
        ajustes: totalAjustesRemovidos,
      },
    };
  });

  app.get("/api/auditoria-cartao/configuracoes", async (req) => ensureConfiguracao(currentUser(req)));

  app.put("/api/auditoria-cartao/configuracoes", async (req) => {
    const usuario = currentUser(req);
    const payload = configuracaoSchema.parse(req.body);
    const regra = ensureConfiguracao(usuario);

    regra.toleranciaValor = payload.toleranciaValor;
    regra.janelaHorarioMinutos = payload.janelaHorarioMinutos;
    regra.prioridadeChaves = payload.prioridadeChaves;
    if (payload.pesosChaves) regra.pesosChaves = payload.pesosChaves;
    if (payload.regrasPorOperadora) regra.regrasPorOperadora = payload.regrasPorOperadora;
    if (payload.mapeamentoEstabelecimentoFilial) regra.mapeamentoEstabelecimentoFilial = payload.mapeamentoEstabelecimentoFilial;
    regra.regraParceladoVista = payload.regraParceladoVista;
    regra.tratamentoCancelamento = payload.tratamentoCancelamento;
    regra.tratamentoChargeback = payload.tratamentoChargeback;
    regra.atualizadoEm = nowIso();
    regra.atualizadoPor = usuario;
    return regra;
  });

  app.get("/api/auditoria-cartao/logs", async (req) => {
    const query = z.object({
      importacaoId: z.string().optional(),
      etapa: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    let records = [...logsStore()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    if (query.importacaoId) records = records.filter((item) => item.importacaoId === query.importacaoId);
    if (query.etapa) records = records.filter((item) => normalizeComparable(item.etapa).includes(normalizeComparable(query.etapa || "")));
    return toPagination(records, query.page, query.limit);
  });

  app.get("/api/auditoria-cartao/export", async (req, reply) => {
    const query = z.object({
      tipo: z.enum([
        "RESUMO_DIA",
        "DIVERGENCIAS",
        "DETALHE_VENDAS",
        "CONSOLIDADO_PERIODO",
        "NAO_ENCONTRADAS",
        "CANCELAMENTOS_CHARGEBACK",
        "CONSOLIDADO_DIA",
        "CONSOLIDADO_DIA_DETALHE",
        "PCPREST_PLANILHA_RESUMO",
        "PCPREST_PLANILHA_DETALHE",
        "PCPREST_PLANILHA_FALTANTES",
        "PCPREST_PLANILHA_DIVERGENCIAS",
        "PCPREST_PLANILHA_DUPLICIDADES",
      ]),
      data: z.string().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      filial: z.string().optional(),
      bandeira: z.string().optional(),
      tipoFiltro: z.string().optional(),
      statusMatch: pcprestPlanilhaStatusSchema.or(z.literal("TODOS")).optional(),
      tratativa: tratamentoStatusSchema.or(z.literal("TODOS")).optional(),
      arquivoId: z.string().optional(),
    }).parse(req.query);

    let csvRows: any[] = [];
    if (query.tipo === "RESUMO_DIA") {
      csvRows = calcularPainelDiario(itensStore(), query.periodStart, query.periodEnd);
    } else if (query.tipo === "DIVERGENCIAS") {
      csvRows = divergenciasStore().filter((item) => filtroPeriodo(item.dataVenda, query.periodStart, query.periodEnd));
    } else if (query.tipo === "DETALHE_VENDAS") {
      csvRows = itensStore()
        .filter((item) => (query.data ? item.camposNormalizados.dataVenda === query.data : true))
        .filter((item) => filtroPeriodo(item.camposNormalizados.dataVenda, query.periodStart, query.periodEnd))
        .map((item) => buildLinhaDetalhe(item));
    } else if (query.tipo === "CONSOLIDADO_PERIODO") {
      csvRows = importacoesStore().filter((item) => {
        const date = item.dataUpload.slice(0, 10);
        return filtroPeriodo(date, query.periodStart, query.periodEnd);
      });
    } else if (query.tipo === "CONSOLIDADO_DIA") {
      csvRows = processarPainelConsolidadoDia({
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        bandeira: query.bandeira,
        tipo: query.tipoFiltro,
      }, currentUser(req)).linhas;
    } else if (query.tipo === "CONSOLIDADO_DIA_DETALHE") {
      if (!query.data) return reply.status(400).send({ error: { message: "Parametro data obrigatorio para exportar detalhe consolidado." } });
      const detalhe = buscarDetalheConsolidadoDia(query.data, {
        bandeira: query.bandeira,
        tipo: query.tipoFiltro,
      }, 1, 200);
      if (!detalhe) return reply.status(404).send({ error: { message: "Detalhe consolidado nao encontrado para exportacao." } });
      csvRows = detalhe.transacoes.items.map((item) => ({
        data_referencia: detalhe.resumo.data,
        status_consolidado: detalhe.resumo.statusConsolidado,
        tratativa: detalhe.resumo.statusTratativa,
        possui_divergencia_interna_filial: detalhe.resumo.possuiDivergenciaInternaFilial ? "SIM" : "NAO",
        tipo_registro: item.tipoRegistro,
        identificador_operadora: item.identificadorOperadora,
        nosso_numero: item.nossoNumero,
        nsu_cv: item.nsuCv,
        autorizacao: item.autorizacao,
        data_venda: item.dataVenda,
        hora_venda: item.horaVenda,
        filial: item.filial,
        bandeira: item.bandeira,
        meio_pagamento: item.meioPagamento,
        tipo: item.tipo,
        valor_operadora: item.valorOperadora,
        valor_erp: item.valorErp,
        diferenca: round2(item.valorOperadora - item.valorErp),
        status_match: item.statusMatch,
        motivo_divergencia: item.motivoDivergencia,
      }));
    } else if (query.tipo.startsWith("PCPREST_PLANILHA_")) {
      const analise = await processarPcprestPlanilha({
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        filial: query.filial,
        bandeira: query.bandeira,
        tipo: query.tipoFiltro,
        statusMatch: query.statusMatch,
        tratativa: query.tratativa,
        arquivoId: query.arquivoId,
      });

      if (query.tipo === "PCPREST_PLANILHA_RESUMO") {
        csvRows = analise.linhasResumo.map((item) => ({
          data: item.data,
          filial: item.filial,
          quantidade_erp: item.quantidadeErp,
          valor_erp: item.valorErp,
          quantidade_encontrada_planilha: item.quantidadeEncontradaPlanilha,
          valor_encontrado_planilha: item.valorEncontradoPlanilha,
          quantidade_faltante: item.quantidadeFaltante,
          valor_faltante: item.valorFaltante,
          quantidade_com_divergencia: item.quantidadeComDivergencia,
          status_resumo: item.statusResumo,
          status_tratativa: item.statusTratativa,
          observacao: item.observacao,
          ultimo_processamento: item.ultimoProcessamento,
        }));
      } else if (query.tipo === "PCPREST_PLANILHA_FALTANTES") {
        csvRows = analise.linhasDetalhe
          .filter((item) => item.statusMatch === "NAO_ENCONTRADO")
          .map((item) => ({
            data_erp: item.dataErp,
            filial_erp: item.filialErp,
            referencia_erp: item.referenciaErpId,
            titulo_erp: item.tituloDuplicataErp,
            valor_erp: item.valorErp,
            status_match: item.statusMatch,
            motivo: item.motivo,
            status_tratativa: item.statusTratativa,
          }));
      } else if (query.tipo === "PCPREST_PLANILHA_DIVERGENCIAS") {
        csvRows = analise.linhasDetalhe
          .filter((item) =>
            [
              "ENCONTRADO_COM_DIFERENCA_DE_VALOR",
              "ENCONTRADO_COM_DIFERENCA_DE_DATA",
              "ENCONTRADO_COM_DIFERENCA_DE_FILIAL",
              "ENCONTRADO_COM_DIFERENCA_DE_BANDEIRA",
              "PENDENTE_DE_ANALISE",
            ].includes(item.statusMatch))
          .map((item) => ({
            data_erp: item.dataErp,
            filial_erp: item.filialErp,
            referencia_erp: item.referenciaErpId,
            valor_erp: item.valorErp,
            data_planilha: item.dataPlanilha,
            filial_planilha: item.filialPlanilha,
            valor_planilha: item.valorPlanilha,
            status_match: item.statusMatch,
            motivo: item.motivo,
            score_match: item.scoreMatch,
          }));
      } else if (query.tipo === "PCPREST_PLANILHA_DUPLICIDADES") {
        csvRows = analise.linhasDetalhe
          .filter((item) => item.statusMatch === "DUPLICIDADE_NA_PLANILHA" || item.statusMatch === "MATCH_AMBIGUO")
          .map((item) => ({
            data_erp: item.dataErp,
            filial_erp: item.filialErp,
            referencia_erp: item.referenciaErpId,
            valor_erp: item.valorErp,
            status_match: item.statusMatch,
            motivo: item.motivo,
          }));
      } else {
        csvRows = analise.linhasDetalhe.map((item) => ({
          data_erp: item.dataErp,
          filial_erp: item.filialErp,
          titulo_duplicata_erp: item.tituloDuplicataErp,
          nsu_autorizacao_erp: item.nsuAutorizacaoErp,
          bandeira_erp: item.bandeiraErp,
          tipo_erp: item.tipoErp,
          valor_erp: item.valorErp,
          data_planilha: item.dataPlanilha,
          filial_planilha: item.filialPlanilha,
          bandeira_planilha: item.bandeiraPlanilha,
          valor_planilha: item.valorPlanilha,
          status_match: item.statusMatch,
          motivo: item.motivo,
          score_match: item.scoreMatch,
          regra_match: item.regraMatch,
          status_tratativa: item.statusTratativa,
        }));
      }
    } else if (query.tipo === "NAO_ENCONTRADAS") {
      csvRows = itensStore().filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP");
    } else {
      csvRows = itensStore().filter((item) => item.statusConciliacao === "CANCELADA" || item.statusConciliacao === "CHARGEBACK");
    }

    addLog("CONSOLIDADO_DIA", "EXPORTACAO_AUDITORIA_CARTAO", "Exportacao solicitada", currentUser(req), {
      tipo: query.tipo,
      data: query.data,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      nivelConciliacao: query.tipo.startsWith("PCPREST_PLANILHA_")
        ? "ERP_PARA_PLANILHA"
        : ["CONSOLIDADO_DIA", "CONSOLIDADO_DIA_DETALHE"].includes(query.tipo)
          ? "CONSOLIDADO_DIA"
          : "FILIAL_DIA",
    });

    const csv = toCsv(csvRows as Array<Record<string, unknown>>);
    const fileName = `auditoria-cartao-${query.tipo.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=\"${fileName}\"`);
    return csv;
  });
}
