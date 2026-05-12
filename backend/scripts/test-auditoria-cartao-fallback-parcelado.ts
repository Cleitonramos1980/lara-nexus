import { executarConciliacaoImportacao } from "../src/modules/auditoriaCartao/matching.js";
import {
  ajustesStore,
  divergenciasStore,
  importacoesStore,
  itensStore,
  logsStore,
  matchesStore,
  regrasStore,
  type AuditoriaCartaoImportacao,
  type AuditoriaCartaoImportacaoItem,
} from "../src/modules/auditoriaCartao/types.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function resetStores(): void {
  importacoesStore().length = 0;
  itensStore().length = 0;
  matchesStore().length = 0;
  divergenciasStore().length = 0;
  logsStore().length = 0;
  regrasStore().length = 0;
  ajustesStore().length = 0;
}

function criarImportacaoTeste(): AuditoriaCartaoImportacao {
  return {
    id: "ACI-FBK-001",
    operadora: "REDE",
    nomeArquivo: "rede-fevereiro.xlsx",
    hashArquivo: "hash-fbk-001",
    periodoInicial: "2026-02-28",
    periodoFinal: "2026-02-28",
    dataUpload: new Date().toISOString(),
    usuarioUpload: "teste",
    statusProcessamento: "PROCESSANDO",
    layoutOrigem: "REDE_XLSX",
    totalLinhas: 1,
    totalValidas: 1,
    totalInvalidas: 0,
    totalConciliadas: 0,
    totalDivergentes: 0,
    totalNaoLocalizadas: 0,
    totalCanceladas: 0,
    totalChargebacks: 0,
  };
}

function criarItemTeste(): AuditoriaCartaoImportacaoItem {
  return {
    id: "ACIIT-FBK-12500",
    importacaoId: "ACI-FBK-001",
    linhaOrigem: 1,
    jsonOrigem: {},
    hashConciliacao: "hash-fbk-item-12500",
    statusConciliacao: "PENDENTE_REVISAO",
    camposNormalizados: {
      idImportacao: "ACI-FBK-001",
      linhaOrigem: 1,
      dataVenda: "2026-02-28",
      horaVenda: "17:14",
      dataHoraVenda: "2026-02-28T17:14:00",
      statusVenda: "aprovada",
      valorBruto: 12500,
      valorBrutoAtualizado: 12500,
      valorLiquido: 12225,
      modalidade: "credito",
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
      nsuCv: "36947756",
      prazoRecebimento: "",
      lote: "",
      autorizacao: "0030228",
      numeroEstabelecimento: "",
      nomeEstabelecimento: "",
      cnpjEstabelecimento: "",
      codfilialArquivo: "3D",
      numeroCartaoMascarado: "",
      carteiraDigitalId: "",
      meioPagamento: "maquininha",
      tipoMaquininha: "",
      codigoMaquininha: "",
      tid: "-",
      numeroPedido: "-",
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
      idTransacao: "TX-12500",
      hashConciliacao: "hash-fbk-item-12500",
      statusConciliacao: "PENDENTE_REVISAO",
      motivoDivergencia: "",
    },
  };
}

async function run(): Promise<void> {
  process.env.AUDITORIA_CARTAO_ENABLE_ERP_MIRROR_FALLBACK = "true";
  resetStores();

  const importacao = criarImportacaoTeste();
  const item = criarItemTeste();
  importacoesStore().push(importacao);
  itensStore().push(item);

  await executarConciliacaoImportacao(importacao, [item], "teste");

  const match = matchesStore().find((m) => m.itemImportadoId === item.id);
  assert(!!match, "Deveria gerar match para item parcelado em fallback.");
  assert(item.statusConciliacao === "CONCILIADO_EXATO", "Item deveria ficar CONCILIADO_EXATO.");
  assert((match?.valorErp || 0) === 12500, "Valor ERP do match deveria ser 12500.");
  assert((match?.parcelasErp || 0) === 12, "Parcelas ERP do match deveria ser 12.");

  const divergenciaNoErp = divergenciasStore().find((d) => d.itemImportadoId === item.id && d.tipoDivergencia === "NAO_ENCONTRADO_NO_ERP");
  assert(!divergenciaNoErp, "Nao deveria gerar NAO_ENCONTRADO_NO_ERP para item 12x em fallback parcelado.");

  console.log("- Fallback parcelado 12x por DTEMISSAO (sem Oracle) => CONCILIADO_EXATO: OK");
}

run().catch((error) => {
  console.error("Falha no teste de fallback parcelado:", error);
  process.exit(1);
});
