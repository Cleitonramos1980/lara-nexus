import { nextId } from "../../repositories/dataStore.js";
import type { AuditoriaCartaoErpVenda } from "../../repositories/auditoriaCartaoOracleRepository.js";
import { absDiff } from "./helpers.js";
import { normalizeComparable, nowIso, round2 } from "./state.js";
import {
  divergenciasStore,
  type AuditoriaCartaoDivergencia,
  type AuditoriaCartaoImportacaoItem,
  type AuditoriaCartaoRegra,
  type DivergenciaTipo,
} from "./types.js";

const DESCRICAO_TIPO: Record<DivergenciaTipo, string> = {
  DIVERGENCIA_VALOR: "Divergencia de valor na chave granular",
  DIVERGENCIA_PARCELAS: "Divergencia de parcelas na chave granular",
  DIVERGENCIA_FILIAL: "Divergencia de filial na chave granular",
  DIVERGENCIA_STATUS: "Divergencia de status/quantidade na chave granular",
  NAO_ENCONTRADO_NO_ERP: "Saldo de movimentos da operadora sem correspondente no ERP para a chave granular",
  NAO_ENCONTRADO_NA_OPERADORA: "Saldo de movimentos do ERP sem correspondente na operadora para a chave granular",
  CANCELADA: "Cancelamento detectado na chave granular",
  CHARGEBACK: "Chargeback detectado na chave granular",
  DUPLICIDADE: "Duplicidade detectada na chave granular",
  PENDENTE_REVISAO: "Pendente de revisao na chave granular",
};

interface ChaveGranular {
  dataReferencia: string;
  filialNormalizada: string;
  valorNormalizado: string;
  key: string;
}

interface OperadoraAgg {
  chave: ChaveGranular;
  valorOperadora: number;
  qtdOperadora: number;
  totalParcelasOperadora: number;
  temCancelada: boolean;
  temChargeback: boolean;
  temDuplicidade: boolean;
  bandeiraNormalizada: string;
  itemImportadoId: string;
}

interface ErpAgg {
  chave: ChaveGranular;
  valorErp: number;
  qtdErp: number;
  totalParcelasErp: number;
  bandeiraNormalizada: string;
  referenciaErpId: string;
}

interface LinhaBaseConciliacao {
  chave: ChaveGranular;
  qtdOperadora: number;
  qtdErp: number;
  valorOperadora: number;
  valorErp: number;
  diferenca: number;
  totalParcelasOperadora: number;
  totalParcelasErp: number;
  temCancelada: boolean;
  temChargeback: boolean;
  temDuplicidade: boolean;
  bandeiraNormalizada: string;
  itemImportadoId?: string;
  referenciaErpId?: string;
}

export interface DivergenciasGranularesDiagnostics {
  totalOperadoraAgg: number;
  totalErpAgg: number;
  totalLinhasBase: number;
  totalLinhasComDivergencia: number;
  totalDivergenciasGeradas: number;
  chavesDuplicadasPosJoin: number;
  chavesOperadoraInvalidas: number;
  chavesErpInvalidas: number;
  contagemPorDataFilial: Array<{ dataReferencia: string; filial: string; quantidade: number }>;
}

interface GerarDivergenciasGranularesParams {
  importacaoId: string;
  itens: AuditoriaCartaoImportacaoItem[];
  vendasErp: AuditoriaCartaoErpVenda[];
  regra: AuditoriaCartaoRegra;
  usuario: string;
  hashConciliacaoCount: Map<string, number>;
  matchesByItemId?: Map<string, { codfilialErp: string; valorErp: number; parcelasErp: number }>;
  usarMatchesComoBaseErp?: boolean;
}

function normalizarDimensao(value: string, fallback: string): string {
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!raw) return fallback;
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function montarChaveGranular(
  dataReferencia: string,
  filial: string,
  valor: number,
): ChaveGranular | null {
  const data = (dataReferencia || "").trim();
  if (!data) return null;

  const filialNormalizada = normalizarDimensao(filial, "SEM_FILIAL");
  const valorNormalizado = round2(valor).toFixed(2);

  return {
    dataReferencia: data,
    filialNormalizada,
    valorNormalizado,
    key: `${data}|${filialNormalizada}|${valorNormalizado}`,
  };
}

function classificarTiposDaLinha(
  linha: LinhaBaseConciliacao,
  toleranciaValor: number,
): DivergenciaTipo[] {
  const tipos: DivergenciaTipo[] = [];

  if (linha.qtdOperadora === 0 && linha.qtdErp > 0) {
    tipos.push("NAO_ENCONTRADO_NA_OPERADORA");
  }
  if (linha.qtdOperadora > 0 && linha.qtdErp === 0) {
    tipos.push("NAO_ENCONTRADO_NO_ERP");
  }

  if (linha.qtdOperadora > 0 && linha.qtdErp > 0) {
    if (absDiff(linha.valorOperadora, linha.valorErp) > toleranciaValor) {
      tipos.push("DIVERGENCIA_VALOR");
    }
    if (linha.totalParcelasOperadora !== linha.totalParcelasErp) {
      tipos.push("DIVERGENCIA_PARCELAS");
    }
    if (linha.qtdOperadora !== linha.qtdErp) {
      tipos.push("DIVERGENCIA_STATUS");
      if (linha.qtdErp > linha.qtdOperadora) {
        tipos.push("NAO_ENCONTRADO_NA_OPERADORA");
      } else if (linha.qtdOperadora > linha.qtdErp) {
        tipos.push("NAO_ENCONTRADO_NO_ERP");
      }
    }
  }

  if (linha.temCancelada) tipos.push("CANCELADA");
  if (linha.temChargeback) tipos.push("CHARGEBACK");
  if (linha.temDuplicidade) tipos.push("DUPLICIDADE");

  return Array.from(new Set(tipos));
}

export function gerarDivergenciasGranulares(params: GerarDivergenciasGranularesParams): {
  linhasBase: LinhaBaseConciliacao[];
  divergencias: AuditoriaCartaoDivergencia[];
  diagnostics: DivergenciasGranularesDiagnostics;
} {
  const operadoraAgg = new Map<string, OperadoraAgg>();
  const erpAgg = new Map<string, ErpAgg>();
  let chavesOperadoraInvalidas = 0;
  let chavesErpInvalidas = 0;

  for (const item of params.itens) {
    const valorOperadora = item.camposNormalizados.valorBrutoAtualizado > 0
      ? item.camposNormalizados.valorBrutoAtualizado
      : item.camposNormalizados.valorBruto;

    const match = params.matchesByItemId?.get(item.id);
    const usarFilialErpNoAgrupamento = !!match
      && absDiff(valorOperadora, match.valorErp) <= params.regra.toleranciaValor
      && Boolean(match.codfilialErp);
    const filialChave = usarFilialErpNoAgrupamento
      ? match!.codfilialErp
      : item.camposNormalizados.codfilialArquivo;

    const chave = montarChaveGranular(
      item.camposNormalizados.dataVenda,
      filialChave,
      valorOperadora,
    );

    if (!chave) {
      chavesOperadoraInvalidas += 1;
      continue;
    }

    if (!operadoraAgg.has(chave.key)) {
      operadoraAgg.set(chave.key, {
        chave,
        valorOperadora: 0,
        qtdOperadora: 0,
        totalParcelasOperadora: 0,
        temCancelada: false,
        temChargeback: false,
        temDuplicidade: false,
        bandeiraNormalizada: normalizarDimensao(item.camposNormalizados.bandeira, "SEM_BANDEIRA"),
        itemImportadoId: item.id,
      });
    }

    const agg = operadoraAgg.get(chave.key)!;
    agg.qtdOperadora += 1;
    agg.valorOperadora = round2(agg.valorOperadora + valorOperadora);
    agg.totalParcelasOperadora += Math.max(0, item.camposNormalizados.parcelas || 0);
    agg.temCancelada = agg.temCancelada || item.camposNormalizados.canceladaEstabelecimento;
    agg.temChargeback = agg.temChargeback || item.camposNormalizados.emChargeback;
    agg.temDuplicidade = agg.temDuplicidade || ((params.hashConciliacaoCount.get(item.hashConciliacao) || 0) > 1);
    const bandeiraAtual = normalizarDimensao(item.camposNormalizados.bandeira, "SEM_BANDEIRA");
    if (agg.bandeiraNormalizada !== bandeiraAtual) agg.bandeiraNormalizada = "MULTIPLAS_BANDEIRAS";

    if (params.usarMatchesComoBaseErp && match && absDiff(valorOperadora, match.valorErp) <= params.regra.toleranciaValor) {
      if (!erpAgg.has(chave.key)) {
        erpAgg.set(chave.key, {
          chave,
          valorErp: 0,
          qtdErp: 0,
          totalParcelasErp: 0,
          bandeiraNormalizada: bandeiraAtual,
          referenciaErpId: `MATCH-${item.id}`,
        });
      }
      const erpRef = erpAgg.get(chave.key)!;
      erpRef.qtdErp += 1;
      erpRef.valorErp = round2(erpRef.valorErp + match.valorErp);
      erpRef.totalParcelasErp += Math.max(0, match.parcelasErp || item.camposNormalizados.parcelas || 0);
      if (erpRef.bandeiraNormalizada !== bandeiraAtual) erpRef.bandeiraNormalizada = "MULTIPLAS_BANDEIRAS";
    }
  }

  if (!params.usarMatchesComoBaseErp) {
    for (const erp of params.vendasErp) {
      const chave = montarChaveGranular(
        erp.dataVenda,
        erp.codfilial,
        erp.valorBruto,
      );

      if (!chave) {
        chavesErpInvalidas += 1;
        continue;
      }

      if (!erpAgg.has(chave.key)) {
        erpAgg.set(chave.key, {
          chave,
          valorErp: 0,
          qtdErp: 0,
          totalParcelasErp: 0,
          bandeiraNormalizada: normalizarDimensao(erp.bandeira, "SEM_BANDEIRA"),
          referenciaErpId: erp.referenciaErpId,
        });
      }

      const agg = erpAgg.get(chave.key)!;
      agg.qtdErp += 1;
      agg.valorErp = round2(agg.valorErp + erp.valorBruto);
      agg.totalParcelasErp += Math.max(0, erp.parcelas || 0);
      const bandeiraAtual = normalizarDimensao(erp.bandeira, "SEM_BANDEIRA");
      if (agg.bandeiraNormalizada !== bandeiraAtual) agg.bandeiraNormalizada = "MULTIPLAS_BANDEIRAS";
    }
  }

  const todasAsChaves = new Set<string>([
    ...operadoraAgg.keys(),
    ...erpAgg.keys(),
  ]);

  const linhasBase: LinhaBaseConciliacao[] = Array.from(todasAsChaves).map((key) => {
    const op = operadoraAgg.get(key);
    const erp = erpAgg.get(key);
    const chave = op?.chave || erp!.chave;
    const valorOperadora = round2(op?.valorOperadora || 0);
    const valorErp = round2(erp?.valorErp || 0);

    return {
      chave,
      qtdOperadora: op?.qtdOperadora || 0,
      qtdErp: erp?.qtdErp || 0,
      valorOperadora,
      valorErp,
      diferenca: round2(valorOperadora - valorErp),
      totalParcelasOperadora: op?.totalParcelasOperadora || 0,
      totalParcelasErp: erp?.totalParcelasErp || 0,
      temCancelada: op?.temCancelada || false,
      temChargeback: op?.temChargeback || false,
      temDuplicidade: op?.temDuplicidade || false,
      bandeiraNormalizada: op?.bandeiraNormalizada || erp?.bandeiraNormalizada || "SEM_BANDEIRA",
      itemImportadoId: op?.itemImportadoId,
      referenciaErpId: erp?.referenciaErpId,
    };
  });

  const contagemChaveFinal = new Map<string, number>();
  for (const linha of linhasBase) {
    contagemChaveFinal.set(linha.chave.key, (contagemChaveFinal.get(linha.chave.key) || 0) + 1);
  }
  const chavesDuplicadasPosJoin = Array.from(contagemChaveFinal.values()).filter((value) => value > 1).length;

  const contagemPorDataFilialMap = new Map<string, number>();
  for (const linha of linhasBase) {
    const chaveDataFilial = `${linha.chave.dataReferencia}|${linha.chave.filialNormalizada}`;
    contagemPorDataFilialMap.set(chaveDataFilial, (contagemPorDataFilialMap.get(chaveDataFilial) || 0) + 1);
  }
  const contagemPorDataFilial = Array.from(contagemPorDataFilialMap.entries())
    .map(([key, quantidade]) => {
      const [dataReferencia, filial] = key.split("|");
      return { dataReferencia, filial, quantidade };
    })
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 200);

  const divergencias: AuditoriaCartaoDivergencia[] = [];
  let totalLinhasComDivergencia = 0;

  for (const linha of linhasBase) {
    const tipos = classificarTiposDaLinha(linha, params.regra.toleranciaValor);
    if (tipos.length === 0) continue;
    totalLinhasComDivergencia += 1;

    for (const tipo of tipos) {
      const now = nowIso();
      divergencias.push({
        id: nextId("ACD", divergenciasStore().length + divergencias.length),
        importacaoId: params.importacaoId,
        itemImportadoId: linha.itemImportadoId,
        referenciaErpId: linha.referenciaErpId,
        tipoDivergencia: tipo,
        descricao: `${DESCRICAO_TIPO[tipo]} [${linha.chave.key}]`,
        valorOperadora: linha.valorOperadora,
        valorErp: linha.valorErp,
        diferenca: linha.diferenca,
        filial: linha.chave.filialNormalizada,
        bandeira: linha.bandeiraNormalizada,
        dataVenda: linha.chave.dataReferencia,
        statusTratativa: "ABERTA",
        revisado: false,
        observacao: "",
        criadoEm: now,
        atualizadoEm: now,
        atualizadoPor: params.usuario,
      });
    }
  }

  const diagnostics: DivergenciasGranularesDiagnostics = {
    totalOperadoraAgg: operadoraAgg.size,
    totalErpAgg: erpAgg.size,
    totalLinhasBase: linhasBase.length,
    totalLinhasComDivergencia,
    totalDivergenciasGeradas: divergencias.length,
    chavesDuplicadasPosJoin,
    chavesOperadoraInvalidas,
    chavesErpInvalidas,
    contagemPorDataFilial,
  };

  return { linhasBase, divergencias, diagnostics };
}

export function detectarVazamentoDeGranularidade(
  divergencias: AuditoriaCartaoDivergencia[],
): Array<{
  dataVenda: string;
  filial: string;
  valorChave: string;
  valoresOperadoraDistintos: number;
  valoresErpDistintos: number;
}> {
  const porDataFilial = new Map<string, { valoresOperadora: Set<string>; valoresErp: Set<string> }>();

  for (const linha of divergencias) {
    const valorChave = round2(linha.valorOperadora).toFixed(2);
    const key = `${linha.dataVenda}|${normalizeComparable(linha.filial || "SEM_FILIAL")}|${valorChave}`;
    if (!porDataFilial.has(key)) {
      porDataFilial.set(key, { valoresOperadora: new Set<string>(), valoresErp: new Set<string>() });
    }
    const registro = porDataFilial.get(key)!;
    registro.valoresOperadora.add(round2(linha.valorOperadora).toFixed(2));
    registro.valoresErp.add(round2(linha.valorErp).toFixed(2));
  }

  return Array.from(porDataFilial.entries())
    .filter(([, valores]) => valores.valoresOperadora.size > 1 || valores.valoresErp.size > 1)
    .map(([key, valores]) => {
      const [dataVenda, filial, valorChave] = key.split("|");
      return {
        dataVenda,
        filial,
        valorChave,
        valoresOperadoraDistintos: valores.valoresOperadora.size,
        valoresErpDistintos: valores.valoresErp.size,
      };
    });
}
