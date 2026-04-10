import { isOracleEnabled } from "../../db/oracle.js";
import {
  buscarVendasErpConsolidacao,
  type AuditoriaCartaoErpVenda,
} from "../../repositories/auditoriaCartaoOracleRepository.js";
import { sumBy } from "./helpers.js";
import { ensureConfiguracao, normalizeComparable, nowIso, round2 } from "./state.js";
import {
  divergenciasStore,
  importacoesStore,
  itensStore,
  matchesStore,
  type TratamentoStatus,
} from "./types.js";

export const pcprestPlanilhaMatchStatusValues = [
  "ENCONTRADO_EXATO",
  "ENCONTRADO_COM_DIFERENCA_DE_VALOR",
  "ENCONTRADO_COM_DIFERENCA_DE_DATA",
  "ENCONTRADO_COM_DIFERENCA_DE_FILIAL",
  "ENCONTRADO_COM_DIFERENCA_DE_BANDEIRA",
  "NAO_ENCONTRADO",
  "MATCH_AMBIGUO",
  "DUPLICIDADE_NA_PLANILHA",
  "CANCELADO_OU_DESCARTADO",
  "PENDENTE_DE_ANALISE",
] as const;

export const pcprestPlanilhaResumoStatusValues = [
  "TOTALMENTE_CONFERIDO",
  "PARCIALMENTE_CONFERIDO",
  "NAO_CONFERIDO",
  "COM_DIVERGENCIAS",
  "COM_DUPLICIDADES",
  "PENDENTE",
] as const;

export type PcprestPlanilhaMatchStatus = typeof pcprestPlanilhaMatchStatusValues[number];
export type PcprestPlanilhaResumoStatus = typeof pcprestPlanilhaResumoStatusValues[number];

export interface PcprestPlanilhaFiltro {
  periodStart?: string;
  periodEnd?: string;
  filial?: string;
  bandeira?: string;
  tipo?: string;
  statusMatch?: PcprestPlanilhaMatchStatus | "TODOS";
  tratativa?: TratamentoStatus | "TODOS";
  somenteFaltantes?: boolean;
  somenteDivergencias?: boolean;
  somenteDuplicidades?: boolean;
  valorExato?: number;
  nsuOuAutorizacao?: string;
  duplicataOuTitulo?: string;
  nossoNumero?: string;
  arquivoId?: string;
}

export interface PcprestPlanilhaCards {
  totalErpPeriodo: number;
  totalEncontradoPlanilha: number;
  totalFaltantePlanilha: number;
  quantidadeRegistrosErp: number;
  quantidadeConciliada: number;
  quantidadeNaoEncontrada: number;
  quantidadeComDivergencia: number;
  quantidadeComDuplicidadeOuAmbiguidade: number;
}

export interface PcprestPlanilhaResumoLinha {
  data: string;
  filial: string;
  quantidadeErp: number;
  valorErp: number;
  quantidadeEncontradaPlanilha: number;
  valorEncontradoPlanilha: number;
  quantidadeFaltante: number;
  valorFaltante: number;
  quantidadeComDivergencia: number;
  statusResumo: PcprestPlanilhaResumoStatus;
  statusTratativa: TratamentoStatus;
  observacao: string;
  ultimoProcessamento: string;
}

export interface PcprestPlanilhaDetalheLinha {
  id: string;
  dataErp: string;
  filialErp: string;
  tituloDuplicataErp: string;
  nsuAutorizacaoErp: string;
  bandeiraErp: string;
  tipoErp: string;
  valorErp: number;
  dataPlanilha: string;
  filialPlanilha: string;
  bandeiraPlanilha: string;
  valorPlanilha: number;
  statusMatch: PcprestPlanilhaMatchStatus;
  motivo: string;
  scoreMatch: number;
  regraMatch: string;
  observacao: string;
  statusTratativa: TratamentoStatus;
  itemIdPlanilha?: string;
  importacaoIdPlanilha?: string;
  referenciaErpId: string;
}

export interface PcprestPlanilhaDiagnostico {
  oracleConfigurado: boolean;
  fonteErp: "ORACLE" | "SNAPSHOT_LOCAL";
  totalErpLidos: number;
  totalPlanilhaLidos: number;
  totalConciliadoExato: number;
  totalNaoEncontrado: number;
  totalDuplicidadeOuAmbiguo: number;
}

export interface PcprestPlanilhaAnalise {
  cards: PcprestPlanilhaCards;
  linhasResumo: PcprestPlanilhaResumoLinha[];
  linhasDetalhe: PcprestPlanilhaDetalheLinha[];
  diagnostico: PcprestPlanilhaDiagnostico;
}

interface PlanilhaFonteRow {
  id: string;
  itemId: string;
  importacaoId: string;
  data: string;
  hora: string;
  statusVenda: string;
  filial: string;
  bandeira: string;
  tipo: string;
  valor: number;
  nsu: string;
  autorizacao: string;
  tid: string;
  numeroPedido: string;
  lote: string;
  sortKey: string;
}

interface ErpFonteRow {
  id: string;
  referenciaErpId: string;
  data: string;
  hora: string;
  filial: string;
  bandeira: string;
  tipo: string;
  valor: number;
  nsu: string;
  autorizacao: string;
  tid: string;
  numeroPedido: string;
  statusVenda: string;
  codCobranca: string;
  sortKey: string;
}

interface TratativaLinha {
  statusTratativa: TratamentoStatus;
  observacao: string;
  motivo: string;
  atualizadoEm: string;
  atualizadoPor: string;
}

interface CandidateSelection {
  planilha: PlanilhaFonteRow;
  score: number;
  regra: string;
  duplicidade: boolean;
}

const tratativasByLinha = new Map<string, TratativaLinha>();

function makeLinhaKey(data: string, filial: string): string {
  return `${data}|${normalizeComparable(filial || "SEM_FILIAL")}`;
}

function formatValueKey(value: number): string {
  return round2(value).toFixed(2);
}

function hasSimilar(value: string, terms: string[]): boolean {
  const normalized = normalizeComparable(value);
  if (!normalized) return false;
  return terms.some((term) => normalized.includes(term));
}

function shouldIgnoreStatus(statusVenda: string): boolean {
  return hasSimilar(statusVenda, ["cancelad", "estornad", "descartad", "negad", "expirad"]);
}

function isIdentifierUseful(value: string): boolean {
  const normalized = normalizeComparable(value).replace(/\s+/g, "_");
  if (!normalized) return false;
  return ![
    "-",
    "--",
    "n_a",
    "na",
    "null",
    "undefined",
    "0",
    "000000",
    "sem_info",
    "sem_informacao",
    "sem_dado",
    "sem_dados",
  ].includes(normalized);
}

function matchTextFilter(base: string, filter?: string): boolean {
  if (!filter) return true;
  return normalizeComparable(base || "").includes(normalizeComparable(filter));
}

function isIsoDate(value?: string): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(baseIso: string, deltaDays: number): string {
  const base = new Date(`${baseIso}T00:00:00`);
  base.setDate(base.getDate() + deltaDays);
  return formatIsoDate(base);
}

function normalizarPeriodoFiltros(filtros: PcprestPlanilhaFiltro): PcprestPlanilhaFiltro {
  let periodStart = isIsoDate(filtros.periodStart) ? filtros.periodStart : undefined;
  let periodEnd = isIsoDate(filtros.periodEnd) ? filtros.periodEnd : undefined;

  if (!periodStart && !periodEnd) {
    const ultimaImportacaoConcluida = [...importacoesStore()]
      .filter((item) =>
        item.statusProcessamento === "CONCLUIDO"
        && isIsoDate(item.periodoInicial)
        && isIsoDate(item.periodoFinal))
      .sort((a, b) => (b.processadoEm || b.dataUpload).localeCompare(a.processadoEm || a.dataUpload))[0];

    if (ultimaImportacaoConcluida) {
      periodStart = ultimaImportacaoConcluida.periodoInicial;
      periodEnd = ultimaImportacaoConcluida.periodoFinal;
    } else {
      periodEnd = formatIsoDate(new Date());
      periodStart = addDaysIso(periodEnd, -30);
    }
  } else if (!periodStart && periodEnd) {
    periodStart = periodEnd;
  } else if (periodStart && !periodEnd) {
    periodEnd = periodStart;
  }

  if (periodStart && periodEnd && periodStart > periodEnd) {
    const tmp = periodStart;
    periodStart = periodEnd;
    periodEnd = tmp;
  }

  return {
    ...filtros,
    periodStart,
    periodEnd,
  };
}

function inPeriod(date: string, periodStart?: string, periodEnd?: string): boolean {
  if (!date) return false;
  if (periodStart && date < periodStart) return false;
  if (periodEnd && date > periodEnd) return false;
  return true;
}

function makeExactOccurrenceKey(row: { data: string; filial: string; bandeira: string; tipo: string; valor: number }): string {
  return [
    row.data,
    normalizeComparable(row.filial || "SEM_FILIAL"),
    normalizeComparable(row.bandeira || "SEM_BANDEIRA"),
    normalizeComparable(row.tipo || "SEM_TIPO"),
    formatValueKey(row.valor),
  ].join("|");
}

function makeBaseOccurrenceKey(row: { data: string; filial: string; valor: number }): string {
  return [
    row.data,
    normalizeComparable(row.filial || "SEM_FILIAL"),
    formatValueKey(row.valor),
  ].join("|");
}

function makeDateValueKey(row: { data: string; valor: number }): string {
  return `${row.data}|${formatValueKey(row.valor)}`;
}

function buildOccurrenceIndex<T extends { id: string; sortKey: string }>(
  rows: T[],
  keySelector: (row: T) => string,
): {
  rowsByKey: Map<string, T[]>;
  countByKey: Map<string, number>;
  occurrenceById: Map<string, number>;
} {
  const rowsByKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keySelector(row);
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key)!.push(row);
  }

  const countByKey = new Map<string, number>();
  const occurrenceById = new Map<string, number>();
  for (const [key, groupedRows] of rowsByKey.entries()) {
    const sorted = [...groupedRows].sort((a, b) => {
      if (a.sortKey === b.sortKey) return a.id.localeCompare(b.id);
      return a.sortKey.localeCompare(b.sortKey);
    });
    rowsByKey.set(key, sorted);
    countByKey.set(key, sorted.length);
    sorted.forEach((row, index) => occurrenceById.set(row.id, index + 1));
  }

  return { rowsByKey, countByKey, occurrenceById };
}

function getStrongKeysFromRow(row: {
  nsu: string;
  autorizacao: string;
  tid: string;
  numeroPedido: string;
}): Array<{ key: string; regra: string }> {
  const keys: Array<{ key: string; regra: string }> = [];
  if (isIdentifierUseful(row.nsu)) keys.push({ key: `NSU:${normalizeComparable(row.nsu)}`, regra: "MATCH_FORTE_NSU" });
  if (isIdentifierUseful(row.autorizacao)) keys.push({ key: `AUT:${normalizeComparable(row.autorizacao)}`, regra: "MATCH_FORTE_AUTORIZACAO" });
  if (isIdentifierUseful(row.tid)) keys.push({ key: `TID:${normalizeComparable(row.tid)}`, regra: "MATCH_FORTE_TID" });
  if (isIdentifierUseful(row.numeroPedido)) keys.push({ key: `PED:${normalizeComparable(row.numeroPedido)}`, regra: "MATCH_FORTE_NUMERO" });
  return keys;
}

function scoreCandidate(erp: ErpFonteRow, planilha: PlanilhaFonteRow, regraBase: string): CandidateSelection {
  const tolerancia = ensureConfiguracao("system").toleranciaValor;
  const sameDate = erp.data === planilha.data;
  const sameFilial = normalizeComparable(erp.filial) === normalizeComparable(planilha.filial);
  const sameBandeira = normalizeComparable(erp.bandeira) === normalizeComparable(planilha.bandeira);
  const sameTipo = normalizeComparable(erp.tipo) === normalizeComparable(planilha.tipo);
  const diff = Math.abs(round2(erp.valor - planilha.valor));

  let score = 50;
  if (sameDate) score += 20;
  if (sameFilial) score += 15;
  if (sameBandeira) score += 5;
  if (sameTipo) score += 5;
  if (diff <= tolerancia) score += 15;
  else if (diff <= tolerancia * 3) score += 8;

  return {
    planilha,
    score: Math.min(100, score),
    regra: regraBase,
    duplicidade: false,
  };
}

function buildPlanilhaRows(filters: PcprestPlanilhaFiltro): PlanilhaFonteRow[] {
  return itensStore()
    .filter((item) => inPeriod(item.camposNormalizados.dataVenda, filters.periodStart, filters.periodEnd))
    .filter((item) => (filters.arquivoId ? item.importacaoId === filters.arquivoId : true))
    .map((item) => {
      const valor = item.camposNormalizados.valorBrutoAtualizado > 0
        ? item.camposNormalizados.valorBrutoAtualizado
        : item.camposNormalizados.valorBruto;
      return {
        id: item.id,
        itemId: item.id,
        importacaoId: item.importacaoId,
        data: item.camposNormalizados.dataVenda,
        hora: item.camposNormalizados.horaVenda || "",
        statusVenda: item.camposNormalizados.statusVenda || "",
        filial: item.camposNormalizados.codfilialArquivo || "",
        bandeira: item.camposNormalizados.bandeira || "",
        tipo: item.camposNormalizados.tipoTransacao || item.camposNormalizados.modalidade || item.camposNormalizados.meioPagamento || "",
        valor: round2(valor),
        nsu: item.camposNormalizados.nsuCv || "",
        autorizacao: item.camposNormalizados.autorizacao || "",
        tid: item.camposNormalizados.tid || "",
        numeroPedido: item.camposNormalizados.numeroPedido || "",
        lote: item.camposNormalizados.lote || "",
        sortKey: `${item.camposNormalizados.dataVenda}|${item.camposNormalizados.horaVenda || "00:00"}|${item.id}`,
      };
    })
    .filter((item) => !shouldIgnoreStatus(item.statusVenda))
    .filter((item) => matchTextFilter(item.filial, filters.filial))
    .filter((item) => matchTextFilter(item.bandeira, filters.bandeira))
    .filter((item) => matchTextFilter(item.tipo, filters.tipo))
    .filter((item) => (typeof filters.valorExato === "number" ? round2(item.valor) === round2(filters.valorExato) : true))
    .filter((item) => matchTextFilter(item.nsu, filters.nsuOuAutorizacao) || matchTextFilter(item.autorizacao, filters.nsuOuAutorizacao) || !filters.nsuOuAutorizacao)
    .filter((item) => matchTextFilter(item.numeroPedido, filters.duplicataOuTitulo) || !filters.duplicataOuTitulo)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function buildSnapshotErpRows(filters: PcprestPlanilhaFiltro): ErpFonteRow[] {
  const itensById = new Map(itensStore().map((item) => [item.id, item]));
  const rows: ErpFonteRow[] = [];
  const dedupe = new Set<string>();

  for (const match of matchesStore()) {
    const item = itensById.get(match.itemImportadoId);
    if (!item) continue;
    const data = item.camposNormalizados.dataVenda;
    if (!inPeriod(data, filters.periodStart, filters.periodEnd)) continue;

    const row: ErpFonteRow = {
      id: `SNP-MAT-${match.id}`,
      referenciaErpId: match.referenciaErpId,
      data,
      hora: item.camposNormalizados.horaVenda || "",
      filial: match.codfilialErp || item.camposNormalizados.codfilialArquivo || "",
      bandeira: item.camposNormalizados.bandeira || "",
      tipo: item.camposNormalizados.tipoTransacao || item.camposNormalizados.modalidade || "",
      valor: round2(match.valorErp),
      nsu: item.camposNormalizados.nsuCv || "",
      autorizacao: item.camposNormalizados.autorizacao || "",
      tid: item.camposNormalizados.tid || "",
      numeroPedido: item.camposNormalizados.numeroPedido || "",
      statusVenda: "SNAPSHOT",
      codCobranca: "",
      sortKey: `${data}|${item.camposNormalizados.horaVenda || "00:00"}|${match.referenciaErpId}`,
    };
    const key = `${row.referenciaErpId}|${row.data}|${formatValueKey(row.valor)}|${normalizeComparable(row.filial)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push(row);
  }

  for (const divergence of divergenciasStore()) {
    if (divergence.tipoDivergencia !== "NAO_ENCONTRADO_NA_OPERADORA") continue;
    if (divergence.importacaoId === "CONSOLIDADO_DIA") continue;
    if (!inPeriod(divergence.dataVenda, filters.periodStart, filters.periodEnd)) continue;

    const row: ErpFonteRow = {
      id: `SNP-DIV-${divergence.id}`,
      referenciaErpId: divergence.referenciaErpId || divergence.id,
      data: divergence.dataVenda,
      hora: "",
      filial: divergence.filial || "",
      bandeira: divergence.bandeira || "",
      tipo: "ERP",
      valor: round2(divergence.valorErp),
      nsu: "",
      autorizacao: "",
      tid: "",
      numeroPedido: divergence.referenciaErpId || "",
      statusVenda: "SNAPSHOT",
      codCobranca: divergence.codCobranca || "",
      sortKey: `${divergence.dataVenda}|00:00|${divergence.referenciaErpId || divergence.id}`,
    };
    const key = `${row.referenciaErpId}|${row.data}|${formatValueKey(row.valor)}|${normalizeComparable(row.filial)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push(row);
  }

  return rows
    .filter((row) => normalizeComparable(row.codCobranca || "") !== "desd")
    .filter((row) => matchTextFilter(row.filial, filters.filial))
    .filter((row) => matchTextFilter(row.bandeira, filters.bandeira))
    .filter((row) => matchTextFilter(row.tipo, filters.tipo))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function buildSnapshotErpRowsFromItens(filters: PcprestPlanilhaFiltro): ErpFonteRow[] {
  return itensStore()
    .filter((item) => inPeriod(item.camposNormalizados.dataVenda, filters.periodStart, filters.periodEnd))
    .filter((item) => (filters.arquivoId ? item.importacaoId === filters.arquivoId : true))
    .map((item): ErpFonteRow => {
      const valor = item.camposNormalizados.valorBrutoAtualizado > 0
        ? item.camposNormalizados.valorBrutoAtualizado
        : item.camposNormalizados.valorBruto;
      return {
        id: `SNP-ITM-${item.id}`,
        referenciaErpId: item.camposNormalizados.numeroPedido || item.id,
        data: item.camposNormalizados.dataVenda,
        hora: item.camposNormalizados.horaVenda || "",
        filial: item.camposNormalizados.codfilialArquivo || "",
        bandeira: item.camposNormalizados.bandeira || "",
        tipo: item.camposNormalizados.tipoTransacao || item.camposNormalizados.modalidade || item.camposNormalizados.meioPagamento || "",
        valor: round2(valor),
        nsu: item.camposNormalizados.nsuCv || "",
        autorizacao: item.camposNormalizados.autorizacao || "",
        tid: item.camposNormalizados.tid || "",
        numeroPedido: item.camposNormalizados.numeroPedido || "",
        statusVenda: item.camposNormalizados.statusVenda || "SNAPSHOT",
        codCobranca: "",
        sortKey: `${item.camposNormalizados.dataVenda}|${item.camposNormalizados.horaVenda || "00:00"}|${item.id}`,
      };
    })
    .filter((row) => !shouldIgnoreStatus(row.statusVenda))
    .filter((row) => normalizeComparable(row.codCobranca || "") !== "desd")
    .filter((row) => matchTextFilter(row.filial, filters.filial))
    .filter((row) => matchTextFilter(row.bandeira, filters.bandeira))
    .filter((row) => matchTextFilter(row.tipo, filters.tipo))
    .filter((row) => (typeof filters.valorExato === "number" ? round2(row.valor) === round2(filters.valorExato) : true))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

async function carregarErpRows(filters: PcprestPlanilhaFiltro): Promise<{
  rows: ErpFonteRow[];
  source: "ORACLE" | "SNAPSHOT_LOCAL";
}> {
  if (isOracleEnabled()) {
    const rows = await buscarVendasErpConsolidacao({
      periodoInicial: filters.periodStart || "1900-01-01",
      periodoFinal: filters.periodEnd || "2999-12-31",
      limite: 250000,
    });

    const mapped = rows
      .map((row): ErpFonteRow => ({
        id: row.referenciaErpId,
        referenciaErpId: row.referenciaErpId,
        data: row.dataVenda,
        hora: row.horaVenda || "",
        filial: row.codfilial || "",
        bandeira: row.bandeira || "",
        tipo: row.modalidade || "",
        valor: round2(row.valorBruto),
        nsu: row.nsuCv || "",
        autorizacao: row.autorizacao || "",
        tid: row.tid || "",
        numeroPedido: row.numeroPedido || "",
        statusVenda: row.statusVenda || "",
        codCobranca: row.codCobranca || "",
        sortKey: `${row.dataVenda}|${row.horaVenda || "00:00"}|${row.referenciaErpId}`,
      }))
      .filter((row) => inPeriod(row.data, filters.periodStart, filters.periodEnd))
      .filter((row) => normalizeComparable(row.codCobranca || "") !== "desd")
      .filter((row) => matchTextFilter(row.filial, filters.filial))
      .filter((row) => matchTextFilter(row.bandeira, filters.bandeira))
      .filter((row) => matchTextFilter(row.tipo, filters.tipo))
      .filter((row) => (typeof filters.valorExato === "number" ? round2(row.valor) === round2(filters.valorExato) : true))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return { rows: mapped, source: "ORACLE" };
  }
  const rowsSnapshot = buildSnapshotErpRows(filters);
  if (rowsSnapshot.length > 0) {
    return { rows: rowsSnapshot, source: "SNAPSHOT_LOCAL" };
  }

  return { rows: buildSnapshotErpRowsFromItens(filters), source: "SNAPSHOT_LOCAL" };
}

function pickSummaryStatus(
  quantidadeErp: number,
  quantidadeFaltante: number,
  quantidadeComDivergencia: number,
  quantidadeComDuplicidadeAmbigua: number,
  quantidadeEncontradaPlanilha: number,
): PcprestPlanilhaResumoStatus {
  if (quantidadeErp === 0) return "PENDENTE";
  if (quantidadeFaltante === 0 && quantidadeComDivergencia === 0 && quantidadeComDuplicidadeAmbigua === 0) return "TOTALMENTE_CONFERIDO";
  if (quantidadeEncontradaPlanilha === 0) return "NAO_CONFERIDO";
  if (quantidadeComDuplicidadeAmbigua > 0) return "COM_DUPLICIDADES";
  if (quantidadeComDivergencia > 0) return "COM_DIVERGENCIAS";
  return "PARCIALMENTE_CONFERIDO";
}

function isDivergenceStatus(status: PcprestPlanilhaMatchStatus): boolean {
  return [
    "ENCONTRADO_COM_DIFERENCA_DE_VALOR",
    "ENCONTRADO_COM_DIFERENCA_DE_DATA",
    "ENCONTRADO_COM_DIFERENCA_DE_FILIAL",
    "ENCONTRADO_COM_DIFERENCA_DE_BANDEIRA",
    "PENDENTE_DE_ANALISE",
  ].includes(status);
}

function applyDetailFilters(rows: PcprestPlanilhaDetalheLinha[], filters: PcprestPlanilhaFiltro): PcprestPlanilhaDetalheLinha[] {
  return rows
    .filter((row) => (filters.statusMatch && filters.statusMatch !== "TODOS" ? row.statusMatch === filters.statusMatch : true))
    .filter((row) => (filters.tratativa && filters.tratativa !== "TODOS" ? row.statusTratativa === filters.tratativa : true))
    .filter((row) => (filters.somenteFaltantes ? row.statusMatch === "NAO_ENCONTRADO" : true))
    .filter((row) => (filters.somenteDivergencias ? isDivergenceStatus(row.statusMatch) : true))
    .filter((row) => (filters.somenteDuplicidades
      ? row.statusMatch === "DUPLICIDADE_NA_PLANILHA" || row.statusMatch === "MATCH_AMBIGUO"
      : true))
    .filter((row) => (typeof filters.valorExato === "number"
      ? round2(row.valorErp) === round2(filters.valorExato) || round2(row.valorPlanilha) === round2(filters.valorExato)
      : true))
    .filter((row) => (filters.nsuOuAutorizacao
      ? matchTextFilter(row.nsuAutorizacaoErp, filters.nsuOuAutorizacao)
      : true))
    .filter((row) => (filters.duplicataOuTitulo
      ? matchTextFilter(row.tituloDuplicataErp, filters.duplicataOuTitulo)
      : true))
    .filter((row) => (filters.nossoNumero
      ? matchTextFilter(row.referenciaErpId, filters.nossoNumero) || matchTextFilter(row.tituloDuplicataErp, filters.nossoNumero)
      : true));
}

function obterTratativaLinha(data: string, filial: string): TratativaLinha {
  const key = makeLinhaKey(data, filial);
  const existente = tratativasByLinha.get(key);
  if (existente) return existente;
  return {
    statusTratativa: "ABERTA",
    observacao: "",
    motivo: "",
    atualizadoEm: "",
    atualizadoPor: "",
  };
}

function withTratativa(det: PcprestPlanilhaDetalheLinha): PcprestPlanilhaDetalheLinha {
  const tratativa = obterTratativaLinha(det.dataErp, det.filialErp);
  return {
    ...det,
    statusTratativa: tratativa.statusTratativa,
    observacao: det.observacao || tratativa.observacao || "",
  };
}

function ultimoProcessamentoDia(data: string): string {
  const registro = importacoesStore()
    .filter((item) => item.periodoInicial <= data && item.periodoFinal >= data)
    .sort((a, b) => (b.processadoEm || b.dataUpload).localeCompare(a.processadoEm || a.dataUpload))[0];
  return registro?.processadoEm || registro?.dataUpload || "";
}

export function atualizarTratativaPcprestPlanilha(
  data: string,
  filial: string,
  payload: {
    statusTratativa?: TratamentoStatus;
    motivo?: string;
    observacao?: string;
    revisado?: boolean;
  },
  usuario: string,
): TratativaLinha {
  const key = makeLinhaKey(data, filial);
  const atual = obterTratativaLinha(data, filial);

  const novoStatus = payload.statusTratativa
    ?? (typeof payload.revisado === "boolean" ? (payload.revisado ? "REVISADA" : "ABERTA") : atual.statusTratativa);
  const novaObservacao = payload.observacao
    ? [atual.observacao, `[${new Date().toLocaleString("pt-BR")}] ${usuario}: ${payload.observacao}`].filter(Boolean).join("\n")
    : atual.observacao;

  const proximo: TratativaLinha = {
    statusTratativa: novoStatus,
    motivo: payload.motivo ?? atual.motivo,
    observacao: novaObservacao,
    atualizadoEm: nowIso(),
    atualizadoPor: usuario,
  };

  tratativasByLinha.set(key, proximo);
  return proximo;
}

export async function processarPcprestPlanilha(filtros: PcprestPlanilhaFiltro): Promise<PcprestPlanilhaAnalise> {
  const filtrosEfetivos = normalizarPeriodoFiltros(filtros);
  const regra = ensureConfiguracao("system");
  const tolerancia = regra.toleranciaValor;

  const planilhaRows = buildPlanilhaRows(filtrosEfetivos);
  const { rows: erpRows, source } = await carregarErpRows(filtrosEfetivos);

  const strongIndex = new Map<string, PlanilhaFonteRow[]>();
  for (const row of planilhaRows) {
    for (const strong of getStrongKeysFromRow({
      nsu: row.nsu,
      autorizacao: row.autorizacao,
      tid: row.tid,
      numeroPedido: row.numeroPedido,
    })) {
      if (!strongIndex.has(strong.key)) strongIndex.set(strong.key, []);
      strongIndex.get(strong.key)!.push(row);
    }
  }

  const planilhaExactOcc = buildOccurrenceIndex(planilhaRows, makeExactOccurrenceKey);
  const planilhaBaseOcc = buildOccurrenceIndex(planilhaRows, makeBaseOccurrenceKey);
  const planilhaDateValueOcc = buildOccurrenceIndex(planilhaRows, makeDateValueKey);
  const erpExactOcc = buildOccurrenceIndex(erpRows, makeExactOccurrenceKey);
  const erpBaseOcc = buildOccurrenceIndex(erpRows, makeBaseOccurrenceKey);

  const usedPlanilhaIds = new Set<string>();
  const detalhes: PcprestPlanilhaDetalheLinha[] = [];

  for (const erp of erpRows) {
    const baseDetalhe: Omit<PcprestPlanilhaDetalheLinha, "statusMatch" | "motivo" | "scoreMatch" | "regraMatch" | "dataPlanilha" | "filialPlanilha" | "bandeiraPlanilha" | "valorPlanilha" | "statusTratativa"> = {
      id: `ERPPLAN-${erp.id}`,
      dataErp: erp.data,
      filialErp: erp.filial || "SEM_FILIAL",
      tituloDuplicataErp: erp.numeroPedido || erp.referenciaErpId,
      nsuAutorizacaoErp: erp.nsu || erp.autorizacao || "-",
      bandeiraErp: erp.bandeira || "-",
      tipoErp: erp.tipo || "-",
      valorErp: erp.valor,
      observacao: "",
      itemIdPlanilha: undefined,
      importacaoIdPlanilha: undefined,
      referenciaErpId: erp.referenciaErpId,
    };

    if (shouldIgnoreStatus(erp.statusVenda)) {
      detalhes.push(withTratativa({
        ...baseDetalhe,
        dataPlanilha: "-",
        filialPlanilha: "-",
        bandeiraPlanilha: "-",
        valorPlanilha: 0,
        statusMatch: "CANCELADO_OU_DESCARTADO",
        motivo: "Registro ERP descartado pela regra de elegibilidade (cancelado/estornado/descartado).",
        scoreMatch: 0,
        regraMatch: "REGRA_ELEGIBILIDADE_STATUS",
        statusTratativa: "ABERTA",
      }));
      continue;
    }

    let selected: CandidateSelection | null = null;
    let ambiguous = false;

    const strongCandidates: CandidateSelection[] = [];
    const strongSeen = new Set<string>();
    for (const strong of getStrongKeysFromRow(erp)) {
      const candidates = (strongIndex.get(strong.key) || []).filter((item) => !usedPlanilhaIds.has(item.id));
      for (const candidate of candidates) {
        if (strongSeen.has(candidate.id)) continue;
        strongSeen.add(candidate.id);
        strongCandidates.push(scoreCandidate(erp, candidate, strong.regra));
      }
    }

    if (strongCandidates.length > 0) {
      strongCandidates.sort((a, b) => b.score - a.score || a.planilha.sortKey.localeCompare(b.planilha.sortKey));
      if (strongCandidates.length > 1 && strongCandidates[0].score === strongCandidates[1].score) {
        ambiguous = true;
      } else {
        selected = strongCandidates[0];
        selected.duplicidade = strongCandidates.length > 1;
      }
    }

    if (!selected && !ambiguous) {
      const keyExact = makeExactOccurrenceKey(erp);
      const erpOcc = erpExactOcc.occurrenceById.get(erp.id) || 1;
      const exactByOcc = planilhaExactOcc.rowsByKey.get(keyExact)?.[erpOcc - 1];
      if (exactByOcc && !usedPlanilhaIds.has(exactByOcc.id)) {
        selected = {
          planilha: exactByOcc,
          score: 100,
          regra: "MATCH_OCORRENCIA_EXATA",
          duplicidade: (planilhaExactOcc.countByKey.get(keyExact) || 0) > 1,
        };
      } else {
        const pool = (planilhaExactOcc.rowsByKey.get(keyExact) || []).filter((item) => !usedPlanilhaIds.has(item.id));
        if (pool.length > 1) ambiguous = true;
        if (!ambiguous && pool.length === 1) {
          selected = {
            planilha: pool[0],
            score: 98,
            regra: "MATCH_EXATO_CHAVE",
            duplicidade: false,
          };
        }
      }
    }

    if (!selected && !ambiguous) {
      const keyBase = makeBaseOccurrenceKey(erp);
      const erpOcc = erpBaseOcc.occurrenceById.get(erp.id) || 1;
      const baseByOcc = planilhaBaseOcc.rowsByKey.get(keyBase)?.[erpOcc - 1];
      if (baseByOcc && !usedPlanilhaIds.has(baseByOcc.id)) {
        selected = {
          planilha: baseByOcc,
          score: 90,
          regra: "MATCH_OCORRENCIA_DATA_FILIAL_VALOR",
          duplicidade: (planilhaBaseOcc.countByKey.get(keyBase) || 0) > (erpBaseOcc.countByKey.get(keyBase) || 0),
        };
      } else {
        const pool = (planilhaBaseOcc.rowsByKey.get(keyBase) || []).filter((item) => !usedPlanilhaIds.has(item.id));
        if (pool.length > 1) ambiguous = true;
        if (!ambiguous && pool.length === 1) {
          selected = {
            planilha: pool[0],
            score: 88,
            regra: "MATCH_DATA_FILIAL_VALOR",
            duplicidade: false,
          };
        }
      }
    }

    if (!selected && !ambiguous) {
      const dateValueKey = makeDateValueKey(erp);
      const pool = (planilhaDateValueOcc.rowsByKey.get(dateValueKey) || []).filter((item) => !usedPlanilhaIds.has(item.id));
      if (pool.length > 1) ambiguous = true;
      if (!ambiguous && pool.length === 1) {
        selected = {
          planilha: pool[0],
          score: 80,
          regra: "MATCH_DATA_VALOR_FILIAL_DIVERGENTE",
          duplicidade: false,
        };
      }
    }

    if (ambiguous) {
      detalhes.push(withTratativa({
        ...baseDetalhe,
        dataPlanilha: "-",
        filialPlanilha: "-",
        bandeiraPlanilha: "-",
        valorPlanilha: 0,
        statusMatch: "MATCH_AMBIGUO",
        motivo: "Mais de um candidato na planilha para o mesmo registro ERP sem desambiguacao segura.",
        scoreMatch: 0,
        regraMatch: "MATCH_AMBIGUO",
        statusTratativa: "ABERTA",
      }));
      continue;
    }

    if (!selected) {
      detalhes.push(withTratativa({
        ...baseDetalhe,
        dataPlanilha: "-",
        filialPlanilha: "-",
        bandeiraPlanilha: "-",
        valorPlanilha: 0,
        statusMatch: "NAO_ENCONTRADO",
        motivo: "Registro ERP nao encontrado na planilha da operadora.",
        scoreMatch: 0,
        regraMatch: "SEM_MATCH",
        statusTratativa: "ABERTA",
      }));
      continue;
    }

    usedPlanilhaIds.add(selected.planilha.id);

    const diff = round2(selected.planilha.valor - erp.valor);
    const diffAbs = Math.abs(diff);
    const sameDate = erp.data === selected.planilha.data;
    const sameFilial = normalizeComparable(erp.filial) === normalizeComparable(selected.planilha.filial);
    const sameBandeira = normalizeComparable(erp.bandeira) === normalizeComparable(selected.planilha.bandeira);

    let statusMatch: PcprestPlanilhaMatchStatus = "ENCONTRADO_EXATO";
    let motivo = "Registro ERP encontrado na planilha com match exato.";

    if (selected.duplicidade) {
      statusMatch = "DUPLICIDADE_NA_PLANILHA";
      motivo = "Encontrados multiplos candidatos equivalentes na planilha para o mesmo padrao de conciliacao.";
    } else if (diffAbs > tolerancia) {
      statusMatch = "ENCONTRADO_COM_DIFERENCA_DE_VALOR";
      motivo = "Registro encontrado, mas com divergencia de valor.";
    } else if (!sameDate) {
      statusMatch = "ENCONTRADO_COM_DIFERENCA_DE_DATA";
      motivo = "Registro encontrado, mas com divergencia de data.";
    } else if (!sameFilial) {
      statusMatch = "ENCONTRADO_COM_DIFERENCA_DE_FILIAL";
      motivo = "Registro encontrado, mas com divergencia de filial.";
    } else if (!sameBandeira) {
      statusMatch = "ENCONTRADO_COM_DIFERENCA_DE_BANDEIRA";
      motivo = "Registro encontrado, mas com divergencia de bandeira.";
    }

    detalhes.push(withTratativa({
      ...baseDetalhe,
      itemIdPlanilha: selected.planilha.itemId,
      importacaoIdPlanilha: selected.planilha.importacaoId,
      dataPlanilha: selected.planilha.data || "-",
      filialPlanilha: selected.planilha.filial || "-",
      bandeiraPlanilha: selected.planilha.bandeira || "-",
      valorPlanilha: selected.planilha.valor,
      statusMatch,
      motivo,
      scoreMatch: selected.score,
      regraMatch: selected.regra,
      statusTratativa: "ABERTA",
    }));
  }

  const detalhesFiltrados = applyDetailFilters(detalhes, filtrosEfetivos);

  const resumoMap = new Map<string, PcprestPlanilhaResumoLinha>();
  for (const row of detalhesFiltrados) {
    const key = makeLinhaKey(row.dataErp, row.filialErp);
    if (!resumoMap.has(key)) {
      const tratativa = obterTratativaLinha(row.dataErp, row.filialErp);
      resumoMap.set(key, {
        data: row.dataErp,
        filial: row.filialErp,
        quantidadeErp: 0,
        valorErp: 0,
        quantidadeEncontradaPlanilha: 0,
        valorEncontradoPlanilha: 0,
        quantidadeFaltante: 0,
        valorFaltante: 0,
        quantidadeComDivergencia: 0,
        statusResumo: "PENDENTE",
        statusTratativa: tratativa.statusTratativa,
        observacao: tratativa.observacao,
        ultimoProcessamento: ultimoProcessamentoDia(row.dataErp),
      });
    }

    const agg = resumoMap.get(key)!;
    agg.quantidadeErp += 1;
    agg.valorErp = round2(agg.valorErp + row.valorErp);

    if (row.statusMatch === "NAO_ENCONTRADO") {
      agg.quantidadeFaltante += 1;
      agg.valorFaltante = round2(agg.valorFaltante + row.valorErp);
    } else if (row.statusMatch !== "CANCELADO_OU_DESCARTADO") {
      agg.quantidadeEncontradaPlanilha += 1;
      agg.valorEncontradoPlanilha = round2(agg.valorEncontradoPlanilha + row.valorPlanilha);
    }

    if (isDivergenceStatus(row.statusMatch)) agg.quantidadeComDivergencia += 1;
  }

  const linhasResumo = Array.from(resumoMap.values())
    .map((row) => {
      const qtyDupAmb = detalhesFiltrados.filter((item) =>
        item.dataErp === row.data
        && normalizeComparable(item.filialErp) === normalizeComparable(row.filial)
        && (item.statusMatch === "DUPLICIDADE_NA_PLANILHA" || item.statusMatch === "MATCH_AMBIGUO"),
      ).length;
      return {
        ...row,
        statusResumo: pickSummaryStatus(
          row.quantidadeErp,
          row.quantidadeFaltante,
          row.quantidadeComDivergencia,
          qtyDupAmb,
          row.quantidadeEncontradaPlanilha,
        ),
      };
    })
    .sort((a, b) => {
      const byDate = b.data.localeCompare(a.data);
      if (byDate !== 0) return byDate;
      return a.filial.localeCompare(b.filial);
    });

  const cards: PcprestPlanilhaCards = {
    totalErpPeriodo: round2(sumBy(detalhesFiltrados, (item) => item.valorErp)),
    totalEncontradoPlanilha: round2(sumBy(detalhesFiltrados, (item) => (item.statusMatch === "NAO_ENCONTRADO" ? 0 : item.valorPlanilha))),
    totalFaltantePlanilha: round2(sumBy(detalhesFiltrados, (item) => (item.statusMatch === "NAO_ENCONTRADO" ? item.valorErp : 0))),
    quantidadeRegistrosErp: detalhesFiltrados.length,
    quantidadeConciliada: detalhesFiltrados.filter((item) => item.statusMatch === "ENCONTRADO_EXATO").length,
    quantidadeNaoEncontrada: detalhesFiltrados.filter((item) => item.statusMatch === "NAO_ENCONTRADO").length,
    quantidadeComDivergencia: detalhesFiltrados.filter((item) => isDivergenceStatus(item.statusMatch)).length,
    quantidadeComDuplicidadeOuAmbiguidade: detalhesFiltrados.filter((item) =>
      item.statusMatch === "DUPLICIDADE_NA_PLANILHA" || item.statusMatch === "MATCH_AMBIGUO").length,
  };

  const diagnostico: PcprestPlanilhaDiagnostico = {
    oracleConfigurado: isOracleEnabled(),
    fonteErp: source,
    totalErpLidos: erpRows.length,
    totalPlanilhaLidos: planilhaRows.length,
    totalConciliadoExato: detalhes.filter((item) => item.statusMatch === "ENCONTRADO_EXATO").length,
    totalNaoEncontrado: detalhes.filter((item) => item.statusMatch === "NAO_ENCONTRADO").length,
    totalDuplicidadeOuAmbiguo: detalhes.filter((item) => item.statusMatch === "DUPLICIDADE_NA_PLANILHA" || item.statusMatch === "MATCH_AMBIGUO").length,
  };

  return {
    cards,
    linhasResumo,
    linhasDetalhe: detalhesFiltrados,
    diagnostico,
  };
}
