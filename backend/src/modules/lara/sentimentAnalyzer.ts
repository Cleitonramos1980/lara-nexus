/**
 * Lara — Analisador de Sentimento Avançado em Tempo Real v2
 *
 * Detecta emoções, nível de stress, vulnerabilidade, fadiga de contato,
 * risco jurídico, sarcasmo e trajetória emocional entre mensagens.
 *
 * Híbrido: keywords locais + sinais linguísticos + análise contextual.
 * 100% offline, zero latência, zero dependências externas.
 */

import { safeText } from "./utils.js";

// ─── Tipos Públicos ───────────────────────────────────────────────────────────

export type SentimentValence = "positivo" | "neutro" | "negativo" | "critico";

export type SentimentTopic =
  | "divida_valor"        // reclamação sobre valor, juros, cobranças indevidas
  | "servico_atendimento" // reclamação sobre o atendimento recebido
  | "situacao_pessoal"    // dificuldade financeira ou pessoal
  | "risco_legal"         // ameaças jurídicas (PROCON, advogado, processo)
  | "vulnerabilidade"     // situação vulnerável (saúde, família, mental)
  | "cansaco_contato"     // fadiga — cliente saturado de mensagens
  | "resolucao_positiva"  // cliente demonstra intenção de resolver
  | "geral";

export type VulnerabilityFlag =
  | "financeira"  // desemprego, sem renda, falência
  | "medica"      // internação, doença grave, cirurgia
  | "familiar"    // luto, separação, crise familiar
  | "mental"      // sinais de sofrimento emocional severo
  | "idoso"       // aposentado/pensionista ou sinalizou idade avançada
  | "nenhuma";

export type SentimentAction =
  | "escalar_humano_urgente"      // escalação imediata (crítico / legal / vulnerável)
  | "pausar_contato_24h"          // cooling-off, retomar amanhã
  | "pausar_contato_72h"          // situação grave, aguardar 3 dias
  | "oferecer_flexibilidade"      // cliente sinaliza dificuldade → propor parcelamento
  | "enviar_mensagem_empatica"    // mude o tom antes de cobrar
  | "oferecer_desconto_especial"  // cliente na corda bamba → desconto pode converter
  | "confirmar_interesse"         // cliente positivo → fechar pagamento
  | "resposta_padrao";            // continuar fluxo normal

export type SentimentResult = {
  valence: SentimentValence;
  stress_level: 0 | 1 | 2 | 3;     // 0=calmo, 1=levemente negativo, 2=frustrado, 3=desesperado
  score: number;                      // -1.0 a +1.0
  confidence: number;                 // 0.0–1.0: confiança na análise
  keywords_detectadas: string[];
  requer_escalacao_imediata: boolean;
  risco_legal: boolean;               // PROCON, advogado, processo, denúncia
  vulnerabilidade: VulnerabilityFlag;
  fadiga_contato: boolean;            // cliente saturado de mensagens
  sarcastico: boolean;                // padrão sarcástico detectado
  topic: SentimentTopic;
  recomendacao_tom: "empático" | "neutro" | "assertivo";
  acoes_sugeridas: SentimentAction[];
};

export type SentimentHistory = {
  texto: string;
  timestamp: string;           // ISO 8601
  resultado?: SentimentResult; // pré-calculado ou calculado on-the-fly
};

export type SentimentTrajectory = {
  tendencia: "melhorando" | "estavel" | "piorando" | "critica";
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  analise_atual: SentimentResult;
};

// ─── Sinais Críticos — escalar imediatamente ──────────────────────────────────

const CRITICAL_SIGNALS = [
  // Jurídico / regulatório
  "procon", "reclame aqui", "advogado", "processo judicial", "ação judicial",
  "acao judicial", "denúncia", "denuncia", "delegacia", "polícia", "policia",
  "bacen", "banco central", "meu direito", "meus direitos", "lei do consumidor",
  "código de defesa do consumidor", "codigo de defesa do consumidor",
  "vou processar", "vou acionar", "vou denunciar", "vou reclamar",
  "juizado especial", "juizado civel", "vara cível", "vara civel",
  // Saúde mental severa
  "suicid", "me matar", "acabar com tudo", "não aguento mais", "nao aguento mais",
  "não quero mais viver", "nao quero mais viver", "quero morrer",
  "não tenho mais saída", "nao tenho mais saida", "sem esperança",
  // Situação extrema
  "desesperado", "desesperada", "desespero total", "sem saída", "sem saida",
  "internado", "internada", "hospitalizado", "hospitalizada", "uti",
  // Ameaças diretas
  "ameaça", "ameaca", "te processo", "isso é assédio", "isso e assedio",
  "abuso de cobrança", "abuso de cobranca", "constrangimento ilegal",
  // Catástrofe / violência — precisa de atendimento humano imediato
  "fui roubado", "fui assaltado", "me roubaram", "assalto", "furto",
  "enchente", "inundação", "inundacao", "casa alagou", "perdi tudo na enchente",
  "incêndio", "incendio", "casa pegou fogo", "perdi minha casa",
  "acidente grave", "baleado", "esfaqueado", "vítima de crime", "vitima de crime",
  "recuperação judicial", "recuperacao judicial", "falência", "falencia",
  "fraude bancária", "fraude bancaria", "clonaram meu cartão", "clonaram meu cartao",
  "cpf clonado", "identidade clonada",
];

// ─── Risco Legal (subconjunto de critical com implicação jurídica) ────────────

const LEGAL_RISK_SIGNALS = [
  "procon", "reclame aqui", "advogado", "processo", "ação judicial",
  "acao judicial", "denúncia", "denuncia", "delegacia", "banco central",
  "bacen", "lei do consumidor", "código de defesa", "codigo de defesa",
  "juizado", "vara cível", "vara civel", "vou processar", "vou acionar",
  "vou denunciar", "assédio de cobrança", "assedio de cobranca",
  "cobrança abusiva", "cobranca abusiva", "constrangimento",
];

// ─── Vulnerabilidade por categoria ───────────────────────────────────────────

const VULNERABILITY_SIGNALS: Record<Exclude<VulnerabilityFlag, "nenhuma">, string[]> = {
  financeira: [
    "desempregado", "desempregada", "sem emprego", "sem trabalho", "fui demitido",
    "fui demitida", "perdi o emprego", "me demitiram", "sem renda", "sem salário",
    "sem salario", "sem dinheiro nenhum", "falência", "falencia", "concordata",
    "superendividado", "superendividada", "não tenho como pagar", "nao tenho como pagar",
    "sem condições nenhuma", "sem condicoes nenhuma", "zero de dinheiro",
    "conta no vermelho", "cheque especial", "inadimplente", "cadastro negativo",
    "nome sujo", "serasa", "spc",
  ],
  medica: [
    "hospital", "internado", "internada", "internação", "internacao",
    "cirurgia", "operação", "operacao", "tratamento", "quimioterapia",
    "radioterapia", "doente", "enfermo", "doença grave", "doenca grave",
    "acidente grave", "uti", "emergência", "emergencia", "pronto socorro",
    "upa", "ame", "reabilitação", "reabilitacao", "remédio caro", "remedio caro",
    "plano de saúde", "plano de saude", "medico particular",
  ],
  familiar: [
    "falecimento", "faleceu", "morte", "morreu", "luto", "perdi minha mãe",
    "perdi meu pai", "separação", "separacao", "divórcio", "divorcio",
    "filho doente", "filha doente", "esposa doente", "marido doente",
    "família em crise", "familia em crise", "bebê doente", "bebe doente",
    "filho internado", "parente doente", "pensão alimentícia", "pensao alimenticia",
  ],
  mental: [
    "deprimido", "deprimida", "depressão", "depressao", "ansiedade",
    "crise de ansiedade", "pânico", "panico", "burnout", "esgotamento",
    "psicólogo", "psicologo", "psiquiatra", "medicamento psiquiátrico",
    "remédio para dormir", "remedio para dormir", "não consigo dormir",
    "nao consigo dormir", "estou arrasado", "estou arrasada", "crise nervosa",
  ],
  idoso: [
    "aposentado", "aposentada", "pensionista", "idoso", "idosa",
    "minha aposentadoria", "meu benefício", "meu beneficio", "inss",
    "tenho 70", "tenho 71", "tenho 72", "tenho 73", "tenho 74", "tenho 75",
    "tenho 76", "tenho 77", "tenho 78", "tenho 79", "tenho 80", "tenho 85",
    "tenho 90", "vivo de pensão", "vivo de pensao", "estatuto do idoso",
  ],
};

// ─── Fadiga de Contato ────────────────────────────────────────────────────────

const CONTACT_FATIGUE_SIGNALS = [
  "para de mandar", "para de ligar", "chega de mensagem", "chega de cobrança",
  "chega de cobranca", "toda hora", "todo dia", "várias vezes", "varias vezes",
  "me enchendo", "me encheram", "saco cheio", "cansei de receber",
  "cansei de mensagem", "cansei dessa cobrança", "cansei dessa cobranca",
  "spam", "assédio", "assedio", "já falei", "ja falei", "quantas vezes",
  "de novo mensagem", "não para de mandar", "nao para de mandar",
  "vocês não param", "voces nao param", "insistência", "insistencia",
  "me perturbando", "me incomodando", "não me ligue mais", "nao me ligue mais",
  "não mande mais", "nao mande mais", "bloqueei", "vou bloquear",
];

// ─── Sarcasmo ─────────────────────────────────────────────────────────────────

const SARCASM_SIGNALS = [
  "que maravilha", "que ótimo", "que otimo", "que surpresa", "só faltava isso",
  "so faltava isso", "tá bom né", "ta bom ne", "claro né", "claro ne",
  "muito obrigado mesmo", "que atendimento nota dez", "excelente mesmo",
  "adorei receber cobrança", "adorei receber cobranca", "parabéns hein",
  "parabens hein", "que serviço de qualidade", "que servico de qualidade",
  "que empresa maravilhosa", "muito profissional", "que surpresa agradável",
  "que surpresa agradavel", "só podia ser", "so podia ser",
];

// ─── Alta Negatividade ────────────────────────────────────────────────────────

const HIGH_NEGATIVE_SIGNALS = [
  "absurdo", "ridículo", "ridiculo", "vergonha", "incompetente", "incompetência",
  "incompetencia", "desrespeito", "abuso", "raiva", "ódio", "odio", "odeio",
  "revoltado", "revoltada", "indignado", "indignada", "cobrança indevida",
  "cobranca indevida", "não é meu", "nao e meu", "não reconheço", "nao reconheco",
  "errado isso", "pegando no meu pé", "pegando no meu pe", "me incomodando",
  "dívida demais", "divida demais", "exploração", "exploracao", "extorsão",
  "extorsao", "juros abusivos", "absurdo esse juros", "cobrança errada",
  "cobranca errada", "não é justo", "nao e justo", "injusto", "injustiça",
  "injustica", "estão me roubando", "estao me roubando", "golpe", "fraude",
  "me enganaram", "me lesaram", "cobrança duplicada", "cobranca duplicada",
  "já paguei isso", "ja paguei isso", "paguei e continuam cobrando",
  "quitei", "já quitei", "ja quitei", "esse valor tá errado", "esse valor ta errado",
  "não devo isso", "nao devo isso", "absurdo cobrar", "ridículo esse valor",
  "ridiculo esse valor",
];

// ─── Negatividade Moderada ────────────────────────────────────────────────────

const MODERATE_NEGATIVE_SIGNALS = [
  "difícil", "dificil", "complicado", "complicada", "problema",
  "não consigo", "nao consigo", "não sei", "nao sei", "estou devendo",
  "apertado", "apertada", "preocupado", "preocupada", "cansado de esperar",
  "demora", "não entendo", "nao entendo", "confuso", "confusa",
  "tá difícil", "ta dificil", "tá complicado", "ta complicado",
  "sem condições agora", "sem condicoes agora", "não posso agora", "nao posso agora",
  "prazo muito apertado", "dinheiro curto", "mês corrido", "mes corrido",
  "difícil esse mês", "dificil esse mes", "não tenho certeza", "nao tenho certeza",
  "vou tentar", "não prometo", "nao prometo", "quem sabe", "talvez",
  "depende", "preciso ver", "tá complicado agora", "ta complicado agora",
  // Informal / gírias brasileiras
  "tô sem grana", "to sem grana", "tô lascado", "to lascado", "tô ferrado",
  "to ferrado", "num consigo", "num tenho", "tô ralando", "to ralando",
  "tô na mão", "to na mão", "perrengue", "sufoco", "sufocado", "aperto",
  "na correria", "tô queimado", "to queimado", "sem margem",
];

// ─── Sinais Positivos ─────────────────────────────────────────────────────────

const POSITIVE_SIGNALS = [
  "obrigado", "obrigada", "ótimo", "otimo", "excelente", "perfeito",
  "entendido", "combinado", "vou pagar", "vou resolver", "ok", "certo",
  "entendi", "grato", "grata", "funcionou", "show", "boa", "beleza",
  "tranquilo", "tranquila", "com certeza", "pode mandar", "manda aí",
  "manda ai", "quero resolver", "quero pagar", "quero quitar",
  "aceito", "topo", "topei", "que bom", "boa opção", "boa opcao",
  "gostei", "me ajudou", "resolveu", "consegui", "boa negociação",
  "boa negociacao", "fechado", "combinei", "vou fazer isso",
  "pode deixar", "pode contar", "tô dentro", "to dentro", "farei isso",
  "vou fazer o pix", "vou pagar hoje", "vou pagar amanhã", "vou pagar amanha",
  "tá certo", "ta certo", "concordo", "sim pode ser",
];

// ─── Negações (invertem o sinal dos termos seguintes) ─────────────────────────

const NEGATION_WORDS = [
  "não", "nao", "nem", "nunca", "jamais", "de forma alguma",
  "de jeito nenhum", "de maneira alguma", "impossível", "impossivel",
];

// ─── Intensificadores (ampliam o peso) ────────────────────────────────────────

const INTENSIFIERS = [
  "muito", "demais", "extremamente", "totalmente", "completamente",
  "absurdamente", "super", "hiper", "mega", "bastante", "demasiado",
  "cada vez mais", "tô cada vez", "to cada vez",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function removeAccents(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(input: string): string {
  return removeAccents(safeText(input).toLowerCase());
}

function hasCapslockPattern(input: string): boolean {
  const words = input.split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 2) return false;
  const capsWords = words.filter((w) => w === w.toUpperCase() && /[A-Z]/.test(w));
  return capsWords.length / words.length >= 0.5;
}

function countExclamations(input: string): number {
  return (input.match(/!/g) ?? []).length;
}

function matchTerms(normalized: string, terms: string[]): string[] {
  return terms.filter((term) => normalized.includes(removeAccents(term.toLowerCase())));
}

function hasNegationBefore(normalized: string, term: string): boolean {
  const idx = normalized.indexOf(removeAccents(term.toLowerCase()));
  if (idx < 0) return false;
  const before = normalized.slice(Math.max(0, idx - 35), idx);
  return NEGATION_WORDS.some((neg) => before.includes(removeAccents(neg)));
}

function hasIntensifierBefore(normalized: string, term: string): boolean {
  const idx = normalized.indexOf(removeAccents(term.toLowerCase()));
  if (idx < 0) return false;
  const before = normalized.slice(Math.max(0, idx - 35), idx);
  return INTENSIFIERS.some((int) => before.includes(removeAccents(int)));
}

function detectVulnerability(normalized: string): VulnerabilityFlag {
  for (const [flag, signals] of Object.entries(VULNERABILITY_SIGNALS)) {
    if (signals.some((s) => normalized.includes(removeAccents(s.toLowerCase())))) {
      return flag as VulnerabilityFlag;
    }
  }
  return "nenhuma";
}

function detectTopic(opts: {
  normalized: string;
  criticalMatches: string[];
  highNegativeMatches: string[];
  vulnerabilidade: VulnerabilityFlag;
  legalRisk: boolean;
  fadiga: boolean;
  positiveMatches: string[];
}): SentimentTopic {
  const { normalized, highNegativeMatches, vulnerabilidade, legalRisk, fadiga, positiveMatches } = opts;
  if (legalRisk) return "risco_legal";
  if (vulnerabilidade !== "nenhuma") return "vulnerabilidade";
  if (fadiga) return "cansaco_contato";
  if (positiveMatches.length > 2 && highNegativeMatches.length === 0) return "resolucao_positiva";
  const serviceTerms = ["absurdo", "ridiculo", "vergonha", "incompetente", "abuso", "desrespeito"];
  if (highNegativeMatches.some((k) => serviceTerms.some((t) => k.includes(t)))) return "servico_atendimento";
  if (normalized.includes("valor") || normalized.includes("juros") || normalized.includes("divida") || normalized.includes("cobran")) return "divida_valor";
  if (vulnerabilidade !== "nenhuma") return "situacao_pessoal";
  return "geral";
}

function buildAcoes(opts: {
  valence: SentimentValence;
  requer_escalacao_imediata: boolean;
  vulnerabilidade: VulnerabilityFlag;
  fadiga_contato: boolean;
  risco_legal: boolean;
  stress_level: 0 | 1 | 2 | 3;
  score: number;
}): SentimentAction[] {
  const { valence, requer_escalacao_imediata, vulnerabilidade, fadiga_contato, risco_legal, stress_level, score } = opts;
  const acoes = new Set<SentimentAction>();

  if (requer_escalacao_imediata || risco_legal) {
    acoes.add("escalar_humano_urgente");
    return Array.from(acoes);
  }

  if (vulnerabilidade !== "nenhuma") {
    acoes.add("escalar_humano_urgente");
    acoes.add("pausar_contato_72h");
    return Array.from(acoes);
  }

  if (fadiga_contato) {
    acoes.add("pausar_contato_24h");
    acoes.add("enviar_mensagem_empatica");
    return Array.from(acoes);
  }

  if (stress_level === 3) acoes.add("pausar_contato_24h");
  if (stress_level >= 2) {
    acoes.add("enviar_mensagem_empatica");
    acoes.add("oferecer_flexibilidade");
  }
  if (valence === "negativo" && score < -0.3) acoes.add("oferecer_desconto_especial");
  if (valence === "positivo" || score > 0.2) acoes.add("confirmar_interesse");
  if (acoes.size === 0) acoes.add("resposta_padrao");

  return Array.from(acoes);
}

// ─── Função Principal ─────────────────────────────────────────────────────────

export function analyzeSentiment(messageText: string): SentimentResult {
  const raw = safeText(messageText);
  const normalized = normalizeText(raw);

  const criticalMatches = matchTerms(normalized, CRITICAL_SIGNALS);
  const legalMatches = matchTerms(normalized, LEGAL_RISK_SIGNALS);
  const highNegativeMatches = matchTerms(normalized, HIGH_NEGATIVE_SIGNALS);
  const moderateNegativeMatches = matchTerms(normalized, MODERATE_NEGATIVE_SIGNALS);
  const positiveMatches = matchTerms(normalized, POSITIVE_SIGNALS);
  const fatigaMatches = matchTerms(normalized, CONTACT_FATIGUE_SIGNALS);
  const sarcasmMatches = matchTerms(normalized, SARCASM_SIGNALS);

  const hasAllCaps = hasCapslockPattern(raw);
  const exclamationCount = countExclamations(raw);
  const risco_legal = legalMatches.length > 0;
  const fadiga_contato = fatigaMatches.length > 0;
  const sarcastico = sarcasmMatches.length > 0;
  const vulnerabilidade = detectVulnerability(normalized);

  // Positivos negados não contam ("não vou pagar" ≠ sinal positivo)
  const genuinePositiveMatches = positiveMatches.filter(
    (term) => !hasNegationBefore(normalized, term),
  );

  // Score com amplificação por intensificadores
  let score = 0;

  for (const term of criticalMatches) {
    score -= 0.5 * (hasIntensifierBefore(normalized, term) ? 1.4 : 1.0);
  }
  for (const term of highNegativeMatches) {
    score -= 0.25 * (hasIntensifierBefore(normalized, term) ? 1.4 : 1.0);
  }
  for (const term of moderateNegativeMatches) {
    score -= 0.1 * (hasIntensifierBefore(normalized, term) ? 1.3 : 1.0);
  }
  for (const _term of genuinePositiveMatches) {
    score += 0.15;
  }

  if (sarcastico) score -= 0.2;
  if (fadiga_contato) score -= 0.3;
  if (hasAllCaps) score -= 0.2;
  if (exclamationCount >= 3) score -= 0.15;
  if (exclamationCount >= 5) score -= 0.1;

  score = Math.max(-1, Math.min(1, score));

  const keywords_detectadas = [
    ...criticalMatches,
    ...legalMatches.slice(0, 2),
    ...highNegativeMatches.slice(0, 3),
    ...moderateNegativeMatches.slice(0, 2),
    ...fatigaMatches.slice(0, 1),
    ...sarcasmMatches.slice(0, 1),
    ...genuinePositiveMatches.slice(0, 2),
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 10);

  const requer_escalacao_imediata = criticalMatches.length > 0 || vulnerabilidade === "mental";

  let stress_level: 0 | 1 | 2 | 3 = 0;
  if (requer_escalacao_imediata || score < -0.6 || vulnerabilidade !== "nenhuma") {
    stress_level = 3;
  } else if (score < -0.3 || highNegativeMatches.length > 0 || fadiga_contato) {
    stress_level = 2;
  } else if (score < -0.1 || moderateNegativeMatches.length > 0) {
    stress_level = 1;
  }

  let valence: SentimentValence;
  if (stress_level === 3 || requer_escalacao_imediata) {
    valence = "critico";
  } else if (stress_level === 2) {
    valence = "negativo";
  } else if (score > 0.1 && genuinePositiveMatches.length > 0) {
    valence = "positivo";
  } else if (stress_level === 1 || score < -0.05) {
    valence = "negativo";
  } else {
    valence = "neutro";
  }

  let recomendacao_tom: "empático" | "neutro" | "assertivo";
  if (stress_level >= 2 || requer_escalacao_imediata || vulnerabilidade !== "nenhuma") {
    recomendacao_tom = "empático";
  } else if (valence === "positivo") {
    recomendacao_tom = "assertivo";
  } else {
    recomendacao_tom = "neutro";
  }

  const topic = detectTopic({
    normalized,
    criticalMatches,
    highNegativeMatches,
    vulnerabilidade,
    legalRisk: risco_legal,
    fadiga: fadiga_contato,
    positiveMatches: genuinePositiveMatches,
  });

  const totalSignals =
    criticalMatches.length +
    highNegativeMatches.length +
    moderateNegativeMatches.length +
    genuinePositiveMatches.length +
    fatigaMatches.length;
  const confidence = Math.min(
    0.95,
    0.4 + totalSignals * 0.1 + (hasAllCaps ? 0.1 : 0) + (exclamationCount > 0 ? 0.05 : 0),
  );

  const acoes_sugeridas = buildAcoes({
    valence,
    requer_escalacao_imediata,
    vulnerabilidade,
    fadiga_contato,
    risco_legal,
    stress_level,
    score,
  });

  return {
    valence,
    stress_level,
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    keywords_detectadas,
    requer_escalacao_imediata,
    risco_legal,
    vulnerabilidade,
    fadiga_contato,
    sarcastico,
    topic,
    recomendacao_tom,
    acoes_sugeridas,
  };
}

// ─── Análise de Trajetória Emocional ─────────────────────────────────────────

export function analyzeSentimentHistory(messages: SentimentHistory[]): SentimentTrajectory {
  if (messages.length === 0) {
    const empty = analyzeSentiment("");
    return { tendencia: "estavel", score_atual: 0, score_anterior: null, delta: 0, analise_atual: empty };
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const analyzed = sorted.map((m) => ({
    ...m,
    resultado: m.resultado ?? analyzeSentiment(m.texto),
  }));

  const latest = analyzed[analyzed.length - 1].resultado!;
  const previous = analyzed.length > 1 ? analyzed[analyzed.length - 2].resultado! : null;

  const scoreAtual = latest.score;
  const scoreAnterior = previous?.score ?? null;
  const delta = scoreAnterior !== null ? scoreAtual - scoreAnterior : 0;

  let tendencia: SentimentTrajectory["tendencia"];
  if (latest.requer_escalacao_imediata || latest.valence === "critico") {
    tendencia = "critica";
  } else if (scoreAnterior === null) {
    tendencia = "estavel";
  } else if (delta > 0.15) {
    tendencia = "melhorando";
  } else if (delta < -0.15) {
    tendencia = "piorando";
  } else {
    tendencia = "estavel";
  }

  return {
    tendencia,
    score_atual: Math.round(scoreAtual * 1000) / 1000,
    score_anterior: scoreAnterior !== null ? Math.round(scoreAnterior * 1000) / 1000 : null,
    delta: Math.round(delta * 1000) / 1000,
    analise_atual: latest,
  };
}
