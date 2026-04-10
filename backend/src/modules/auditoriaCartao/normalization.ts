import { createHash } from "node:crypto";
import {
  type AuditoriaCartaoCamposNormalizados,
  type AuditoriaCartaoRegra,
} from "./types.js";
import {
  buildLookup,
  maskCard,
  normalizeHeader,
  parseBoolean,
  parseDate,
  parseNumber,
  parseTime,
  sanitizeText,
} from "./helpers.js";
import { normalizeComparable } from "./state.js";

type CampoRede =
  | "dataVenda"
  | "horaVenda"
  | "statusVenda"
  | "valorVendaOriginal"
  | "valorVendaAtualizado"
  | "modalidade"
  | "tipo"
  | "preAutorizado"
  | "numeroParcelas"
  | "bandeira"
  | "taxaMdr"
  | "valorMdr"
  | "taxaRecebimentoAuto"
  | "valorTaxaRecebimentoAuto"
  | "taxasDescontadas"
  | "valorTotalTaxasDescontadas"
  | "valorLiquido"
  | "nsuCv"
  | "prazoRecebimento"
  | "lote"
  | "autorizacao"
  | "numeroEstabelecimento"
  | "nomeEstabelecimento"
  | "cnpj"
  | "codfilial"
  | "numeroCartao"
  | "idCarteiraDigital"
  | "meioPagamento"
  | "tipoMaquininha"
  | "codigoMaquininha"
  | "tid"
  | "numeroPedido"
  | "taxaEmbarque"
  | "canceladaEstabelecimento"
  | "dataCancelamento"
  | "valorCancelado"
  | "emDisputaChargeback"
  | "dataChargeback"
  | "resolucaoChargeback"
  | "dataResolucaoChargeback"
  | "nacionalidadeCartao"
  | "moedaEstrangeira"
  | "cartaoPrePago"
  | "idTransacao";

const COLUMN_ALIASES: Record<CampoRede, string[]> = {
  dataVenda: ["data da venda", "data venda", "dt venda"],
  horaVenda: ["hora da venda", "hora venda", "hr venda"],
  statusVenda: ["status da venda", "status venda"],
  valorVendaOriginal: ["valor da venda original", "valor venda original", "valor da venda"],
  valorVendaAtualizado: ["valor da venda atualizado", "valor venda atualizado"],
  modalidade: ["modalidade"],
  tipo: ["tipo", "tipo transacao"],
  preAutorizado: ["pre-autorizado", "pre autorizado"],
  numeroParcelas: ["numero de parcelas", "parcelas", "n de parcelas"],
  bandeira: ["bandeira"],
  taxaMdr: ["taxa mdr", "taxa mdr (%)"],
  valorMdr: ["valor mdr"],
  taxaRecebimentoAuto: ["taxa de recebimento automatico", "taxa recebimento automatico"],
  valorTaxaRecebimentoAuto: ["valor taxa de recebimento automatico", "valor taxa recebimento automatico"],
  taxasDescontadas: ["taxas descontadas (mdr+recebimento automatico)", "taxas descontadas"],
  valorTotalTaxasDescontadas: ["valor total das taxas descontadas (mdr+recebimento automatico)", "valor total taxas descontadas"],
  valorLiquido: ["valor liquido"],
  nsuCv: ["nsu/cv", "nsu cv", "nsucv"],
  prazoRecebimento: ["prazo de recebimento"],
  lote: ["resumo de vendas/numero do lote", "numero do lote", "lote"],
  autorizacao: ["numero da autorizacao (auto)", "numero da autorizacao", "auto", "autorizacao"],
  numeroEstabelecimento: ["numero do estabelecimento"],
  nomeEstabelecimento: ["nome do estabelecimento"],
  cnpj: ["cnpj"],
  codfilial: ["codfilial", "cod filial"],
  numeroCartao: ["numero do cartao"],
  idCarteiraDigital: ["id carteira digital"],
  meioPagamento: ["meio de pagamento"],
  tipoMaquininha: ["tipo de maquininha"],
  codigoMaquininha: ["codigo da maquininha", "cod maquininha"],
  tid: ["tid"],
  numeroPedido: ["numero do pedido", "pedido"],
  taxaEmbarque: ["taxa de embarque"],
  canceladaEstabelecimento: ["cancelada pelo estabelecimento"],
  dataCancelamento: ["data do cancelamento"],
  valorCancelado: ["valor cancelado"],
  emDisputaChargeback: ["em disputa de chargeback"],
  dataChargeback: ["data que entrou em disputa de chargeback"],
  resolucaoChargeback: ["resolucao do chargeback"],
  dataResolucaoChargeback: ["data da resolucao do chargeback"],
  nacionalidadeCartao: ["nacionalidade do cartao"],
  moedaEstrangeira: ["moeda estrangeira (dcc)", "moeda estrangeira dcc"],
  cartaoPrePago: ["cartao pre-pago", "cartao pre pago"],
  idTransacao: ["id transacao", "id transacao"],
};

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(COLUMN_ALIASES).map(([campo, aliases]) => [
    campo,
    aliases.map((alias) => normalizeHeader(alias)),
  ]),
) as Record<CampoRede, string[]>;

function pickFromLookup(lookup: Map<string, unknown>, campo: CampoRede): unknown {
  const aliases = NORMALIZED_ALIASES[campo];
  for (const alias of aliases) {
    if (lookup.has(alias)) return lookup.get(alias);
  }
  return undefined;
}

function applyFilialMapping(numeroEstabelecimento: string, codfilialArquivo: string, regra: AuditoriaCartaoRegra): string {
  const byEstabelecimento = regra.mapeamentoEstabelecimentoFilial.find(
    (item) => normalizeComparable(item.numeroEstabelecimento) === normalizeComparable(numeroEstabelecimento),
  );
  if (byEstabelecimento) return byEstabelecimento.codfilial;
  return codfilialArquivo;
}

export function buildHashConciliacao(values: Array<string | number | boolean>): string {
  return createHash("sha256").update(values.join("|")).digest("hex");
}

export function normalizarLinhaRede(
  importacaoId: string,
  linhaOrigem: number,
  row: Record<string, unknown>,
  regra: AuditoriaCartaoRegra,
): AuditoriaCartaoCamposNormalizados {
  const lookup = buildLookup(row);

  const dataVenda = parseDate(pickFromLookup(lookup, "dataVenda"));
  const horaVenda = parseTime(pickFromLookup(lookup, "horaVenda"));
  const dataHoraVenda = dataVenda ? `${dataVenda}T${horaVenda || "00:00"}:00` : "";

  const valorBruto = parseNumber(pickFromLookup(lookup, "valorVendaOriginal"));
  const valorBrutoAtualizado = parseNumber(pickFromLookup(lookup, "valorVendaAtualizado"));
  const valorLiquido = parseNumber(pickFromLookup(lookup, "valorLiquido"));
  const parcelas = Math.max(0, Math.round(parseNumber(pickFromLookup(lookup, "numeroParcelas"))));
  const taxaMdr = parseNumber(pickFromLookup(lookup, "taxaMdr"));
  const valorMdr = parseNumber(pickFromLookup(lookup, "valorMdr"));
  const taxaRecebimentoAuto = parseNumber(pickFromLookup(lookup, "taxaRecebimentoAuto"));
  const valorRecebimentoAuto = parseNumber(pickFromLookup(lookup, "valorTaxaRecebimentoAuto"));
  const valorTotalTaxas = parseNumber(pickFromLookup(lookup, "valorTotalTaxasDescontadas"));

  const numeroEstabelecimento = sanitizeText(pickFromLookup(lookup, "numeroEstabelecimento"));
  const codfilialArquivo = sanitizeText(pickFromLookup(lookup, "codfilial"));
  const codfilialMapeado = applyFilialMapping(numeroEstabelecimento, codfilialArquivo, regra);

  const nsuCv = sanitizeText(pickFromLookup(lookup, "nsuCv"));
  const autorizacao = sanitizeText(pickFromLookup(lookup, "autorizacao"));
  const tid = sanitizeText(pickFromLookup(lookup, "tid"));
  const numeroPedido = sanitizeText(pickFromLookup(lookup, "numeroPedido"));
  const idTransacao = sanitizeText(pickFromLookup(lookup, "idTransacao"));

  const hashConciliacao = buildHashConciliacao([
    dataVenda,
    horaVenda,
    valorBruto,
    nsuCv,
    autorizacao,
    tid,
    numeroPedido,
    numeroEstabelecimento,
    idTransacao,
  ]);

  return {
    idImportacao: importacaoId,
    linhaOrigem,
    dataVenda,
    horaVenda,
    dataHoraVenda,
    statusVenda: sanitizeText(pickFromLookup(lookup, "statusVenda")),
    valorBruto,
    valorBrutoAtualizado,
    valorLiquido,
    modalidade: sanitizeText(pickFromLookup(lookup, "modalidade")),
    tipoTransacao: sanitizeText(pickFromLookup(lookup, "tipo")),
    preAutorizado: parseBoolean(pickFromLookup(lookup, "preAutorizado")),
    parcelas,
    bandeira: sanitizeText(pickFromLookup(lookup, "bandeira")),
    taxaMdr,
    valorMdr,
    taxaRecebimentoAuto,
    valorRecebimentoAuto,
    taxasDescontadasDescricao: sanitizeText(pickFromLookup(lookup, "taxasDescontadas")),
    valorTotalTaxas,
    nsuCv,
    prazoRecebimento: sanitizeText(pickFromLookup(lookup, "prazoRecebimento")),
    lote: sanitizeText(pickFromLookup(lookup, "lote")),
    autorizacao,
    numeroEstabelecimento,
    nomeEstabelecimento: sanitizeText(pickFromLookup(lookup, "nomeEstabelecimento")),
    cnpjEstabelecimento: sanitizeText(pickFromLookup(lookup, "cnpj")),
    codfilialArquivo: codfilialMapeado,
    numeroCartaoMascarado: maskCard(sanitizeText(pickFromLookup(lookup, "numeroCartao"))),
    carteiraDigitalId: sanitizeText(pickFromLookup(lookup, "idCarteiraDigital")),
    meioPagamento: sanitizeText(pickFromLookup(lookup, "meioPagamento")),
    tipoMaquininha: sanitizeText(pickFromLookup(lookup, "tipoMaquininha")),
    codigoMaquininha: sanitizeText(pickFromLookup(lookup, "codigoMaquininha")),
    tid,
    numeroPedido,
    taxaEmbarque: parseNumber(pickFromLookup(lookup, "taxaEmbarque")),
    canceladaEstabelecimento: parseBoolean(pickFromLookup(lookup, "canceladaEstabelecimento")),
    dataCancelamento: parseDate(pickFromLookup(lookup, "dataCancelamento")),
    valorCancelado: parseNumber(pickFromLookup(lookup, "valorCancelado")),
    emChargeback: parseBoolean(pickFromLookup(lookup, "emDisputaChargeback")),
    dataChargeback: parseDate(pickFromLookup(lookup, "dataChargeback")),
    resolucaoChargeback: sanitizeText(pickFromLookup(lookup, "resolucaoChargeback")),
    dataResolucaoChargeback: parseDate(pickFromLookup(lookup, "dataResolucaoChargeback")),
    nacionalidadeCartao: sanitizeText(pickFromLookup(lookup, "nacionalidadeCartao")),
    moedaEstrangeiraDcc: sanitizeText(pickFromLookup(lookup, "moedaEstrangeira")),
    cartaoPrePago: parseBoolean(pickFromLookup(lookup, "cartaoPrePago")),
    idTransacao,
    hashConciliacao,
    statusConciliacao: "PENDENTE_REVISAO",
    motivoDivergencia: "",
  };
}

export function linhaValida(item: AuditoriaCartaoCamposNormalizados): boolean {
  if (!item.dataVenda) return false;
  if (item.valorBruto <= 0 && item.valorBrutoAtualizado <= 0) return false;
  return true;
}

export function statusVendaDeveSerIgnorado(statusVenda: string): boolean {
  const status = normalizeComparable(statusVenda || "");
  if (!status) return false;
  return status.includes("negad")
    || status.includes("expirad")
    || status.includes("cancelad")
    || status.includes("estornad");
}
