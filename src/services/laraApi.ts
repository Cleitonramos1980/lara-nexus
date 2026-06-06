import type {
  Atendimento,
  CaseItem,
  Cliente,
  Conversa,
  LogItem,
  OptoutItem,
  ReguaEtapa,
  ReguaExecucao,
  Titulo,
} from "@/data/lara-mock";

type JsonBody = Record<string, unknown> | Array<unknown> | undefined;
type QueryValuePrimitive = string | number | boolean | null | undefined;
type QueryValue = QueryValuePrimitive | QueryValuePrimitive[];
type QueryParams = Record<string, QueryValue>;

const API_BASE = (import.meta.env.VITE_LARA_API_BASE_URL || "/api").replace(/\/+$/, "");
const API_KEY = String(import.meta.env.VITE_LARA_API_KEY || "").trim();

function withQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
      if (values.length === 0) continue;
      params.set(key, values.join(","));
      continue;
    }
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    params.set(key, String(rawValue));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function apiRequest<T>(path: string, init?: RequestInit & { json?: JsonBody }): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (API_KEY) headers.set("x-lara-api-key", API_KEY);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });

  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const payload = await response.json();
      const maybeMessage = payload?.error?.message || payload?.message;
      if (typeof maybeMessage === "string" && maybeMessage.trim()) message = maybeMessage.trim();
    } catch {
      // noop
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const laraRequest = apiRequest;

export type LaraDashboardResponse = {
  kpis: {
    totalAberto: number;
    clientesAberto: number;
    boletoEnviados: number;
    interacoesHoje: number;
    promessas: number;
    optouts: number;
    reguaAtiva: number;
    taxaResposta: number;
    valorRecuperado: number;
    vencendoHoje?: number;
    vencidoMaisTrintaDias?: number;
  };
  faixaAtraso: Array<{ faixa: string; valor: number }>;
  statusPie: Array<{ name: string; value: number }>;
  reguaEtapas: ReguaEtapa[];
  topClientes: Cliente[];
  alertas: Array<{ type: string; title: string; description: string }>;
  classificador?: {
    total_classificacoes: number;
    openai_usado: number;
    fallback_local: number;
    circuito_aberto_eventos: number;
    acuracia_estimada_media: number;
    intents: Array<{
      intent: string;
      total: number;
      openai: number;
      fallback: number;
      acuracia_media: number;
    }>;
  };
};

export function getDashboard(filters?: { filial?: string; filiais?: string[]; canal?: string }) {
  return apiRequest<LaraDashboardResponse>(withQuery("/lara/dashboard", {
    filial: filters?.filial,
    filiais: filters?.filiais,
    canal: filters?.canal,
  }));
}

export function getFiliais() {
  return apiRequest<string[]>("/lara/filiais");
}

export function getAtendimentos(filters?: {
  search?: string;
  filial?: string;
  filiais?: string[];
  status?: string;
  origem?: string;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<Atendimento[]>(withQuery("/lara/atendimentos", filters));
}

export function getConversas(filters?: {
  search?: string;
  filial?: string;
  filiais?: string[];
  canal?: string;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<Conversa[]>(withQuery("/lara/conversas", filters));
}

export function getConversa(waId: string) {
  return apiRequest<Conversa>(`/lara/conversas/${encodeURIComponent(waId)}`);
}

export function getClientes(filters?: {
  search?: string;
  filial?: string;
  filiais?: string[];
  risco?: "baixo" | "medio" | "alto" | "critico";
  optout?: boolean;
  limit?: number;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<Cliente[]>(withQuery("/lara/clientes", filters));
}

export function getCliente(codcli: string | number) {
  return apiRequest<Cliente>(`/lara/clientes/${encodeURIComponent(String(codcli))}`);
}

export function getClienteTitulos(codcli: string | number) {
  return apiRequest<Titulo[]>(`/lara/clientes/${encodeURIComponent(String(codcli))}/titulos`);
}

export function getClienteConversas(codcli: string | number) {
  return apiRequest<Conversa[]>(`/lara/clientes/${encodeURIComponent(String(codcli))}/conversas`);
}

export function getClienteCases(codcli: string | number) {
  return apiRequest<CaseItem[]>(`/lara/clientes/${encodeURIComponent(String(codcli))}/cases`);
}

export function getTitulos(filters?: {
  search?: string;
  codcli?: number;
  etapa?: string;
  filial?: string;
  filiais?: string[];
  atrasoMin?: number;
  atrasoMax?: number;
  somenteAbertos?: boolean;
  limit?: number;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<Titulo[]>(withQuery("/lara/titulos", filters));
}

export function getTitulo(id: string) {
  return apiRequest<Titulo>(`/lara/titulos/${encodeURIComponent(id)}`);
}

export function recarregarTitulosOracle(payload?: { codcli?: number; limit?: number; includeDesd?: boolean }) {
  return apiRequest<{
    totalTitulos: number;
    totalClientes: number;
    codcliAfetados: string[];
  }>("/lara/titulos/recarregar-oracle", {
    method: "POST",
    json: payload ?? {},
  });
}

export function processarMensagem(payload: {
  event_id?: string;
  wa_id: string;
  telefone?: string;
  codcli?: number;
  message_text: string;
  origem?: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/atendimentos/processar-mensagem", {
    method: "POST",
    json: payload,
  });
}

export function escalarAtendimento(payload: {
  wa_id: string;
  codcli?: number;
  cliente?: string;
  detalhe: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/atendimentos/escalar", {
    method: "POST",
    json: payload,
  });
}

export function enviarBoleto(payload: {
  wa_id?: string;
  codcli: number;
  duplicatas?: string[];
  origem?: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/pagamentos/boleto", {
    method: "POST",
    json: payload,
  });
}

export function enviarPix(payload: {
  wa_id?: string;
  codcli: number;
  duplicatas?: string[];
  origem?: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/pagamentos/pix", {
    method: "POST",
    json: payload,
  });
}

export function registrarPromessa(payload: {
  wa_id?: string;
  codcli: number;
  duplicatas?: string[];
  valor_total?: number;
  data_prometida: string;
  origem?: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/pagamentos/promessa", {
    method: "POST",
    json: payload,
  });
}

export function getReguaAtiva() {
  return apiRequest<{
    etapas: ReguaEtapa[];
    totalElegivel: number;
    totalRespondido: number;
    totalConvertido: number;
    totalErro: number;
    execucoes: ReguaExecucao[];
  }>("/lara/regua/ativa");
}

export function getReguaConfig() {
  return apiRequest<{
    templates: Array<{
      id: string;
      etapa: string;
      nome_template: string;
      canal: string;
      mensagem_template: string;
      ativo: boolean;
      ordem_execucao: number;
      created_at: string;
      updated_at: string;
    }>;
    configuracoes: Array<{
      id: string;
      chave: string;
      valor: string;
      descricao: string;
      updated_at: string;
    }>;
  }>("/lara/regua/config");
}

export function saveReguaConfig(payload: {
  templates?: Array<{
    id?: string;
    etapa: string;
    nome_template: string;
    canal: string;
    mensagem_template: string;
    ativo: boolean;
    ordem_execucao: number;
  }>;
  configuracoes?: Array<{ chave: string; valor: string; descricao?: string }>;
}) {
  return apiRequest<Record<string, unknown>>("/lara/regua/config", {
    method: "PUT",
    json: payload,
  });
}

export function getReguaExecucoes() {
  return apiRequest<ReguaExecucao[]>("/lara/regua/execucoes");
}

export function dispararReguaTeste(payload: {
  etapa: string;
  elegivel: number;
  disparada: number;
  respondida: number;
  convertida: number;
  erro: number;
  bloqueado_optout: number;
  valor_impactado: number;
}) {
  return apiRequest<Record<string, unknown>>("/lara/regua/disparar-teste", {
    method: "POST",
    json: payload,
  });
}

export function getCases(filters?: {
  search?: string;
  filial?: string;
  filiais?: string[];
  tipo_case?: string;
  status?: string;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<CaseItem[]>(withQuery("/lara/cases", filters));
}

export function createCase(payload: {
  wa_id?: string;
  codcli?: number;
  cliente?: string;
  tipo_case: string;
  detalhe: string;
  origem?: string;
  responsavel?: string;
}) {
  return apiRequest<Record<string, unknown>>("/lara/cases", {
    method: "POST",
    json: payload,
  });
}

export function getOptouts(filters?: {
  search?: string;
  filial?: string;
  filiais?: string[];
  ativo?: boolean;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<OptoutItem[]>(withQuery("/lara/optout", filters));
}

export function setOptout(payload: {
  wa_id: string;
  codcli?: number;
  cliente?: string;
  motivo: string;
  origem?: string;
  observacao?: string;
  ativo?: boolean;
}) {
  return apiRequest<Record<string, unknown>>("/lara/optout", {
    method: "POST",
    json: payload,
  });
}

export function disableOptout(id: string) {
  return apiRequest<Record<string, unknown>>(`/lara/optout/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export type PromessaItem = {
  id: string;
  wa_id: string;
  codcli: number | null;
  cliente: string;
  duplicatas: string;
  valor_total: number;
  data_prometida: string | null;
  observacao: string;
  status: string;
  origem: string;
  created_at: string;
  updated_at: string;
};

export function getPromessas(filters?: { limit?: number }) {
  return apiRequest<PromessaItem[]>(withQuery("/lara/promessas", filters));
}

export function getLogs(filters?: {
  limit?: number;
  search?: string;
  filial?: string;
  filiais?: string[];
  tipo?: string;
  severidade?: string;
  page_size?: number;
  cursor?: string;
}) {
  return apiRequest<LogItem[]>(withQuery("/lara/logs", filters));
}

export function getConfiguracoes() {
  return apiRequest<{
    templates?: Array<unknown>;
    configuracoes?: Array<{ id: string; chave: string; valor: string; descricao: string; updated_at: string }>;
  }>("/lara/regua/config")
    .then((data) => data.configuracoes ?? []);
}

export function saveConfiguracoes(payload: Array<{ chave: string; valor: string; descricao?: string }>) {
  return saveReguaConfig({
    configuracoes: payload,
  });
}

export function getMonitoramentoHealth() {
  return apiRequest<{
    componentes: Array<{ label: string; status: string; detail: string }>;
  }>("/lara/monitoramento/health");
}

export function getMonitoramentoResumo() {
  return apiRequest<{
    mensagens_enviadas?: number;
    mensagens_recebidas?: number;
    promessas_registradas?: number;
    optouts_ativos?: number;
    casos_escalados?: number;
    sincronizacao_diaria_ok_hoje?: number;
    falhas_sincronizacao_hoje?: number;
    fila_pendente?: number;
    erros_integracao?: number;
    clientes_risco_critico?: number;
    valor_total_aberto?: number;
    classificador_total_classificacoes?: number;
    classificador_openai_usado?: number;
    classificador_fallback_local?: number;
    classificador_circuito_aberto_eventos?: number;
    classificador_acuracia_estimada_media?: number;
    classificador_por_intent?: Array<{
      intent: string;
      total: number;
      openai: number;
      fallback: number;
      acuracia_media: number;
    }>;
  }>("/lara/monitoramento/resumo-operacional");
}

export function getSincronizacaoUltima() {
  return apiRequest<{
    configuracao: {
      ativo: boolean;
      hora: number;
      minuto: number;
      timezone: string;
      limit: number;
      includeDesd: boolean;
      startupRun: boolean;
    };
    ultima_execucao: null | {
      status: string;
      data_hora: string;
      total_titulos?: number;
      total_clientes?: number;
      titulos_removidos?: number;
      clientes_removidos?: number;
      erro?: string;
    };
  }>("/lara/sincronizacao/ultima");
}

export function updateJanelaSincronizacao(payload: {
  ativo?: boolean;
  hora?: number;
  minuto?: number;
  timezone?: string;
  limit?: number;
  includeDesd?: boolean;
  startupRun?: boolean;
}) {
  return apiRequest<{
    configuracao: {
      ativo: boolean;
      hora: number;
      minuto: number;
      timezone: string;
      limit: number;
      includeDesd: boolean;
      startupRun: boolean;
    };
    ultima_execucao: null | {
      status: string;
      data_hora: string;
      total_titulos?: number;
      total_clientes?: number;
      titulos_removidos?: number;
      clientes_removidos?: number;
      erro?: string;
    };
  }>("/lara/sincronizacao/janela", {
    method: "PUT",
    json: payload,
  });
}

// ── Análise de Sentimento ────────────────────────────────────────────────────

export async function analisarSentimento(messageText: string) {
  return laraRequest<{
    valence: string;
    stress_level: number;
    score: number;
    keywords_detectadas: string[];
    requer_escalacao_imediata: boolean;
    recomendacao_tom: string;
  }>("/lara/analise/sentimento", { method: "POST", json: { message_text: messageText } });
}

export async function getSentimentoConversa(waId: string) {
  return laraRequest<{
    sentimento_geral: { score: number; stress_level: number; requer_atencao: boolean } | null;
    mensagens_analisadas: number;
    historico: Array<{ texto: string; data: string; sentimento: Record<string, unknown> }>;
  }>(`/lara/conversas/${encodeURIComponent(waId)}/sentimento`);
}

// ── Score de Propensão ───────────────────────────────────────────────────────

export async function getPropensityScore(codcli: string | number) {
  return laraRequest<{
    score: number;
    level: string;
    melhor_canal: string;
    melhor_hora: number;
    recomendacao: string;
    fatores: string[];
    calculado_em: string;
  }>(`/lara/clientes/${codcli}/propensity`);
}

// ── Negociação Autônoma ──────────────────────────────────────────────────────

export async function getPoliticasNegociacao() {
  return laraRequest<Array<{
    etapa_regua: string;
    desconto_maximo_pct: number;
    parcelas_maximas: number;
    entrada_minima_pct: number;
    ativo: boolean;
  }>>("/lara/negociacao/politicas");
}

export async function salvarPoliticaNegociacao(etapa: string, politica: {
  desconto_maximo_pct: number;
  parcelas_maximas: number;
  entrada_minima_pct: number;
  ativo: boolean;
}) {
  return laraRequest<{ ok: boolean }>(`/lara/negociacao/politicas/${encodeURIComponent(etapa)}`, {
    method: "PUT",
    json: politica,
  });
}

export async function simularNegociacao(codcli: number, duplicatas?: string[]) {
  return laraRequest<{
    pode_negociar: boolean;
    motivo_bloqueio?: string;
    mensagem_apresentacao?: string;
    propostas?: Array<{
      tipo: string;
      desconto_pct: number;
      valor_original: number;
      valor_com_desconto: number;
      entrada: number;
      parcelas: number;
      valor_parcela: number;
      mensagem_oferta: string;
    }>;
  }>("/lara/negociacao/simular", { method: "POST", json: { codcli, duplicatas } });
}

export type NegociacaoHistoricoItem = {
  id: string;
  codcli: string;
  wa_id: string;
  filial?: string;
  duplicata?: string;
  valor_original?: number;
  valor_negociado?: number;
  tipo_negociacao?: string;
  status_negociacao?: string;
  origem?: string;
  observacao?: string;
  created_at: string;
};

export async function getNegociacaoHistorico(params?: { limit?: number; codcli?: number }) {
  return laraRequest<NegociacaoHistoricoItem[]>(withQuery("/lara/negociacao/historico", params));
}

// ── Portal Self-Service ──────────────────────────────────────────────────────

export async function gerarPortalToken(codcli: number, wa_id?: string) {
  return laraRequest<{
    token: string;
    valido_ate: string;
    link_portal: string;
    codcli: string;
    cliente: string;
  }>("/lara/portal/gerar-token", { method: "POST", json: { codcli, wa_id } });
}

// ── Alertas Inteligentes ─────────────────────────────────────────────────────

export async function getAlertasInteligentes(filial?: string) {
  const params = filial ? `?filial=${encodeURIComponent(filial)}` : "";
  return laraRequest<{
    total: number;
    criticos: number;
    avisos: number;
    infos: number;
    alertas: Array<{ tipo: string; titulo: string; descricao: string; valor?: number }>;
    gerado_em: string;
  }>(`/lara/dashboard/alertas${params}`);
}

// ── Feedback de Interações ───────────────────────────────────────────────────

export async function registrarFeedback(data: {
  wa_id: string;
  codcli?: string;
  etapa?: string;
  acao: string;
  canal?: string;
  hora_envio: number;
  resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
  tempo_resposta_min?: number;
}) {
  return laraRequest<{ ok: boolean; resultado: string }>("/lara/feedback/registrar", {
    method: "POST",
    json: data,
  });
}

export async function getInsightsFeedback(etapa?: string, dias = 30) {
  const params = new URLSearchParams();
  if (etapa) params.set("etapa", etapa);
  params.set("dias", String(dias));
  return laraRequest<{
    periodo_dias: number;
    total_interacoes: number;
    taxa_conversao: number;
    por_resultado: Record<string, number>;
    melhores_horas: Array<{ hora: number; taxa: number }>;
  }>(`/lara/feedback/insights?${params}`);
}

// ── Dashboard Preditivo ──────────────────────────────────────────────────────

export async function getDashboardPreditivo(filial?: string) {
  return laraRequest<{
    clientes_risco_alto: number;
    clientes_risco_critico: number;
    valor_em_risco: number;
    previsao_recuperacao_7d: number;
    previsao_recuperacao_30d: number;
    score_medio_carteira: number;
    top_clientes_risco: Array<{
      codcli: string;
      cliente: string;
      score: number;
      valor_aberto: number;
      melhor_canal: string;
      melhor_hora: number;
    }>;
    distribuicao_scores: Array<{ faixa: string; quantidade: number }>;
    tendencia_conversao: Array<{ data: string; taxa: number }>;
    gerado_em: string;
  }>(withQuery("/lara/dashboard/preditivo", { filial }));
}

// ── A/B Test por Etapa ───────────────────────────────────────────────────────

export async function getAbTestEtapa(etapa: string) {
  return laraRequest<{
    etapa: string;
    variantes: Array<{
      variante: string;
      template_id: string;
      nome_template: string;
      total_disparos: number;
      total_respostas: number;
      total_pagamentos: number;
      taxa_resposta: number;
      taxa_conversao: number;
      vencedor: boolean;
    }>;
  }>(`/lara/regua/ab-test/${encodeURIComponent(etapa)}`);
}

// ── Escalar com Contexto ─────────────────────────────────────────────────────

export async function escalarComContexto(input: {
  wa_id: string;
  codcli?: number;
  cliente?: string;
  detalhe: string;
  sentimento?: string;
  etapa?: string;
}) {
  return laraRequest<{
    case_id: string;
    ok: boolean;
    mensagem: string;
  }>("/lara/atendimentos/escalar-contexto", { method: "POST", json: input });
}
