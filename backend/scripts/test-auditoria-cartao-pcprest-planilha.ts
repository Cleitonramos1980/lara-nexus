import { processarPcprestPlanilha } from "../src/modules/auditoriaCartao/pcprestPlanilha.js";
import { divergenciasStore, itensStore, matchesStore, regrasStore } from "../src/modules/auditoriaCartao/types.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function reset(): void {
  itensStore().length = 0;
  matchesStore().length = 0;
  divergenciasStore().length = 0;
  regrasStore().length = 0;
}

function makeItem(params: {
  id: string;
  data: string;
  hora?: string;
  filial: string;
  valor: number;
  bandeira?: string;
  tipo?: string;
  nsu?: string;
  autorizacao?: string;
  numeroPedido?: string;
}) {
  itensStore().push({
    id: params.id,
    importacaoId: "IMP-TESTE",
    linhaOrigem: 1,
    jsonOrigem: {},
    hashConciliacao: `${params.id}-hash`,
    statusConciliacao: "CONCILIADO_EXATO",
    camposNormalizados: {
      idImportacao: "IMP-TESTE",
      linhaOrigem: 1,
      dataVenda: params.data,
      horaVenda: params.hora || "10:00",
      dataHoraVenda: `${params.data}T${params.hora || "10:00"}:00`,
      statusVenda: "APROVADA",
      valorBruto: params.valor,
      valorBrutoAtualizado: params.valor,
      valorLiquido: params.valor,
      modalidade: "CARTAO",
      tipoTransacao: params.tipo || "CREDITO",
      preAutorizado: false,
      parcelas: 1,
      bandeira: params.bandeira || "VISA",
      taxaMdr: 0,
      valorMdr: 0,
      taxaRecebimentoAuto: 0,
      valorRecebimentoAuto: 0,
      taxasDescontadasDescricao: "",
      valorTotalTaxas: 0,
      nsuCv: params.nsu || `${params.id}-NSU`,
      prazoRecebimento: "",
      lote: "",
      autorizacao: params.autorizacao || `${params.id}-AUT`,
      numeroEstabelecimento: "",
      nomeEstabelecimento: "",
      cnpjEstabelecimento: "",
      codfilialArquivo: params.filial,
      numeroCartaoMascarado: "",
      carteiraDigitalId: "",
      meioPagamento: "Cartao",
      tipoMaquininha: "",
      codigoMaquininha: "",
      tid: `${params.id}-TID`,
      numeroPedido: params.numeroPedido || `${params.id}-PED`,
      taxaEmbarque: 0,
      canceladaEstabelecimento: false,
      dataCancelamento: "",
      valorCancelado: 0,
      emChargeback: false,
      dataChargeback: "",
      resolucaoChargeback: "",
      dataResolucaoChargeback: "",
      nacionalidadeCartao: "",
      moedaEstrangeiraDcc: "",
      cartaoPrePago: false,
      idTransacao: `${params.id}-TX`,
      hashConciliacao: `${params.id}-hash`,
      statusConciliacao: "CONCILIADO_EXATO",
      motivoDivergencia: "",
    },
  } as any);
}

function makeMatch(params: {
  id: string;
  itemId: string;
  valorErp: number;
  filialErp: string;
  referencia?: string;
}) {
  matchesStore().push({
    id: params.id,
    importacaoId: "IMP-TESTE",
    itemImportadoId: params.itemId,
    referenciaErpId: params.referencia || `ERP-${params.id}`,
    tipoMatch: "EXATO",
    scoreMatch: 100,
    regraMatch: "TESTE",
    conciliado: true,
    valorOperadora: params.valorErp,
    valorErp: params.valorErp,
    diferencaValor: 0,
    parcelasOperadora: 1,
    parcelasErp: 1,
    codfilialOperadora: params.filialErp,
    codfilialErp: params.filialErp,
    criadoEm: new Date().toISOString(),
  });
}

function makeErpSemPlanilha(params: {
  id: string;
  data: string;
  filial: string;
  valorErp: number;
}) {
  divergenciasStore().push({
    id: params.id,
    importacaoId: "IMP-TESTE",
    tipoDivergencia: "NAO_ENCONTRADO_NA_OPERADORA",
    descricao: "ERP sem planilha",
    valorOperadora: 0,
    valorErp: params.valorErp,
    diferenca: -params.valorErp,
    filial: params.filial,
    bandeira: "VISA",
    dataVenda: params.data,
    statusTratativa: "ABERTA",
    revisado: false,
    observacao: "",
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: "teste",
  });
}

async function run(): Promise<void> {
  // Cenario 1: 10 ERP e 10 na planilha -> totalmente conferido
  reset();
  for (let i = 1; i <= 10; i += 1) {
    const id = `C1-${i}`;
    makeItem({ id, data: "2026-01-05", filial: "10", valor: 100 + i });
    makeMatch({ id: `M-${id}`, itemId: id, valorErp: 100 + i, filialErp: "10" });
  }
  let result = await processarPcprestPlanilha({ periodStart: "2026-01-05", periodEnd: "2026-01-05" });
  assert(result.cards.quantidadeNaoEncontrada === 0, "Cenario 1: nao deveria haver faltantes.");
  assert(result.linhasResumo[0]?.statusResumo === "TOTALMENTE_CONFERIDO", "Cenario 1: status resumo invalido.");

  // Cenario 2: ERP 10, planilha 8 -> 2 faltantes
  reset();
  for (let i = 1; i <= 8; i += 1) {
    const id = `C2-${i}`;
    makeItem({ id, data: "2026-01-06", filial: "11", valor: 200 + i });
    makeMatch({ id: `M-${id}`, itemId: id, valorErp: 200 + i, filialErp: "11" });
  }
  makeErpSemPlanilha({ id: "C2-F1", data: "2026-01-06", filial: "11", valorErp: 999 });
  makeErpSemPlanilha({ id: "C2-F2", data: "2026-01-06", filial: "11", valorErp: 888 });
  result = await processarPcprestPlanilha({ periodStart: "2026-01-06", periodEnd: "2026-01-06" });
  assert(result.cards.quantidadeNaoEncontrada === 2, "Cenario 2: deveriam existir 2 faltantes.");

  // Cenario 3: valores repetidos no mesmo dia/filial -> match por ocorrencia sem consumo duplicado
  reset();
  for (let i = 1; i <= 3; i += 1) {
    const id = `C3-${i}`;
    makeItem({ id, data: "2026-01-07", filial: "12", valor: 100, nsu: `NSU-C3-${i}` });
    makeMatch({ id: `M-${id}`, itemId: id, valorErp: 100, filialErp: "12", referencia: `ERP-C3-${i}` });
  }
  result = await processarPcprestPlanilha({ periodStart: "2026-01-07", periodEnd: "2026-01-07" });
  assert(result.cards.quantidadeConciliada === 3, "Cenario 3: todas as 3 ocorrencias deveriam conciliar.");

  // Cenario 4: mesma data/valor, filial divergente
  reset();
  makeItem({ id: "C4-1", data: "2026-01-08", filial: "20", valor: 300, nsu: "NSU-C4" });
  makeMatch({ id: "M-C4", itemId: "C4-1", valorErp: 300, filialErp: "21", referencia: "ERP-C4" });
  result = await processarPcprestPlanilha({ periodStart: "2026-01-08", periodEnd: "2026-01-08" });
  assert(result.linhasDetalhe[0]?.statusMatch === "ENCONTRADO_COM_DIFERENCA_DE_FILIAL", "Cenario 4: esperado divergencia de filial.");

  // Cenario 5: mesma filial/data com valor diferente
  reset();
  makeItem({ id: "C5-1", data: "2026-01-09", filial: "30", valor: 500, nsu: "NSU-C5" });
  makeMatch({ id: "M-C5", itemId: "C5-1", valorErp: 450, filialErp: "30", referencia: "ERP-C5" });
  result = await processarPcprestPlanilha({ periodStart: "2026-01-09", periodEnd: "2026-01-09" });
  assert(result.linhasDetalhe[0]?.statusMatch === "ENCONTRADO_COM_DIFERENCA_DE_VALOR", "Cenario 5: esperado divergencia de valor.");

  // Cenario 6: duas linhas candidatas equivalentes na planilha para um ERP -> ambiguo
  reset();
  makeItem({ id: "C6-1", data: "2026-01-10", filial: "40", valor: 700, nsu: "NSU-AMB" });
  makeItem({ id: "C6-2", data: "2026-01-10", filial: "40", valor: 700, nsu: "NSU-AMB" });
  makeMatch({ id: "M-C6", itemId: "C6-1", valorErp: 700, filialErp: "40", referencia: "ERP-C6" });
  result = await processarPcprestPlanilha({ periodStart: "2026-01-10", periodEnd: "2026-01-10" });
  assert(result.linhasDetalhe[0]?.statusMatch === "MATCH_AMBIGUO", "Cenario 6: esperado MATCH_AMBIGUO.");

  // Cenario 7: duplicidade na planilha, mas com melhor candidato unico
  reset();
  makeItem({ id: "C7-1", data: "2026-01-11", filial: "50", valor: 900, nsu: "NSU-DUP" });
  makeItem({ id: "C7-2", data: "2026-01-11", filial: "99", valor: 900, nsu: "NSU-DUP" });
  makeMatch({ id: "M-C7", itemId: "C7-1", valorErp: 900, filialErp: "50", referencia: "ERP-C7" });
  result = await processarPcprestPlanilha({ periodStart: "2026-01-11", periodEnd: "2026-01-11" });
  assert(result.linhasDetalhe[0]?.statusMatch === "DUPLICIDADE_NA_PLANILHA", "Cenario 7: esperado DUPLICIDADE_NA_PLANILHA.");

  // Cenario 8: reprocessamento idempotente
  reset();
  makeItem({ id: "C8-1", data: "2026-01-12", filial: "60", valor: 1200 });
  makeMatch({ id: "M-C8", itemId: "C8-1", valorErp: 1200, filialErp: "60", referencia: "ERP-C8" });
  const a = await processarPcprestPlanilha({ periodStart: "2026-01-12", periodEnd: "2026-01-12" });
  const b = await processarPcprestPlanilha({ periodStart: "2026-01-12", periodEnd: "2026-01-12" });
  assert(a.cards.totalErpPeriodo === b.cards.totalErpPeriodo, "Cenario 8: total ERP deveria ser idempotente.");
  assert(a.linhasDetalhe.length === b.linhasDetalhe.length, "Cenario 8: quantidade de linhas deveria ser idempotente.");

  console.log("Teste PCPREST x Planilha finalizado com sucesso.");
}

run().catch((error) => {
  console.error("Falha no teste PCPREST x Planilha:", error);
  process.exit(1);
});

