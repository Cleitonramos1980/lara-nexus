import { gerarDivergenciasGranulares } from "../src/modules/auditoriaCartao/divergencias.js";
import {
  divergenciasStore,
  type AuditoriaCartaoImportacaoItem,
  type AuditoriaCartaoRegra,
} from "../src/modules/auditoriaCartao/types.js";
import type { AuditoriaCartaoErpVenda } from "../src/repositories/auditoriaCartaoOracleRepository.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function resetStores(): void {
  divergenciasStore().length = 0;
}

function regraBase(): AuditoriaCartaoRegra {
  return {
    id: "ACR-TESTE",
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

function criarItem(params: {
  id: string;
  data: string;
  filial: string;
  bandeira?: string;
  tipo?: string;
  valorOperadora: number;
  parcelas?: number;
  cancelada?: boolean;
  chargeback?: boolean;
  hash?: string;
}): AuditoriaCartaoImportacaoItem {
  const bandeira = params.bandeira || "VISA";
  const tipo = params.tipo || "CREDITO";
  const parcelas = params.parcelas ?? 1;
  const hash = params.hash || `${params.id}-hash`;
  return {
    id: params.id,
    importacaoId: "IMP-TESTE",
    linhaOrigem: Number(params.id.replace(/\D+/g, "")) || 1,
    jsonOrigem: {},
    hashConciliacao: hash,
    statusConciliacao: "PENDENTE_REVISAO",
    camposNormalizados: {
      idImportacao: "IMP-TESTE",
      linhaOrigem: 1,
      dataVenda: params.data,
      horaVenda: "10:00",
      dataHoraVenda: `${params.data}T10:00:00`,
      statusVenda: "APROVADA",
      valorBruto: params.valorOperadora,
      valorBrutoAtualizado: params.valorOperadora,
      valorLiquido: params.valorOperadora,
      modalidade: "CARTAO",
      tipoTransacao: tipo,
      preAutorizado: false,
      parcelas,
      bandeira,
      taxaMdr: 0,
      valorMdr: 0,
      taxaRecebimentoAuto: 0,
      valorRecebimentoAuto: 0,
      taxasDescontadasDescricao: "",
      valorTotalTaxas: 0,
      nsuCv: `${params.id}-NSU`,
      prazoRecebimento: "",
      lote: "",
      autorizacao: `${params.id}-AUT`,
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
      numeroPedido: `${params.id}-PED`,
      taxaEmbarque: 0,
      canceladaEstabelecimento: params.cancelada || false,
      dataCancelamento: "",
      valorCancelado: 0,
      emChargeback: params.chargeback || false,
      dataChargeback: "",
      resolucaoChargeback: "",
      dataResolucaoChargeback: "",
      nacionalidadeCartao: "",
      moedaEstrangeiraDcc: "",
      cartaoPrePago: false,
      idTransacao: `${params.id}-TX`,
      hashConciliacao: hash,
      statusConciliacao: "PENDENTE_REVISAO",
      motivoDivergencia: "",
    },
  };
}

function criarErp(params: {
  id: string;
  data: string;
  filial: string;
  bandeira?: string;
  tipo?: string;
  valorErp: number;
  parcelas?: number;
}): AuditoriaCartaoErpVenda {
  const bandeira = params.bandeira || "VISA";
  const tipo = params.tipo || "CREDITO";
  const parcelas = params.parcelas ?? 1;
  return {
    referenciaErpId: params.id,
    dataVenda: params.data,
    horaVenda: "10:00",
    dataHoraVenda: `${params.data}T10:00:00`,
    valorBruto: params.valorErp,
    valorLiquido: params.valorErp,
    parcelas,
    codfilial: params.filial,
    nsuCv: `${params.id}-NSU`,
    autorizacao: `${params.id}-AUT`,
    tid: `${params.id}-TID`,
    numeroPedido: `${params.id}-PED`,
    bandeira,
    modalidade: tipo,
    statusVenda: "APROVADA",
    origemConsulta: "PCPREST",
  };
}

function executarTeste(nome: string, fn: () => void): void {
  try {
    resetStores();
    fn();
    console.log(`- ${nome}: OK`);
  } catch (error) {
    console.error(`- ${nome}: FALHA`);
    throw error;
  }
}

function parEsperado(valorOperadora: number, valorErp: number): string {
  return `${valorOperadora.toFixed(2)}|${valorErp.toFixed(2)}`;
}

function paresDasDivergencias(importacao: ReturnType<typeof gerarDivergenciasGranulares>, filial: string): Set<string> {
  return new Set(
    importacao.divergencias
      .filter((item) => item.filial === filial)
      .map((item) => parEsperado(item.valorOperadora, item.valorErp)),
  );
}

function mapContagemPorHashConciliacao(itens: AuditoriaCartaoImportacaoItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of itens) {
    const chave = item.hashConciliacao;
    map.set(chave, (map.get(chave) || 0) + 1);
  }
  return map;
}

function run(): void {
  const regra = regraBase();

  executarTeste("Cenario 1 - duas filiais no mesmo dia sem vazamento", () => {
    const itens = [
      criarItem({ id: "IT1", data: "2026-01-05", filial: "63", valorOperadora: 74130.09 }),
      criarItem({ id: "IT2", data: "2026-01-05", filial: "1L", valorOperadora: 1999.96 }),
    ];
    const erp = [
      criarErp({ id: "ERP1", data: "2026-01-05", filial: "63", valorErp: 114.14 }),
      criarErp({ id: "ERP2", data: "2026-01-05", filial: "1L", valorErp: 74130.09 }),
    ];
    const hashCount = mapContagemPorHashConciliacao(itens);
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: hashCount,
    });

    const filial63 = paresDasDivergencias(result, "63");
    const filial1L = paresDasDivergencias(result, "1L");
    const esperado63 = new Set([parEsperado(74130.09, 0), parEsperado(0, 114.14)]);
    const esperado1L = new Set([parEsperado(1999.96, 0), parEsperado(0, 74130.09)]);
    assert([...filial63].every((par) => esperado63.has(par)), "Filial 63 recebeu valores de outra filial.");
    assert([...filial1L].every((par) => esperado1L.has(par)), "Filial 1L recebeu valores de outra filial.");
  });

  executarTeste("Cenario 2 - multiplos tipos para a mesma chave base", () => {
    const itens = [
      criarItem({ id: "IT3A", data: "2026-01-06", filial: "63", valorOperadora: 1000, parcelas: 1, hash: "H-1" }),
      criarItem({ id: "IT3B", data: "2026-01-06", filial: "63", valorOperadora: 1000, parcelas: 1, hash: "H-1" }),
    ];
    const erp = [
      criarErp({ id: "ERP3", data: "2026-01-06", filial: "63", valorErp: 1000, parcelas: 3 }),
    ];
    const hashCount = mapContagemPorHashConciliacao(itens);
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: hashCount,
    });

    const linhas = result.divergencias.filter((item) => item.dataVenda === "2026-01-06" && item.filial === "63");
    const tipos = new Set(linhas.map((item) => item.tipoDivergencia));
    assert(tipos.has("DIVERGENCIA_VALOR"), "Faltou DIVERGENCIA_VALOR.");
    assert(tipos.has("DIVERGENCIA_PARCELAS"), "Faltou DIVERGENCIA_PARCELAS.");
    assert(tipos.has("DIVERGENCIA_STATUS"), "Faltou DIVERGENCIA_STATUS.");
    assert(tipos.has("DUPLICIDADE"), "Faltou DUPLICIDADE.");
    assert(linhas.every((item) => item.valorOperadora === 2000 && item.valorErp === 1000), "Tipos derivados nao herdaram os mesmos valores da linha-base.");
  });

  executarTeste("Cenario 3 - dias diferentes sem reaproveitamento", () => {
    const itens = [
      criarItem({ id: "IT4A", data: "2026-01-07", filial: "63", valorOperadora: 500 }),
      criarItem({ id: "IT4B", data: "2026-01-08", filial: "63", valorOperadora: 700 }),
    ];
    const erp = [
      criarErp({ id: "ERP4A", data: "2026-01-07", filial: "63", valorErp: 450 }),
      criarErp({ id: "ERP4B", data: "2026-01-08", filial: "63", valorErp: 710 }),
    ];
    const hashCount = mapContagemPorHashConciliacao(itens);
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: hashCount,
    });
    const dia7 = result.divergencias.filter((item) => item.dataVenda === "2026-01-07");
    const dia8 = result.divergencias.filter((item) => item.dataVenda === "2026-01-08");
    assert(dia7.every((item) => item.valorOperadora === 500 || item.valorErp === 450), "Dia 07 recebeu valores de outro dia.");
    assert(dia8.every((item) => item.valorOperadora === 700 || item.valorErp === 710), "Dia 08 recebeu valores de outro dia.");
  });

  executarTeste("Cenario 4 - movimento so operadora", () => {
    const itens = [criarItem({ id: "IT5", data: "2026-01-09", filial: "1L", valorOperadora: 1200 })];
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: [],
      regra,
      usuario: "teste",
      hashConciliacaoCount: mapContagemPorHashConciliacao(itens),
    });
    assert(result.divergencias.some((item) => item.tipoDivergencia === "NAO_ENCONTRADO_NO_ERP" && item.filial === "1L"), "Nao classificou MOVIMENTO_SO_OPERADORA corretamente.");
  });

  executarTeste("Cenario 5 - valores altos em filiais diferentes no mesmo dia", () => {
    const itens = [
      criarItem({ id: "IT6A", data: "2026-01-10", filial: "A", valorOperadora: 1000 }),
      criarItem({ id: "IT6B", data: "2026-01-10", filial: "B", valorOperadora: 80 }),
    ];
    const erp = [
      criarErp({ id: "ERP6A", data: "2026-01-10", filial: "A", valorErp: 50 }),
      criarErp({ id: "ERP6B", data: "2026-01-10", filial: "B", valorErp: 1000 }),
    ];
    const hashCount = mapContagemPorHashConciliacao(itens);
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: hashCount,
    });
    const paresA = paresDasDivergencias(result, "A");
    const paresB = paresDasDivergencias(result, "B");
    const esperadoA = new Set([parEsperado(1000, 0), parEsperado(0, 50)]);
    const esperadoB = new Set([parEsperado(80, 0), parEsperado(0, 1000)]);
    assert([...paresA].every((par) => esperadoA.has(par)), "Filial A cruzou valores com outra filial.");
    assert([...paresB].every((par) => esperadoB.has(par)), "Filial B cruzou valores com outra filial.");
  });

  executarTeste("Cenario 6 - full outer join sem multiplicacao", () => {
    const itens = [criarItem({ id: "IT7", data: "2026-01-11", filial: "1", valorOperadora: 300 })];
    const erp = [
      criarErp({ id: "ERP7A", data: "2026-01-11", filial: "1", valorErp: 100 }),
      criarErp({ id: "ERP7B", data: "2026-01-11", filial: "2", valorErp: 200 }),
    ];
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: mapContagemPorHashConciliacao(itens),
    });
    assert(result.diagnostics.chavesDuplicadasPosJoin === 0, "Join gerou chave duplicada.");
    assert(result.linhasBase.length === 3, "Full outer join deveria produzir 3 linhas-base para data+filial+valor.");
  });

  executarTeste("Cenario 7 - bandeira desconsiderada, chave por data+filial+valor", () => {
    const itens = [
      criarItem({ id: "IT8A", data: "2026-01-12", filial: "1", bandeira: "VISA", valorOperadora: 100 }),
      criarItem({ id: "IT8B", data: "2026-01-12", filial: "1", bandeira: "MASTERCARD", valorOperadora: 100 }),
    ];
    const erp = [
      criarErp({ id: "ERP8A", data: "2026-01-12", filial: "1", bandeira: "VISA", valorErp: 100 }),
    ];
    const hashCount = mapContagemPorHashConciliacao(itens);
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: hashCount,
    });
    assert(result.linhasBase.length === 1, "Com bandeira ignorada deveria existir apenas uma linha-base para data+filial+valor.");
    const linha = result.divergencias.find((item) => item.tipoDivergencia === "DIVERGENCIA_VALOR");
    assert(!!linha && linha.valorOperadora === 200 && linha.valorErp === 100, "A agregacao por data+filial+valor nao refletiu o esperado.");
  });

  executarTeste("Cenario 8 - mesmo valor no dia consolida em uma linha com match ERP por filial ajustada", () => {
    const itens = [
      criarItem({ id: "IT9", data: "2026-01-13", filial: "12", valorOperadora: 911.95 }),
    ];
    const erp = [
      criarErp({ id: "ERP9", data: "2026-01-13", filial: "12X", valorErp: 911.95 }),
    ];
    const result = gerarDivergenciasGranulares({
      importacaoId: "IMP-TESTE",
      itens,
      vendasErp: erp,
      regra,
      usuario: "teste",
      hashConciliacaoCount: mapContagemPorHashConciliacao(itens),
      matchesByItemId: new Map([
        ["IT9", { codfilialErp: "12X", valorErp: 911.95 }],
      ]),
    });

    assert(result.linhasBase.length === 1, "Deveria existir apenas uma linha-base apos alinhamento por match.");
    assert(result.divergencias.length === 0, "Nao deveria gerar NAO_ENCONTRADO quando valor igual foi conciliado no match.");
  });

  console.log("Teste de granularidade da aba Divergencias finalizado com sucesso.");
}

run();
