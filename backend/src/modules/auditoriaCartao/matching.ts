import { nextId, db } from "../../repositories/dataStore.js";
import {
  type AuditoriaCartaoImportacao,
  type AuditoriaCartaoImportacaoItem,
  type AuditoriaCartaoDivergencia,
  type AuditoriaCartaoMatch,
  type AuditoriaCartaoRegra,
  type ConciliacaoStatus,
  type DivergenciaTipo,
  matchesStore,
  divergenciasStore,
} from "./types.js";
import { absDiff, minutesBetween } from "./helpers.js";
import { addLog, ensureConfiguracao, makeDivergencia, nowIso, removeResultadosImportacao, round2 } from "./state.js";
import {
  buscarVendasErpConsolidacao,
  contarVendasErpPcprestPeriodo,
  type AuditoriaCartaoErpVenda,
} from "../../repositories/auditoriaCartaoOracleRepository.js";
import { detectarVazamentoDeGranularidade, gerarDivergenciasGranulares } from "./divergencias.js";
import { isOracleEnabled } from "../../db/oracle.js";

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

const ERP_QUERY_LIMIT = 250000;
const CODCOB_MONITORADOS = ["AFZ", "756", "422", "AFZR", "341", "001", "9999", "2025"];
const LOOP_YIELD_INTERVAL = 50;

async function maybeYieldLoop(index: number): Promise<void> {
  if (index <= 0 || index % LOOP_YIELD_INTERVAL !== 0) return;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function isErpMirrorFallbackEnabled(): boolean {
  return String(process.env.AUDITORIA_CARTAO_ENABLE_ERP_MIRROR_FALLBACK || "")
    .trim()
    .toLowerCase() === "true";
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildCodCobrancaResumo(vendasErp: AuditoriaCartaoErpVenda[]): {
  totalComCodCob: number;
  totalSemCodCob: number;
  totalCodCobDistintos: number;
  topCodCob: Array<{ codCobranca: string; quantidade: number }>;
  codCobMonitorados: Array<{ codCobranca: string; quantidade: number }>;
} {
  const codCobMap = new Map<string, number>();
  let totalSemCodCob = 0;

  for (const venda of vendasErp) {
    const cod = String(venda.codCobranca || "").trim().toUpperCase();
    if (!cod) {
      totalSemCodCob += 1;
      continue;
    }
    codCobMap.set(cod, (codCobMap.get(cod) || 0) + 1);
  }

  const topCodCob = Array.from(codCobMap.entries())
    .map(([codCobranca, quantidade]) => ({ codCobranca, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 20);

  const codCobMonitorados = CODCOB_MONITORADOS.map((codCobranca) => ({
    codCobranca,
    quantidade: codCobMap.get(codCobranca) || 0,
  }));

  return {
    totalComCodCob: vendasErp.length - totalSemCodCob,
    totalSemCodCob,
    totalCodCobDistintos: codCobMap.size,
    topCodCob,
    codCobMonitorados,
  };
}

function classificarDivergenciaPrincipal(types: DivergenciaTipo[]): DivergenciaTipo {
  for (const priority of DIVERGENCIA_PRIORITY) {
    if (types.includes(priority)) return priority;
  }
  return "PENDENTE_REVISAO";
}

function isPlaceholderIdentifier(value: string): boolean {
  const normalized = normalizeComparable(value).replace(/\s+/g, "_");
  if (!normalized) return true;
  return [
    "-",
    "--",
    "n/a",
    "na",
    "null",
    "undefined",
    "sem_info",
    "sem-informacao",
    "sem_informacao",
    "sem_dado",
    "sem_dados",
    "0",
    "000000",
  ].includes(normalized);
}

function scoreMatch(
  item: AuditoriaCartaoImportacaoItem["camposNormalizados"],
  erp: AuditoriaCartaoErpVenda,
  regra: AuditoriaCartaoRegra,
): { score: number; tipoMatch: AuditoriaCartaoMatch["tipoMatch"]; regraMatch: string } {
  const pesos = regra.pesosChaves;
  let score = 0;
  let chavesFortes = 0;

  const sameDate = item.dataVenda && erp.dataVenda && item.dataVenda === erp.dataVenda;
  if (sameDate) score += pesos.DATA_VENDA ?? 20;

  const valorOperadora = item.valorBrutoAtualizado > 0 ? item.valorBrutoAtualizado : item.valorBruto;
  const valorDiff = absDiff(valorOperadora, erp.valorBruto);
  if (valorDiff <= regra.toleranciaValor) {
    score += pesos.VALOR_BRUTO ?? 32;
  } else if (valorDiff <= regra.toleranciaValor * 2) {
    score += (pesos.VALOR_BRUTO ?? 32) * 0.5;
  }

  if (item.nsuCv && erp.nsuCv && normalizeComparable(item.nsuCv) === normalizeComparable(erp.nsuCv)) {
    score += pesos.NSU_CV ?? 40;
    chavesFortes += 1;
  }

  if (item.autorizacao && erp.autorizacao && normalizeComparable(item.autorizacao) === normalizeComparable(erp.autorizacao)) {
    score += pesos.AUTORIZACAO ?? 35;
    chavesFortes += 1;
  }

  if (item.tid && erp.tid && normalizeComparable(item.tid) === normalizeComparable(erp.tid)) {
    score += pesos.TID ?? 35;
    chavesFortes += 1;
  }

  if (item.numeroPedido && erp.numeroPedido && normalizeComparable(item.numeroPedido) === normalizeComparable(erp.numeroPedido)) {
    score += pesos.NUMERO_PEDIDO ?? 28;
    chavesFortes += 1;
  }

  const minDiff = minutesBetween(item.dataVenda, item.horaVenda, erp.horaVenda);
  if (minDiff <= regra.janelaHorarioMinutos) {
    score += pesos.HORA_VENDA ?? 8;
  }

  if (item.codfilialArquivo && erp.codfilial && normalizeComparable(item.codfilialArquivo) === normalizeComparable(erp.codfilial)) {
    score += pesos.CODFILIAL ?? 12;
  }

  if (item.parcelas > 0 && erp.parcelas > 0 && item.parcelas === erp.parcelas) {
    score += pesos.PARCELAS ?? 9;
  }

  if (item.bandeira && erp.bandeira && normalizeComparable(item.bandeira) === normalizeComparable(erp.bandeira)) {
    score += pesos.BANDEIRA ?? 4;
  }

  if (item.modalidade && erp.modalidade && normalizeComparable(item.modalidade) === normalizeComparable(erp.modalidade)) {
    score += pesos.MODALIDADE ?? 4;
  }

  const limitedScore = Math.min(100, round2(score));

  if (chavesFortes > 0 && sameDate && valorDiff <= regra.toleranciaValor) {
    return {
      score: limitedScore,
      tipoMatch: "EXATO",
      regraMatch: "REGRA_1_MATCH_EXATO_FORTE",
    };
  }

  if (limitedScore >= 75) {
    return {
      score: limitedScore,
      tipoMatch: "COMBINADO",
      regraMatch: "REGRA_2_COMBINACAO_ATRIBUTOS",
    };
  }

  return {
    score: limitedScore,
    tipoMatch: "APROXIMADO",
    regraMatch: "REGRA_3_MATCH_APROXIMADO_SCORE",
  };
}

function splitValorEmParcelas(valorTotal: number, quantidadeParcelas: number): number[] {
  const safeParcelas = Math.max(1, quantidadeParcelas);
  const sinal = valorTotal < 0 ? -1 : 1;
  const totalCentavos = Math.round(Math.abs(valorTotal) * 100);
  const centavosBase = Math.floor(totalCentavos / safeParcelas);
  const valores: number[] = [];
  let acumulado = 0;

  for (let parcela = 1; parcela <= safeParcelas; parcela += 1) {
    const centavos = parcela === safeParcelas
      ? totalCentavos - acumulado
      : centavosBase;
    acumulado += centavos;
    valores.push(round2((centavos / 100) * sinal));
  }

  return valores;
}

export function gerarErpFallback(itens: AuditoriaCartaoImportacaoItem[]): AuditoriaCartaoErpVenda[] {
  const rows: AuditoriaCartaoErpVenda[] = [];

  for (const item of itens) {
    const base = item.camposNormalizados;
    const valorTotal = base.valorBrutoAtualizado > 0 ? base.valorBrutoAtualizado : base.valorBruto;
    if (!base.dataVenda || !Number.isFinite(valorTotal) || valorTotal <= 0) continue;

    const parcelasTotais = Math.max(1, Math.round(base.parcelas || 1));
    const valoresParcelas = parcelasTotais > 1 ? splitValorEmParcelas(valorTotal, parcelasTotais) : [round2(valorTotal)];
    const numeroPedido = isPlaceholderIdentifier(base.numeroPedido || "") ? item.id : base.numeroPedido;
    const nsuCv = isPlaceholderIdentifier(base.nsuCv || "") ? item.id : base.nsuCv;
    const autorizacao = isPlaceholderIdentifier(base.autorizacao || "") ? item.id : base.autorizacao;
    const tid = isPlaceholderIdentifier(base.tid || "") ? item.id : base.tid;

    for (let index = 0; index < valoresParcelas.length; index += 1) {
      const numeroParcela = index + 1;
      const valorParcela = valoresParcelas[index];
      rows.push({
        referenciaErpId: `ERP-FBK-${item.id}-${String(numeroParcela).padStart(2, "0")}`,
        dataVenda: base.dataVenda,
        horaVenda: base.horaVenda,
        dataHoraVenda: base.dataHoraVenda,
        valorBruto: valorParcela,
        valorLiquido: valorParcela,
        parcelas: parcelasTotais > 1 ? numeroParcela : parcelasTotais,
        codfilial: base.codfilialArquivo,
        nsuCv,
        autorizacao,
        tid,
        numeroPedido,
        bandeira: base.bandeira,
        modalidade: base.modalidade,
        statusVenda: "APROVADA",
        origemConsulta: "PCPREST",
      });
    }
  }

  return rows;
}

interface MatchCandidate {
  erp: AuditoriaCartaoErpVenda;
  score: number;
  tipoMatch: AuditoriaCartaoMatch["tipoMatch"];
  regraMatch: string;
  forcarConciliadoExatoPorValor: boolean;
  erpIdsReservados: string[];
}

function escolherIdentificadorAgrupamentoErp(erp: AuditoriaCartaoErpVenda): string {
  const candidatos = [
    erp.numeroPedido,
    erp.nsuCv,
    erp.autorizacao,
    erp.tid,
    erp.referenciaErpId,
  ];

  for (const candidato of candidatos) {
    const normalizado = normalizeComparable(candidato || "");
    if (normalizado && !isPlaceholderIdentifier(normalizado)) return normalizado;
  }
  return "";
}

function ordenarParcelasCrescentes(rows: AuditoriaCartaoErpVenda[]): AuditoriaCartaoErpVenda[] {
  return [...rows].sort((a, b) => {
    const pa = Number.isFinite(a.parcelas) ? a.parcelas : 0;
    const pb = Number.isFinite(b.parcelas) ? b.parcelas : 0;
    if (pa !== pb) return pa - pb;
    const ha = normalizeComparable(a.horaVenda || "");
    const hb = normalizeComparable(b.horaVenda || "");
    if (ha !== hb) return ha.localeCompare(hb);
    return a.referenciaErpId.localeCompare(b.referenciaErpId);
  });
}

function selecionarJanelaParcelas(
  rows: AuditoriaCartaoErpVenda[],
  parcelasAlvo: number,
  valorOperadora: number,
  toleranciaValor: number,
): AuditoriaCartaoErpVenda[] | null {
  if (rows.length < 2) return null;

  const ordenadas = ordenarParcelasCrescentes(rows);
  const targetCount = parcelasAlvo > 1 ? parcelasAlvo : rows.length;

  let melhorRows: AuditoriaCartaoErpVenda[] | null = null;
  let menorDiff = Number.POSITIVE_INFINITY;

  if (targetCount > 1 && ordenadas.length >= targetCount) {
    for (let inicio = 0; inicio <= ordenadas.length - targetCount; inicio += 1) {
      const janela = ordenadas.slice(inicio, inicio + targetCount);
      const somaJanela = round2(janela.reduce((acc, row) => acc + row.valorBruto, 0));
      const diffJanela = absDiff(somaJanela, valorOperadora);
      if (diffJanela < menorDiff) {
        menorDiff = diffJanela;
        melhorRows = janela;
      }
    }
  }

  if (!melhorRows) {
    const somaTotal = round2(ordenadas.reduce((acc, row) => acc + row.valorBruto, 0));
    const diffTotal = absDiff(somaTotal, valorOperadora);
    if (diffTotal <= toleranciaValor) {
      melhorRows = ordenadas;
      menorDiff = diffTotal;
    }
  }

  if (!melhorRows) return null;
  if (menorDiff > toleranciaValor) return null;
  return melhorRows;
}

export function buscarMatchErpAgrupadoPorParcelas(
  item: AuditoriaCartaoImportacaoItem["camposNormalizados"],
  valorOperadora: number,
  vendasErp: AuditoriaCartaoErpVenda[],
  usedErpIds: Set<string>,
  regra: AuditoriaCartaoRegra,
): MatchCandidate | null {
  const grupos = new Map<string, { rows: AuditoriaCartaoErpVenda[]; somaValor: number; somaLiquido: number }>();
  const filialItem = normalizeComparable(item.codfilialArquivo || "SEM_FILIAL");

  for (const erp of vendasErp) {
    if (usedErpIds.has(erp.referenciaErpId)) continue;
    if (!erp.dataVenda || erp.dataVenda !== item.dataVenda) continue;

    const identificador = escolherIdentificadorAgrupamentoErp(erp);
    if (!identificador) continue;

    const filial = normalizeComparable(erp.codfilial || "SEM_FILIAL");
    const chaveGrupo = `${erp.dataVenda}|${filial}|${identificador}`;

    if (!grupos.has(chaveGrupo)) {
      grupos.set(chaveGrupo, { rows: [], somaValor: 0, somaLiquido: 0 });
    }

    const grupo = grupos.get(chaveGrupo)!;
    grupo.rows.push(erp);
    grupo.somaValor = round2(grupo.somaValor + erp.valorBruto);
    grupo.somaLiquido = round2(grupo.somaLiquido + (erp.valorLiquido || erp.valorBruto));
  }

  let melhor: MatchCandidate | null = null;

  for (const grupo of grupos.values()) {
    if (grupo.rows.length < 2) continue;

    const selecionadas = selecionarJanelaParcelas(
      grupo.rows,
      item.parcelas,
      valorOperadora,
      regra.toleranciaValor,
    );
    if (!selecionadas || selecionadas.length < 2) continue;

    const somaValor = round2(selecionadas.reduce((acc, row) => acc + row.valorBruto, 0));
    const somaLiquido = round2(selecionadas.reduce((acc, row) => acc + (row.valorLiquido || row.valorBruto), 0));
    const diff = absDiff(somaValor, valorOperadora);
    if (diff > regra.toleranciaValor) continue;

    const linhaBase = selecionadas[0];
    const filialGrupo = normalizeComparable(linhaBase.codfilial || "SEM_FILIAL");
    const bonusFilial = filialGrupo === filialItem ? 10 : 0;
    const score = Math.min(100, round2(90 + bonusFilial - diff));
    const referenciaAgrupada = `ERP-AGG-${linhaBase.referenciaErpId}-${selecionadas.length}`;

    const candidato: MatchCandidate = {
      erp: {
        referenciaErpId: referenciaAgrupada,
        dataVenda: linhaBase.dataVenda,
        horaVenda: linhaBase.horaVenda,
        dataHoraVenda: linhaBase.dataHoraVenda,
        valorBruto: somaValor,
        valorLiquido: somaLiquido,
        parcelas: selecionadas.length,
        codfilial: linhaBase.codfilial,
        nsuCv: linhaBase.nsuCv,
        autorizacao: linhaBase.autorizacao,
        tid: linhaBase.tid,
        numeroPedido: linhaBase.numeroPedido,
        bandeira: linhaBase.bandeira,
        modalidade: linhaBase.modalidade,
        statusVenda: linhaBase.statusVenda,
        origemConsulta: linhaBase.origemConsulta,
      },
      score,
      tipoMatch: "EXATO",
      regraMatch: "REGRA_1_SOMA_PARCELAS_ERP_DTEMISSAO",
      forcarConciliadoExatoPorValor: true,
      erpIdsReservados: selecionadas.map((row) => row.referenciaErpId),
    };

    if (!melhor || candidato.score > melhor.score) {
      melhor = candidato;
    }
  }

  if (melhor) return melhor;

  const buscarHeuristicaSemIdentificador = (somenteMesmaFilial: boolean): MatchCandidate | null => {
    if ((item.parcelas || 0) <= 1) return null;

    const candidatosDia = vendasErp.filter((erp) => {
      if (usedErpIds.has(erp.referenciaErpId)) return false;
      if (!erp.dataVenda || erp.dataVenda !== item.dataVenda) return false;
      if (!somenteMesmaFilial) return true;
      return normalizeComparable(erp.codfilial || "SEM_FILIAL") === filialItem;
    });

    if (candidatosDia.length < item.parcelas) return null;

    const targetParcela = valorOperadora / item.parcelas;
    const toleranciaParcela = Math.max(1, regra.toleranciaValor * 4);
    const gruposHeuristicos = new Map<string, AuditoriaCartaoErpVenda[]>();

    for (const erp of candidatosDia) {
      const filial = normalizeComparable(erp.codfilial || "SEM_FILIAL");
      const bandeira = normalizeComparable(erp.bandeira || "SEM_BANDEIRA");
      const modalidade = normalizeComparable(erp.modalidade || "SEM_MODALIDADE");
      const key = `${filial}|${bandeira}|${modalidade}`;
      if (!gruposHeuristicos.has(key)) gruposHeuristicos.set(key, []);
      gruposHeuristicos.get(key)!.push(erp);
    }

    let melhorLocal: MatchCandidate | null = null;

    for (const rows of gruposHeuristicos.values()) {
      const ordenadas = [...rows].sort(
        (a, b) => absDiff(a.valorBruto, targetParcela) - absDiff(b.valorBruto, targetParcela),
      );
      const proximas = ordenadas.filter((row) => absDiff(row.valorBruto, targetParcela) <= toleranciaParcela);
      const pool = proximas.length >= item.parcelas ? proximas : ordenadas;
      if (pool.length < item.parcelas) continue;

      const selecionadas = pool.slice(0, item.parcelas);
      const somaValor = round2(selecionadas.reduce((acc, row) => acc + row.valorBruto, 0));
      const somaLiquido = round2(selecionadas.reduce((acc, row) => acc + (row.valorLiquido || row.valorBruto), 0));
      const diff = absDiff(somaValor, valorOperadora);
      if (diff > regra.toleranciaValor) continue;

      const linhaBase = selecionadas[0];
      const score = Math.min(100, round2(94 - diff));
      const candidato: MatchCandidate = {
        erp: {
          referenciaErpId: `ERP-AGG-HEUR-${linhaBase.referenciaErpId}-${selecionadas.length}`,
          dataVenda: linhaBase.dataVenda,
          horaVenda: linhaBase.horaVenda,
          dataHoraVenda: linhaBase.dataHoraVenda,
          valorBruto: somaValor,
          valorLiquido: somaLiquido,
          parcelas: selecionadas.length,
          codfilial: linhaBase.codfilial,
          nsuCv: linhaBase.nsuCv,
          autorizacao: linhaBase.autorizacao,
          tid: linhaBase.tid,
          numeroPedido: linhaBase.numeroPedido,
          bandeira: linhaBase.bandeira,
          modalidade: linhaBase.modalidade,
          statusVenda: linhaBase.statusVenda,
          origemConsulta: linhaBase.origemConsulta,
        },
        score,
        tipoMatch: "EXATO",
        regraMatch: "REGRA_1_SOMA_PARCELAS_ERP_HEURISTICA",
        forcarConciliadoExatoPorValor: true,
        erpIdsReservados: selecionadas.map((row) => row.referenciaErpId),
      };

      if (!melhorLocal || candidato.score > melhorLocal.score) {
        melhorLocal = candidato;
      }
    }

    return melhorLocal;
  };

  const heuristicaMesmoFilial = buscarHeuristicaSemIdentificador(true);
  if (heuristicaMesmoFilial) return heuristicaMesmoFilial;

  const heuristicaDia = buscarHeuristicaSemIdentificador(false);
  if (heuristicaDia) return heuristicaDia;

  return melhor;
}

export async function executarConciliacaoImportacao(
  importacao: AuditoriaCartaoImportacao,
  itensDaImportacao: AuditoriaCartaoImportacaoItem[],
  usuario: string,
): Promise<void> {
  const regra = ensureConfiguracao(usuario);
  const fallbackEspelhoConfigurado = isErpMirrorFallbackEnabled();
  const oracleConfigurado = isOracleEnabled();
  const fallbackEspelhoAtivo = fallbackEspelhoConfigurado;

  const datasValidas = itensDaImportacao
    .map((item) => item.camposNormalizados.dataVenda)
    .filter((item) => Boolean(item))
    .sort();

  importacao.periodoInicial = datasValidas[0] || importacao.periodoInicial || new Date().toISOString().slice(0, 10);
  importacao.periodoFinal = datasValidas[datasValidas.length - 1] || importacao.periodoFinal || importacao.periodoInicial;

  if (!oracleConfigurado && !fallbackEspelhoConfigurado) {
    addLog(
      importacao.id,
      "CONSULTA_ERP_SEM_CONFIG",
      "Oracle nao configurado no backend. Processamento segue sem fallback espelho (modo auditoria estrita).",
      usuario,
      {
        oracleConfigurado: false,
        modoFallback: "DESATIVADO",
        modoAuditoriaEstrita: true,
        periodoInicial: importacao.periodoInicial,
        periodoFinal: importacao.periodoFinal,
      },
    );
  }

  const totalPcprestPeriodo = await contarVendasErpPcprestPeriodo(
    importacao.periodoInicial,
    importacao.periodoFinal,
  );

  let vendasErp = await buscarVendasErpConsolidacao({
    periodoInicial: importacao.periodoInicial,
    periodoFinal: importacao.periodoFinal,
    limite: ERP_QUERY_LIMIT,
  });
  const semDadosErp = vendasErp.length === 0;
  let usandoFallbackErp = false;

  if (semDadosErp && fallbackEspelhoAtivo) {
    usandoFallbackErp = true;
    vendasErp = gerarErpFallback(itensDaImportacao);
    const codCobResumo = buildCodCobrancaResumo(vendasErp);
    addLog(importacao.id, "CONSULTA_ERP", "Consulta ERP sem dados. Fallback espelho ativado por configuracao explicita.", usuario, {
      oracleConfigurado: isOracleEnabled(),
      totalFallback: vendasErp.length,
      modoFallback: "ESPELHO_OPERADORA_PARCELADO_DTEMISSAO",
      modoAuditoriaEstrita: false,
      totalPcprestPeriodo,
      limiteConsultaErp: ERP_QUERY_LIMIT,
      ...codCobResumo,
    });
  } else if (semDadosErp) {
    addLog(importacao.id, "CONSULTA_ERP_SEM_DADOS", "Consulta ERP sem retorno. Fallback espelho desativado para preservar auditoria real.", usuario, {
      oracleConfigurado: isOracleEnabled(),
      modoFallback: "DESATIVADO",
      modoAuditoriaEstrita: true,
      totalPcprestPeriodo,
      limiteConsultaErp: ERP_QUERY_LIMIT,
    });
  } else {
    const codCobResumo = buildCodCobrancaResumo(vendasErp);
    const totalViaPcprest = vendasErp.filter((row) => row.origemConsulta === "PCPREST").length;
    const totalViaView = vendasErp.filter((row) => row.origemConsulta === "VW_AUDITORIA_CARTAO_ERP").length;
    addLog(importacao.id, "CONSULTA_ERP", "Consulta Oracle/WinThor executada com sucesso", usuario, {
      totalEncontrado: vendasErp.length,
      totalViaPcprest,
      totalViaView,
      totalPcprestPeriodo,
      periodoInicial: importacao.periodoInicial,
      periodoFinal: importacao.periodoFinal,
      basePrincipal: "PCPREST",
      limiteConsultaErp: ERP_QUERY_LIMIT,
      limiteAtingido: totalViaPcprest >= ERP_QUERY_LIMIT,
      ...codCobResumo,
    });

    if (totalViaPcprest >= ERP_QUERY_LIMIT || totalPcprestPeriodo > ERP_QUERY_LIMIT) {
      addLog(importacao.id, "ALERTA_CONSULTA_ERP_LIMITADA", "Consulta ERP atingiu o limite operacional e pode estar truncada no periodo.", usuario, {
        totalViaPcprest,
        totalPcprestPeriodo,
        limiteConsultaErp: ERP_QUERY_LIMIT,
        recomendacao: "Refinar o periodo por data/filial para varrer 100% dos registros.",
      });
    }
  }

  const erpPorData = new Map<string, AuditoriaCartaoErpVenda[]>();
  const erpPorDataFilial = new Map<string, AuditoriaCartaoErpVenda[]>();
  const erpPorDataValorCentavos = new Map<string, Map<number, AuditoriaCartaoErpVenda[]>>();

  const adicionarNoIndice = <T>(map: Map<string, T[]>, key: string, value: T): void => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(value);
  };

  const toCentavos = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);

  const obterCandidatosPorValorNoDia = (
    dataVenda: string,
    valorAlvo: number,
    tolerancia: number,
  ): AuditoriaCartaoErpVenda[] => {
    const bucketMap = erpPorDataValorCentavos.get(dataVenda);
    if (!bucketMap) return [];

    const alvoCentavos = toCentavos(valorAlvo);
    const toleranciaCentavos = Math.max(0, Math.round((Number.isFinite(tolerancia) ? tolerancia : 0) * 100));
    const candidatos: AuditoriaCartaoErpVenda[] = [];

    for (let cents = alvoCentavos - toleranciaCentavos; cents <= alvoCentavos + toleranciaCentavos; cents += 1) {
      const encontrados = bucketMap.get(cents);
      if (!encontrados?.length) continue;
      candidatos.push(...encontrados);
    }

    return candidatos;
  };

  for (let erpIndex = 0; erpIndex < vendasErp.length; erpIndex += 1) {
    await maybeYieldLoop(erpIndex);
    const erp = vendasErp[erpIndex];
    const data = erp.dataVenda || "";
    if (!data) continue;

    adicionarNoIndice(erpPorData, data, erp);

    const filialNorm = normalizeComparable(erp.codfilial || "SEM_FILIAL");
    adicionarNoIndice(erpPorDataFilial, `${data}|${filialNorm}`, erp);

    if (!erpPorDataValorCentavos.has(data)) {
      erpPorDataValorCentavos.set(data, new Map<number, AuditoriaCartaoErpVenda[]>());
    }
    const bucketMap = erpPorDataValorCentavos.get(data)!;
    const cents = toCentavos(erp.valorBruto);
    if (!bucketMap.has(cents)) bucketMap.set(cents, []);
    bucketMap.get(cents)!.push(erp);
  }

  const hashes = new Map<string, number>();
  const itensOrdenados = [...itensDaImportacao].sort((a, b) => {
    const parcelasA = a.camposNormalizados.parcelas || 0;
    const parcelasB = b.camposNormalizados.parcelas || 0;
    if (parcelasA !== parcelasB) return parcelasB - parcelasA;

    const valorA = a.camposNormalizados.valorBrutoAtualizado > 0
      ? a.camposNormalizados.valorBrutoAtualizado
      : a.camposNormalizados.valorBruto;
    const valorB = b.camposNormalizados.valorBrutoAtualizado > 0
      ? b.camposNormalizados.valorBrutoAtualizado
      : b.camposNormalizados.valorBruto;
    if (valorA !== valorB) return valorB - valorA;

    return a.id.localeCompare(b.id);
  });

  for (let index = 0; index < itensDaImportacao.length; index += 1) {
    await maybeYieldLoop(index);
    const item = itensDaImportacao[index];
    hashes.set(item.hashConciliacao, (hashes.get(item.hashConciliacao) || 0) + 1);
  }

  const usedErpIds = new Set<string>();
  const novosMatches: AuditoriaCartaoMatch[] = [];
  const novasDivergencias: AuditoriaCartaoDivergencia[] = [];
  const divergenciasErpSemOperadora: AuditoriaCartaoDivergencia[] = [];

  for (let itemIndex = 0; itemIndex < itensOrdenados.length; itemIndex += 1) {
    await maybeYieldLoop(itemIndex);
    const item = itensOrdenados[itemIndex];
    const normalized = item.camposNormalizados;
    const valorOperadora = normalized.valorBrutoAtualizado > 0 ? normalized.valorBrutoAtualizado : normalized.valorBruto;

    item.statusConciliacao = "PENDENTE_REVISAO";
    item.camposNormalizados.statusConciliacao = "PENDENTE_REVISAO";
    item.camposNormalizados.motivoDivergencia = "";
    item.matchId = undefined;

    if (!normalized.dataVenda || (normalized.valorBruto <= 0 && normalized.valorBrutoAtualizado <= 0)) {
      item.camposNormalizados.motivoDivergencia = "Linha invalida para conciliacao automatica";
      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        tipoDivergencia: "PENDENTE_REVISAO",
        descricao: "Linha invalida para conciliacao automatica",
        valorOperadora,
        valorErp: 0,
        diferenca: valorOperadora,
        filial: normalized.codfilialArquivo,
        bandeira: normalized.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
      continue;
    }

    if ((hashes.get(item.hashConciliacao) || 0) > 1) {
      item.statusConciliacao = "DUPLICIDADE";
      item.camposNormalizados.statusConciliacao = "DUPLICIDADE";
      item.camposNormalizados.motivoDivergencia = "Duplicidade detectada na operadora";
      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        tipoDivergencia: "DUPLICIDADE",
        descricao: "Possivel duplicidade da venda na operadora",
        valorOperadora,
        valorErp: 0,
        diferenca: valorOperadora,
        filial: normalized.codfilialArquivo,
        bandeira: normalized.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
      continue;
    }

    if (normalized.canceladaEstabelecimento) {
      item.statusConciliacao = "CANCELADA";
      item.camposNormalizados.statusConciliacao = "CANCELADA";
      item.camposNormalizados.motivoDivergencia = "Venda cancelada pelo estabelecimento";
      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        tipoDivergencia: "CANCELADA",
        descricao: "Venda marcada como cancelada na operadora",
        valorOperadora,
        valorErp: 0,
        diferenca: valorOperadora,
        filial: normalized.codfilialArquivo,
        bandeira: normalized.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
      continue;
    }

    if (normalized.emChargeback) {
      item.statusConciliacao = "CHARGEBACK";
      item.camposNormalizados.statusConciliacao = "CHARGEBACK";
      item.camposNormalizados.motivoDivergencia = "Venda em disputa/chargeback";
      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        tipoDivergencia: "CHARGEBACK",
        descricao: "Venda em disputa de chargeback",
        valorOperadora,
        valorErp: 0,
        diferenca: valorOperadora,
        filial: normalized.codfilialArquivo,
        bandeira: normalized.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
      continue;
    }

    let bestCandidate: MatchCandidate | null = null;
    const filialNormalizadaItem = normalizeComparable(normalized.codfilialArquivo || "SEM_FILIAL");
    const candidatosErpDia = normalized.dataVenda ? (erpPorData.get(normalized.dataVenda) || []) : [];
    const candidatosErpDiaFilial = normalized.dataVenda
      ? (erpPorDataFilial.get(`${normalized.dataVenda}|${filialNormalizadaItem}`) || [])
      : [];

    // Prioriza caso parcelado (ex.: 12x) no mesmo dia para evitar consumo
    // indevido de parcelas ERP por matches unitarios.
    if (normalized.parcelas > 1) {
      const candidatoAgrupadoPrioritario = buscarMatchErpAgrupadoPorParcelas(
        normalized,
        valorOperadora,
        candidatosErpDia,
        usedErpIds,
        regra,
      );
      if (candidatoAgrupadoPrioritario) {
        bestCandidate = candidatoAgrupadoPrioritario;
      }
    }

    if (!bestCandidate) {
      for (let erpIndex = 0; erpIndex < candidatosErpDiaFilial.length; erpIndex += 1) {
        await maybeYieldLoop(erpIndex);
        const erp = candidatosErpDiaFilial[erpIndex];
        if (usedErpIds.has(erp.referenciaErpId)) continue;
        if (absDiff(valorOperadora, erp.valorBruto) > regra.toleranciaValor) continue;

        const scored = scoreMatch(normalized, erp, regra);
        const valorExatoDia = absDiff(valorOperadora, erp.valorBruto) <= regra.toleranciaValor
          && Boolean(normalized.dataVenda)
          && Boolean(erp.dataVenda)
          && normalized.dataVenda === erp.dataVenda;
        const scoreForcado = valorExatoDia ? 100 : scored.score;
        if (!bestCandidate || scoreForcado > bestCandidate.score) {
          bestCandidate = {
            erp,
            score: scoreForcado,
            tipoMatch: valorExatoDia ? "EXATO" : scored.tipoMatch,
            regraMatch: valorExatoDia ? "REGRA_1_VALOR_EXATO_DIA" : scored.regraMatch,
            forcarConciliadoExatoPorValor: valorExatoDia,
            erpIdsReservados: [erp.referenciaErpId],
          };
        }
      }
    }

    // Regra complementar solicitada pelo negocio:
    // quando existir o mesmo valor no mesmo dia, considerar correspondencia da mesma venda
    // mesmo que a filial venha diferente entre operadora e ERP.
    if (!bestCandidate) {
      const candidatosMesmoValorNoDia = normalized.dataVenda
        ? obterCandidatosPorValorNoDia(normalized.dataVenda, valorOperadora, regra.toleranciaValor)
        : [];

      for (let erpIndex = 0; erpIndex < candidatosMesmoValorNoDia.length; erpIndex += 1) {
        await maybeYieldLoop(erpIndex);
        const erp = candidatosMesmoValorNoDia[erpIndex];
        if (usedErpIds.has(erp.referenciaErpId)) continue;

        const scored = scoreMatch(normalized, erp, regra);
        const scoreForcado = Math.max(100, scored.score);
        if (!bestCandidate || scoreForcado > bestCandidate.score) {
          bestCandidate = {
            erp,
            score: scoreForcado,
            tipoMatch: "EXATO",
            regraMatch: "REGRA_1_VALOR_EXATO_DIA",
            forcarConciliadoExatoPorValor: true,
            erpIdsReservados: [erp.referenciaErpId],
          };
        }
      }
    }

    if (!bestCandidate) {
      const candidatoAgrupado = buscarMatchErpAgrupadoPorParcelas(
        normalized,
        valorOperadora,
        candidatosErpDia,
        usedErpIds,
        regra,
      );
      if (candidatoAgrupado) {
        bestCandidate = candidatoAgrupado;
      }
    }

    if (!bestCandidate || (!bestCandidate.forcarConciliadoExatoPorValor && bestCandidate.score < 55)) {
      item.statusConciliacao = "NAO_ENCONTRADO_NO_ERP";
      item.camposNormalizados.statusConciliacao = "NAO_ENCONTRADO_NO_ERP";
      item.camposNormalizados.motivoDivergencia = "Venda da operadora sem correspondente no ERP";

      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        tipoDivergencia: "NAO_ENCONTRADO_NO_ERP",
        descricao: "Venda nao localizada no ERP/WinThor",
        valorOperadora,
        valorErp: 0,
        diferenca: valorOperadora,
        filial: normalized.codfilialArquivo,
        bandeira: normalized.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
      continue;
    }

    const erp = bestCandidate.erp;
    for (const erpId of bestCandidate.erpIdsReservados) {
      usedErpIds.add(erpId);
    }

    const difValor = round2(absDiff(valorOperadora, erp.valorBruto));
    const divergenciasLinha: DivergenciaTipo[] = [];

    if (difValor > regra.toleranciaValor) divergenciasLinha.push("DIVERGENCIA_VALOR");

    if (normalized.parcelas > 0 && erp.parcelas > 0 && normalized.parcelas !== erp.parcelas) {
      divergenciasLinha.push("DIVERGENCIA_PARCELAS");
    }

    if (
      normalized.codfilialArquivo
      && erp.codfilial
      && normalizeComparable(normalized.codfilialArquivo) !== normalizeComparable(erp.codfilial)
    ) {
      divergenciasLinha.push("DIVERGENCIA_FILIAL");
    }

    if (
      normalized.statusVenda
      && erp.statusVenda
      && normalizeComparable(normalized.statusVenda) !== normalizeComparable(erp.statusVenda)
    ) {
      divergenciasLinha.push("DIVERGENCIA_STATUS");
    }

    const match: AuditoriaCartaoMatch = {
      id: nextId("ACM", matchesStore().length + novosMatches.length),
      importacaoId: importacao.id,
      itemImportadoId: item.id,
      referenciaErpId: erp.referenciaErpId,
      tipoMatch: bestCandidate.tipoMatch,
      scoreMatch: bestCandidate.score,
      regraMatch: bestCandidate.regraMatch,
      conciliado: divergenciasLinha.length === 0,
      valorOperadora,
      valorErp: erp.valorBruto,
      diferencaValor: difValor,
      parcelasOperadora: normalized.parcelas,
      parcelasErp: erp.parcelas,
      codfilialOperadora: normalized.codfilialArquivo,
      codfilialErp: erp.codfilial,
      criadoEm: nowIso(),
    };

    novosMatches.push(match);
    item.matchId = match.id;

    if (bestCandidate.forcarConciliadoExatoPorValor) {
      item.statusConciliacao = "CONCILIADO_EXATO";
      item.camposNormalizados.statusConciliacao = "CONCILIADO_EXATO";
      item.camposNormalizados.motivoDivergencia = "";
      continue;
    }

    if (divergenciasLinha.length === 0) {
      const status: ConciliacaoStatus = bestCandidate.tipoMatch === "EXATO" && bestCandidate.score >= 90
        ? "CONCILIADO_EXATO"
        : "CONCILIADO_APROXIMADO";
      item.statusConciliacao = status;
      item.camposNormalizados.statusConciliacao = status;
      item.camposNormalizados.motivoDivergencia = "";
      continue;
    }

    const principal = classificarDivergenciaPrincipal(divergenciasLinha);
    item.statusConciliacao = principal;
    item.camposNormalizados.statusConciliacao = principal;
    item.camposNormalizados.motivoDivergencia = divergenciasLinha.join(" | ");

    for (const tipo of divergenciasLinha) {
      novasDivergencias.push(makeDivergencia({
        importacaoId: importacao.id,
        itemImportadoId: item.id,
        referenciaErpId: erp.referenciaErpId,
        tipoDivergencia: tipo,
        descricao: `Divergencia detectada: ${tipo}`,
        valorOperadora,
        valorErp: erp.valorBruto,
        diferenca: round2(valorOperadora - erp.valorBruto),
        filial: normalized.codfilialArquivo || erp.codfilial,
        bandeira: normalized.bandeira || erp.bandeira,
        dataVenda: normalized.dataVenda,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
      }, usuario));
    }
  }

  for (let erpIndex = 0; erpIndex < vendasErp.length; erpIndex += 1) {
    await maybeYieldLoop(erpIndex);
    const erp = vendasErp[erpIndex];
    if (usedErpIds.has(erp.referenciaErpId)) continue;

    divergenciasErpSemOperadora.push(makeDivergencia({
      importacaoId: importacao.id,
      referenciaErpId: erp.referenciaErpId,
      tipoDivergencia: "NAO_ENCONTRADO_NA_OPERADORA",
      descricao: "Venda encontrada no ERP sem correspondente na operadora",
      valorOperadora: 0,
      valorErp: erp.valorBruto,
      diferenca: round2(0 - erp.valorBruto),
      filial: erp.codfilial,
      bandeira: erp.bandeira,
      dataVenda: erp.dataVenda,
      codCobranca: erp.codCobranca || "",
      statusTratativa: "ABERTA",
      revisado: false,
      observacao: "",
    }, usuario));
  }

  removeResultadosImportacao(importacao.id);
  db.auditoriaCartaoMatches = [...matchesStore(), ...novosMatches];
  const matchesByItemId = new Map<string, { codfilialErp: string; valorErp: number; parcelasErp: number }>(
    novosMatches.map((item) => [
      item.itemImportadoId,
      {
        codfilialErp: item.codfilialErp,
        valorErp: item.valorErp,
        parcelasErp: item.parcelasErp,
      },
    ]),
  );
  const granular = gerarDivergenciasGranulares({
    importacaoId: importacao.id,
    itens: itensDaImportacao,
    vendasErp,
    regra,
    usuario,
    hashConciliacaoCount: hashes,
    matchesByItemId,
    usarMatchesComoBaseErp: usandoFallbackErp,
  });
  const divergenciasGranulares = granular.divergencias
    .filter((item) => item.tipoDivergencia !== "NAO_ENCONTRADO_NA_OPERADORA");
  db.auditoriaCartaoDivergencias = [
    ...divergenciasStore(),
    ...divergenciasGranulares,
    ...divergenciasErpSemOperadora,
  ];

  addLog(importacao.id, "DIAGNOSTICO_DIVERGENCIAS", "Diagnostico da granularidade da aba Divergencias", usuario, {
    totalOperadoraAgg: granular.diagnostics.totalOperadoraAgg,
    totalErpAgg: granular.diagnostics.totalErpAgg,
    totalLinhasBase: granular.diagnostics.totalLinhasBase,
    totalLinhasComDivergencia: granular.diagnostics.totalLinhasComDivergencia,
    totalDivergenciasGeradas: granular.diagnostics.totalDivergenciasGeradas,
    chavesDuplicadasPosJoin: granular.diagnostics.chavesDuplicadasPosJoin,
    chavesOperadoraInvalidas: granular.diagnostics.chavesOperadoraInvalidas,
    chavesErpInvalidas: granular.diagnostics.chavesErpInvalidas,
    contagemPorDataFilial: granular.diagnostics.contagemPorDataFilial,
  });

  const inconsistencias = detectarVazamentoDeGranularidade(granular.divergencias);
  if (inconsistencias.length > 0) {
    addLog(importacao.id, "ERRO_CONSISTENCIA_DIVERGENCIAS", "Detectada inconsistência de granularidade em data+filial", usuario, {
      inconsistencias,
    });
  }

  importacao.totalConciliadas = itensDaImportacao.filter((item) => ["CONCILIADO_EXATO", "CONCILIADO_APROXIMADO"].includes(item.statusConciliacao)).length;
  importacao.totalDivergentes = itensDaImportacao.filter((item) => item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO").length;
  importacao.totalNaoLocalizadas = itensDaImportacao.filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP").length;
  importacao.totalCanceladas = itensDaImportacao.filter((item) => item.statusConciliacao === "CANCELADA").length;
  importacao.totalChargebacks = itensDaImportacao.filter((item) => item.statusConciliacao === "CHARGEBACK").length;
  importacao.statusProcessamento = "CONCLUIDO";
  importacao.processadoEm = nowIso();

  addLog(importacao.id, "CONCILIACAO", "Motor de conciliacao concluido", usuario, {
    totalMatches: novosMatches.length,
    totalDivergencias: divergenciasGranulares.length + divergenciasErpSemOperadora.length,
    totalDivergenciasGranulares: divergenciasGranulares.length,
    totalSemMatchNaRede: divergenciasErpSemOperadora.length,
    totalDivergenciasLegadoDescartadas: novasDivergencias.length,
    conciliadas: importacao.totalConciliadas,
    divergentes: importacao.totalDivergentes,
    naoLocalizadas: importacao.totalNaoLocalizadas,
  });
}
