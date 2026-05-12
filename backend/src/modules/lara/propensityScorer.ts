/**
 * Lara — Score de Propensão ao Pagamento v2 (Collection Score)
 *
 * Calcula a probabilidade de um cliente pagar com base em dados comportamentais,
 * financeiros e de sentimento. Inclui:
 *   • Integração com análise de sentimento em tempo real
 *   • Detecção de fadiga de contato por volume (24h)
 *   • Melhor hora inferida do histórico real de respostas
 *   • Melhor dia da semana (Ter–Qui é o ótimo para cobrança)
 *   • Score separado de propensão a parcelamento
 *   • Desconto mínimo estimado para conversão
 *   • Velocidade do score (subindo / estável / caindo)
 *   • Frequência de contato recomendada
 *   • Ação granular recomendada por perfil
 */

import type { LaraCliente } from "./types.js";
import type { SentimentResult } from "./sentimentAnalyzer.js";
import { roundMoney } from "./utils.js";

// Re-exporta para manter compatibilidade com service.ts que importa daqui
export { selecionarPoliticaPorEtapa } from "./negotiationEngine.js";

// ─── Tipos Públicos ───────────────────────────────────────────────────────────

export type PropensityLevel = "muito_alto" | "alto" | "medio" | "baixo" | "muito_baixo";

export type PropensityAction =
  | "cobrar_direto"          // Alta propensão: envie boleto/PIX agora
  | "oferecer_parcelamento"  // Propensão moderada: parcelamento aumenta chance
  | "oferecer_desconto"      // Baixa propensão: desconto pode converter
  | "abordagem_empatica"     // Cliente frustrado: fale antes de cobrar
  | "pausar_e_aguardar"      // Muito baixa: pause, tente depois
  | "escalar_negociador";    // Necessita operador humano especializado

export type PropensityScoreResult = {
  score: number;                // 0–100
  level: PropensityLevel;
  confidence: number;           // 0.0–1.0: confiança baseada na riqueza dos dados
  melhor_canal: "WHATSAPP" | "EMAIL" | "SMS" | "VOICE";
  melhor_hora: number;          // hora local (0–23) recomendada para contato
  melhor_dia_semana: number;    // 0=Dom, 1=Seg … 6=Sab (2=Ter é o padrão ótimo)
  recomendacao: string;
  acao_recomendada: PropensityAction;
  fatores: string[];
  score_parcelamento: number;            // 0–100: propensão específica a parcelamento
  desconto_minimo_pct: number;           // desconto mínimo estimado para conversão (%)
  velocidade: "subindo" | "estavel" | "caindo" | "desconhecida"; // tendência do score
  frequencia_contato_sugerida: "diaria" | "2x_semana" | "semanal" | "quinzenal" | "pausar";
};

export type PropensityInput = {
  cliente: LaraCliente;
  qtd_mensagens_enviadas_7d: number;
  qtd_respostas_7d: number;
  qtd_promessas_abertas: number;
  qtd_promessas_cumpridas: number;
  qtd_interacoes_total: number;
  tem_optout_historico: boolean;
  dias_desde_ultimo_contato: number;
  // ── Campos opcionais para análise enriquecida ──
  sentimento_atual?: SentimentResult | null;
  score_anterior?: number | null;          // para calcular velocidade da propensão
  horas_resposta_historico?: number[];     // horas (0–23) em que o cliente respondeu
  qtd_mensagens_enviadas_24h?: number;     // para detectar fadiga imediata
  tem_promessa_recente?: boolean;          // promessa registrada há menos de 7 dias
  pagamentos_parciais_historico?: number;  // pagamentos parciais feitos anteriormente
};

// ─── Pesos por Etapa da Régua ─────────────────────────────────────────────────

const ETAPA_WEIGHT: Record<string, number> = {
  "D-3": 85,
  "D0":  75,
  "D+3": 60,
  "D+7": 45,
  "D+15": 30,
  "D+30": 15,
};

// ─── Pesos por Perfil de Risco ────────────────────────────────────────────────

const RISCO_WEIGHT: Record<string, number> = {
  baixo:   80,
  medio:   55,
  alto:    35,
  critico: 15,
};

// ─── Pesos por Dia da Semana (0=Dom … 6=Sab) ─────────────────────────────────
// Terça a quinta são os melhores dias para cobrança (maior engajamento financeiro)

const DIA_SEMANA_SCORE: Record<number, number> = {
  0: 0.60, // Dom
  1: 0.85, // Seg
  2: 1.00, // Ter ★ ótimo
  3: 1.00, // Qua ★ ótimo
  4: 0.95, // Qui
  5: 0.75, // Sex
  6: 0.55, // Sab
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bestHourFromHistory(horas: number[]): number | null {
  if (!horas || horas.length === 0) return null;
  const freq: Record<number, number> = {};
  for (const h of horas) freq[h] = (freq[h] ?? 0) + 1;
  let best = -1;
  let bestCount = 0;
  for (const [hora, count] of Object.entries(freq)) {
    if (count > bestCount) { bestCount = count; best = Number(hora); }
  }
  return best >= 0 ? best : null;
}

function bestDayOfWeek(): number {
  // Retorna o melhor dia absoluto (Terça-feira = 2) como padrão global
  return 2;
}

// ─── Função Principal ─────────────────────────────────────────────────────────

export function calcPropensityScore(input: PropensityInput): PropensityScoreResult {
  const { cliente } = input;
  const fatores: string[] = [];
  let score = 50; // base neutra

  // ── 1. Etapa da régua (peso 25%) ─────────────────────────────────────────────
  const etapaBase = ETAPA_WEIGHT[cliente.etapa_regua] ?? 40;
  score += (etapaBase - 50) * 0.25;
  if (etapaBase >= 70) fatores.push("Título recente (baixo atraso)");
  else if (etapaBase <= 20) fatores.push("Atraso crítico acima de 30 dias");

  // ── 2. Risco inferido (peso 20%) ─────────────────────────────────────────────
  const riscoBase = RISCO_WEIGHT[cliente.risco] ?? 40;
  score += (riscoBase - 50) * 0.20;
  if (riscoBase >= 70) fatores.push("Perfil de baixo risco");
  else if (riscoBase <= 20) fatores.push("Perfil de risco crítico");

  // ── 3. Taxa de resposta 7 dias (peso 15%) ────────────────────────────────────
  const taxaResposta = input.qtd_mensagens_enviadas_7d > 0
    ? input.qtd_respostas_7d / input.qtd_mensagens_enviadas_7d
    : 0;
  score += (taxaResposta - 0.5) * 40 * 0.15;
  if (taxaResposta >= 0.7) fatores.push("Alta taxa de resposta recente");
  else if (taxaResposta > 0 && taxaResposta < 0.2) fatores.push("Baixa taxa de resposta recente");

  // ── 4. Promessas cumpridas (peso 12%) ────────────────────────────────────────
  const totalPromessas = input.qtd_promessas_abertas + input.qtd_promessas_cumpridas;
  if (totalPromessas > 0) {
    const taxaCumprimento = input.qtd_promessas_cumpridas / totalPromessas;
    score += (taxaCumprimento - 0.5) * 30 * 0.12;
    if (taxaCumprimento > 0.7) fatores.push("Histórico de cumprimento de promessas");
    else if (taxaCumprimento < 0.2 && totalPromessas > 1) fatores.push("Promessas não cumpridas no histórico");
  }

  // ── 5. Valor da dívida — escala log inversa (peso 8%) ────────────────────────
  const valorFator = cliente.total_aberto > 0
    ? Math.max(0, 1 - Math.log10(cliente.total_aberto) / 6)
    : 0.5;
  score += (valorFator - 0.5) * 20 * 0.08;
  if (cliente.total_aberto < 1000) fatores.push("Valor baixo facilita quitação");
  else if (cliente.total_aberto > 50000) fatores.push("Valor elevado pode dificultar quitação");

  // ── 6. Engajamento recente (peso 8%) ─────────────────────────────────────────
  if (input.qtd_interacoes_total > 0) {
    const recencyFactor =
      input.dias_desde_ultimo_contato <= 3  ? 1.0 :
      input.dias_desde_ultimo_contato <= 7  ? 0.7 :
      input.dias_desde_ultimo_contato <= 14 ? 0.4 : 0.1;
    score += (recencyFactor - 0.5) * 20 * 0.08;
    if (recencyFactor >= 0.7) fatores.push("Interagiu recentemente");
  }

  // ── 7. Sentimento atual — integração (peso 12%) ──────────────────────────────
  if (input.sentimento_atual) {
    const s = input.sentimento_atual;
    if (s.requer_escalacao_imediata) {
      score -= 30;
      fatores.push("Sentimento crítico detectado — resistência máxima");
    } else if (s.risco_legal) {
      score -= 25;
      fatores.push("Risco jurídico detectado — não cobrar até resolução");
    } else if (s.vulnerabilidade !== "nenhuma") {
      score -= 20;
      fatores.push(`Vulnerabilidade (${s.vulnerabilidade}) — abordagem especial necessária`);
    } else if (s.fadiga_contato) {
      score -= 22;
      fatores.push("Fadiga de contato — saturação de mensagens");
    } else if (s.valence === "negativo" && s.stress_level >= 2) {
      score -= 15;
      fatores.push("Cliente frustrado — propensão reduzida temporariamente");
    } else if (s.valence === "positivo") {
      score += 12;
      fatores.push("Sentimento positivo — maior abertura para pagamento");
    } else if (s.sarcastico) {
      score -= 10;
      fatores.push("Sarcasmo detectado — cliente resistente");
    }
  }

  // ── Penalidades ────────────────────────────────────────────────────────────────
  if (input.tem_optout_historico) {
    score -= 25;
    fatores.push("Histórico de opt-out registrado");
  }

  if (input.qtd_promessas_abertas > 1) {
    score -= 10;
    fatores.push("Múltiplas promessas em aberto");
  }

  // Fadiga de contato por volume nas últimas 24h
  const msgs24h = input.qtd_mensagens_enviadas_24h ?? 0;
  if (msgs24h >= 4) {
    score -= 20;
    fatores.push("Volume excessivo de contatos nas últimas 24h");
  } else if (msgs24h >= 2) {
    score -= 8;
    fatores.push("Múltiplos contatos nas últimas 24h");
  }

  // ── Bônus ──────────────────────────────────────────────────────────────────────
  if ((input.pagamentos_parciais_historico ?? 0) > 0) {
    score += 8;
    fatores.push("Realizou pagamentos parciais anteriormente");
  }

  if (input.tem_promessa_recente) {
    score += 5;
    fatores.push("Promessa de pagamento registrada recentemente");
  }

  score = Math.max(0, Math.min(100, roundMoney(score)));

  // ── Level ─────────────────────────────────────────────────────────────────────
  let level: PropensityLevel;
  if (score >= 75)      level = "muito_alto";
  else if (score >= 60) level = "alto";
  else if (score >= 40) level = "medio";
  else if (score >= 20) level = "baixo";
  else                  level = "muito_baixo";

  // ── Velocidade (tendência do score) ──────────────────────────────────────────
  let velocidade: PropensityScoreResult["velocidade"] = "desconhecida";
  if (input.score_anterior !== null && input.score_anterior !== undefined) {
    const delta = score - input.score_anterior;
    velocidade = delta > 5 ? "subindo" : delta < -5 ? "caindo" : "estavel";
  }

  // ── Melhor canal ──────────────────────────────────────────────────────────────
  const melhor_canal: "WHATSAPP" | "EMAIL" | "SMS" | "VOICE" =
    taxaResposta > 0.3 || input.qtd_respostas_7d > 0 ? "WHATSAPP" :
    input.qtd_interacoes_total === 0 ? "SMS" : "WHATSAPP";

  // ── Melhor hora (histórico real > heurística por valor) ───────────────────────
  const horaFromHistory = bestHourFromHistory(input.horas_resposta_historico ?? []);
  const melhor_hora = horaFromHistory !== null
    ? horaFromHistory
    : cliente.total_aberto < 5000  ? 10
    : cliente.total_aberto < 20000 ? 14
    : 19;

  // ── Melhor dia da semana ──────────────────────────────────────────────────────
  const melhor_dia_semana = bestDayOfWeek();

  // ── Score de parcelamento ─────────────────────────────────────────────────────
  // Clientes com dívida alta, etapa avançada e sentimento negativo (não crítico)
  // têm mais propensão a fechar um parcelamento do que a pagar à vista
  let score_parcelamento = score;
  if (cliente.total_aberto > 5000) score_parcelamento += 10;
  if (["D+15", "D+30"].includes(cliente.etapa_regua)) score_parcelamento += 8;
  if (input.sentimento_atual?.valence === "negativo" && (input.sentimento_atual?.stress_level ?? 0) < 3) {
    score_parcelamento += 5;
  }
  score_parcelamento = Math.min(100, roundMoney(score_parcelamento));

  // ── Desconto mínimo estimado para conversão ───────────────────────────────────
  let desconto_minimo_pct = 0;
  if      (level === "muito_baixo") desconto_minimo_pct = 18;
  else if (level === "baixo")       desconto_minimo_pct = 12;
  else if (level === "medio")       desconto_minimo_pct = 5;
  if (input.sentimento_atual?.valence === "negativo") desconto_minimo_pct += 3;
  if (input.sentimento_atual?.valence === "critico")  desconto_minimo_pct += 5;

  // ── Frequência de contato recomendada ─────────────────────────────────────────
  let frequencia_contato_sugerida: PropensityScoreResult["frequencia_contato_sugerida"];
  if (msgs24h >= 4 || input.sentimento_atual?.fadiga_contato) {
    frequencia_contato_sugerida = "pausar";
  } else if (level === "muito_baixo") {
    frequencia_contato_sugerida = "quinzenal";
  } else if (level === "baixo") {
    frequencia_contato_sugerida = "semanal";
  } else if (level === "medio") {
    frequencia_contato_sugerida = "2x_semana";
  } else {
    frequencia_contato_sugerida = "diaria";
  }

  // ── Ação recomendada ──────────────────────────────────────────────────────────
  let acao_recomendada: PropensityAction;
  const s = input.sentimento_atual;
  if (s?.requer_escalacao_imediata || s?.risco_legal || s?.vulnerabilidade !== "nenhuma") {
    acao_recomendada = "escalar_negociador";
  } else if (s?.valence === "negativo" && (s?.stress_level ?? 0) >= 2) {
    acao_recomendada = "abordagem_empatica";
  } else if (level === "muito_baixo") {
    acao_recomendada = "pausar_e_aguardar";
  } else if (level === "baixo") {
    acao_recomendada = "oferecer_desconto";
  } else if (level === "medio" || score_parcelamento > score + 5) {
    acao_recomendada = "oferecer_parcelamento";
  } else {
    acao_recomendada = "cobrar_direto";
  }

  // ── Recomendação textual ──────────────────────────────────────────────────────
  const parcMax = Math.max(2, Math.round(score_parcelamento / 10));
  let recomendacao: string;
  if      (level === "muito_alto") recomendacao = "Alta propensão. Envie PIX/boleto com urgência suave. Não ofereça desconto.";
  else if (level === "alto")       recomendacao = "Boa propensão. Opções claras de pagamento. Parcelamento pode fechar.";
  else if (level === "medio")      recomendacao = `Propensão moderada. Ofereça parcelamento em até ${parcMax}x.`;
  else if (level === "baixo")      recomendacao = `Baixa propensão. Desconto de ${desconto_minimo_pct}%+ e parcelamento para converter.`;
  else                             recomendacao = "Muito baixa propensão. Pause o contato ou escale para negociador humano.";

  // ── Confiança — função da riqueza de dados disponíveis ───────────────────────
  const dataPoints = [
    input.qtd_interacoes_total > 0 ? 1 : 0,
    totalPromessas > 0 ? 1 : 0,
    (input.horas_resposta_historico?.length ?? 0) > 0 ? 1 : 0,
    input.sentimento_atual ? 1 : 0,
    input.score_anterior !== null && input.score_anterior !== undefined ? 1 : 0,
    (input.pagamentos_parciais_historico ?? 0) > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);
  const confidence = Math.min(0.95, 0.35 + dataPoints * 0.1);

  return {
    score,
    level,
    confidence: Math.round(confidence * 100) / 100,
    melhor_canal,
    melhor_hora,
    melhor_dia_semana,
    recomendacao,
    acao_recomendada,
    fatores: fatores.slice(0, 6),
    score_parcelamento,
    desconto_minimo_pct,
    velocidade,
    frequencia_contato_sugerida,
  };
}

export function propensityLevelLabel(level: PropensityLevel): string {
  const map: Record<PropensityLevel, string> = {
    muito_alto: "Muito Alto",
    alto:       "Alto",
    medio:      "Médio",
    baixo:      "Baixo",
    muito_baixo: "Muito Baixo",
  };
  return map[level] ?? level;
}
