import { processarPainelConsolidadoDia } from "../src/modules/auditoriaCartao/consolidadoDia.js";
import {
  consolidadoDiaStore,
  divergenciasStore,
  importacoesStore,
  itensStore,
  matchesStore,
  regrasStore,
} from "../src/modules/auditoriaCartao/types.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

type ScenarioResult = {
  nome: string;
  ok: boolean;
};

function resetStores(): void {
  itensStore().length = 0;
  matchesStore().length = 0;
  divergenciasStore().length = 0;
  consolidadoDiaStore().length = 0;
  importacoesStore().length = 0;
  regrasStore().length = 0;
}

function addItem({
  id,
  data,
  filial,
  valorOperadora,
  bandeira = "VISA",
  tipo = "CREDITO",
}: {
  id: string;
  data: string;
  filial: string;
  valorOperadora: number;
  bandeira?: string;
  tipo?: string;
}) {
  itensStore().push({
    id,
    importacaoId: "IMP-TESTE",
    linhaOrigem: Number(id.replace(/\D+/g, "")) || 1,
    jsonOrigem: {},
    hashConciliacao: `${id}-hash`,
    statusConciliacao: "CONCILIADO_EXATO",
    camposNormalizados: {
      idImportacao: "IMP-TESTE",
      linhaOrigem: 1,
      dataVenda: data,
      horaVenda: "10:00",
      dataHoraVenda: `${data}T10:00:00`,
      statusVenda: "APROVADA",
      valorBruto: valorOperadora,
      valorBrutoAtualizado: valorOperadora,
      valorLiquido: valorOperadora,
      modalidade: "CARTAO",
      tipoTransacao: tipo,
      preAutorizado: false,
      parcelas: 1,
      bandeira,
      taxaMdr: 0,
      valorMdr: 0,
      taxaRecebimentoAuto: 0,
      valorRecebimentoAuto: 0,
      taxasDescontadasDescricao: "",
      valorTotalTaxas: 0,
      nsuCv: `${id}-NSU`,
      prazoRecebimento: "",
      lote: "",
      autorizacao: `${id}-AUT`,
      numeroEstabelecimento: "",
      nomeEstabelecimento: "",
      cnpjEstabelecimento: "",
      codfilialArquivo: filial,
      numeroCartaoMascarado: "",
      carteiraDigitalId: "",
      meioPagamento: "Cartao",
      tipoMaquininha: "",
      codigoMaquininha: "",
      tid: `${id}-TID`,
      numeroPedido: `${id}-PED`,
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
      idTransacao: `${id}-TX`,
      hashConciliacao: `${id}-hash`,
      statusConciliacao: "CONCILIADO_EXATO",
      motivoDivergencia: "",
    },
  } as any);
}

function addMatch(itemId: string, valorErp: number, filial = "1"): void {
  matchesStore().push({
    id: `MAT-${itemId}`,
    importacaoId: "IMP-TESTE",
    itemImportadoId: itemId,
    referenciaErpId: `ERP-${itemId}`,
    tipoMatch: "EXATO",
    scoreMatch: 100,
    regraMatch: "TESTE",
    conciliado: true,
    valorOperadora: valorErp,
    valorErp,
    diferencaValor: 0,
    parcelasOperadora: 1,
    parcelasErp: 1,
    codfilialOperadora: filial,
    codfilialErp: filial,
    criadoEm: new Date().toISOString(),
  });
}

function addErpSomente(data: string, valorErp: number, filial = "1", bandeira = "VISA"): void {
  divergenciasStore().push({
    id: `DIV-ERP-${data}-${valorErp}-${filial}`,
    importacaoId: "IMP-TESTE",
    tipoDivergencia: "NAO_ENCONTRADO_NA_OPERADORA",
    descricao: "Venda encontrada no ERP sem correspondente na operadora",
    valorOperadora: 0,
    valorErp,
    diferenca: -valorErp,
    filial,
    bandeira,
    dataVenda: data,
    statusTratativa: "ABERTA",
    revisado: false,
    observacao: "",
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: "teste",
  });
}

function getDia(data: string) {
  const result = processarPainelConsolidadoDia({ periodStart: data, periodEnd: data }, "teste");
  return result.linhas.find((item) => item.data === data);
}

async function run(): Promise<void> {
  const results: ScenarioResult[] = [];

  // Cenario 1: Operadora total dia = ERP total dia -> CONCILIADO
  resetStores();
  addItem({ id: "IT1", data: "2026-01-05", filial: "1", valorOperadora: 100 });
  addMatch("IT1", 100, "1");
  const c1 = getDia("2026-01-05");
  assert(c1?.statusConsolidado === "CONCILIADO", "Cenario 1 falhou: status deveria ser CONCILIADO.");
  results.push({ nome: "Cenario 1", ok: true });

  // Cenario 2: Operadora total dia != ERP total dia -> DIVERGENCIA_TOTAL_DIA
  resetStores();
  addItem({ id: "IT2", data: "2026-01-06", filial: "1", valorOperadora: 100 });
  addMatch("IT2", 80, "1");
  const c2 = getDia("2026-01-06");
  assert(c2?.statusConsolidado === "DIVERGENCIA_TOTAL_DIA", "Cenario 2 falhou: status deveria ser DIVERGENCIA_TOTAL_DIA.");
  results.push({ nome: "Cenario 2", ok: true });

  // Cenario 3: Operadora com movimento e ERP sem movimento -> MOVIMENTO_SO_OPERADORA
  resetStores();
  addItem({ id: "IT3", data: "2026-01-07", filial: "1", valorOperadora: 120 });
  const c3 = getDia("2026-01-07");
  assert(c3?.statusConsolidado === "MOVIMENTO_SO_OPERADORA", "Cenario 3 falhou: status deveria ser MOVIMENTO_SO_OPERADORA.");
  results.push({ nome: "Cenario 3", ok: true });

  // Cenario 4: ERP com movimento e Operadora sem movimento -> MOVIMENTO_SO_ERP
  resetStores();
  addErpSomente("2026-01-08", 200, "1");
  const c4 = getDia("2026-01-08");
  assert(c4?.statusConsolidado === "MOVIMENTO_SO_ERP", "Cenario 4 falhou: status deveria ser MOVIMENTO_SO_ERP.");
  results.push({ nome: "Cenario 4", ok: true });

  // Cenario 5: Total bate, mas filiais nao batem -> CONCILIADO + divergencia interna
  resetStores();
  addItem({ id: "IT5A", data: "2026-01-09", filial: "1", valorOperadora: 100 });
  addItem({ id: "IT5B", data: "2026-01-09", filial: "2", valorOperadora: 200 });
  addMatch("IT5A", 120, "1");
  addMatch("IT5B", 180, "2");
  const c5 = getDia("2026-01-09");
  assert(c5?.statusConsolidado === "CONCILIADO", "Cenario 5 falhou: status consolidado deveria ser CONCILIADO.");
  assert(c5?.possuiDivergenciaInternaFilial === true, "Cenario 5 falhou: deveria indicar divergencia interna por filial.");
  results.push({ nome: "Cenario 5", ok: true });

  // Cenario 6: Sem movimento nos dois lados -> SEM_MOVIMENTO
  resetStores();
  const c6 = getDia("2026-01-10");
  assert(c6?.statusConsolidado === "SEM_MOVIMENTO", "Cenario 6 falhou: status deveria ser SEM_MOVIMENTO.");
  results.push({ nome: "Cenario 6", ok: true });

  // Cenario 7: Reprocessamento idempotente -> sem duplicidade
  resetStores();
  addItem({ id: "IT7", data: "2026-01-11", filial: "1", valorOperadora: 70 });
  addMatch("IT7", 70, "1");
  const before = processarPainelConsolidadoDia({ periodStart: "2026-01-11", periodEnd: "2026-01-11" }, "teste");
  const countBefore = consolidadoDiaStore().length;
  const after = processarPainelConsolidadoDia({ periodStart: "2026-01-11", periodEnd: "2026-01-11" }, "teste");
  const countAfter = consolidadoDiaStore().length;
  assert(before.linhas[0].diferenca === after.linhas[0].diferenca, "Cenario 7 falhou: resultado nao idempotente.");
  assert(countBefore === countAfter, "Cenario 7 falhou: gerou duplicidade de snapshot.");
  results.push({ nome: "Cenario 7", ok: true });

  // Cenario 8: Filtros por periodo e bandeira -> totais recalculados corretamente
  resetStores();
  addItem({ id: "IT8A", data: "2026-01-12", filial: "1", valorOperadora: 90, bandeira: "VISA" });
  addMatch("IT8A", 90, "1");
  addItem({ id: "IT8B", data: "2026-01-12", filial: "1", valorOperadora: 150, bandeira: "MASTERCARD" });
  addMatch("IT8B", 140, "1");
  const filtrado = processarPainelConsolidadoDia({
    periodStart: "2026-01-12",
    periodEnd: "2026-01-12",
    bandeira: "VISA",
  }, "teste");
  assert(filtrado.linhas.length === 1, "Cenario 8 falhou: deveria retornar 1 dia.");
  assert(filtrado.linhas[0].valorOperadoraTotalDia === 90, "Cenario 8 falhou: valor operadora filtrado incorreto.");
  assert(filtrado.linhas[0].valorErpTotalDia === 90, "Cenario 8 falhou: valor ERP filtrado incorreto.");
  results.push({ nome: "Cenario 8", ok: true });

  console.log("Teste consolidado dia finalizado com sucesso.");
  for (const result of results) {
    console.log(`- ${result.nome}: ${result.ok ? "OK" : "FALHA"}`);
  }
}

run().catch((error) => {
  console.error("Falha nos testes do consolidado por dia:", error);
  process.exit(1);
});
