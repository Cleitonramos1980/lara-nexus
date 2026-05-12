/**
 * Lara — Motor de Negociação Autônoma
 * Permite que a Lara proponha e registre acordos de parcelamento de forma autônoma,
 * dentro de limites configuráveis pelo gestor.
 */

import type { LaraCliente, LaraTitulo } from "./types.js";
import { roundMoney } from "./utils.js";

export type PoliticaNegociacao = {
  etapa_regua: string;
  desconto_maximo_pct: number;   // ex: 10 = 10% de desconto máximo
  parcelas_maximas: number;      // ex: 6
  entrada_minima_pct: number;    // ex: 20 = mínimo 20% de entrada
  ativo: boolean;
};

export type PropostaNegociacao = {
  tipo: "avista" | "parcelado";
  desconto_pct: number;
  valor_original: number;
  valor_com_desconto: number;
  entrada: number;
  parcelas: number;
  valor_parcela: number;
  duplicatas: string[];
  valida_ate: string; // ISO datetime — oferta temporária
  mensagem_oferta: string;
};

export type ResultadoNegociacao = {
  pode_negociar: boolean;
  motivo_bloqueio?: string;
  propostas: PropostaNegociacao[];
  mensagem_apresentacao: string;
};

// Políticas padrão por etapa da régua (fallback quando não vem do banco)
export const POLITICAS_PADRAO: PoliticaNegociacao[] = [
  { etapa_regua: "D0",   desconto_maximo_pct: 0,  parcelas_maximas: 3,  entrada_minima_pct: 30, ativo: true },
  { etapa_regua: "D+3",  desconto_maximo_pct: 5,  parcelas_maximas: 3,  entrada_minima_pct: 25, ativo: true },
  { etapa_regua: "D+7",  desconto_maximo_pct: 8,  parcelas_maximas: 6,  entrada_minima_pct: 20, ativo: true },
  { etapa_regua: "D+15", desconto_maximo_pct: 12, parcelas_maximas: 9,  entrada_minima_pct: 15, ativo: true },
  { etapa_regua: "D+30", desconto_maximo_pct: 18, parcelas_maximas: 12, entrada_minima_pct: 10, ativo: true },
  { etapa_regua: "D-3",  desconto_maximo_pct: 0,  parcelas_maximas: 2,  entrada_minima_pct: 50, ativo: true },
];

function formatMoneyBr(value: number): string {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function addHours(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

export function gerarPropostasNegociacao(input: {
  cliente: LaraCliente;
  titulos: LaraTitulo[];
  duplicatas_selecionadas?: string[];
  politica: PoliticaNegociacao;
  horas_validade?: number;
}): ResultadoNegociacao {
  const { cliente, titulos, politica } = input;
  const horasValidade = input.horas_validade ?? 24;

  if (!politica.ativo) {
    return {
      pode_negociar: false,
      motivo_bloqueio: "Negociação autônoma desativada para esta etapa da régua.",
      propostas: [],
      mensagem_apresentacao: "",
    };
  }

  // Filtra os títulos relevantes
  const titulosRelevantes = input.duplicatas_selecionadas?.length
    ? titulos.filter((t) => input.duplicatas_selecionadas!.includes(t.duplicata))
    : titulos;

  if (titulosRelevantes.length === 0) {
    return {
      pode_negociar: false,
      motivo_bloqueio: "Nenhum título em aberto encontrado para negociação.",
      propostas: [],
      mensagem_apresentacao: "",
    };
  }

  const valorTotal = roundMoney(titulosRelevantes.reduce((sum, t) => sum + t.valor, 0));
  const duplicatas = titulosRelevantes.map((t) => t.duplicata);
  const validaAte = addHours(horasValidade);
  const nomeCliente = cliente.cliente.split(" ")[0]; // primeiro nome

  const propostas: PropostaNegociacao[] = [];

  // Proposta 1: À vista com desconto máximo
  if (politica.desconto_maximo_pct > 0) {
    const descontoAvista = politica.desconto_maximo_pct;
    const valorComDesconto = roundMoney(valorTotal * (1 - descontoAvista / 100));
    propostas.push({
      tipo: "avista",
      desconto_pct: descontoAvista,
      valor_original: valorTotal,
      valor_com_desconto: valorComDesconto,
      entrada: valorComDesconto,
      parcelas: 1,
      valor_parcela: valorComDesconto,
      duplicatas,
      valida_ate: validaAte,
      mensagem_oferta: `💰 *${descontoAvista}% de desconto* pagando à vista: ${formatMoneyBr(valorComDesconto)} (válido por ${horasValidade}h)`,
    });
  }

  // Proposta 2: Parcelado com entrada mínima (metade do desconto máximo)
  if (politica.parcelas_maximas >= 2) {
    const descontoParcelado = roundMoney(politica.desconto_maximo_pct * 0.5);
    const valorComDesconto = roundMoney(valorTotal * (1 - descontoParcelado / 100));
    const entradaMinima = roundMoney(valorComDesconto * (politica.entrada_minima_pct / 100));
    const valorRestante = roundMoney(valorComDesconto - entradaMinima);
    const parcelas = Math.min(politica.parcelas_maximas, Math.ceil(politica.parcelas_maximas / 2));
    const valorParcela = roundMoney(valorRestante / parcelas);
    const descricaoDesconto = descontoParcelado > 0 ? ` (${descontoParcelado}% off)` : "";
    propostas.push({
      tipo: "parcelado",
      desconto_pct: descontoParcelado,
      valor_original: valorTotal,
      valor_com_desconto: valorComDesconto,
      entrada: entradaMinima,
      parcelas,
      valor_parcela: valorParcela,
      duplicatas,
      valida_ate: validaAte,
      mensagem_oferta: `📅 *${parcelas}x parcelado${descricaoDesconto}:* entrada ${formatMoneyBr(entradaMinima)} + ${parcelas}x ${formatMoneyBr(valorParcela)}`,
    });
  }

  // Proposta 3: Máximo parcelamento com desconto reduzido
  if (politica.parcelas_maximas >= 4) {
    const descontoMin = roundMoney(politica.desconto_maximo_pct * 0.25);
    const valorComDesconto = roundMoney(valorTotal * (1 - descontoMin / 100));
    const entradaMinima = roundMoney(valorComDesconto * (politica.entrada_minima_pct / 100));
    const valorRestante = roundMoney(valorComDesconto - entradaMinima);
    const valorParcela = roundMoney(valorRestante / politica.parcelas_maximas);
    const descricaoDesconto = descontoMin > 0 ? ` (${descontoMin}% off)` : "";
    propostas.push({
      tipo: "parcelado",
      desconto_pct: descontoMin,
      valor_original: valorTotal,
      valor_com_desconto: valorComDesconto,
      entrada: entradaMinima,
      parcelas: politica.parcelas_maximas,
      valor_parcela: valorParcela,
      duplicatas,
      valida_ate: validaAte,
      mensagem_oferta: `📆 *${politica.parcelas_maximas}x parcelado${descricaoDesconto}:* entrada ${formatMoneyBr(entradaMinima)} + ${politica.parcelas_maximas}x ${formatMoneyBr(valorParcela)}`,
    });
  }

  if (propostas.length === 0) {
    // Sem desconto — apenas parcelamento simples
    const entradaMinima = roundMoney(valorTotal * (politica.entrada_minima_pct / 100));
    const valorRestante = roundMoney(valorTotal - entradaMinima);
    const parcelas = politica.parcelas_maximas;
    const valorParcela = roundMoney(valorRestante / parcelas);
    propostas.push({
      tipo: "parcelado",
      desconto_pct: 0,
      valor_original: valorTotal,
      valor_com_desconto: valorTotal,
      entrada: entradaMinima,
      parcelas,
      valor_parcela: valorParcela,
      duplicatas,
      valida_ate: validaAte,
      mensagem_oferta: `📅 *${parcelas}x sem desconto:* entrada ${formatMoneyBr(entradaMinima)} + ${parcelas}x ${formatMoneyBr(valorParcela)}`,
    });
  }

  const ofertasTexto = propostas.map((p, i) => `${i + 1}️⃣ ${p.mensagem_oferta}`).join("\n");

  const mensagem_apresentacao = [
    `Olá ${nomeCliente}! Entendo a situação. 😊`,
    `Tenho *${propostas.length} opção${propostas.length > 1 ? "ões" : ""}* especial${propostas.length > 1 ? "is" : ""} para regularizar ${formatMoneyBr(valorTotal)} em aberto:`,
    "",
    ofertasTexto,
    "",
    `Qual prefere? Responda *1*, *2*${propostas.length > 2 ? " ou *3*" : ""} — ou me diga se precisar de outra condição. 🤝`,
  ].join("\n");

  return {
    pode_negociar: true,
    propostas,
    mensagem_apresentacao,
  };
}

export function selecionarPoliticaPorEtapa(
  etapa: string,
  politicasPersonalizadas: PoliticaNegociacao[],
): PoliticaNegociacao {
  // Prioriza políticas personalizadas do banco
  const personalizada = politicasPersonalizadas.find(
    (p) => p.etapa_regua === etapa && p.ativo,
  );
  if (personalizada) return personalizada;

  // Fallback para padrões
  const padrao = POLITICAS_PADRAO.find((p) => p.etapa_regua === etapa);
  return padrao ?? { etapa_regua: etapa, desconto_maximo_pct: 5, parcelas_maximas: 3, entrada_minima_pct: 30, ativo: true };
}
