import { db } from "../../repositories/dataStore.js";

export const concStatusValues = [
  "CONCILIADO_EXATO",
  "CONCILIADO_APROXIMADO",
  "DIVERGENCIA_VALOR",
  "DIVERGENCIA_PARCELAS",
  "DIVERGENCIA_FILIAL",
  "DIVERGENCIA_STATUS",
  "NAO_ENCONTRADO_NO_ERP",
  "NAO_ENCONTRADO_NA_OPERADORA",
  "CANCELADA",
  "CHARGEBACK",
  "DUPLICIDADE",
  "PENDENTE_REVISAO",
] as const;

export const divergenciaTipoValues = [
  "DIVERGENCIA_VALOR",
  "DIVERGENCIA_PARCELAS",
  "DIVERGENCIA_FILIAL",
  "DIVERGENCIA_STATUS",
  "NAO_ENCONTRADO_NO_ERP",
  "NAO_ENCONTRADO_NA_OPERADORA",
  "CANCELADA",
  "CHARGEBACK",
  "DUPLICIDADE",
  "PENDENTE_REVISAO",
] as const;

export const tratamentoStatusValues = ["ABERTA", "EM_ANALISE", "REVISADA", "RESOLVIDA"] as const;
export const consolidadoStatusValues = [
  "CONCILIADO",
  "DIVERGENCIA_TOTAL_DIA",
  "SEM_MOVIMENTO",
  "MOVIMENTO_SO_OPERADORA",
  "MOVIMENTO_SO_ERP",
] as const;
export const nivelConciliacaoValues = ["FILIAL_DIA", "CONSOLIDADO_DIA"] as const;

export type ConciliacaoStatus = typeof concStatusValues[number];
export type DivergenciaTipo = typeof divergenciaTipoValues[number];
export type TratamentoStatus = typeof tratamentoStatusValues[number];
export type ConsolidadoDiaStatus = typeof consolidadoStatusValues[number];
export type NivelConciliacao = typeof nivelConciliacaoValues[number];
export type OperadoraCartao = "REDE";

export interface AuditoriaCartaoImportacao {
  id: string;
  operadora: OperadoraCartao;
  nomeArquivo: string;
  hashArquivo: string;
  periodoInicial: string;
  periodoFinal: string;
  dataUpload: string;
  usuarioUpload: string;
  statusProcessamento: "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "ERRO";
  layoutOrigem: string;
  totalLinhas: number;
  totalValidas: number;
  totalInvalidas: number;
  totalConciliadas: number;
  totalDivergentes: number;
  totalNaoLocalizadas: number;
  totalCanceladas: number;
  totalChargebacks: number;
  processadoEm?: string;
  observacaoErro?: string;
}

export interface AuditoriaCartaoCamposNormalizados {
  idImportacao: string;
  linhaOrigem: number;
  dataVenda: string;
  horaVenda: string;
  dataHoraVenda: string;
  statusVenda: string;
  valorBruto: number;
  valorBrutoAtualizado: number;
  valorLiquido: number;
  modalidade: string;
  tipoTransacao: string;
  preAutorizado: boolean;
  parcelas: number;
  bandeira: string;
  taxaMdr: number;
  valorMdr: number;
  taxaRecebimentoAuto: number;
  valorRecebimentoAuto: number;
  taxasDescontadasDescricao: string;
  valorTotalTaxas: number;
  nsuCv: string;
  prazoRecebimento: string;
  lote: string;
  autorizacao: string;
  numeroEstabelecimento: string;
  nomeEstabelecimento: string;
  cnpjEstabelecimento: string;
  codfilialArquivo: string;
  numeroCartaoMascarado: string;
  carteiraDigitalId: string;
  meioPagamento: string;
  tipoMaquininha: string;
  codigoMaquininha: string;
  tid: string;
  numeroPedido: string;
  taxaEmbarque: number;
  canceladaEstabelecimento: boolean;
  dataCancelamento: string;
  valorCancelado: number;
  emChargeback: boolean;
  dataChargeback: string;
  resolucaoChargeback: string;
  dataResolucaoChargeback: string;
  nacionalidadeCartao: string;
  moedaEstrangeiraDcc: string;
  cartaoPrePago: boolean;
  idTransacao: string;
  hashConciliacao: string;
  statusConciliacao: ConciliacaoStatus;
  motivoDivergencia: string;
}

export interface AuditoriaCartaoImportacaoItem {
  id: string;
  importacaoId: string;
  linhaOrigem: number;
  jsonOrigem: Record<string, unknown>;
  camposNormalizados: AuditoriaCartaoCamposNormalizados;
  hashConciliacao: string;
  statusConciliacao: ConciliacaoStatus;
  matchId?: string;
  processadoEm?: string;
}

export interface AuditoriaCartaoMatch {
  id: string;
  importacaoId: string;
  itemImportadoId: string;
  referenciaErpId: string;
  tipoMatch: "EXATO" | "COMBINADO" | "APROXIMADO";
  scoreMatch: number;
  regraMatch: string;
  conciliado: boolean;
  valorOperadora: number;
  valorErp: number;
  diferencaValor: number;
  parcelasOperadora: number;
  parcelasErp: number;
  codfilialOperadora: string;
  codfilialErp: string;
  criadoEm: string;
}

export interface AuditoriaCartaoDivergencia {
  id: string;
  importacaoId: string;
  itemImportadoId?: string;
  referenciaErpId?: string;
  codCobranca?: string;
  tipoDivergencia: DivergenciaTipo;
  descricao: string;
  valorOperadora: number;
  valorErp: number;
  diferenca: number;
  filial: string;
  bandeira: string;
  dataVenda: string;
  statusTratativa: TratamentoStatus;
  revisado: boolean;
  observacao: string;
  criadoEm: string;
  atualizadoEm: string;
  atualizadoPor: string;
}

export interface AuditoriaCartaoRegra {
  id: string;
  toleranciaValor: number;
  janelaHorarioMinutos: number;
  prioridadeChaves: string[];
  pesosChaves: Record<string, number>;
  regrasPorOperadora: Record<string, Record<string, unknown>>;
  mapeamentoEstabelecimentoFilial: Array<{
    numeroEstabelecimento: string;
    codfilial: string;
  }>;
  regraParceladoVista: string;
  tratamentoCancelamento: string;
  tratamentoChargeback: string;
  atualizadoEm: string;
  atualizadoPor: string;
}

export interface AuditoriaCartaoLog {
  id: string;
  importacaoId: string;
  etapa: string;
  mensagem: string;
  payloadResumo?: Record<string, unknown>;
  criadoEm: string;
  criadoPor: string;
}

export interface AuditoriaCartaoAjusteManual {
  id: string;
  importacaoId: string;
  divergenciaId: string;
  acao: string;
  valorAnterior: string;
  valorNovo: string;
  observacao: string;
  usuario: string;
  criadoEm: string;
}

export interface LinhaDetalheDia {
  itemId: string;
  importacaoId: string;
  numeroPedido: string;
  nsuCv: string;
  autorizacao: string;
  tid: string;
  dataVenda: string;
  horaVenda: string;
  filial: string;
  bandeira: string;
  modalidade: string;
  parcelas: number;
  valorOperadora: number;
  valorErp: number;
  diferencaValor: number;
  statusConciliacao: ConciliacaoStatus;
  scoreMatch: number;
  regraMatch: string;
  motivoDivergencia: string;
  cancelada: boolean;
  chargeback: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuditoriaCartaoConsolidadoDia {
  id: string;
  dataReferencia: string;
  nivelConciliacao: "CONSOLIDADO_DIA";
  valorOperadora: number;
  valorErp: number;
  diferenca: number;
  statusConsolidado: ConsolidadoDiaStatus;
  qtdOperadora: number;
  qtdErp: number;
  possuiDivergenciaInternaFilial: boolean;
  statusTratativa: TratamentoStatus;
  motivoTratativa: string;
  observacao: string;
  ultimoProcessamento: string;
  processadoEm: string;
  criadoEm: string;
  atualizadoEm: string;
  atualizadoPor: string;
  metadata: Record<string, unknown>;
}

export function importacoesStore(): AuditoriaCartaoImportacao[] {
  return db.auditoriaCartaoImportacoes as AuditoriaCartaoImportacao[];
}

export function itensStore(): AuditoriaCartaoImportacaoItem[] {
  return db.auditoriaCartaoImportacaoItens as AuditoriaCartaoImportacaoItem[];
}

export function matchesStore(): AuditoriaCartaoMatch[] {
  return db.auditoriaCartaoMatches as AuditoriaCartaoMatch[];
}

export function divergenciasStore(): AuditoriaCartaoDivergencia[] {
  return db.auditoriaCartaoDivergencias as AuditoriaCartaoDivergencia[];
}

export function regrasStore(): AuditoriaCartaoRegra[] {
  return db.auditoriaCartaoRegras as AuditoriaCartaoRegra[];
}

export function logsStore(): AuditoriaCartaoLog[] {
  return db.auditoriaCartaoLogs as AuditoriaCartaoLog[];
}

export function ajustesStore(): AuditoriaCartaoAjusteManual[] {
  return db.auditoriaCartaoAjustesManuais as AuditoriaCartaoAjusteManual[];
}

export function consolidadoDiaStore(): AuditoriaCartaoConsolidadoDia[] {
  return db.auditoriaCartaoConsolidadoDia as AuditoriaCartaoConsolidadoDia[];
}
