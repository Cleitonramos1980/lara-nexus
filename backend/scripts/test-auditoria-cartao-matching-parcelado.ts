import { buscarMatchErpAgrupadoPorParcelas } from "../src/modules/auditoriaCartao/matching.js";
import type { AuditoriaCartaoCamposNormalizados, AuditoriaCartaoRegra } from "../src/modules/auditoriaCartao/types.js";
import type { AuditoriaCartaoErpVenda } from "../src/repositories/auditoriaCartaoOracleRepository.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function regraBase(): AuditoriaCartaoRegra {
  return {
    id: "ACR-TESTE-PARCELADO",
    toleranciaValor: 0.5,
    janelaHorarioMinutos: 30,
    prioridadeChaves: [],
    pesosChaves: {},
    regrasPorOperadora: {},
    mapeamentoEstabelecimentoFilial: [],
    regraParceladoVista: "PADRAO",
    tratamentoCancelamento: "SEPARAR",
    tratamentoChargeback: "SEPARAR",
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: "teste",
  };
}

function criarCamposItem(valor: number): AuditoriaCartaoCamposNormalizados {
  return {
    idImportacao: "IMP-TESTE",
    linhaOrigem: 1,
    dataVenda: "2026-02-28",
    horaVenda: "17:14",
    dataHoraVenda: "2026-02-28T17:14:00",
    statusVenda: "APROVADA",
    valorBruto: valor,
    valorBrutoAtualizado: valor,
    valorLiquido: valor,
    modalidade: "CREDITO",
    tipoTransacao: "parcelado sem juros",
    preAutorizado: false,
    parcelas: 12,
    bandeira: "Mastercard",
    taxaMdr: 0,
    valorMdr: 0,
    taxaRecebimentoAuto: 0,
    valorRecebimentoAuto: 0,
    taxasDescontadasDescricao: "",
    valorTotalTaxas: 0,
    nsuCv: "173401638",
    prazoRecebimento: "",
    lote: "",
    autorizacao: "AUT-173401638",
    numeroEstabelecimento: "EST-3D",
    nomeEstabelecimento: "LOJA 3D",
    cnpjEstabelecimento: "00.000.000/0001-00",
    codfilialArquivo: "3D",
    numeroCartaoMascarado: "1234****5678",
    carteiraDigitalId: "",
    meioPagamento: "maquininha",
    tipoMaquininha: "",
    codigoMaquininha: "",
    tid: "TID-173401638",
    numeroPedido: "PED-318070",
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
    idTransacao: "TX-173401638",
    hashConciliacao: "HASH-173401638",
    statusConciliacao: "PENDENTE_REVISAO",
    motivoDivergencia: "",
  };
}

function criarErpParcelado(indice: number, valor: number): AuditoriaCartaoErpVenda {
  const parcelaNumero = 13 + indice;
  return {
    referenciaErpId: `ERP-PP-${parcelaNumero}`,
    dataVenda: "2026-02-28",
    horaVenda: "10:00",
    dataHoraVenda: "2026-02-28T10:00:00",
    valorBruto: valor,
    valorLiquido: valor,
    parcelas: parcelaNumero,
    codfilial: "3D",
    nsuCv: "",
    autorizacao: "",
    tid: "",
    numeroPedido: "318070",
    bandeira: "Mastercard",
    modalidade: "CREDITO",
    statusVenda: "APROVADA",
    origemConsulta: "PCPREST",
  };
}

function run(): void {
  const regra = regraBase();
  const item = criarCamposItem(12500);

  const erpParcelas: AuditoriaCartaoErpVenda[] = [];
  for (let i = 0; i < 11; i += 1) erpParcelas.push(criarErpParcelado(i, 1041.66));
  erpParcelas.push(criarErpParcelado(11, 1041.74));

  const candidate = buscarMatchErpAgrupadoPorParcelas(
    item,
    12500,
    erpParcelas,
    new Set<string>(),
    regra,
  );

  assert(!!candidate, "Nao encontrou candidato de match agrupado por parcelas.");
  assert(candidate?.forcarConciliadoExatoPorValor === true, "Match agrupado deveria ser forçado como exato.");
  assert(
    candidate?.regraMatch === "REGRA_1_SOMA_PARCELAS_ERP_DTEMISSAO",
    "Regra aplicada incorreta para agrupamento de parcelas na mesma data.",
  );
  assert(candidate?.erp.valorBruto === 12500, "Soma ERP agrupada nao bate com valor da operadora.");
  assert((candidate?.erpIdsReservados.length || 0) === 12, "Deveria reservar os 12 lancamentos ERP da venda parcelada.");

  const erpComExtras: AuditoriaCartaoErpVenda[] = [
    ...erpParcelas,
    criarErpParcelado(12, 999.99),
    criarErpParcelado(13, 999.99),
  ];
  const candidateComExtras = buscarMatchErpAgrupadoPorParcelas(
    item,
    12500,
    erpComExtras,
    new Set<string>(),
    regra,
  );
  assert(!!candidateComExtras, "Nao encontrou candidato quando existem parcelas extras no mesmo identificador.");
  assert(
    candidateComExtras?.erp.valorBruto === 12500,
    "Deveria selecionar a janela crescente de 12 parcelas na mesma data com soma exata.",
  );
  assert(
    (candidateComExtras?.erpIdsReservados.length || 0) === 12,
    "Com parcelas extras, deveria reservar somente as 12 parcelas da venda correspondente.",
  );

  const used = new Set(candidate?.erpIdsReservados || []);
  const afterUsed = buscarMatchErpAgrupadoPorParcelas(
    item,
    12500,
    erpParcelas,
    used,
    regra,
  );
  assert(afterUsed === null, "Nao deveria encontrar novo match com os mesmos ERP IDs ja reservados.");

  console.log("- Cenario parcelado 12x (soma ERP) => CONCILIADO_EXATO: OK");
  console.log("Teste de match agrupado por parcelas finalizado com sucesso.");
}

run();
