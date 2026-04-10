export type LaraRisco = "baixo" | "medio" | "alto" | "critico";
export type LaraJurisdicao = "BR" | "US" | "EU" | "UK" | "GLOBAL";
export type LaraCanal = "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO";
export type LaraNextAction =
  | "enviar_boleto"
  | "enviar_pix"
  | "registrar_promessa"
  | "negociar"
  | "escalar_humano"
  | "pausar_contato"
  | "resposta_padrao";

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
  codcli: string;
  cliente: string;
  telefone: string;
  valor: number;
  vencimento: string;
  dias_atraso: number;
  etapa_regua: string;
  status_atendimento: string;
  boleto_disponivel: boolean;
  pix_disponivel: boolean;
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
  tipo: "texto" | "boleto" | "pix" | "sistema";
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

export type LaraPagamentoTipo = "boleto" | "pix";

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
