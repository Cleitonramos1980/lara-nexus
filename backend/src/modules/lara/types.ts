export type LaraRisco = "baixo" | "medio" | "alto" | "critico";
export type LaraJurisdicao = "BR" | "US" | "EU" | "UK" | "GLOBAL";
export type LaraCanal = "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO";
export type LaraNextAction =
  | "enviar_boleto"
  | "enviar_pix"
  | "apresentar_opcoes_pagamento"
  | "registrar_promessa"
  | "negociar_autonomamente"
  | "negociar"
  | "escalar_humano"
  | "pausar_contato"
  | "resposta_padrao";

export type LaraSentimentValence = "positivo" | "neutro" | "negativo" | "critico";

export type LaraVulnerabilityFlag = "financeira" | "medica" | "familiar" | "mental" | "idoso" | "nenhuma";

export type LaraSentimentTopic =
  | "divida_valor"
  | "servico_atendimento"
  | "situacao_pessoal"
  | "risco_legal"
  | "vulnerabilidade"
  | "cansaco_contato"
  | "resolucao_positiva"
  | "geral";

export type LaraSentimentAction =
  | "escalar_humano_urgente"
  | "pausar_contato_24h"
  | "pausar_contato_72h"
  | "oferecer_flexibilidade"
  | "enviar_mensagem_empatica"
  | "oferecer_desconto_especial"
  | "confirmar_interesse"
  | "resposta_padrao";

export interface LaraSentimentResult {
  valence: LaraSentimentValence;
  stress_level: 0 | 1 | 2 | 3;
  score: number;
  confidence?: number;
  keywords_detectadas: string[];
  requer_escalacao_imediata: boolean;
  risco_legal?: boolean;
  vulnerabilidade?: LaraVulnerabilityFlag;
  fadiga_contato?: boolean;
  sarcastico?: boolean;
  topic?: LaraSentimentTopic;
  recomendacao_tom: "empático" | "neutro" | "assertivo";
  acoes_sugeridas?: LaraSentimentAction[];
}

export type LaraPropensityLevel = "muito_alto" | "alto" | "medio" | "baixo" | "muito_baixo";

export type LaraPropensityAction =
  | "cobrar_direto"
  | "oferecer_parcelamento"
  | "oferecer_desconto"
  | "abordagem_empatica"
  | "pausar_e_aguardar"
  | "escalar_negociador";

export interface LaraPropensityScore {
  score: number;
  level: LaraPropensityLevel;
  confidence?: number;
  melhor_canal: LaraCanal;
  melhor_hora: number;
  melhor_dia_semana?: number;
  recomendacao: string;
  acao_recomendada?: LaraPropensityAction;
  fatores: string[];
  score_parcelamento?: number;
  desconto_minimo_pct?: number;
  velocidade?: "subindo" | "estavel" | "caindo" | "desconhecida";
  frequencia_contato_sugerida?: "diaria" | "2x_semana" | "semanal" | "quinzenal" | "pausar";
  calculado_em: string;
}

export interface LaraPoliticaNegociacao {
  id: string;
  etapa_regua: string;
  desconto_maximo_pct: number;
  parcelas_maximas: number;
  entrada_minima_pct: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface LaraFeedbackInteracao {
  id: string;
  wa_id: string;
  codcli: string;
  etapa: string;
  acao: string;
  canal: LaraCanal;
  hora_envio: number;
  resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
  tempo_resposta_min?: number;
  created_at: string;
}

export interface LaraPortalToken {
  token: string;
  codcli: number;
  wa_id: string;
  valido_ate: string;
  criado_em: string;
  usado: boolean;
}

export interface LaraCliente {
  codcli: string;
  cliente: string;
  telefone: string;
  wa_id: string;
  cpf_cnpj: string;
  filial: string;
  total_aberto: number;
  qtd_titulos: number;
  titulo_mais_antigo: string;
  proximo_vencimento: string;
  ultimo_contato: string;
  ultima_acao: string;
  proxima_acao: string;
  optout: boolean;
  etapa_regua: string;
  status: string;
  responsavel: string;
  risco: LaraRisco;
}

export interface LaraTitulo {
  id: string;
  duplicata: string;
  prestacao: string;
  numtransvenda: number;
  numnota: number;
  codcli: string;
  cliente: string;
  fantasia: string;
  telefone: string;
  valor: number;
  vlreceber: number;
  vldesc: number;
  cmulta_prev: number;
  percmulta: number;
  vencimento: string;
  dtemissao: string;
  dtrecebimento_previsto: string;
  dias_atraso: number;
  codcob: string;
  cobranca: string;
  rca: string;
  etapa_regua: string;
  status_atendimento: string;
  boleto_disponivel: boolean;
  pix_disponivel: boolean;
  titulo_com_data_prevista: boolean;
  ultima_acao: string;
  responsavel: string;
  filial: string;
}

export interface LaraAtendimento {
  id: string;
  codcli: string;
  cliente: string;
  telefone: string;
  wa_id: string;
  status: string;
  origem: string;
  ultima_mensagem: string;
  ultima_interacao: string;
  etapa: string;
  qtd_titulos: number;
  boleto_enviado: boolean;
  promessa: boolean;
  optout: boolean;
}

export interface LaraCaseItem {
  id: string;
  data_hora: string;
  cliente: string;
  codcli: string;
  wa_id: string;
  acao: string;
  etapa: string;
  duplicatas: string;
  valor_total: number;
  forma_pagamento: string;
  origem: string;
  responsavel: string;
  detalhe: string;
  status: string;
}

export type LaraLogSeveridade = "sucesso" | "aviso" | "erro" | "bloqueado";

export interface LaraLogItem {
  id: string;
  data_hora: string;
  tipo: string;
  modulo: string;
  cliente: string;
  wa_id: string;
  codcli: string;
  etapa: string;
  mensagem: string;
  severidade: LaraLogSeveridade;
  status: string;
  origem: string;
}

export interface LaraOptoutItem {
  id: string;
  wa_id: string;
  codcli: string;
  cliente: string;
  motivo: string;
  ativo: boolean;
  data_criacao: string;
  data_atualizacao: string;
  origem: string;
  observacao: string;
}

export interface LaraMensagem {
  id: string;
  remetente: "lara" | "cliente";
  texto: string;
  data_hora: string;
  tipo: "texto" | "boleto" | "pix" | "bolepix" | "sistema";
  operador?: string;
}

export interface LaraConversa {
  id: string;
  codcli: string;
  cliente: string;
  telefone: string;
  wa_id: string;
  status: string;
  etapa: string;
  origem: string;
  inicio: string;
  ultima_interacao: string;
  total_mensagens: number;
  mensagens: LaraMensagem[];
  encerrada: boolean;
  responsavel: string;
}

export interface LaraReguaEtapa {
  etapa: string;
  elegivel: number;
  enviado: number;
  respondido: number;
  convertido: number;
  erro: number;
  bloqueado_optout: number;
  taxa_resposta: number;
  taxa_recuperacao: number;
}

export interface LaraReguaExecucao {
  id: string;
  data_hora: string;
  etapa: string;
  elegivel: number;
  disparada: number;
  erro: number;
  respondida: number;
  convertida: number;
  bloqueado_optout: number;
  valor_impactado: number;
  status: string;
}

export interface LaraReguaTemplate {
  id: string;
  etapa: string;
  nome_template: string;
  canal: string;
  mensagem_template: string;
  ativo: boolean;
  ordem_execucao: number;
  created_at: string;
  updated_at: string;
}

export interface LaraConfiguracao {
  id: string;
  chave: string;
  valor: string;
  descricao: string;
  updated_at: string;
}

export interface LaraWebhookResponse {
  status: "ok" | "erro" | "duplicado";
  mensagem: string;
  acao: string;
  codcli?: string;
  wa_id: string;
  cliente?: string;
  payload_whatsapp?: Record<string, unknown>;
  escalado?: boolean;
  compliance?: {
    permitido: boolean;
    razao: string;
    base_legal: string;
    revisao_humana_disponivel: boolean;
    score_confianca?: number;
  };
}

export type LaraPagamentoTipo = "boleto" | "pix" | "bolepix";

export interface LaraPagedResult<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
}

export interface LaraComplianceAuditItem {
  id: string;
  data_hora: string;
  wa_id: string;
  codcli: string;
  tenant_id: string;
  jurisdicao: LaraJurisdicao;
  canal: LaraCanal;
  acao: LaraNextAction | "bloqueado_politica";
  intencao: string;
  score_confianca: number;
  permitido: boolean;
  base_legal: string;
  razao_automatizada: string;
  revisao_humana_disponivel: boolean;
  detalhes: Record<string, unknown>;
}

export interface LaraWinthorBoleto {
  codcli: string;
  cliente: string;
  codfilial: string;
  numtransvenda: number;
  duplicata: string;
  prestacao: string;
  codcob: string;
  codbanco: number;
  numdias_prazo_protesto: number;
  valor: number;
  dtvenc: string;
  nossonumbco: string;
  codbarra: string;
  linhadig: string;
  boleto_disponivel: boolean;
}

export interface LaraNegociacaoItem {
  id: string;
  codcli: string;
  wa_id: string;
  filial: string;
  duplicata: string;
  prestacao: string;
  numtransvenda: number;
  dtvenc_original: string;
  dtvenc_prorrogada: string;
  valor_original: number;
  valor_negociado: number;
  tipo_negociacao: string;
  status_negociacao: string;
  proxima_cobranca_em: string;
  origem: string;
  observacao: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}
