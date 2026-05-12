import { nextId } from "../../repositories/dataStore.js";
import { parseNumber, sumBy, toPagination } from "./helpers.js";
import { ensureConfiguracao, makeDivergencia, normalizeComparable, nowIso, round2 } from "./state.js";
import {
  consolidadoDiaStore,
  divergenciasStore,
  importacoesStore,
  itensStore,
  matchesStore,
  type AuditoriaCartaoConsolidadoDia,
  type ConciliacaoStatus,
  type ConsolidadoDiaStatus,
  type TratamentoStatus,
} from "./types.js";

type ConsolidadoDiaStatusFiltro = ConsolidadoDiaStatus | "TODOS";
type ConsolidadoDiaTratativaFiltro = TratamentoStatus | "TODOS";

export interface ConsolidadoDiaFiltro {
  periodStart?: string;
  periodEnd?: string;
  bandeira?: string;
  tipo?: string;
  status?: ConsolidadoDiaStatusFiltro;
  tratativa?: ConsolidadoDiaTratativaFiltro;
}

export interface ConsolidadoDiaLinha {
  data: string;
  quantidadeTransacoesOperadora: number;
  quantidadeRegistrosErp: number;
  valorOperadoraTotalDia: number;
  valorErpTotalDia: number;
  diferenca: number;
  statusConsolidado: ConsolidadoDiaStatus;
  statusTratativa: TratamentoStatus;
  motivoTratativa: string;
  observacao: string;
  possuiDivergenciaInternaFilial: boolean;
  ultimoProcessamento: string;
  processadoEm: string;
}

export interface ConsolidadoDiaResumo {
  diasConciliados: number;
  diasDivergentes: number;
  totalOperadoraPeriodo: number;
  totalErpPeriodo: number;
  diferencaAcumuladaPeriodo: number;
}

export interface ConsolidadoFilialLinha {
  data: string;
  filial: string;
  quantidadeTransacoesOperadora: number;
  quantidadeRegistrosErp: number;
  valorOperadoraTotalDia: number;
  valorErpTotalDia: number;
  diferenca: number;
  statusConsolidado: ConsolidadoDiaStatus;
  ultimoProcessamento: string;
  processadoEm: string;
}

export interface ConsolidadoFilialResumo {
  filiaisConciliadas: number;
  filiaisDivergentes: number;
  totalOperadoraPeriodo: number;
  totalErpPeriodo: number;
  diferencaAcumuladaPeriodo: number;
  totalLinhas: number;
}

export interface ConsolidadoDiaFilialLinha {
  filial: string;
  valorOperadora: number;
  valorErp: number;
  diferenca: number;
  quantidadeOperadora: number;
  quantidadeErp: number;
  statusFilial: "CONCILIADO_FILIAL" | "DIVERGENCIA_FILIAL";
}

export interface ConsolidadoDiaTransacaoLinha {
  tipoRegistro: "OPERADORA" | "ERP_SEM_OPERADORA";
  itemId?: string;
  referenciaErpId?: string;
  nsuCv: string;
  autorizacao: string;
  identificadorOperadora: string;
  nossoNumero: string;
  dataVenda: string;
  horaVenda: string;
  bandeira: string;
  meioPagamento: string;
  tipo: string;
  filial: string;
  valorOperadora: number;
  valorErp: number;
  statusMatch: ConciliacaoStatus;
  motivoDivergencia: string;
}

export interface ConsolidadoDiaDetalhe {
  resumo: ConsolidadoDiaLinha;
  quebraPorFilial: ConsolidadoDiaFilialLinha[];
  transacoes: ReturnType<typeof toPagination<ConsolidadoDiaTransacaoLinha>>;
  alertaDivergenciaInternaFilial: boolean;
}

interface AggFilial {
  filial: string;
  quantidadeOperadora: number;
  quantidadeErp: number;
  valorOperadora: number;
  valorErp: number;
}

interface AggDia {
  data: string;
  quantidadeOperadora: number;
  quantidadeErp: number;
  valorOperadora: number;
  valorErp: number;
  porFilial: Map<string, AggFilial>;
}

function matchesFiltroTexto(valor: string, filtro?: string): boolean {
  if (!filtro) return true;
  return normalizeComparable(valor || "").includes(normalizeComparable(filtro));
}

function gerarDatasIntervalo(inicio: string, fim: string): string[] {
  const from = new Date(`${inicio}T00:00:00`);
  const to = new Date(`${fim}T00:00:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return [];

  const datas: string[] = [];
  for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
    datas.push(dt.toISOString().slice(0, 10));
  }
  return datas;
}

function statusConsolidadoDoDia(
  quantidadeOperadora: number,
  quantidadeErp: number,
  diferenca: number,
  toleranciaValor: number,
): ConsolidadoDiaStatus {
  if (quantidadeOperadora === 0 && quantidadeErp === 0) return "SEM_MOVIMENTO";
  if (quantidadeOperadora > 0 && quantidadeErp === 0) return "MOVIMENTO_SO_OPERADORA";
  if (quantidadeOperadora === 0 && quantidadeErp > 0) return "MOVIMENTO_SO_ERP";
  return Math.abs(diferenca) <= toleranciaValor ? "CONCILIADO" : "DIVERGENCIA_TOTAL_DIA";
}

function ultimoProcessamentoData(data: string): string {
  const relacionado = importacoesStore()
    .filter((item) => item.periodoInicial <= data && item.periodoFinal >= data)
    .sort((a, b) => (b.processadoEm || b.dataUpload).localeCompare(a.processadoEm || a.dataUpload))[0];
  return relacionado?.processadoEm || relacionado?.dataUpload || "";
}

function getAggMapBase(filters: ConsolidadoDiaFiltro): Map<string, AggDia> {
  const map = new Map<string, AggDia>();
  const byMatch = new Map(matchesStore().map((item) => [item.itemImportadoId, item]));

  const upsertDia = (data: string): AggDia => {
    if (!map.has(data)) {
      map.set(data, {
        data,
        quantidadeOperadora: 0,
        quantidadeErp: 0,
        valorOperadora: 0,
        valorErp: 0,
        porFilial: new Map<string, AggFilial>(),
      });
    }
    return map.get(data)!;
  };

  const upsertFilial = (dia: AggDia, filialRaw: string): AggFilial => {
    const filial = filialRaw || "SEM_FILIAL";
    if (!dia.porFilial.has(filial)) {
      dia.porFilial.set(filial, {
        filial,
        quantidadeOperadora: 0,
        quantidadeErp: 0,
        valorOperadora: 0,
        valorErp: 0,
      });
    }
    return dia.porFilial.get(filial)!;
  };

  for (const item of itensStore()) {
    const data = item.camposNormalizados.dataVenda;
    if (!data) continue;
    if (filters.periodStart && data < filters.periodStart) continue;
    if (filters.periodEnd && data > filters.periodEnd) continue;
    if (!matchesFiltroTexto(item.camposNormalizados.bandeira, filters.bandeira)) continue;
    if (
      filters.tipo
      && !matchesFiltroTexto(item.camposNormalizados.tipoTransacao, filters.tipo)
      && !matchesFiltroTexto(item.camposNormalizados.modalidade, filters.tipo)
    ) continue;

    const valorOperadora = item.camposNormalizados.valorBrutoAtualizado > 0
      ? item.camposNormalizados.valorBrutoAtualizado
      : item.camposNormalizados.valorBruto;
    const dia = upsertDia(data);
    const filial = upsertFilial(dia, item.camposNormalizados.codfilialArquivo);

    dia.quantidadeOperadora += 1;
    dia.valorOperadora = round2(dia.valorOperadora + valorOperadora);
    filial.quantidadeOperadora += 1;
    filial.valorOperadora = round2(filial.valorOperadora + valorOperadora);

    const match = byMatch.get(item.id);
    if (match) {
      const valorErpMatch = parseNumber(match.valorErp);
      dia.quantidadeErp += 1;
      dia.valorErp = round2(dia.valorErp + valorErpMatch);
      filial.quantidadeErp += 1;
      filial.valorErp = round2(filial.valorErp + valorErpMatch);
    }
  }

  for (const divergence of divergenciasStore()) {
    if (divergence.tipoDivergencia !== "NAO_ENCONTRADO_NA_OPERADORA") continue;
    const data = divergence.dataVenda;
    if (!data) continue;
    if (filters.periodStart && data < filters.periodStart) continue;
    if (filters.periodEnd && data > filters.periodEnd) continue;
    if (!matchesFiltroTexto(divergence.bandeira, filters.bandeira)) continue;
    if (filters.tipo) continue;

    const dia = upsertDia(data);
    const filial = upsertFilial(dia, divergence.filial);
    const valorErpDivergencia = parseNumber(divergence.valorErp);
    dia.quantidadeErp += 1;
    dia.valorErp = round2(dia.valorErp + valorErpDivergencia);
    filial.quantidadeErp += 1;
    filial.valorErp = round2(filial.valorErp + valorErpDivergencia);
  }

  return map;
}

function syncConsolidadoDivergencia(snapshot: AuditoriaCartaoConsolidadoDia, usuario: string): void {
  const registros = divergenciasStore();
  const existe = registros.find(
    (item) =>
      item.dataVenda === snapshot.dataReferencia
      && item.descricao.startsWith("CONSOLIDADO_DIA:")
      && !item.itemImportadoId,
  );

  const now = nowIso();
  const precisaDivergencia = ["DIVERGENCIA_TOTAL_DIA", "MOVIMENTO_SO_OPERADORA", "MOVIMENTO_SO_ERP"].includes(snapshot.statusConsolidado);
  if (!precisaDivergencia) {
    if (existe) {
      existe.statusTratativa = "RESOLVIDA";
      existe.revisado = true;
      existe.observacao = [existe.observacao, `[${now}] ${usuario}: Consolidado em estado ${snapshot.statusConsolidado}`]
        .filter(Boolean)
        .join("\n");
      existe.atualizadoEm = now;
      existe.atualizadoPor = usuario;
    }
    return;
  }

  const tipo = snapshot.statusConsolidado === "DIVERGENCIA_TOTAL_DIA"
    ? "DIVERGENCIA_VALOR"
    : snapshot.statusConsolidado === "MOVIMENTO_SO_OPERADORA"
      ? "NAO_ENCONTRADO_NO_ERP"
      : "NAO_ENCONTRADO_NA_OPERADORA";

  if (existe) {
    existe.tipoDivergencia = tipo;
    existe.descricao = `CONSOLIDADO_DIA:${snapshot.statusConsolidado}`;
    existe.valorOperadora = snapshot.valorOperadora;
    existe.valorErp = snapshot.valorErp;
    existe.diferenca = snapshot.diferenca;
    existe.filial = "CONSOLIDADO";
    existe.bandeira = "TODAS";
    existe.statusTratativa = snapshot.statusTratativa;
    existe.observacao = snapshot.observacao;
    existe.atualizadoEm = now;
    existe.atualizadoPor = usuario;
    return;
  }

  registros.unshift(makeDivergencia({
    importacaoId: "CONSOLIDADO_DIA",
    tipoDivergencia: tipo,
    descricao: `CONSOLIDADO_DIA:${snapshot.statusConsolidado}`,
    valorOperadora: snapshot.valorOperadora,
    valorErp: snapshot.valorErp,
    diferenca: snapshot.diferenca,
    filial: "CONSOLIDADO",
    bandeira: "TODAS",
    dataVenda: snapshot.dataReferencia,
    statusTratativa: snapshot.statusTratativa,
    revisado: false,
    observacao: snapshot.observacao,
  }, usuario));
}

function upsertSnapshot(
  data: string,
  linha: Omit<ConsolidadoDiaLinha, "statusTratativa" | "motivoTratativa" | "observacao">,
  usuario: string,
): AuditoriaCartaoConsolidadoDia {
  const snapshots = consolidadoDiaStore();
  const now = nowIso();
  const existente = snapshots.find((item) => item.dataReferencia === data && item.nivelConciliacao === "CONSOLIDADO_DIA");
  if (!existente) {
    const novo: AuditoriaCartaoConsolidadoDia = {
      id: nextId("ACCD", snapshots.length),
      dataReferencia: data,
      nivelConciliacao: "CONSOLIDADO_DIA",
      valorOperadora: linha.valorOperadoraTotalDia,
      valorErp: linha.valorErpTotalDia,
      diferenca: linha.diferenca,
      statusConsolidado: linha.statusConsolidado,
      qtdOperadora: linha.quantidadeTransacoesOperadora,
      qtdErp: linha.quantidadeRegistrosErp,
      possuiDivergenciaInternaFilial: linha.possuiDivergenciaInternaFilial,
      statusTratativa: "ABERTA",
      motivoTratativa: "",
      observacao: "",
      ultimoProcessamento: linha.ultimoProcessamento,
      processadoEm: linha.processadoEm,
      criadoEm: now,
      atualizadoEm: now,
      atualizadoPor: usuario,
      metadata: {
        nivelConsolidacao: "CONSOLIDADO_DIA",
      },
    };
    snapshots.unshift(novo);
    syncConsolidadoDivergencia(novo, usuario);
    return novo;
  }

  existente.valorOperadora = linha.valorOperadoraTotalDia;
  existente.valorErp = linha.valorErpTotalDia;
  existente.diferenca = linha.diferenca;
  existente.statusConsolidado = linha.statusConsolidado;
  existente.qtdOperadora = linha.quantidadeTransacoesOperadora;
  existente.qtdErp = linha.quantidadeRegistrosErp;
  existente.possuiDivergenciaInternaFilial = linha.possuiDivergenciaInternaFilial;
  existente.ultimoProcessamento = linha.ultimoProcessamento;
  existente.processadoEm = linha.processadoEm;
  existente.atualizadoEm = now;
  existente.atualizadoPor = usuario;
  syncConsolidadoDivergencia(existente, usuario);
  return existente;
}

function linhaFromSnapshot(snapshot: AuditoriaCartaoConsolidadoDia): ConsolidadoDiaLinha {
  return {
    data: snapshot.dataReferencia,
    quantidadeTransacoesOperadora: snapshot.qtdOperadora,
    quantidadeRegistrosErp: snapshot.qtdErp,
    valorOperadoraTotalDia: snapshot.valorOperadora,
    valorErpTotalDia: snapshot.valorErp,
    diferenca: snapshot.diferenca,
    statusConsolidado: snapshot.statusConsolidado,
    statusTratativa: snapshot.statusTratativa,
    motivoTratativa: snapshot.motivoTratativa,
    observacao: snapshot.observacao,
    possuiDivergenciaInternaFilial: snapshot.possuiDivergenciaInternaFilial,
    ultimoProcessamento: snapshot.ultimoProcessamento,
    processadoEm: snapshot.processadoEm,
  };
}

export function processarPainelConsolidadoDia(filters: ConsolidadoDiaFiltro, usuario = "system"): {
  resumo: ConsolidadoDiaResumo;
  linhas: ConsolidadoDiaLinha[];
} {
  const regra = ensureConfiguracao(usuario);
  const agg = getAggMapBase(filters);
  const datasMap = new Set<string>(agg.keys());
  if (filters.periodStart && filters.periodEnd) {
    for (const data of gerarDatasIntervalo(filters.periodStart, filters.periodEnd)) datasMap.add(data);
  }

  const linhas = Array.from(datasMap)
    .map((data) => {
      const dia = agg.get(data) || {
        data,
        quantidadeOperadora: 0,
        quantidadeErp: 0,
        valorOperadora: 0,
        valorErp: 0,
        porFilial: new Map<string, AggFilial>(),
      };
      const diferenca = round2(dia.valorOperadora - dia.valorErp);
      const statusConsolidado = statusConsolidadoDoDia(
        dia.quantidadeOperadora,
        dia.quantidadeErp,
        diferenca,
        regra.toleranciaValor,
      );
      const possuiDivergenciaInternaFilial = Array.from(dia.porFilial.values())
        .some((item) => Math.abs(round2(item.valorOperadora - item.valorErp)) > regra.toleranciaValor);

      const processadoEm = nowIso();
      const snapshot = upsertSnapshot(
        data,
        {
          data,
          quantidadeTransacoesOperadora: dia.quantidadeOperadora,
          quantidadeRegistrosErp: dia.quantidadeErp,
          valorOperadoraTotalDia: round2(dia.valorOperadora),
          valorErpTotalDia: round2(dia.valorErp),
          diferenca,
          statusConsolidado,
          possuiDivergenciaInternaFilial,
          ultimoProcessamento: ultimoProcessamentoData(data),
          processadoEm,
        },
        usuario,
      );
      return linhaFromSnapshot(snapshot);
    })
    .sort((a, b) => b.data.localeCompare(a.data));

  const linhasFiltradas = linhas.filter((item) => {
    if (filters.status && filters.status !== "TODOS" && item.statusConsolidado !== filters.status) return false;
    if (filters.tratativa && filters.tratativa !== "TODOS" && item.statusTratativa !== filters.tratativa) return false;
    return true;
  });

  const resumo: ConsolidadoDiaResumo = {
    diasConciliados: linhasFiltradas.filter((item) => item.statusConsolidado === "CONCILIADO").length,
    diasDivergentes: linhasFiltradas.filter((item) => item.statusConsolidado === "DIVERGENCIA_TOTAL_DIA").length,
    totalOperadoraPeriodo: round2(sumBy(linhasFiltradas, (item) => item.valorOperadoraTotalDia)),
    totalErpPeriodo: round2(sumBy(linhasFiltradas, (item) => item.valorErpTotalDia)),
    diferencaAcumuladaPeriodo: round2(sumBy(linhasFiltradas, (item) => item.diferenca)),
  };

  return { resumo, linhas: linhasFiltradas };
}

export function processarPainelConsolidadoFilial(filters: ConsolidadoDiaFiltro & { filial?: string }, usuario = "system"): {
  resumo: ConsolidadoFilialResumo;
  linhas: ConsolidadoFilialLinha[];
} {
  const regra = ensureConfiguracao(usuario);
  const agg = getAggMapBase(filters);
  const linhas: ConsolidadoFilialLinha[] = [];

  for (const dia of Array.from(agg.values())) {
    for (const filialAgg of Array.from(dia.porFilial.values())) {
      if (!matchesFiltroTexto(filialAgg.filial, filters.filial)) continue;

      const diferenca = round2(filialAgg.valorOperadora - filialAgg.valorErp);
      const statusConsolidado = statusConsolidadoDoDia(
        filialAgg.quantidadeOperadora,
        filialAgg.quantidadeErp,
        diferenca,
        regra.toleranciaValor,
      );

      linhas.push({
        data: dia.data,
        filial: filialAgg.filial,
        quantidadeTransacoesOperadora: filialAgg.quantidadeOperadora,
        quantidadeRegistrosErp: filialAgg.quantidadeErp,
        valorOperadoraTotalDia: round2(filialAgg.valorOperadora),
        valorErpTotalDia: round2(filialAgg.valorErp),
        diferenca,
        statusConsolidado,
        ultimoProcessamento: ultimoProcessamentoData(dia.data),
        processadoEm: nowIso(),
      });
    }
  }

  linhas.sort((a, b) => {
    const byDate = b.data.localeCompare(a.data);
    if (byDate !== 0) return byDate;
    return a.filial.localeCompare(b.filial);
  });

  if (filters.status && filters.status !== "TODOS") {
    for (let i = linhas.length - 1; i >= 0; i -= 1) {
      if (linhas[i].statusConsolidado !== filters.status) linhas.splice(i, 1);
    }
  }

  const resumo: ConsolidadoFilialResumo = {
    filiaisConciliadas: linhas.filter((item) => item.statusConsolidado === "CONCILIADO").length,
    filiaisDivergentes: linhas.filter((item) => item.statusConsolidado === "DIVERGENCIA_TOTAL_DIA").length,
    totalOperadoraPeriodo: round2(sumBy(linhas, (item) => item.valorOperadoraTotalDia)),
    totalErpPeriodo: round2(sumBy(linhas, (item) => item.valorErpTotalDia)),
    diferencaAcumuladaPeriodo: round2(sumBy(linhas, (item) => item.diferenca)),
    totalLinhas: linhas.length,
  };

  return { resumo, linhas };
}

export function buscarDetalheConsolidadoDia(
  data: string,
  filters: Pick<ConsolidadoDiaFiltro, "bandeira" | "tipo"> & { filial?: string },
  page = 1,
  limit = 100,
): ConsolidadoDiaDetalhe | null {
  const regra = ensureConfiguracao("system");
  const painel = processarPainelConsolidadoDia({ periodStart: data, periodEnd: data, ...filters }, "system");
  const resumo = painel.linhas.find((item) => item.data === data);
  if (!resumo) return null;

  const byMatch = new Map(matchesStore().map((item) => [item.itemImportadoId, item]));
  const porFilialMap = new Map<string, ConsolidadoDiaFilialLinha>();
  const transacoes: ConsolidadoDiaTransacaoLinha[] = [];

  const upsertFilial = (filialRaw: string): ConsolidadoDiaFilialLinha => {
    const filial = filialRaw || "SEM_FILIAL";
    if (!porFilialMap.has(filial)) {
      porFilialMap.set(filial, {
        filial,
        valorOperadora: 0,
        valorErp: 0,
        diferenca: 0,
        quantidadeOperadora: 0,
        quantidadeErp: 0,
        statusFilial: "CONCILIADO_FILIAL",
      });
    }
    return porFilialMap.get(filial)!;
  };

  for (const item of itensStore()) {
    if (item.camposNormalizados.dataVenda !== data) continue;
    if (!matchesFiltroTexto(item.camposNormalizados.bandeira, filters.bandeira)) continue;
    if (
      filters.tipo
      && !matchesFiltroTexto(item.camposNormalizados.tipoTransacao, filters.tipo)
      && !matchesFiltroTexto(item.camposNormalizados.modalidade, filters.tipo)
    ) continue;

    const valorOperadora = item.camposNormalizados.valorBrutoAtualizado > 0
      ? item.camposNormalizados.valorBrutoAtualizado
      : item.camposNormalizados.valorBruto;
    const match = byMatch.get(item.id);
    const valorErp = parseNumber(match?.valorErp);

    const filial = upsertFilial(item.camposNormalizados.codfilialArquivo);
    filial.quantidadeOperadora += 1;
    filial.valorOperadora = round2(filial.valorOperadora + valorOperadora);
    if (match) {
      filial.quantidadeErp += 1;
      filial.valorErp = round2(filial.valorErp + valorErp);
    }

    transacoes.push({
      tipoRegistro: "OPERADORA",
      itemId: item.id,
      referenciaErpId: match?.referenciaErpId,
      nsuCv: item.camposNormalizados.nsuCv,
      autorizacao: item.camposNormalizados.autorizacao,
      identificadorOperadora: item.camposNormalizados.idTransacao || item.camposNormalizados.nsuCv || item.camposNormalizados.autorizacao,
      nossoNumero: match?.referenciaErpId || "",
      dataVenda: item.camposNormalizados.dataVenda,
      horaVenda: item.camposNormalizados.horaVenda,
      bandeira: item.camposNormalizados.bandeira,
      meioPagamento: item.camposNormalizados.meioPagamento,
      tipo: item.camposNormalizados.tipoTransacao || item.camposNormalizados.modalidade,
      filial: item.camposNormalizados.codfilialArquivo,
      valorOperadora,
      valorErp,
      statusMatch: item.statusConciliacao,
      motivoDivergencia: item.camposNormalizados.motivoDivergencia,
    });
  }

  for (const divergence of divergenciasStore()) {
    if (divergence.tipoDivergencia !== "NAO_ENCONTRADO_NA_OPERADORA") continue;
    if (divergence.dataVenda !== data) continue;
    if (!matchesFiltroTexto(divergence.bandeira, filters.bandeira)) continue;
    if (filters.tipo) continue;

    const filial = upsertFilial(divergence.filial);
    const valorErpDivergencia = parseNumber(divergence.valorErp);
    filial.quantidadeErp += 1;
    filial.valorErp = round2(filial.valorErp + valorErpDivergencia);

    transacoes.push({
      tipoRegistro: "ERP_SEM_OPERADORA",
      referenciaErpId: divergence.referenciaErpId,
      nsuCv: "",
      autorizacao: "",
      identificadorOperadora: "",
      nossoNumero: divergence.referenciaErpId || "",
      dataVenda: divergence.dataVenda,
      horaVenda: "",
      bandeira: divergence.bandeira,
      meioPagamento: "",
      tipo: "ERP",
      filial: divergence.filial,
      valorOperadora: 0,
      valorErp: valorErpDivergencia,
      statusMatch: "NAO_ENCONTRADO_NA_OPERADORA",
      motivoDivergencia: divergence.descricao,
    });
  }

  const quebraPorFilial = Array.from(porFilialMap.values())
    .map((item) => {
      const diferenca = round2(item.valorOperadora - item.valorErp);
      const statusFilial: ConsolidadoDiaFilialLinha["statusFilial"] = Math.abs(diferenca) <= regra.toleranciaValor
        ? "CONCILIADO_FILIAL"
        : "DIVERGENCIA_FILIAL";
      return { ...item, diferenca, statusFilial };
    })
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

  transacoes.sort((a, b) => Math.abs((b.valorOperadora - b.valorErp)) - Math.abs((a.valorOperadora - a.valorErp)));

  const transacoesFiltradas = filters.filial
    ? transacoes.filter((item) => matchesFiltroTexto(item.filial, filters.filial))
    : transacoes;

  return {
    resumo,
    quebraPorFilial,
    transacoes: toPagination(transacoesFiltradas, page, limit),
    alertaDivergenciaInternaFilial: resumo.statusConsolidado === "CONCILIADO" && resumo.possuiDivergenciaInternaFilial,
  };
}

export function atualizarTratativaConsolidadoDia(
  data: string,
  payload: {
    statusTratativa?: TratamentoStatus;
    motivoTratativa?: string;
    observacao?: string;
    revisado?: boolean;
  },
  usuario: string,
): AuditoriaCartaoConsolidadoDia | null {
  const registro = consolidadoDiaStore().find((item) => item.dataReferencia === data && item.nivelConciliacao === "CONSOLIDADO_DIA");
  if (!registro) return null;

  if (payload.statusTratativa) {
    registro.statusTratativa = payload.statusTratativa;
  } else if (typeof payload.revisado === "boolean") {
    registro.statusTratativa = payload.revisado ? "REVISADA" : "ABERTA";
  }

  if (typeof payload.motivoTratativa === "string") {
    registro.motivoTratativa = payload.motivoTratativa;
  }

  if (typeof payload.observacao === "string" && payload.observacao.trim().length > 0) {
    const timestamp = new Date().toLocaleString("pt-BR");
    const nota = `[${timestamp}] ${usuario}: ${payload.observacao.trim()}`;
    registro.observacao = [registro.observacao, nota].filter(Boolean).join("\n");
  }

  registro.atualizadoEm = nowIso();
  registro.atualizadoPor = usuario;
  syncConsolidadoDivergencia(registro, usuario);
  return registro;
}
