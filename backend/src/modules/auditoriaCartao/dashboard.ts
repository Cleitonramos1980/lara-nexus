import {
  type AuditoriaCartaoImportacaoItem,
  type LinhaDetalheDia,
  itensStore,
  matchesStore,
  divergenciasStore,
} from "./types.js";
import { round2 } from "./state.js";
import { parseNumber, sumBy } from "./helpers.js";

export function filtroPeriodo(data: string, periodStart?: string, periodEnd?: string): boolean {
  if (!data) return false;
  if (periodStart && data < periodStart) return false;
  if (periodEnd && data > periodEnd) return false;
  return true;
}

export function buildLinhaDetalhe(item: AuditoriaCartaoImportacaoItem): LinhaDetalheDia {
  const match = matchesStore().find((m) => m.itemImportadoId === item.id);
  const valorErp = parseNumber(match?.valorErp);
  const diferencaValor = match ? parseNumber(match.diferencaValor) : item.camposNormalizados.valorBruto;
  return {
    itemId: item.id,
    importacaoId: item.importacaoId,
    numeroPedido: item.camposNormalizados.numeroPedido,
    nsuCv: item.camposNormalizados.nsuCv,
    autorizacao: item.camposNormalizados.autorizacao,
    tid: item.camposNormalizados.tid,
    dataVenda: item.camposNormalizados.dataVenda,
    horaVenda: item.camposNormalizados.horaVenda,
    filial: item.camposNormalizados.codfilialArquivo,
    bandeira: item.camposNormalizados.bandeira,
    modalidade: item.camposNormalizados.modalidade,
    parcelas: item.camposNormalizados.parcelas,
    valorOperadora: item.camposNormalizados.valorBruto,
    valorErp,
    diferencaValor,
    statusConciliacao: item.statusConciliacao,
    scoreMatch: match?.scoreMatch ?? 0,
    regraMatch: match?.regraMatch || "SEM_MATCH",
    motivoDivergencia: item.camposNormalizados.motivoDivergencia,
    cancelada: item.camposNormalizados.canceladaEstabelecimento,
    chargeback: item.camposNormalizados.emChargeback,
  };
}

export function calcularPainelDiario(itensBase: AuditoriaCartaoImportacaoItem[], periodStart?: string, periodEnd?: string) {
  const matchesByItemId = new Map(matchesStore().map((m) => [m.itemImportadoId, m]));
  const itens = itensBase.filter((item) => filtroPeriodo(item.camposNormalizados.dataVenda, periodStart, periodEnd));
  const inversas = divergenciasStore()
    .filter((item) => item.tipoDivergencia === "NAO_ENCONTRADO_NA_OPERADORA")
    .filter((item) => item.importacaoId !== "CONSOLIDADO_DIA")
    .filter((item) => filtroPeriodo(item.dataVenda, periodStart, periodEnd));

  const grouped = new Map<string, AuditoriaCartaoImportacaoItem[]>();
  for (const item of itens) {
    const key = item.camposNormalizados.dataVenda;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const inversoPorData = new Map<string, { quantidade: number; valorErp: number }>();
  for (const divergence of inversas) {
    if (!inversoPorData.has(divergence.dataVenda)) {
      inversoPorData.set(divergence.dataVenda, { quantidade: 0, valorErp: 0 });
    }
    const agg = inversoPorData.get(divergence.dataVenda)!;
    agg.quantidade += 1;
    agg.valorErp = round2(agg.valorErp + parseNumber(divergence.valorErp));
  }

  const datas = Array.from(new Set<string>([
    ...Array.from(grouped.keys()),
    ...Array.from(inversoPorData.keys()),
  ]));

  const result = datas.map((data) => {
    const linhas = grouped.get(data) || [];
    const inverso = inversoPorData.get(data) || { quantidade: 0, valorErp: 0 };
    const conciliadas = linhas.filter((item) => ["CONCILIADO_EXATO", "CONCILIADO_APROXIMADO"].includes(item.statusConciliacao)).length;
    const divergenciasOperadora = linhas.filter((item) => item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO").length;
    const divergencias = divergenciasOperadora + inverso.quantidade;
    const valorBrutoOperadora = round2(sumBy(linhas, (item) => item.camposNormalizados.valorBruto));
    const valorErpConciliadoBase = round2(sumBy(linhas, (item) => parseNumber(matchesByItemId.get(item.id)?.valorErp)));
    const valorErpConciliado = round2(valorErpConciliadoBase + inverso.valorErp);
    const diferencaTotalDia = round2(valorBrutoOperadora - valorErpConciliado);
    const naoLocalizadas = linhas.filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP").length;
    const naoRecebidasNoArquivo = inverso.quantidade;
    const canceladas = linhas.filter((item) => item.statusConciliacao === "CANCELADA").length;
    const chargebacks = linhas.filter((item) => item.statusConciliacao === "CHARGEBACK").length;
    const totalBasePercentual = linhas.length + inverso.quantidade;
    const percentualConciliacao = totalBasePercentual > 0 ? round2((conciliadas / totalBasePercentual) * 100) : 0;

    const statusDia: "OK" | "ATENCAO" | "CRITICO" = percentualConciliacao >= 95
      ? "OK"
      : percentualConciliacao >= 85
        ? "ATENCAO"
        : "CRITICO";

    return {
      data,
      quantidadeVendasOperadora: linhas.length,
      quantidadeVendasConciliadas: conciliadas,
      quantidadeDivergencias: divergencias,
      valorBrutoOperadora,
      valorErpConciliado,
      diferencaTotalDia,
      quantidadeNaoLocalizadas: naoLocalizadas,
      quantidadeNaoRecebidasNoArquivo: naoRecebidasNoArquivo,
      quantidadeCanceladas: canceladas,
      quantidadeChargeback: chargebacks,
      percentualConciliacao,
      statusDia,
    };
  });

  return result.sort((a, b) => b.data.localeCompare(a.data));
}

export function buildDashboard(periodStart?: string, periodEnd?: string) {
  const itens = itensStore().filter((item) => filtroPeriodo(item.camposNormalizados.dataVenda, periodStart, periodEnd));
  const divergencias = divergenciasStore().filter((item) => filtroPeriodo(item.dataVenda, periodStart, periodEnd));
  const painel = calcularPainelDiario(itens, periodStart, periodEnd);

  const totalImportado = itens.length;
  const totalConciliado = itens.filter((item) => ["CONCILIADO_EXATO", "CONCILIADO_APROXIMADO"].includes(item.statusConciliacao)).length;
  const totalDivergente = itens.filter((item) => item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO").length;
  const totalNaoLocalizado = itens.filter((item) => item.statusConciliacao === "NAO_ENCONTRADO_NO_ERP").length;
  const divergenciasNaOperadora = divergencias.filter((item) => item.tipoDivergencia === "NAO_ENCONTRADO_NA_OPERADORA");
  const totalNaoEncontradoNaOperadora = divergenciasNaOperadora.length;
  const valorNaoEncontradoNaOperadora = round2(sumBy(divergenciasNaOperadora, (item) => parseNumber(item.valorErp)));

  const valorBrutoImportado = round2(sumBy(itens, (item) => item.camposNormalizados.valorBruto));
  const valorLiquido = round2(sumBy(itens, (item) => item.camposNormalizados.valorLiquido));

  const matchesByItem = new Map(matchesStore().map((m) => [m.itemImportadoId, m]));
  const valorConciliado = round2(sumBy(itens, (item) => parseNumber(matchesByItem.get(item.id)?.valorErp)));
  const valorDivergente = round2(valorBrutoImportado - valorConciliado);

  const totalCancelamentos = itens.filter((item) => item.statusConciliacao === "CANCELADA").length;
  const totalChargebacks = itens.filter((item) => item.statusConciliacao === "CHARGEBACK").length;

  const topFiliaisMap = new Map<string, { filial: string; total: number; impacto: number }>();
  for (const div of divergencias) {
    const key = div.filial || "SEM_FILIAL";
    const current = topFiliaisMap.get(key) || { filial: key, total: 0, impacto: 0 };
    current.total += 1;
    current.impacto = round2(current.impacto + Math.abs(div.diferenca));
    topFiliaisMap.set(key, current);
  }

  const topBandeirasMap = new Map<string, { bandeira: string; total: number; impacto: number }>();
  for (const div of divergencias) {
    const key = div.bandeira || "SEM_BANDEIRA";
    const current = topBandeirasMap.get(key) || { bandeira: key, total: 0, impacto: 0 };
    current.total += 1;
    current.impacto = round2(current.impacto + Math.abs(div.diferenca));
    topBandeirasMap.set(key, current);
  }

  const topMotivosMap = new Map<string, number>();
  for (const div of divergencias) {
    topMotivosMap.set(div.tipoDivergencia, (topMotivosMap.get(div.tipoDivergencia) || 0) + 1);
  }

  const topFiliais = Array.from(topFiliaisMap.values()).sort((a, b) => b.impacto - a.impacto).slice(0, 10);
  const topBandeiras = Array.from(topBandeirasMap.values()).sort((a, b) => b.impacto - a.impacto).slice(0, 10);
  const topMotivos = Array.from(topMotivosMap.entries())
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const filiais = Array.from(new Set(itens.map((item) => item.camposNormalizados.codfilialArquivo || "SEM_FILIAL"))).slice(0, 20);
  const heatmap = filiais.map((filial) => {
    const porDia = new Map<string, number>();
    for (const item of itens.filter((registro) => (registro.camposNormalizados.codfilialArquivo || "SEM_FILIAL") === filial)) {
      if (item.statusConciliacao.startsWith("DIVERGENCIA") || item.statusConciliacao === "DUPLICIDADE" || item.statusConciliacao === "PENDENTE_REVISAO") {
        const dia = item.camposNormalizados.dataVenda;
        porDia.set(dia, (porDia.get(dia) || 0) + 1);
      }
    }
    return {
      filial,
      dias: Array.from(porDia.entries()).map(([data, quantidade]) => ({ data, quantidade })),
    };
  });

  return {
    totalImportado,
    totalConciliado,
    totalDivergente,
    totalNaoLocalizado,
    totalNaoEncontradoNaOperadora,
    valorNaoEncontradoNaOperadora,
    valorBrutoImportado,
    valorConciliado,
    valorDivergente,
    valorLiquido,
    totalCancelamentos,
    totalChargebacks,
    topFiliais,
    topBandeiras,
    topMotivos,
    graficoDiario: painel,
    heatmap,
  };
}
