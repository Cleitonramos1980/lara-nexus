import { queryOne, queryRows, execDml } from "../../repositories/baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import type {
  LaraCaseItem,
  LaraCliente,
  LaraComplianceAuditItem,
  LaraConfiguracao,
  LaraLogItem,
  LaraMensagem,
  LaraNegociacaoItem,
  LaraOptoutItem,
  LaraReguaExecucao,
  LaraReguaTemplate,
  LaraTitulo,
} from "./types.js";
import {
  dateToIsoDate,
  dateToIsoDateTime,
  generateLaraId,
  parseJsonSafe,
  roundMoney,
  toNumber,
} from "./utils.js";

type MessageLogRow = {
  id: string;
  wa_id: string;
  codcli: number | null;
  cliente: string;
  telefone: string;
  message_text: string;
  direction: string;
  origem: string;
  etapa: string;
  duplics: string;
  valor_total: number;
  payload_json: string;
  status: string;
  sent_at: string;
  received_at: string;
  message_type: string;
  operator_name: string;
  idempotency_key: string;
  created_at: string;
};

type IntegrationLogRow = {
  id: string;
  integracao: string;
  tipo: string;
  request_json: string;
  response_json: string;
  status_http: number | null;
  status_operacao: string;
  erro_resumo: string;
  idempotency_key: string;
  correlation_id: string;
  created_at: string;
};

type PromiseRow = {
  id: string;
  wa_id: string;
  codcli: number | null;
  cliente: string;
  duplicatas: string;
  valor_total: number;
  data_prometida: string | Date | null;
  observacao: string;
  status: string;
  origem: string;
  created_at: string;
  updated_at: string;
};

type NegotiationRow = {
  id: string;
  codcli: number | null;
  wa_id: string;
  filial: string;
  duplicata: string;
  prestacao: string;
  numtransvenda: number;
  dtvenc_original: string | Date | null;
  dtvenc_prorrogada: string | Date | null;
  valor_original: number;
  valor_negociado: number;
  tipo_negociacao: string;
  status_negociacao: string;
  proxima_cobranca_em: string | Date | null;
  origem: string;
  observacao: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

type CaseRow = {
  id: string;
  wa_id: string;
  codcli: number | null;
  cliente: string;
  tipo_case: string;
  etapa: string;
  duplicatas: string;
  valor_total: number;
  forma_pagamento: string;
  detalhe: string;
  origem: string;
  responsavel: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type OptoutRow = {
  id: string;
  wa_id: string;
  codcli: number | null;
  cliente: string;
  motivo: string;
  ativo: number;
  origem: string;
  observacao: string;
  data_criacao: string;
  data_atualizacao: string;
};

type ReguaTemplateRow = {
  id: string;
  etapa: string;
  nome_template: string;
  canal: string;
  mensagem_template: string;
  ativo: number;
  ordem_execucao: number;
  created_at: string;
  updated_at: string;
};

type ReguaExecucaoRow = {
  id: string;
  etapa: string;
  data_hora_execucao: string | Date | null;
  elegivel: number;
  disparada: number;
  respondida: number;
  convertida: number;
  erro: number;
  bloqueado_optout: number;
  valor_impactado: number;
  status: string;
  detalhes_json: string;
  created_at: string;
};

type ComplianceAuditRow = {
  id: string;
  wa_id: string;
  codcli: number | null;
  tenant_id: string;
  jurisdicao: string;
  canal: string;
  acao: string;
  intencao: string;
  score_confianca: number;
  permitido: number;
  base_legal: string;
  razao_automatizada: string;
  revisao_humana_disponivel: number;
  detalhes_json: string;
  created_at: string;
};

type ClienteCacheRow = {
  id: string;
  codcli: number;
  cliente: string;
  cpf_cnpj_mask: string;
  telefone: string;
  wa_id: string;
  filial: string;
  status_relacionamento: string;
  total_aberto: number;
  qtd_titulos: number;
  risco: string;
  etapa_regua: string;
  titulo_mais_antigo: string | Date | null;
  proximo_vencimento: string | Date | null;
  ultima_acao: string;
  proxima_acao: string;
  responsavel: string;
  ultimo_contato_em: string | Date | null;
  created_at: string;
  updated_at: string;
};

type TituloCacheRow = {
  id: string;
  codcli: number;
  duplicata: string;
  prestacao: string;
  numtransvenda: number;
  numnota: number;
  valor: number;
  vlreceber: number;
  vldesc: number;
  cmulta_prev: number;
  percmulta: number;
  vencimento: string | Date | null;
  dtemissao: string | Date | null;
  dtrecebimento_previsto: string | Date | null;
  dias_atraso: number;
  codcob: string;
  cobranca: string;
  rca: string;
  status_titulo: string;
  boleto_disponivel: number;
  pix_disponivel: number;
  titulo_com_data_prevista: number;
  filial: string;
  cliente: string;
  fantasia: string;
  telefone: string;
  etapa_regua: string;
  ultima_acao: string;
  responsavel: string;
  created_at: string;
  updated_at: string;
};

type MemoryStoreState = {
  clientes: LaraCliente[];
  titulos: LaraTitulo[];
  mensagens: MessageLogRow[];
  cases: LaraCaseItem[];
  promessas: PromiseRow[];
  negociacoes: LaraNegociacaoItem[];
  optouts: LaraOptoutItem[];
  templates: LaraReguaTemplate[];
  execucoes: LaraReguaExecucao[];
  integracoes: IntegrationLogRow[];
  configuracoes: LaraConfiguracao[];
  complianceAudits: LaraComplianceAuditItem[];
};

const memoryStore: MemoryStoreState = {
  clientes: [],
  titulos: [],
  mensagens: [],
  cases: [],
  promessas: [],
  negociacoes: [],
  optouts: [],
  templates: [],
  execucoes: [],
  integracoes: [],
  configuracoes: [],
  complianceAudits: [],
};

const UPSERT_CLIENTES_BATCH_SIZE = 100;
const UPSERT_TITULOS_BATCH_SIZE = 100;

let memoryDefaultsInitialized = false;

function shouldFallbackToMemory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ORA-00942")
    || message.includes("ORA-00904")
    || message.includes("ORA-01031")
    || message.includes("NJS-")
  );
}

// ─── Estado de fallback Oracle → RAM ─────────────────────────────────────────
// Visível externamente via getOracleFallbackState() para health checks

type OracleFallbackState = {
  emFallback: boolean;         // true = Oracle caiu, usando RAM
  desde: Date | null;          // quando entrou em fallback
  totalEventos: number;        // total de chamadas que caíram para RAM
  ultimoErro: string;          // última mensagem de erro do Oracle
  ultimoAlertaEmitido: number; // timestamp do último log de alerta (evita spam)
};

const _fallbackState: OracleFallbackState = {
  emFallback: false,
  desde: null,
  totalEventos: 0,
  ultimoErro: "",
  ultimoAlertaEmitido: 0,
};

export function getOracleFallbackState(): Readonly<OracleFallbackState> {
  return { ..._fallbackState };
}

// Logger registrado pelo server.ts para emitir alertas estruturados
type FallbackLogger = { error: (payload: Record<string, unknown>, msg: string) => void };
let _fallbackLogger: FallbackLogger | null = null;

export function registerFallbackLogger(logger: FallbackLogger): void {
  _fallbackLogger = logger;
}

const ALERT_DEBOUNCE_MS = 60_000; // emite no máximo 1 alerta por minuto

function onFallbackActivated(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  _fallbackState.totalEventos += 1;
  _fallbackState.ultimoErro = msg.slice(0, 300);

  if (!_fallbackState.emFallback) {
    _fallbackState.emFallback = true;
    _fallbackState.desde = new Date();
  }

  const now = Date.now();
  if (now - _fallbackState.ultimoAlertaEmitido >= ALERT_DEBOUNCE_MS) {
    _fallbackState.ultimoAlertaEmitido = now;
    _fallbackLogger?.error(
      {
        modulo: "oracle-fallback",
        em_fallback: true,
        desde: _fallbackState.desde?.toISOString(),
        total_eventos: _fallbackState.totalEventos,
        erro: _fallbackState.ultimoErro,
        aviso: "Dados gravados somente em RAM — serao PERDIDOS no restart do servidor.",
      },
      "ALERTA: Oracle indisponivel — sistema em modo fallback (RAM). Dados em risco.",
    );
  }
}

async function withOperationalFallback<T>(
  oracleFn: () => Promise<T>,
  memoryFn: () => T | Promise<T>,
): Promise<T> {
  if (!isOracleEnabled()) return memoryFn();
  try {
    const result = await oracleFn();
    // Oracle respondeu OK — sai do modo fallback se estava nele
    if (_fallbackState.emFallback) {
      _fallbackState.emFallback = false;
      _fallbackState.desde = null;
      _fallbackLogger?.error(
        { modulo: "oracle-fallback", em_fallback: false, total_eventos: _fallbackState.totalEventos },
        "Oracle reconectado — fallback de RAM desativado.",
      );
    }
    return result;
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      onFallbackActivated(error);
      return memoryFn();
    }
    throw error;
  }
}

function ensureMemoryDefaults(): void {
  if (memoryDefaultsInitialized) return;
  memoryDefaultsInitialized = true;

  if (memoryStore.templates.length === 0) {
    const now = new Date().toISOString();
    memoryStore.templates = [
      {
        id: generateLaraId("TMP"),
        etapa: "D-3",
        nome_template: "Preventivo D-3",
        canal: "WHATSAPP",
        mensagem_template: "Olá {cliente}, lembramos que o título {duplicata} vence em {vencimento}.",
        ativo: true,
        ordem_execucao: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: generateLaraId("TMP"),
        etapa: "D0",
        nome_template: "Vencimento D0",
        canal: "WHATSAPP",
        mensagem_template: "Olá {cliente}, hoje vence o título {duplicata} no valor de {valor}.",
        ativo: true,
        ordem_execucao: 2,
        created_at: now,
        updated_at: now,
      },
      {
        id: generateLaraId("TMP"),
        etapa: "D+7",
        nome_template: "Cobrança D+7",
        canal: "WHATSAPP",
        mensagem_template: "Olá {cliente}, seu título está em atraso. Quer boleto ou PIX?",
        ativo: true,
        ordem_execucao: 4,
        created_at: now,
        updated_at: now,
      },
    ];
  }

  if (memoryStore.configuracoes.length === 0) {
    const now = new Date().toISOString();
    memoryStore.configuracoes = [
      {
        id: generateLaraId("CFG"),
        chave: "JANELA_CONTEXTO_HORAS",
        valor: "72",
        descricao: "Janela de contexto da régua ativa",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN",
        valor: "120",
        descricao: "Janela para não pedir identificação novamente",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "RATE_LIMIT_WEBHOOK_POR_MIN",
        valor: "60",
        descricao: "Limite de webhook por minuto",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_BASE_BOLETO_URL",
        valor: "https://pagamentos.exemplo.local/boleto",
        descricao: "Base de URL para boleto",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_BOLETO_MODO_PADRAO",
        valor: "boleto",
        descricao: "Define modo de envio para intencao de boleto: boleto ou bolepix",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_PIX_CHAVE",
        valor: "financeiro@empresa.com.br",
        descricao: "Chave PIX padrão",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_PIX_BRADESCO_ENABLED",
        valor: "false",
        descricao: "Ativa geracao oficial de PIX via API Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_PIX_BRADESCO_FAILFAST",
        valor: "false",
        descricao: "Quando true, bloqueia fallback local em falha Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_AMBIENTE",
        valor: "producao",
        descricao: "Ambiente da API PIX Bradesco (sandbox/producao)",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_BASE_URL",
        valor: "https://qrpix.bradesco.com.br",
        descricao: "Base URL da API PIX Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_TOKEN_URL",
        valor: "https://qrpix.bradesco.com.br/auth/server/oauth/token",
        descricao: "Endpoint OAuth para obter token PIX Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_SCOPE",
        valor: "",
        descricao: "Escopo opcional no OAuth client_credentials",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_TIMEOUT_MS",
        valor: "15000",
        descricao: "Timeout HTTP para token/cobranca PIX Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_CLIENT_ID",
        valor: "",
        descricao: "Client ID OAuth da API PIX Bradesco",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "BRADESCO_PIX_CLIENT_SECRET",
        valor: "",
        descricao: "Client Secret OAuth da API PIX Bradesco",
        updated_at: now,
      },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_PIX_EXPIRACAO_SEGUNDOS",
          valor: "86400",
          descricao: "Expiracao do QR dinâmico em segundos",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "LARA_BOLEPIX_BRADESCO_ENABLED",
          valor: "false",
          descricao: "Ativa emissao oficial de BolePix via API Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "LARA_BOLEPIX_BRADESCO_FAILFAST",
          valor: "false",
          descricao: "Quando true, bloqueia fallback local em falha de emissao BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_AMBIENTE",
          valor: "producao",
          descricao: "Ambiente da API BolePix Bradesco (sandbox/producao)",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_BASE_URL",
          valor: "https://openapi.bradesco.com.br",
          descricao: "Base URL da API BolePix Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_TOKEN_URL",
          valor: "https://openapi.bradesco.com.br/auth/server-mtls/v2/token",
          descricao: "Endpoint OAuth mTLS para token BolePix Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_SCOPE",
          valor: "",
          descricao: "Escopo opcional para token BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_TIMEOUT_MS",
          valor: "20000",
          descricao: "Timeout HTTP para chamadas BolePix Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_CLIENT_ID",
          valor: "",
          descricao: "Client ID OAuth da API BolePix Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_CLIENT_SECRET",
          valor: "",
          descricao: "Client Secret OAuth da API BolePix Bradesco",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_COD_USUARIO",
          valor: "APISERVIC",
          descricao: "Codigo de usuario contratual para operacoes BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_PRODUTO",
          valor: "9",
          descricao: "Codigo do produto de cobranca para BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_TIPO_ACESSO",
          valor: "2",
          descricao: "Tipo de acesso contratual no endpoint de BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_CERT_PATH",
          valor: "",
          descricao: "Caminho do certificado publico (.pem/.crt) para mTLS BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_KEY_PATH",
          valor: "",
          descricao: "Caminho da chave privada (.key/.pem) para mTLS BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_PFX_PATH",
          valor: "",
          descricao: "Caminho do certificado PFX para mTLS BolePix (opcional)",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_PASSPHRASE",
          valor: "",
          descricao: "Passphrase do PFX/certificado mTLS BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_CA_PATH",
          valor: "",
          descricao: "CA confiavel do Bradesco para validacao TLS",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_MTLS_REJECT_UNAUTHORIZED",
          valor: "true",
          descricao: "Valida cadeia TLS no mTLS BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_BENEF_CNPJ_RAIZ",
          valor: "",
          descricao: "Raiz CNPJ beneficiario para emissao BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_BENEF_FILIAL",
          valor: "",
          descricao: "Filial CNPJ beneficiario para emissao BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_BENEF_CONTROLE",
          valor: "",
          descricao: "Controle CNPJ beneficiario para emissao BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "BRADESCO_BOLEPIX_NEGOCIACAO",
          valor: "",
          descricao: "Numero da negociacao contratual da cobranca BolePix",
          updated_at: now,
        },
        {
          id: generateLaraId("CFG"),
          chave: "LARA_SYNC_DAILY_ATIVO",
          valor: "false",
        descricao: "Ativa a sincronizacao diaria de titulos em aberto",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_DAILY_HORA",
        valor: "6",
        descricao: "Hora da sincronizacao diaria",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_DAILY_MINUTO",
        valor: "0",
        descricao: "Minuto da sincronizacao diaria",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_DAILY_TIMEZONE",
        valor: "America/Sao_Paulo",
        descricao: "Fuso horario da sincronizacao diaria",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_DAILY_LIMIT",
        valor: "30000",
        descricao: "Limite maximo de titulos por carga diaria",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_DAILY_INCLUDE_DESD",
        valor: "false",
        descricao: "Inclui titulos DESD na carga diaria",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_SYNC_STARTUP_RUN",
        valor: "true",
        descricao: "Executa carga ao iniciar backend",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_PROMESSA_FOLLOWUP_ATIVO",
        valor: "true",
        descricao: "Ativa follow-up automatico para promessas vencidas",
        updated_at: now,
      },
      {
        id: generateLaraId("CFG"),
        chave: "LARA_PROMESSA_FOLLOWUP_INTERVAL_MIN",
        valor: "10",
        descricao: "Intervalo em minutos para varredura de promessas vencidas",
        updated_at: now,
      },
    ];
  }
}

function toStringSafe(value: unknown): string {
  return String(value ?? "").trim();
}

function maskSensitiveText(value: string): string {
  return String(value ?? "")
    .replace(/\b\d{11,14}\b/g, "***DOCUMENTO***")
    .replace(/\b55\d{10,11}\b/g, "***TELEFONE***")
    .replace(/\b\d{5,}\b/g, (match) => `${match.slice(0, 2)}***${match.slice(-2)}`);
}

function sanitizePayloadJson(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (["message_text", "texto", "documento", "cpf", "cnpj", "telefone", "wa_id"].includes(key.toLowerCase())) {
      copy[key] = "***";
      continue;
    }
    copy[key] = raw;
  }
  return copy;
}

function splitInChunks<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function readRowValue(row: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];

  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];

  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];

  return undefined;
}

function mapMessageLogRow(row: MessageLogRow): MessageLogRow {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);

  return {
    id: toStringSafe(readRowValue(source, "id")),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    codcli: codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed)
      ? null
      : codcliParsed,
    cliente: toStringSafe(readRowValue(source, "cliente")),
    telefone: toStringSafe(readRowValue(source, "telefone")),
    message_text: toStringSafe(readRowValue(source, "message_text")),
    direction: toStringSafe(readRowValue(source, "direction")),
    origem: toStringSafe(readRowValue(source, "origem")),
    etapa: toStringSafe(readRowValue(source, "etapa")),
    duplics: toStringSafe(readRowValue(source, "duplics")),
    valor_total: roundMoney(toNumber(readRowValue(source, "valor_total"))),
    payload_json: toStringSafe(readRowValue(source, "payload_json")) || "{}",
    status: toStringSafe(readRowValue(source, "status")),
    sent_at: dateToIsoDateTime(readRowValue(source, "sent_at") as string | Date | null | undefined),
    received_at: dateToIsoDateTime(readRowValue(source, "received_at") as string | Date | null | undefined),
    message_type: toStringSafe(readRowValue(source, "message_type")),
    operator_name: toStringSafe(readRowValue(source, "operator_name")),
    idempotency_key: toStringSafe(readRowValue(source, "idempotency_key")),
    created_at: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
  };
}

function mapIntegrationLogRow(row: IntegrationLogRow): IntegrationLogRow {
  const source = row as unknown as Record<string, unknown>;
  const statusHttpRaw = readRowValue(source, "status_http");
  const statusHttpParsed = Number(statusHttpRaw);

  return {
    id: toStringSafe(readRowValue(source, "id")),
    integracao: toStringSafe(readRowValue(source, "integracao")),
    tipo: toStringSafe(readRowValue(source, "tipo")),
    request_json: toStringSafe(readRowValue(source, "request_json")) || "{}",
    response_json: toStringSafe(readRowValue(source, "response_json")) || "{}",
    status_http:
      statusHttpRaw === null || statusHttpRaw === undefined || statusHttpRaw === "" || !Number.isFinite(statusHttpParsed)
        ? null
        : statusHttpParsed,
    status_operacao: toStringSafe(readRowValue(source, "status_operacao")),
    erro_resumo: toStringSafe(readRowValue(source, "erro_resumo")),
    idempotency_key: toStringSafe(readRowValue(source, "idempotency_key")),
    correlation_id: toStringSafe(readRowValue(source, "correlation_id")),
    created_at: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
  };
}

function mapPromiseRow(row: PromiseRow): PromiseRow {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);

  return {
    id: toStringSafe(readRowValue(source, "id")),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    codcli: codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed)
      ? null
      : codcliParsed,
    cliente: toStringSafe(readRowValue(source, "cliente")),
    duplicatas: toStringSafe(readRowValue(source, "duplicatas")),
    valor_total: roundMoney(toNumber(readRowValue(source, "valor_total"))),
    data_prometida: dateToIsoDate(readRowValue(source, "data_prometida") as string | Date | null | undefined),
    observacao: toStringSafe(readRowValue(source, "observacao")),
    status: toStringSafe(readRowValue(source, "status")),
    origem: toStringSafe(readRowValue(source, "origem")),
    created_at: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
    updated_at: dateToIsoDateTime(readRowValue(source, "updated_at") as string | Date | null | undefined),
  };
}

function mapClienteCacheRowToCliente(row: ClienteCacheRow): LaraCliente {
  const source = row as unknown as Record<string, unknown>;
  return {
    codcli: String(readRowValue(source, "codcli")),
    cliente: toStringSafe(readRowValue(source, "cliente")),
    telefone: toStringSafe(readRowValue(source, "telefone")),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    cpf_cnpj: toStringSafe(readRowValue(source, "cpf_cnpj_mask")),
    filial: toStringSafe(readRowValue(source, "filial")),
    total_aberto: roundMoney(toNumber(readRowValue(source, "total_aberto"))),
    qtd_titulos: Number(readRowValue(source, "qtd_titulos") ?? 0),
    titulo_mais_antigo: dateToIsoDate(readRowValue(source, "titulo_mais_antigo") as string | Date | null | undefined),
    proximo_vencimento: dateToIsoDate(readRowValue(source, "proximo_vencimento") as string | Date | null | undefined),
    ultimo_contato: dateToIsoDateTime(readRowValue(source, "ultimo_contato_em") as string | Date | null | undefined),
    ultima_acao:
      toStringSafe(readRowValue(source, "ultima_acao"))
      || toStringSafe(readRowValue(source, "status_relacionamento"))
      || "Aguardando acao",
    proxima_acao: toStringSafe(readRowValue(source, "proxima_acao")),
    optout: false,
    etapa_regua: toStringSafe(readRowValue(source, "etapa_regua")) || "-",
    status: toStringSafe(readRowValue(source, "status_relacionamento")) || "Aguardando resposta",
    responsavel: toStringSafe(readRowValue(source, "responsavel")) || "Lara Automacao",
    risco: (toStringSafe(readRowValue(source, "risco")).toLowerCase() as any) || "baixo",
  };
}

function mapTituloCacheRowToTitulo(row: TituloCacheRow, cliente?: LaraCliente): LaraTitulo {
  const source = row as unknown as Record<string, unknown>;
  const valorBase = roundMoney(toNumber(readRowValue(source, "valor")));
  const vlreceber = roundMoney(toNumber(readRowValue(source, "vlreceber") ?? readRowValue(source, "valor")));
  return {
    id: toStringSafe(readRowValue(source, "id")),
    duplicata: toStringSafe(readRowValue(source, "duplicata")),
    prestacao: toStringSafe(readRowValue(source, "prestacao")),
    numtransvenda: Number(readRowValue(source, "numtransvenda") ?? 0),
    numnota: Number(readRowValue(source, "numnota") ?? 0),
    codcli: String(readRowValue(source, "codcli")),
    cliente: toStringSafe(readRowValue(source, "cliente")) || cliente?.cliente || "",
    fantasia: toStringSafe(readRowValue(source, "fantasia")) || toStringSafe(readRowValue(source, "cliente")) || cliente?.cliente || "",
    telefone: toStringSafe(readRowValue(source, "telefone")) || cliente?.telefone || "",
    valor: valorBase,
    vlreceber: vlreceber || valorBase,
    vldesc: roundMoney(toNumber(readRowValue(source, "vldesc") ?? 0)),
    cmulta_prev: roundMoney(toNumber(readRowValue(source, "cmulta_prev") ?? 0)),
    percmulta: toNumber(readRowValue(source, "percmulta") ?? 0),
    vencimento: dateToIsoDate(readRowValue(source, "vencimento") as string | Date | null | undefined),
    dtemissao: dateToIsoDate(readRowValue(source, "dtemissao") as string | Date | null | undefined),
    dtrecebimento_previsto: dateToIsoDate(readRowValue(source, "dtrecebimento_previsto") as string | Date | null | undefined),
    dias_atraso: Number(readRowValue(source, "dias_atraso") ?? 0),
    codcob: toStringSafe(readRowValue(source, "codcob")),
    cobranca: toStringSafe(readRowValue(source, "cobranca")),
    rca: toStringSafe(readRowValue(source, "rca")),
    etapa_regua: toStringSafe(readRowValue(source, "etapa_regua")) || cliente?.etapa_regua || "-",
    status_atendimento: toStringSafe(readRowValue(source, "status_titulo")) || "Em aberto",
    boleto_disponivel: Number(readRowValue(source, "boleto_disponivel") ?? 0) === 1,
    pix_disponivel: Number(readRowValue(source, "pix_disponivel") ?? 0) === 1,
    titulo_com_data_prevista: Number(readRowValue(source, "titulo_com_data_prevista") ?? 0) === 1,
    ultima_acao:
      toStringSafe(readRowValue(source, "ultima_acao"))
      || toStringSafe(readRowValue(source, "status_titulo"))
      || "Em aberto",
    responsavel: toStringSafe(readRowValue(source, "responsavel")) || "Lara Automacao",
    filial: toStringSafe(readRowValue(source, "filial")),
  };
}

function mapCaseRow(row: CaseRow): LaraCaseItem {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);
  return {
    id: toStringSafe(readRowValue(source, "id")),
    data_hora: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
    cliente: toStringSafe(readRowValue(source, "cliente")),
    codcli: codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed) ? "" : String(codcliParsed),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    acao: toStringSafe(readRowValue(source, "tipo_case")),
    etapa: toStringSafe(readRowValue(source, "etapa")),
    duplicatas: toStringSafe(readRowValue(source, "duplicatas")),
    valor_total: roundMoney(toNumber(readRowValue(source, "valor_total"))),
    forma_pagamento: toStringSafe(readRowValue(source, "forma_pagamento")),
    origem: toStringSafe(readRowValue(source, "origem")),
    responsavel: toStringSafe(readRowValue(source, "responsavel")),
    detalhe: toStringSafe(readRowValue(source, "detalhe")),
    status: toStringSafe(readRowValue(source, "status")) || "aberto",
  };
}

function mapNegotiationRow(row: NegotiationRow): LaraNegociacaoItem {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);
  return {
    id: toStringSafe(readRowValue(source, "id")),
    codcli:
      codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed)
        ? ""
        : String(codcliParsed),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    filial: toStringSafe(readRowValue(source, "filial")),
    duplicata: toStringSafe(readRowValue(source, "duplicata")),
    prestacao: toStringSafe(readRowValue(source, "prestacao")),
    numtransvenda: Number(readRowValue(source, "numtransvenda") ?? 0),
    dtvenc_original: dateToIsoDate(readRowValue(source, "dtvenc_original") as string | Date | null | undefined),
    dtvenc_prorrogada: dateToIsoDate(readRowValue(source, "dtvenc_prorrogada") as string | Date | null | undefined),
    valor_original: roundMoney(toNumber(readRowValue(source, "valor_original"))),
    valor_negociado: roundMoney(toNumber(readRowValue(source, "valor_negociado"))),
    tipo_negociacao: toStringSafe(readRowValue(source, "tipo_negociacao")),
    status_negociacao: toStringSafe(readRowValue(source, "status_negociacao")),
    proxima_cobranca_em: dateToIsoDateTime(readRowValue(source, "proxima_cobranca_em") as string | Date | null | undefined),
    origem: toStringSafe(readRowValue(source, "origem")),
    observacao: toStringSafe(readRowValue(source, "observacao")),
    idempotency_key: toStringSafe(readRowValue(source, "idempotency_key")),
    created_at: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
    updated_at: dateToIsoDateTime(readRowValue(source, "updated_at") as string | Date | null | undefined),
  };
}

function mapOptoutRow(row: OptoutRow): LaraOptoutItem {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);
  return {
    id: toStringSafe(readRowValue(source, "id")),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    codcli: codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed) ? "" : String(codcliParsed),
    cliente: toStringSafe(readRowValue(source, "cliente")),
    motivo: toStringSafe(readRowValue(source, "motivo")),
    ativo: Number(readRowValue(source, "ativo") ?? 0) === 1,
    origem: toStringSafe(readRowValue(source, "origem")),
    observacao: toStringSafe(readRowValue(source, "observacao")),
    data_criacao: dateToIsoDateTime(readRowValue(source, "data_criacao") as string | Date | null | undefined),
    data_atualizacao: dateToIsoDateTime(readRowValue(source, "data_atualizacao") as string | Date | null | undefined),
  };
}

function mapReguaTemplateRow(row: ReguaTemplateRow): LaraReguaTemplate {
  const source = row as unknown as Record<string, unknown>;
  return {
    id: toStringSafe(readRowValue(source, "id")),
    etapa: toStringSafe(readRowValue(source, "etapa")),
    nome_template: toStringSafe(readRowValue(source, "nome_template")),
    canal: toStringSafe(readRowValue(source, "canal")),
    mensagem_template: toStringSafe(readRowValue(source, "mensagem_template")),
    ativo: Number(readRowValue(source, "ativo") ?? 0) === 1,
    ordem_execucao: Number(readRowValue(source, "ordem_execucao") ?? 0),
    created_at: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
    updated_at: dateToIsoDateTime(readRowValue(source, "updated_at") as string | Date | null | undefined),
  };
}

function mapReguaExecucaoRow(row: ReguaExecucaoRow): LaraReguaExecucao {
  const source = row as unknown as Record<string, unknown>;
  return {
    id: toStringSafe(readRowValue(source, "id")),
    data_hora: dateToIsoDateTime(
      (readRowValue(source, "data_hora_execucao") ?? readRowValue(source, "created_at")) as string | Date | null | undefined,
    ),
    etapa: toStringSafe(readRowValue(source, "etapa")),
    elegivel: Number(readRowValue(source, "elegivel") ?? 0),
    disparada: Number(readRowValue(source, "disparada") ?? 0),
    erro: Number(readRowValue(source, "erro") ?? 0),
    respondida: Number(readRowValue(source, "respondida") ?? 0),
    convertida: Number(readRowValue(source, "convertida") ?? 0),
    bloqueado_optout: Number(readRowValue(source, "bloqueado_optout") ?? 0),
    valor_impactado: roundMoney(toNumber(readRowValue(source, "valor_impactado"))),
    status: toStringSafe(readRowValue(source, "status")) || "concluido",
  };
}

function mapComplianceAuditRow(row: ComplianceAuditRow): LaraComplianceAuditItem {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);
  const rawDetalhes = toStringSafe(readRowValue(source, "detalhes_json")) || "{}";
  const detalhes = parseJsonSafe<Record<string, unknown>>(rawDetalhes, {});
  const permitidoRaw = Number(readRowValue(source, "permitido") ?? 0);
  const revisaoRaw = Number(readRowValue(source, "revisao_humana_disponivel") ?? 0);
  return {
    id: toStringSafe(readRowValue(source, "id")),
    data_hora: dateToIsoDateTime(readRowValue(source, "created_at") as string | Date | null | undefined),
    wa_id: toStringSafe(readRowValue(source, "wa_id")),
    codcli:
      codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed)
        ? ""
        : String(codcliParsed),
    tenant_id: toStringSafe(readRowValue(source, "tenant_id")) || "default",
    jurisdicao: (toStringSafe(readRowValue(source, "jurisdicao")) || "GLOBAL") as any,
    canal: (toStringSafe(readRowValue(source, "canal")) || "OUTRO") as any,
    acao: (toStringSafe(readRowValue(source, "acao")) || "resposta_padrao") as any,
    intencao: toStringSafe(readRowValue(source, "intencao")) || "neutro",
    score_confianca: roundMoney(toNumber(readRowValue(source, "score_confianca"))),
    permitido: permitidoRaw === 1,
    base_legal: toStringSafe(readRowValue(source, "base_legal")),
    razao_automatizada: toStringSafe(readRowValue(source, "razao_automatizada")),
    revisao_humana_disponivel: revisaoRaw === 1,
    detalhes,
  };
}

function mapMessageToLog(row: MessageLogRow): LaraLogItem {
  const source = row as unknown as Record<string, unknown>;
  const codcliRaw = readRowValue(source, "codcli");
  const codcliParsed = Number(codcliRaw);
  const direction = toStringSafe(readRowValue(source, "direction")).toUpperCase();
  return {
    id: toStringSafe(readRowValue(source, "id")),
    data_hora: dateToIsoDateTime(
      (readRowValue(source, "created_at") ?? readRowValue(source, "sent_at") ?? readRowValue(source, "received_at")) as
      | string
      | Date
      | null
      | undefined,
    ),
    tipo: direction === "OUTBOUND" ? "Mensagem enviada" : "Mensagem recebida",
    modulo: "WhatsApp",
    cliente: toStringSafe(readRowValue(source, "cliente")) || "-",
    wa_id: toStringSafe(readRowValue(source, "wa_id")) || "-",
    codcli: codcliRaw === null || codcliRaw === undefined || codcliRaw === "" || !Number.isFinite(codcliParsed) ? "-" : String(codcliParsed),
    etapa: toStringSafe(readRowValue(source, "etapa")) || "-",
    mensagem: toStringSafe(readRowValue(source, "message_text")),
    severidade: "sucesso",
    status: toStringSafe(readRowValue(source, "status")) || "processado",
    origem: toStringSafe(readRowValue(source, "origem")) || "atendimento",
  };
}

export class LaraOperationalStore {
  constructor() {
    ensureMemoryDefaults();
  }

  async listClientesCache(): Promise<LaraCliente[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<ClienteCacheRow>(`
          SELECT
            ID, CODCLI, CLIENTE, CPF_CNPJ_MASK, TELEFONE, WA_ID, FILIAL,
            STATUS_RELACIONAMENTO, TOTAL_ABERTO, QTD_TITULOS, RISCO, ETAPA_REGUA,
            TITULO_MAIS_ANTIGO, PROXIMO_VENCIMENTO, ULTIMA_ACAO, PROXIMA_ACAO, RESPONSAVEL,
            ULTIMO_CONTATO_EM, CREATED_AT, UPDATED_AT
          FROM LARA_CLIENTES_CACHE
          ORDER BY TOTAL_ABERTO DESC, CODCLI ASC
        `);
        return rows.map(mapClienteCacheRowToCliente);
      },
      () => [...memoryStore.clientes],
    );
  }

  async getClientesResumo(): Promise<{ total: number; risco_critico: number; valor_total_aberto: number }> {
    return withOperationalFallback(
      async () => {
        const row = await queryOne<Record<string, unknown>>(`
          SELECT
            COUNT(*) AS TOTAL,
            SUM(CASE WHEN UPPER(RISCO) = 'CRITICO' THEN 1 ELSE 0 END) AS RISCO_CRITICO,
            SUM(NVL(TOTAL_ABERTO, 0)) AS VALOR_TOTAL_ABERTO
          FROM LARA_CLIENTES_CACHE
        `);
        return {
          total: Number(row?.TOTAL ?? row?.total ?? 0),
          risco_critico: Number(row?.RISCO_CRITICO ?? row?.risco_critico ?? 0),
          valor_total_aberto: roundMoney(Number(row?.VALOR_TOTAL_ABERTO ?? row?.valor_total_aberto ?? 0)),
        };
      },
      () => {
        const clientes = memoryStore.clientes;
        return {
          total: clientes.length,
          risco_critico: clientes.filter((c) => String(c.risco).toLowerCase() === "critico").length,
          valor_total_aberto: roundMoney(clientes.reduce((sum, c) => sum + (c.total_aberto ?? 0), 0)),
        };
      },
    );
  }

  async getClienteCache(codcli: number): Promise<LaraCliente | null> {
    return withOperationalFallback(
      async () => {
        const row = await queryOne<ClienteCacheRow>(
          `
          SELECT
            ID, CODCLI, CLIENTE, CPF_CNPJ_MASK, TELEFONE, WA_ID, FILIAL,
            STATUS_RELACIONAMENTO, TOTAL_ABERTO, QTD_TITULOS, RISCO, ETAPA_REGUA,
            TITULO_MAIS_ANTIGO, PROXIMO_VENCIMENTO, ULTIMA_ACAO, PROXIMA_ACAO, RESPONSAVEL,
            ULTIMO_CONTATO_EM, CREATED_AT, UPDATED_AT
          FROM LARA_CLIENTES_CACHE
          WHERE CODCLI = :codcli
          `,
          { codcli },
        );
        return row ? mapClienteCacheRowToCliente(row) : null;
      },
      () => memoryStore.clientes.find((item) => item.codcli === String(codcli)) ?? null,
    );
  }

  async upsertClienteCache(cliente: LaraCliente): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `
          MERGE INTO LARA_CLIENTES_CACHE t
          USING (SELECT :id AS ID FROM DUAL) s
            ON (t.ID = s.ID)
          WHEN MATCHED THEN UPDATE SET
            CODCLI = :codcli,
            CLIENTE = :cliente,
            CPF_CNPJ_MASK = :cpfCnpjMask,
            TELEFONE = :telefone,
            WA_ID = :waId,
            FILIAL = :filial,
            STATUS_RELACIONAMENTO = :statusRelacionamento,
            TOTAL_ABERTO = :totalAberto,
            QTD_TITULOS = :qtdTitulos,
            RISCO = :risco,
            ETAPA_REGUA = :etapaRegua,
            TITULO_MAIS_ANTIGO = CASE WHEN :tituloMaisAntigo IS NULL THEN NULL ELSE TO_DATE(:tituloMaisAntigo, 'YYYY-MM-DD') END,
            PROXIMO_VENCIMENTO = CASE WHEN :proximoVencimento IS NULL THEN NULL ELSE TO_DATE(:proximoVencimento, 'YYYY-MM-DD') END,
            ULTIMA_ACAO = :ultimaAcao,
            PROXIMA_ACAO = :proximaAcao,
            RESPONSAVEL = :responsavel,
            ULTIMO_CONTATO_EM = CASE WHEN :ultimoContato IS NULL THEN NULL ELSE TO_TIMESTAMP(:ultimoContato, 'YYYY-MM-DD HH24:MI:SS') END,
            UPDATED_AT = SYSTIMESTAMP
          WHEN NOT MATCHED THEN INSERT (
            ID, CODCLI, CLIENTE, CPF_CNPJ_MASK, TELEFONE, WA_ID, FILIAL,
            STATUS_RELACIONAMENTO, TOTAL_ABERTO, QTD_TITULOS, RISCO, ETAPA_REGUA,
            TITULO_MAIS_ANTIGO, PROXIMO_VENCIMENTO, ULTIMA_ACAO, PROXIMA_ACAO, RESPONSAVEL, ULTIMO_CONTATO_EM
          ) VALUES (
            :id, :codcli, :cliente, :cpfCnpjMask, :telefone, :waId, :filial,
            :statusRelacionamento, :totalAberto, :qtdTitulos, :risco, :etapaRegua,
            CASE WHEN :tituloMaisAntigo IS NULL THEN NULL ELSE TO_DATE(:tituloMaisAntigo, 'YYYY-MM-DD') END,
            CASE WHEN :proximoVencimento IS NULL THEN NULL ELSE TO_DATE(:proximoVencimento, 'YYYY-MM-DD') END,
            :ultimaAcao, :proximaAcao, :responsavel,
            CASE WHEN :ultimoContato IS NULL THEN NULL ELSE TO_TIMESTAMP(:ultimoContato, 'YYYY-MM-DD HH24:MI:SS') END
          )
          `,
          {
            id: `CLI-${cliente.codcli}`,
            codcli: Number(cliente.codcli),
            cliente: cliente.cliente,
            cpfCnpjMask: cliente.cpf_cnpj,
            telefone: cliente.telefone,
            waId: cliente.wa_id,
            filial: cliente.filial,
            statusRelacionamento: cliente.status,
            totalAberto: roundMoney(cliente.total_aberto),
            qtdTitulos: cliente.qtd_titulos,
            risco: cliente.risco,
            etapaRegua: cliente.etapa_regua,
            tituloMaisAntigo: cliente.titulo_mais_antigo || null,
            proximoVencimento: cliente.proximo_vencimento || null,
            ultimaAcao: cliente.ultima_acao || "",
            proximaAcao: cliente.proxima_acao || "",
            responsavel: cliente.responsavel || "Lara Automacao",
            ultimoContato: cliente.ultimo_contato || null,
          },
        );
      },
      () => {
        const idx = memoryStore.clientes.findIndex((item) => item.codcli === cliente.codcli);
        if (idx >= 0) memoryStore.clientes[idx] = { ...cliente };
        else memoryStore.clientes.push({ ...cliente });
      },
    );
  }

  async upsertClientesCacheBatch(clientes: LaraCliente[]): Promise<void> {
    if (!clientes.length) return;

    const deduped = Array.from(
      new Map(clientes.map((item) => [item.codcli, item])).values(),
    );
    const chunks = splitInChunks(deduped, UPSERT_CLIENTES_BATCH_SIZE);
    for (const chunk of chunks) {
      await withOperationalFallback(
        async () => {
          const binds: Record<string, unknown> = {};
          const rowsSql = chunk.map((cliente, index) => {
            binds[`id${index}`] = `CLI-${cliente.codcli}`;
            binds[`codcli${index}`] = Number(cliente.codcli);
            binds[`cliente${index}`] = cliente.cliente;
            binds[`cpfCnpjMask${index}`] = cliente.cpf_cnpj;
            binds[`telefone${index}`] = cliente.telefone;
            binds[`waId${index}`] = cliente.wa_id;
            binds[`filial${index}`] = cliente.filial;
            binds[`statusRelacionamento${index}`] = cliente.status;
            binds[`totalAberto${index}`] = roundMoney(cliente.total_aberto);
            binds[`qtdTitulos${index}`] = cliente.qtd_titulos;
            binds[`risco${index}`] = cliente.risco;
            binds[`etapaRegua${index}`] = cliente.etapa_regua;
            binds[`tituloMaisAntigo${index}`] = cliente.titulo_mais_antigo || null;
            binds[`proximoVencimento${index}`] = cliente.proximo_vencimento || null;
            binds[`ultimaAcao${index}`] = cliente.ultima_acao || "";
            binds[`proximaAcao${index}`] = cliente.proxima_acao || "";
            binds[`responsavel${index}`] = cliente.responsavel || "Lara Automacao";
            binds[`ultimoContato${index}`] = cliente.ultimo_contato || null;

            return `
            SELECT
              :id${index} AS ID,
              :codcli${index} AS CODCLI,
              :cliente${index} AS CLIENTE,
              :cpfCnpjMask${index} AS CPF_CNPJ_MASK,
              :telefone${index} AS TELEFONE,
              :waId${index} AS WA_ID,
              :filial${index} AS FILIAL,
              :statusRelacionamento${index} AS STATUS_RELACIONAMENTO,
              :totalAberto${index} AS TOTAL_ABERTO,
              :qtdTitulos${index} AS QTD_TITULOS,
              :risco${index} AS RISCO,
              :etapaRegua${index} AS ETAPA_REGUA,
              CASE
                WHEN :tituloMaisAntigo${index} IS NULL THEN NULL
                ELSE TO_DATE(:tituloMaisAntigo${index}, 'YYYY-MM-DD')
              END AS TITULO_MAIS_ANTIGO,
              CASE
                WHEN :proximoVencimento${index} IS NULL THEN NULL
                ELSE TO_DATE(:proximoVencimento${index}, 'YYYY-MM-DD')
              END AS PROXIMO_VENCIMENTO,
              :ultimaAcao${index} AS ULTIMA_ACAO,
              :proximaAcao${index} AS PROXIMA_ACAO,
              :responsavel${index} AS RESPONSAVEL,
              CASE
                WHEN :ultimoContato${index} IS NULL THEN NULL
                ELSE TO_TIMESTAMP(:ultimoContato${index}, 'YYYY-MM-DD HH24:MI:SS')
              END AS ULTIMO_CONTATO_EM
            FROM DUAL
            `;
          });

          try {
            await execDml(
              `
              MERGE INTO LARA_CLIENTES_CACHE t
              USING (
                ${rowsSql.join("\nUNION ALL\n")}
              ) s
                ON (t.ID = s.ID)
              WHEN MATCHED THEN UPDATE SET
                CODCLI = s.CODCLI,
                CLIENTE = s.CLIENTE,
                CPF_CNPJ_MASK = s.CPF_CNPJ_MASK,
                TELEFONE = s.TELEFONE,
                WA_ID = s.WA_ID,
                FILIAL = s.FILIAL,
                STATUS_RELACIONAMENTO = s.STATUS_RELACIONAMENTO,
                TOTAL_ABERTO = s.TOTAL_ABERTO,
                QTD_TITULOS = s.QTD_TITULOS,
                RISCO = s.RISCO,
                ETAPA_REGUA = s.ETAPA_REGUA,
                TITULO_MAIS_ANTIGO = s.TITULO_MAIS_ANTIGO,
                PROXIMO_VENCIMENTO = s.PROXIMO_VENCIMENTO,
                ULTIMA_ACAO = s.ULTIMA_ACAO,
                PROXIMA_ACAO = s.PROXIMA_ACAO,
                RESPONSAVEL = s.RESPONSAVEL,
                ULTIMO_CONTATO_EM = s.ULTIMO_CONTATO_EM,
                UPDATED_AT = SYSTIMESTAMP
              WHEN NOT MATCHED THEN INSERT (
                ID, CODCLI, CLIENTE, CPF_CNPJ_MASK, TELEFONE, WA_ID, FILIAL,
                STATUS_RELACIONAMENTO, TOTAL_ABERTO, QTD_TITULOS, RISCO, ETAPA_REGUA,
                TITULO_MAIS_ANTIGO, PROXIMO_VENCIMENTO, ULTIMA_ACAO, PROXIMA_ACAO, RESPONSAVEL, ULTIMO_CONTATO_EM
              ) VALUES (
                s.ID, s.CODCLI, s.CLIENTE, s.CPF_CNPJ_MASK, s.TELEFONE, s.WA_ID, s.FILIAL,
                s.STATUS_RELACIONAMENTO, s.TOTAL_ABERTO, s.QTD_TITULOS, s.RISCO, s.ETAPA_REGUA,
                s.TITULO_MAIS_ANTIGO, s.PROXIMO_VENCIMENTO, s.ULTIMA_ACAO, s.PROXIMA_ACAO, s.RESPONSAVEL, s.ULTIMO_CONTATO_EM
              )
              `,
              binds,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("ORA-00001")) throw error;
            for (const cliente of chunk) {
              await this.upsertClienteCache(cliente);
            }
          }
        },
        () => {
          for (const cliente of chunk) {
            const idx = memoryStore.clientes.findIndex((item) => item.codcli === cliente.codcli);
            if (idx >= 0) memoryStore.clientes[idx] = { ...cliente };
            else memoryStore.clientes.push({ ...cliente });
          }
        },
      );
    }
  }

  async listTitulosCache(): Promise<LaraTitulo[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<TituloCacheRow>(`
          SELECT
            ID, CODCLI, DUPLICATA, PRESTACAO,
            NVL(NUMTRANSVENDA,0) AS NUMTRANSVENDA, NVL(NUMNOTA,0) AS NUMNOTA,
            VALOR, NVL(VLRECEBER,VALOR) AS VLRECEBER, NVL(VLDESC,0) AS VLDESC,
            NVL(CMULTA_PREV,0) AS CMULTA_PREV, NVL(PERCMULTA,0) AS PERCMULTA,
            VENCIMENTO, DTEMISSAO, DTRECEBIMENTO_PREVISTO, DIAS_ATRASO,
            CODCOB, NVL(COBRANCA,CODCOB) AS COBRANCA, NVL(RCA,'') AS RCA,
            STATUS_TITULO, BOLETO_DISPONIVEL, PIX_DISPONIVEL,
            NVL(TITULO_COM_DATA_PREVISTA,0) AS TITULO_COM_DATA_PREVISTA,
            FILIAL, CLIENTE, NVL(FANTASIA,CLIENTE) AS FANTASIA,
            TELEFONE, ETAPA_REGUA, ULTIMA_ACAO, RESPONSAVEL,
            CREATED_AT, UPDATED_AT
          FROM LARA_TITULOS_CACHE
          ORDER BY VENCIMENTO ASC, CODCLI ASC
        `);
        const clientes = await this.listClientesCache();
        const byCodcli = new Map(clientes.map((item) => [item.codcli, item]));
        return rows.map((row) => mapTituloCacheRowToTitulo(row, byCodcli.get(String(row.codcli))));
      },
      () => [...memoryStore.titulos],
    );
  }

  async listTitulosByCodcli(codcli: number): Promise<LaraTitulo[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<TituloCacheRow>(
          `
          SELECT
            ID, CODCLI, DUPLICATA, PRESTACAO,
            NVL(NUMTRANSVENDA,0) AS NUMTRANSVENDA, NVL(NUMNOTA,0) AS NUMNOTA,
            VALOR, NVL(VLRECEBER,VALOR) AS VLRECEBER, NVL(VLDESC,0) AS VLDESC,
            NVL(CMULTA_PREV,0) AS CMULTA_PREV, NVL(PERCMULTA,0) AS PERCMULTA,
            VENCIMENTO, DTEMISSAO, DTRECEBIMENTO_PREVISTO, DIAS_ATRASO,
            CODCOB, NVL(COBRANCA,CODCOB) AS COBRANCA, NVL(RCA,'') AS RCA,
            STATUS_TITULO, BOLETO_DISPONIVEL, PIX_DISPONIVEL,
            NVL(TITULO_COM_DATA_PREVISTA,0) AS TITULO_COM_DATA_PREVISTA,
            FILIAL, CLIENTE, NVL(FANTASIA,CLIENTE) AS FANTASIA,
            TELEFONE, ETAPA_REGUA, ULTIMA_ACAO, RESPONSAVEL,
            CREATED_AT, UPDATED_AT
          FROM LARA_TITULOS_CACHE
          WHERE CODCLI = :codcli
          ORDER BY VENCIMENTO ASC, CODCLI ASC
          `,
          { codcli },
        );
        const cliente = await this.getClienteCache(codcli);
        return rows.map((row) => mapTituloCacheRowToTitulo(row, cliente ?? undefined));
      },
      () => memoryStore.titulos.filter((item) => item.codcli === String(codcli)),
    );
  }

  async getTituloCache(id: string): Promise<LaraTitulo | null> {
    const all = await this.listTitulosCache();
    return all.find((item) => item.id === id) ?? null;
  }

  async upsertTituloCache(titulo: LaraTitulo): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `
          MERGE INTO LARA_TITULOS_CACHE t
          USING (SELECT :id AS ID FROM DUAL) s
            ON (t.ID = s.ID)
          WHEN MATCHED THEN UPDATE SET
            CODCLI = :codcli,
            DUPLICATA = :duplicata,
            PRESTACAO = :prestacao,
            NUMTRANSVENDA = :numtransvenda,
            NUMNOTA = :numnota,
            VALOR = :valor,
            VLRECEBER = :vlreceber,
            VLDESC = :vldesc,
            CMULTA_PREV = :cmultaPrev,
            PERCMULTA = :percmulta,
            VENCIMENTO = CASE WHEN :vencimento IS NULL THEN NULL ELSE TO_DATE(:vencimento, 'YYYY-MM-DD') END,
            DTEMISSAO = CASE WHEN :dtemissao IS NULL THEN NULL ELSE TO_DATE(:dtemissao, 'YYYY-MM-DD') END,
            DTRECEBIMENTO_PREVISTO = CASE WHEN :dtrecebPrev IS NULL THEN NULL ELSE TO_DATE(:dtrecebPrev, 'YYYY-MM-DD') END,
            DIAS_ATRASO = :diasAtraso,
            CODCOB = :codcob,
            COBRANCA = :cobranca,
            RCA = :rca,
            STATUS_TITULO = :statusTitulo,
            BOLETO_DISPONIVEL = :boletoDisponivel,
            PIX_DISPONIVEL = :pixDisponivel,
            TITULO_COM_DATA_PREVISTA = :tituloComDataPrevista,
            FILIAL = :filial,
            CLIENTE = :cliente,
            FANTASIA = :fantasia,
            TELEFONE = :telefone,
            ETAPA_REGUA = :etapaRegua,
            ULTIMA_ACAO = :ultimaAcao,
            RESPONSAVEL = :responsavel,
            UPDATED_AT = SYSTIMESTAMP
          WHEN NOT MATCHED THEN INSERT (
            ID, CODCLI, DUPLICATA, PRESTACAO, NUMTRANSVENDA, NUMNOTA,
            VALOR, VLRECEBER, VLDESC, CMULTA_PREV, PERCMULTA,
            VENCIMENTO, DTEMISSAO, DTRECEBIMENTO_PREVISTO, DIAS_ATRASO,
            CODCOB, COBRANCA, RCA, STATUS_TITULO,
            BOLETO_DISPONIVEL, PIX_DISPONIVEL, TITULO_COM_DATA_PREVISTA,
            FILIAL, CLIENTE, FANTASIA, TELEFONE, ETAPA_REGUA, ULTIMA_ACAO, RESPONSAVEL
          ) VALUES (
            :id, :codcli, :duplicata, :prestacao, :numtransvenda, :numnota,
            :valor, :vlreceber, :vldesc, :cmultaPrev, :percmulta,
            CASE WHEN :vencimento IS NULL THEN NULL ELSE TO_DATE(:vencimento, 'YYYY-MM-DD') END,
            CASE WHEN :dtemissao IS NULL THEN NULL ELSE TO_DATE(:dtemissao, 'YYYY-MM-DD') END,
            CASE WHEN :dtrecebPrev IS NULL THEN NULL ELSE TO_DATE(:dtrecebPrev, 'YYYY-MM-DD') END,
            :diasAtraso, :codcob, :cobranca, :rca, :statusTitulo,
            :boletoDisponivel, :pixDisponivel, :tituloComDataPrevista,
            :filial, :cliente, :fantasia, :telefone, :etapaRegua, :ultimaAcao, :responsavel
          )
          `,
          {
            id: titulo.id,
            codcli: Number(titulo.codcli),
            duplicata: titulo.duplicata,
            prestacao: titulo.prestacao,
            numtransvenda: titulo.numtransvenda || 0,
            numnota: titulo.numnota || 0,
            valor: roundMoney(titulo.valor),
            vlreceber: roundMoney(titulo.vlreceber || titulo.valor),
            vldesc: roundMoney(titulo.vldesc || 0),
            cmultaPrev: roundMoney(titulo.cmulta_prev || 0),
            percmulta: titulo.percmulta || 0,
            vencimento: titulo.vencimento || null,
            dtemissao: titulo.dtemissao || null,
            dtrecebPrev: titulo.dtrecebimento_previsto || null,
            diasAtraso: titulo.dias_atraso,
            codcob: titulo.codcob || "",
            cobranca: titulo.cobranca || "",
            rca: titulo.rca || "",
            statusTitulo: titulo.status_atendimento,
            boletoDisponivel: titulo.boleto_disponivel ? 1 : 0,
            pixDisponivel: titulo.pix_disponivel ? 1 : 0,
            tituloComDataPrevista: titulo.titulo_com_data_prevista ? 1 : 0,
            filial: titulo.filial,
            cliente: titulo.cliente || "",
            fantasia: titulo.fantasia || titulo.cliente || "",
            telefone: titulo.telefone || "",
            etapaRegua: titulo.etapa_regua || "-",
            ultimaAcao: titulo.ultima_acao || "Sincronizado Oracle",
            responsavel: titulo.responsavel || "Lara Automacao",
          },
        );
      },
      () => {
        const idx = memoryStore.titulos.findIndex((item) => item.id === titulo.id);
        if (idx >= 0) memoryStore.titulos[idx] = { ...titulo };
        else memoryStore.titulos.push({ ...titulo });
      },
    );
  }

  async deleteTituloCacheById(id: string): Promise<void> {
    await execDml(`DELETE FROM LARA_TITULOS_CACHE WHERE ID = :id`, { id });
  }

  async upsertTitulosCacheBatch(titulos: LaraTitulo[]): Promise<void> {
    if (!titulos.length) return;

    const deduped = Array.from(
      new Map(titulos.map((item) => [item.id, item])).values(),
    );
    const chunks = splitInChunks(deduped, UPSERT_TITULOS_BATCH_SIZE);
    for (const chunk of chunks) {
      await withOperationalFallback(
        async () => {
          const binds: Record<string, unknown> = {};
          const rowsSql = chunk.map((titulo, index) => {
            binds[`id${index}`] = titulo.id;
            binds[`codcli${index}`] = Number(titulo.codcli);
            binds[`duplicata${index}`] = titulo.duplicata;
            binds[`prestacao${index}`] = titulo.prestacao;
            binds[`numtransvenda${index}`] = titulo.numtransvenda || 0;
            binds[`numnota${index}`] = titulo.numnota || 0;
            binds[`valor${index}`] = roundMoney(titulo.valor);
            binds[`vlreceber${index}`] = roundMoney(titulo.vlreceber || titulo.valor);
            binds[`vldesc${index}`] = roundMoney(titulo.vldesc || 0);
            binds[`cmultaPrev${index}`] = roundMoney(titulo.cmulta_prev || 0);
            binds[`percmulta${index}`] = titulo.percmulta || 0;
            binds[`vencimento${index}`] = titulo.vencimento || null;
            binds[`dtemissao${index}`] = titulo.dtemissao || null;
            binds[`dtrecebPrev${index}`] = titulo.dtrecebimento_previsto || null;
            binds[`diasAtraso${index}`] = titulo.dias_atraso;
            binds[`codcob${index}`] = titulo.codcob || "";
            binds[`cobranca${index}`] = titulo.cobranca || "";
            binds[`rca${index}`] = titulo.rca || "";
            binds[`statusTitulo${index}`] = titulo.status_atendimento;
            binds[`boletoDisponivel${index}`] = titulo.boleto_disponivel ? 1 : 0;
            binds[`pixDisponivel${index}`] = titulo.pix_disponivel ? 1 : 0;
            binds[`tituloComDataPrevista${index}`] = titulo.titulo_com_data_prevista ? 1 : 0;
            binds[`filial${index}`] = titulo.filial;
            binds[`cliente${index}`] = titulo.cliente || "";
            binds[`fantasia${index}`] = titulo.fantasia || titulo.cliente || "";
            binds[`telefone${index}`] = titulo.telefone || "";
            binds[`etapaRegua${index}`] = titulo.etapa_regua || "-";
            binds[`ultimaAcao${index}`] = titulo.ultima_acao || "Sincronizado Oracle";
            binds[`responsavel${index}`] = titulo.responsavel || "Lara Automacao";

            return `
            SELECT
              :id${index} AS ID, :codcli${index} AS CODCLI,
              :duplicata${index} AS DUPLICATA, :prestacao${index} AS PRESTACAO,
              :numtransvenda${index} AS NUMTRANSVENDA, :numnota${index} AS NUMNOTA,
              :valor${index} AS VALOR, :vlreceber${index} AS VLRECEBER,
              :vldesc${index} AS VLDESC, :cmultaPrev${index} AS CMULTA_PREV,
              :percmulta${index} AS PERCMULTA,
              CASE WHEN :vencimento${index} IS NULL THEN NULL ELSE TO_DATE(:vencimento${index}, 'YYYY-MM-DD') END AS VENCIMENTO,
              CASE WHEN :dtemissao${index} IS NULL THEN NULL ELSE TO_DATE(:dtemissao${index}, 'YYYY-MM-DD') END AS DTEMISSAO,
              CASE WHEN :dtrecebPrev${index} IS NULL THEN NULL ELSE TO_DATE(:dtrecebPrev${index}, 'YYYY-MM-DD') END AS DTRECEBIMENTO_PREVISTO,
              :diasAtraso${index} AS DIAS_ATRASO,
              :codcob${index} AS CODCOB, :cobranca${index} AS COBRANCA, :rca${index} AS RCA,
              :statusTitulo${index} AS STATUS_TITULO,
              :boletoDisponivel${index} AS BOLETO_DISPONIVEL,
              :pixDisponivel${index} AS PIX_DISPONIVEL,
              :tituloComDataPrevista${index} AS TITULO_COM_DATA_PREVISTA,
              :filial${index} AS FILIAL, :cliente${index} AS CLIENTE,
              :fantasia${index} AS FANTASIA, :telefone${index} AS TELEFONE,
              :etapaRegua${index} AS ETAPA_REGUA,
              :ultimaAcao${index} AS ULTIMA_ACAO, :responsavel${index} AS RESPONSAVEL
            FROM DUAL
            `;
          });

          try {
            await execDml(
              `
              MERGE INTO LARA_TITULOS_CACHE t
              USING ( ${rowsSql.join("\nUNION ALL\n")} ) s ON (t.ID = s.ID)
              WHEN MATCHED THEN UPDATE SET
                CODCLI = s.CODCLI, DUPLICATA = s.DUPLICATA, PRESTACAO = s.PRESTACAO,
                NUMTRANSVENDA = s.NUMTRANSVENDA, NUMNOTA = s.NUMNOTA,
                VALOR = s.VALOR, VLRECEBER = s.VLRECEBER, VLDESC = s.VLDESC,
                CMULTA_PREV = s.CMULTA_PREV, PERCMULTA = s.PERCMULTA,
                VENCIMENTO = s.VENCIMENTO, DTEMISSAO = s.DTEMISSAO,
                DTRECEBIMENTO_PREVISTO = s.DTRECEBIMENTO_PREVISTO, DIAS_ATRASO = s.DIAS_ATRASO,
                CODCOB = s.CODCOB, COBRANCA = s.COBRANCA, RCA = s.RCA,
                STATUS_TITULO = s.STATUS_TITULO,
                BOLETO_DISPONIVEL = s.BOLETO_DISPONIVEL, PIX_DISPONIVEL = s.PIX_DISPONIVEL,
                TITULO_COM_DATA_PREVISTA = s.TITULO_COM_DATA_PREVISTA,
                FILIAL = s.FILIAL, CLIENTE = s.CLIENTE, FANTASIA = s.FANTASIA,
                TELEFONE = s.TELEFONE, ETAPA_REGUA = s.ETAPA_REGUA,
                ULTIMA_ACAO = s.ULTIMA_ACAO, RESPONSAVEL = s.RESPONSAVEL,
                UPDATED_AT = SYSTIMESTAMP
              WHEN NOT MATCHED THEN INSERT (
                ID, CODCLI, DUPLICATA, PRESTACAO, NUMTRANSVENDA, NUMNOTA,
                VALOR, VLRECEBER, VLDESC, CMULTA_PREV, PERCMULTA,
                VENCIMENTO, DTEMISSAO, DTRECEBIMENTO_PREVISTO, DIAS_ATRASO,
                CODCOB, COBRANCA, RCA, STATUS_TITULO,
                BOLETO_DISPONIVEL, PIX_DISPONIVEL, TITULO_COM_DATA_PREVISTA,
                FILIAL, CLIENTE, FANTASIA, TELEFONE, ETAPA_REGUA, ULTIMA_ACAO, RESPONSAVEL
              ) VALUES (
                s.ID, s.CODCLI, s.DUPLICATA, s.PRESTACAO, s.NUMTRANSVENDA, s.NUMNOTA,
                s.VALOR, s.VLRECEBER, s.VLDESC, s.CMULTA_PREV, s.PERCMULTA,
                s.VENCIMENTO, s.DTEMISSAO, s.DTRECEBIMENTO_PREVISTO, s.DIAS_ATRASO,
                s.CODCOB, s.COBRANCA, s.RCA, s.STATUS_TITULO,
                s.BOLETO_DISPONIVEL, s.PIX_DISPONIVEL, s.TITULO_COM_DATA_PREVISTA,
                s.FILIAL, s.CLIENTE, s.FANTASIA, s.TELEFONE, s.ETAPA_REGUA, s.ULTIMA_ACAO, s.RESPONSAVEL
              )
              `,
              binds,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("ORA-00001")) throw error;
            for (const titulo of chunk) {
              await this.upsertTituloCache(titulo);
            }
          }
        },
        () => {
          for (const titulo of chunk) {
            const idx = memoryStore.titulos.findIndex((item) => item.id === titulo.id);
            if (idx >= 0) memoryStore.titulos[idx] = { ...titulo };
            else memoryStore.titulos.push({ ...titulo });
          }
        },
      );
    }
  }

  async markCacheForFullSync(markerTs: string): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `
          UPDATE LARA_TITULOS_CACHE
          SET UPDATED_AT = TO_TIMESTAMP(:markerTs, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { markerTs },
        );
        await execDml(
          `
          UPDATE LARA_CLIENTES_CACHE
          SET UPDATED_AT = TO_TIMESTAMP(:markerTs, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { markerTs },
        );
      },
      () => undefined,
    );
  }

  async pruneCacheAfterFullSync(
    cutoffTs: string,
    touchedTitleIds: string[],
    touchedCodclis: string[],
  ): Promise<{ titulosRemovidos: number; clientesRemovidos: number }> {
    return withOperationalFallback(
      async () => {
        const cutoff = cutoffTs;
        const staleTitulosBefore = await queryOne<{ CNT: number }>(
          `
          SELECT COUNT(*) AS CNT
          FROM LARA_TITULOS_CACHE
          WHERE UPDATED_AT = TO_TIMESTAMP(:cutoff, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { cutoff },
        );
        const staleClientesBefore = await queryOne<{ CNT: number }>(
          `
          SELECT COUNT(*) AS CNT
          FROM LARA_CLIENTES_CACHE
          WHERE UPDATED_AT = TO_TIMESTAMP(:cutoff, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { cutoff },
        );

        await execDml(
          `
          DELETE FROM LARA_TITULOS_CACHE
          WHERE UPDATED_AT = TO_TIMESTAMP(:cutoff, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { cutoff },
        );
        await execDml(
          `
          DELETE FROM LARA_CLIENTES_CACHE
          WHERE UPDATED_AT = TO_TIMESTAMP(:cutoff, 'YYYY-MM-DD HH24:MI:SS.FF3')
          `,
          { cutoff },
        );

        return {
          titulosRemovidos: Number((staleTitulosBefore as any)?.CNT ?? 0),
          clientesRemovidos: Number((staleClientesBefore as any)?.CNT ?? 0),
        };
      },
      () => {
        const beforeTitulos = memoryStore.titulos.length;
        const beforeClientes = memoryStore.clientes.length;
        const touchedTitulos = new Set(touchedTitleIds);
        const touchedClientes = new Set(touchedCodclis.map((item) => String(item)));

        memoryStore.titulos = touchedTitulos.size
          ? memoryStore.titulos.filter((item) => touchedTitulos.has(item.id))
          : [];
        memoryStore.clientes = touchedClientes.size
          ? memoryStore.clientes.filter((item) => touchedClientes.has(String(item.codcli)))
          : [];

        return {
          titulosRemovidos: Math.max(0, beforeTitulos - memoryStore.titulos.length),
          clientesRemovidos: Math.max(0, beforeClientes - memoryStore.clientes.length),
        };
      },
    );
  }

  async purgeInvalidCodcob(
    validCodcobs: string[],
  ): Promise<{ titulosRemovidos: number; clientesRemovidos: number }> {
    return withOperationalFallback(
      async () => {
        const placeholders = validCodcobs.map((_, i) => `:c${i}`).join(",");
        const binds: Record<string, string> = {};
        validCodcobs.forEach((v, i) => { binds[`c${i}`] = v; });

        const countTitulos = await queryOne<{ CNT: number }>(
          `SELECT COUNT(*) AS CNT FROM LARA_TITULOS_CACHE WHERE CODCOB NOT IN (${placeholders}) OR CODCOB IS NULL`,
          binds,
        );
        const countClientes = await queryOne<{ CNT: number }>(
          `SELECT COUNT(*) AS CNT FROM LARA_CLIENTES_CACHE WHERE CODCLI NOT IN (SELECT DISTINCT CODCLI FROM LARA_TITULOS_CACHE)`,
          {},
        );

        await execDml(
          `DELETE FROM LARA_TITULOS_CACHE WHERE CODCOB NOT IN (${placeholders}) OR CODCOB IS NULL`,
          binds,
        );
        await execDml(
          `DELETE FROM LARA_CLIENTES_CACHE WHERE CODCLI NOT IN (SELECT DISTINCT CODCLI FROM LARA_TITULOS_CACHE)`,
          {},
        );

        return {
          titulosRemovidos: Number((countTitulos as any)?.CNT ?? 0),
          clientesRemovidos: Number((countClientes as any)?.CNT ?? 0),
        };
      },
      () => ({ titulosRemovidos: 0, clientesRemovidos: 0 }),
    );
  }

  async findMessageByIdempotency(idempotencyKey: string): Promise<MessageLogRow | null> {
    return withOperationalFallback(
      async () => {
        const row = await queryOne<MessageLogRow>(
          `
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, TELEFONE, MESSAGE_TEXT, DIRECTION, ORIGEM, ETAPA, DUPLICS,
            VALOR_TOTAL, PAYLOAD_JSON, STATUS, SENT_AT, RECEIVED_AT, MESSAGE_TYPE, OPERATOR_NAME,
            IDEMPOTENCY_KEY, CREATED_AT
          FROM LARA_COB_MSG_LOG
          WHERE IDEMPOTENCY_KEY = :idempotencyKey
          ORDER BY CREATED_AT DESC
          `,
          { idempotencyKey },
        );
        return row ?? null;
      },
      () => memoryStore.mensagens.find((item) => item.idempotency_key === idempotencyKey) ?? null,
    );
  }

  async addMessageLog(input: Omit<MessageLogRow, "id" | "created_at"> & { id?: string }): Promise<MessageLogRow> {
    const row: MessageLogRow = {
      id: input.id || generateLaraId("MSG"),
      wa_id: input.wa_id,
      codcli: input.codcli ?? null,
      cliente: input.cliente || "",
      telefone: input.telefone || "",
      message_text: maskSensitiveText(input.message_text || ""),
      direction: input.direction,
      origem: input.origem || "",
      etapa: input.etapa || "",
      duplics: (input.duplics || "").slice(0, 499),
      valor_total: roundMoney(toNumber(input.valor_total)),
      payload_json: JSON.stringify(
        sanitizePayloadJson(parseJsonSafe<Record<string, unknown>>(input.payload_json || "{}", {})),
      ),
      status: input.status || "processado",
      sent_at: input.sent_at || "",
      received_at: input.received_at || "",
      message_type: input.message_type || "texto",
      operator_name: input.operator_name || "Lara",
      idempotency_key: input.idempotency_key || "",
      created_at: dateToIsoDateTime(new Date()),
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_COB_MSG_LOG (
            ID, WA_ID, CODCLI, CLIENTE, TELEFONE, MESSAGE_TEXT, DIRECTION, ORIGEM, ETAPA, DUPLICS,
            VALOR_TOTAL, PAYLOAD_JSON, STATUS, SENT_AT, RECEIVED_AT, MESSAGE_TYPE, OPERATOR_NAME,
            IDEMPOTENCY_KEY, CREATED_AT
          ) VALUES (
            :id, :waId, :codcli, :cliente, :telefone, :messageText, :direction, :origem, :etapa, :duplics,
            :valorTotal, :payloadJson, :status,
            CASE WHEN :sentAt IS NULL OR :sentAt = '' THEN NULL ELSE TO_TIMESTAMP(:sentAt, 'YYYY-MM-DD HH24:MI:SS') END,
            CASE WHEN :receivedAt IS NULL OR :receivedAt = '' THEN NULL ELSE TO_TIMESTAMP(:receivedAt, 'YYYY-MM-DD HH24:MI:SS') END,
            :messageType, :operatorName, :idempotencyKey, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            waId: row.wa_id,
            codcli: row.codcli,
            cliente: row.cliente,
            telefone: row.telefone,
            messageText: row.message_text,
            direction: row.direction,
            origem: row.origem,
            etapa: row.etapa,
            duplics: row.duplics,
            valorTotal: row.valor_total,
            payloadJson: row.payload_json,
            status: row.status,
            sentAt: row.sent_at,
            receivedAt: row.received_at,
            messageType: row.message_type,
            operatorName: row.operator_name,
            idempotencyKey: row.idempotency_key,
          },
        );
      },
      () => {
        memoryStore.mensagens.unshift(row);
      },
    );

    return row;
  }

  async listMessagesByWaId(waId: string): Promise<MessageLogRow[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<MessageLogRow>(
          `
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, TELEFONE, MESSAGE_TEXT, DIRECTION, ORIGEM, ETAPA, DUPLICS,
            VALOR_TOTAL, PAYLOAD_JSON, STATUS, SENT_AT, RECEIVED_AT, MESSAGE_TYPE, OPERATOR_NAME,
            IDEMPOTENCY_KEY, CREATED_AT
          FROM LARA_COB_MSG_LOG
          WHERE WA_ID = :waId
          ORDER BY CREATED_AT ASC
          `,
          { waId },
        );
        return rows.map(mapMessageLogRow);
      },
      () => memoryStore.mensagens.filter((item) => item.wa_id === waId).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }

  async listMessagesByCodcli(codcli: number, options?: { diasRetroativos?: number; maxRows?: number }): Promise<MessageLogRow[]> {
    const diasRetroativos = options?.diasRetroativos ?? 90;
    const maxRows = options?.maxRows ?? 500;
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<MessageLogRow>(
          `
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, TELEFONE, MESSAGE_TEXT, DIRECTION, ORIGEM, ETAPA, DUPLICS,
            VALOR_TOTAL, PAYLOAD_JSON, STATUS, SENT_AT, RECEIVED_AT, MESSAGE_TYPE, OPERATOR_NAME,
            IDEMPOTENCY_KEY, CREATED_AT
          FROM LARA_COB_MSG_LOG
          WHERE CODCLI = :codcli
            AND CREATED_AT >= SYSDATE - :dias
          ORDER BY CREATED_AT ASC
          FETCH FIRST :maxRows ROWS ONLY
          `,
          { codcli, dias: diasRetroativos, maxRows },
        );
        return rows.map(mapMessageLogRow);
      },
      () => {
        const cutoff = new Date(Date.now() - diasRetroativos * 24 * 60 * 60 * 1000).toISOString();
        return memoryStore.mensagens
          .filter((item) => Number(item.codcli ?? 0) === codcli && item.created_at >= cutoff)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, maxRows);
      },
    );
  }

  async listAllMessages(limit = 2000): Promise<MessageLogRow[]> {
    return withOperationalFallback(
      async () => {
        // Usa FETCH FIRST (Oracle 12c+) que é index-friendly com ORDER BY CREATED_AT DESC
        const rows = await queryRows<MessageLogRow>(
          `
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, TELEFONE, MESSAGE_TEXT, DIRECTION, ORIGEM, ETAPA, DUPLICS,
            VALOR_TOTAL, PAYLOAD_JSON, STATUS, SENT_AT, RECEIVED_AT, MESSAGE_TYPE, OPERATOR_NAME,
            IDEMPOTENCY_KEY, CREATED_AT
          FROM LARA_COB_MSG_LOG
          ORDER BY CREATED_AT DESC
          FETCH FIRST :limitRows ROWS ONLY
          `,
          { limitRows: limit },
        );
        return rows.map(mapMessageLogRow);
      },
      () => [...memoryStore.mensagens].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit),
    );
  }

  async listCases(): Promise<LaraCaseItem[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<CaseRow>(`
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, TIPO_CASE, ETAPA, DUPLICATAS, VALOR_TOTAL, FORMA_PAGAMENTO,
            DETALHE, ORIGEM, RESPONSAVEL, STATUS, CREATED_AT, UPDATED_AT
          FROM LARA_CASES
          ORDER BY CREATED_AT DESC
        `);
        return rows.map(mapCaseRow);
      },
      () => [...memoryStore.cases].sort((a, b) => b.data_hora.localeCompare(a.data_hora)),
    );
  }

  async listCasesByCodcli(codcli: number): Promise<LaraCaseItem[]> {
    const cases = await this.listCases();
    return cases.filter((item) => item.codcli === String(codcli));
  }

  async createCase(input: {
    wa_id?: string;
    codcli?: number;
    cliente?: string;
    tipo_case: string;
    etapa?: string;
    duplicatas?: string;
    valor_total?: number;
    forma_pagamento?: string;
    detalhe: string;
    origem: string;
    responsavel: string;
    status?: string;
  }): Promise<LaraCaseItem> {
    const caseItem: LaraCaseItem = {
      id: generateLaraId("CASE"),
      data_hora: dateToIsoDateTime(new Date()),
      cliente: input.cliente || "",
      codcli: input.codcli ? String(input.codcli) : "",
      wa_id: input.wa_id || "",
      acao: input.tipo_case,
      etapa: input.etapa || "",
      duplicatas: input.duplicatas || "",
      valor_total: roundMoney(toNumber(input.valor_total)),
      forma_pagamento: input.forma_pagamento || "",
      origem: input.origem,
      responsavel: input.responsavel,
      detalhe: input.detalhe,
      status: input.status || "aberto",
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_CASES (
            ID, WA_ID, CODCLI, CLIENTE, TIPO_CASE, ETAPA, DUPLICATAS, VALOR_TOTAL, FORMA_PAGAMENTO,
            DETALHE, ORIGEM, RESPONSAVEL, STATUS, CREATED_AT, UPDATED_AT
          ) VALUES (
            :id, :waId, :codcli, :cliente, :tipoCase, :etapa, :duplicatas, :valorTotal, :formaPagamento,
            :detalhe, :origem, :responsavel, :status, SYSTIMESTAMP, SYSTIMESTAMP
          )
          `,
          {
            id: caseItem.id,
            waId: caseItem.wa_id || null,
            codcli: caseItem.codcli ? Number(caseItem.codcli) : null,
            cliente: caseItem.cliente,
            tipoCase: caseItem.acao,
            etapa: caseItem.etapa,
            duplicatas: caseItem.duplicatas,
            valorTotal: caseItem.valor_total,
            formaPagamento: caseItem.forma_pagamento,
            detalhe: caseItem.detalhe,
            origem: caseItem.origem,
            responsavel: caseItem.responsavel,
            status: caseItem.status,
          },
        );
      },
      () => {
        memoryStore.cases.unshift(caseItem);
      },
    );

    return caseItem;
  }

  async listPromessas(): Promise<PromiseRow[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<PromiseRow>(`
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, DUPLICATAS, VALOR_TOTAL, DATA_PROMETIDA, OBSERVACAO,
            STATUS, ORIGEM, CREATED_AT, UPDATED_AT
          FROM LARA_PROMESSAS_PAGAMENTO
          ORDER BY CREATED_AT DESC
        `);
        return rows.map(mapPromiseRow);
      },
      () => [...memoryStore.promessas],
    );
  }

  async createPromessa(input: {
    wa_id?: string;
    codcli?: number;
    cliente?: string;
    duplicatas?: string;
    valor_total?: number;
    data_prometida: string;
    observacao?: string;
    status?: string;
    origem: string;
  }): Promise<PromiseRow> {
    const row: PromiseRow = {
      id: generateLaraId("PROM"),
      wa_id: input.wa_id || "",
      codcli: input.codcli ?? null,
      cliente: input.cliente || "",
      duplicatas: input.duplicatas || "",
      valor_total: roundMoney(toNumber(input.valor_total)),
      data_prometida: input.data_prometida,
      observacao: input.observacao || "",
      status: input.status || "registrada",
      origem: input.origem,
      created_at: dateToIsoDateTime(new Date()),
      updated_at: dateToIsoDateTime(new Date()),
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_PROMESSAS_PAGAMENTO (
            ID, WA_ID, CODCLI, CLIENTE, DUPLICATAS, VALOR_TOTAL, DATA_PROMETIDA, OBSERVACAO, STATUS, ORIGEM, CREATED_AT, UPDATED_AT
          ) VALUES (
            :id, :waId, :codcli, :cliente, :duplicatas, :valorTotal, TO_DATE(:dataPrometida, 'YYYY-MM-DD'),
            :observacao, :status, :origem, SYSTIMESTAMP, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            waId: row.wa_id || null,
            codcli: row.codcli,
            cliente: row.cliente,
            duplicatas: row.duplicatas,
            valorTotal: row.valor_total,
            dataPrometida: row.data_prometida,
            observacao: row.observacao,
            status: row.status,
            origem: row.origem,
          },
        );
      },
      () => {
        memoryStore.promessas.unshift(row);
      },
    );

    return row;
  }

  async updatePromessaStatus(id: string, status: string): Promise<void> {
    const normalizedStatus = String(status || "").trim();
    await withOperationalFallback(
      async () => {
        await execDml(
          `UPDATE LARA_PROMESSAS_PAGAMENTO SET STATUS = :status, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`,
          { status: normalizedStatus, id },
        );
      },
      () => {
        const found = memoryStore.promessas.find((p) => p.id === id);
        if (found) found.status = normalizedStatus;
      },
    );
  }

  async listNegociacoes(limit = 500): Promise<LaraNegociacaoItem[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<NegotiationRow>(
          `
          SELECT *
          FROM (
            SELECT
              ID, CODCLI, WA_ID, FILIAL, DUPLICATA, PRESTACAO, NUMTRANSVENDA,
              DTVENC_ORIGINAL, DTVENC_PRORROGADA, VALOR_ORIGINAL, VALOR_NEGOCIADO,
              TIPO_NEGOCIACAO, STATUS_NEGOCIACAO, PROXIMA_COBRANCA_EM, ORIGEM, OBSERVACAO,
              IDEMPOTENCY_KEY, CREATED_AT, UPDATED_AT
            FROM LARA_NEGOCIACOES
            ORDER BY CREATED_AT DESC
          ) WHERE ROWNUM <= :limitRows
          `,
          { limitRows: Math.max(1, limit) },
        );
        return rows.map(mapNegotiationRow);
      },
      () => [...memoryStore.negociacoes].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit),
    );
  }

  async createNegociacao(input: {
    codcli?: number;
    wa_id?: string;
    filial?: string;
    duplicata?: string;
    prestacao?: string;
    numtransvenda?: number;
    dtvenc_original?: string;
    dtvenc_prorrogada?: string;
    valor_original?: number;
    valor_negociado?: number;
    tipo_negociacao?: string;
    status_negociacao?: string;
    proxima_cobranca_em?: string;
    origem?: string;
    observacao?: string;
    idempotency_key?: string;
  }): Promise<LaraNegociacaoItem> {
    const nowIso = dateToIsoDateTime(new Date());
    const row: LaraNegociacaoItem = {
      id: generateLaraId("NEG"),
      codcli: input.codcli ? String(input.codcli) : "",
      wa_id: input.wa_id || "",
      filial: input.filial || "",
      duplicata: input.duplicata || "",
      prestacao: input.prestacao || "",
      numtransvenda: Number(input.numtransvenda ?? 0),
      dtvenc_original: input.dtvenc_original || "",
      dtvenc_prorrogada: input.dtvenc_prorrogada || "",
      valor_original: roundMoney(toNumber(input.valor_original)),
      valor_negociado: roundMoney(toNumber(input.valor_negociado)),
      tipo_negociacao: input.tipo_negociacao || "PRORROGACAO",
      status_negociacao: input.status_negociacao || "ATIVA",
      proxima_cobranca_em: input.proxima_cobranca_em || nowIso,
      origem: input.origem || "n8n",
      observacao: input.observacao || "",
      idempotency_key: input.idempotency_key || "",
      created_at: nowIso,
      updated_at: nowIso,
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_NEGOCIACOES (
            ID, CODCLI, WA_ID, FILIAL, DUPLICATA, PRESTACAO, NUMTRANSVENDA,
            DTVENC_ORIGINAL, DTVENC_PRORROGADA, VALOR_ORIGINAL, VALOR_NEGOCIADO,
            TIPO_NEGOCIACAO, STATUS_NEGOCIACAO, PROXIMA_COBRANCA_EM, ORIGEM, OBSERVACAO,
            IDEMPOTENCY_KEY, CREATED_AT, UPDATED_AT
          ) VALUES (
            :id, :codcli, :waId, :filial, :duplicata, :prestacao, :numtransvenda,
            CASE WHEN :dtvencOriginal IS NULL OR :dtvencOriginal = '' THEN NULL ELSE TO_DATE(:dtvencOriginal, 'YYYY-MM-DD') END,
            CASE WHEN :dtvencProrrogada IS NULL OR :dtvencProrrogada = '' THEN NULL ELSE TO_DATE(:dtvencProrrogada, 'YYYY-MM-DD') END,
            :valorOriginal, :valorNegociado,
            :tipoNegociacao, :statusNegociacao, TO_TIMESTAMP(:proximaCobrancaEm, 'YYYY-MM-DD HH24:MI:SS'),
            :origem, :observacao, :idempotencyKey, SYSTIMESTAMP, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            codcli: row.codcli ? Number(row.codcli) : null,
            waId: row.wa_id || null,
            filial: row.filial || null,
            duplicata: row.duplicata || null,
            prestacao: row.prestacao || null,
            numtransvenda: Number.isFinite(row.numtransvenda) && row.numtransvenda > 0 ? row.numtransvenda : null,
            dtvencOriginal: row.dtvenc_original || null,
            dtvencProrrogada: row.dtvenc_prorrogada || null,
            valorOriginal: row.valor_original,
            valorNegociado: row.valor_negociado,
            tipoNegociacao: row.tipo_negociacao,
            statusNegociacao: row.status_negociacao,
            proximaCobrancaEm: row.proxima_cobranca_em.replace("T", " ").slice(0, 19),
            origem: row.origem,
            observacao: row.observacao,
            idempotencyKey: row.idempotency_key || null,
          },
        );
      },
      () => {
        memoryStore.negociacoes.unshift(row);
      },
    );

    return row;
  }

  async listOptouts(): Promise<LaraOptoutItem[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<OptoutRow>(`
          SELECT
            ID, WA_ID, CODCLI, CLIENTE, MOTIVO, ATIVO, ORIGEM, OBSERVACAO, DATA_CRIACAO, DATA_ATUALIZACAO
          FROM LARA_OPTOUT
          ORDER BY DATA_ATUALIZACAO DESC
        `);
        return rows.map(mapOptoutRow);
      },
      () => [...memoryStore.optouts].sort((a, b) => b.data_atualizacao.localeCompare(a.data_atualizacao)),
    );
  }

  async findActiveOptoutByWaId(waId: string): Promise<LaraOptoutItem | null> {
    const rows = await this.listOptouts();
    return rows.find((item) => item.wa_id === waId && item.ativo) ?? null;
  }

  async setOptout(input: {
    wa_id: string;
    codcli?: number;
    cliente?: string;
    motivo: string;
    ativo: boolean;
    origem: string;
    observacao?: string;
  }): Promise<LaraOptoutItem> {
    const existing = (await this.listOptouts()).find((item) => item.wa_id === input.wa_id);
    const row: LaraOptoutItem = {
      id: existing?.id ?? generateLaraId("OPTOUT"),
      wa_id: input.wa_id,
      codcli: input.codcli ? String(input.codcli) : existing?.codcli ?? "",
      cliente: input.cliente || existing?.cliente || "",
      motivo: input.motivo,
      ativo: input.ativo,
      origem: input.origem,
      observacao: input.observacao || "",
      data_criacao: existing?.data_criacao || dateToIsoDateTime(new Date()),
      data_atualizacao: dateToIsoDateTime(new Date()),
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          MERGE INTO LARA_OPTOUT t
          USING (SELECT :waId AS WA_ID FROM DUAL) s
            ON (t.WA_ID = s.WA_ID)
          WHEN MATCHED THEN UPDATE SET
            CODCLI = :codcli,
            CLIENTE = :cliente,
            MOTIVO = :motivo,
            ATIVO = :ativo,
            ORIGEM = :origem,
            OBSERVACAO = :observacao,
            DATA_ATUALIZACAO = SYSTIMESTAMP
          WHEN NOT MATCHED THEN INSERT (
            ID, WA_ID, CODCLI, CLIENTE, MOTIVO, ATIVO, ORIGEM, OBSERVACAO, DATA_CRIACAO, DATA_ATUALIZACAO
          ) VALUES (
            :id, :waId, :codcli, :cliente, :motivo, :ativo, :origem, :observacao, SYSTIMESTAMP, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            waId: row.wa_id,
            codcli: row.codcli ? Number(row.codcli) : null,
            cliente: row.cliente,
            motivo: row.motivo,
            ativo: row.ativo ? 1 : 0,
            origem: row.origem,
            observacao: row.observacao,
          },
        );
      },
      () => {
        const idx = memoryStore.optouts.findIndex((item) => item.wa_id === row.wa_id);
        if (idx >= 0) memoryStore.optouts[idx] = row;
        else memoryStore.optouts.unshift(row);
      },
    );

    return row;
  }

  async disableOptoutById(id: string): Promise<boolean> {
    return withOperationalFallback(
      async () => {
        const item = await queryOne<{ ID: string }>(
          `SELECT ID FROM LARA_OPTOUT WHERE ID = :id`,
          { id },
        );
        if (!item) return false;
        await execDml(
          `UPDATE LARA_OPTOUT SET ATIVO = 0, DATA_ATUALIZACAO = SYSTIMESTAMP WHERE ID = :id`,
          { id },
        );
        return true;
      },
      () => {
        const idx = memoryStore.optouts.findIndex((item) => item.id === id);
        if (idx < 0) return false;
        memoryStore.optouts[idx] = {
          ...memoryStore.optouts[idx],
          ativo: false,
          data_atualizacao: dateToIsoDateTime(new Date()),
        };
        return true;
      },
    );
  }

  async listReguaTemplates(): Promise<LaraReguaTemplate[]> {
    ensureMemoryDefaults();
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<ReguaTemplateRow>(`
          SELECT
            ID, ETAPA, NOME_TEMPLATE, CANAL, MENSAGEM_TEMPLATE, ATIVO, ORDEM_EXECUCAO, CREATED_AT, UPDATED_AT
          FROM LARA_REGUA_TEMPLATES
          ORDER BY ORDEM_EXECUCAO ASC, ETAPA ASC
        `);
        return rows.map(mapReguaTemplateRow);
      },
      () => [...memoryStore.templates].sort((a, b) => a.ordem_execucao - b.ordem_execucao),
    );
  }

  async replaceReguaTemplates(templates: Array<{
    id?: string;
    etapa: string;
    nome_template: string;
    canal: string;
    mensagem_template: string;
    ativo: boolean;
    ordem_execucao: number;
  }>): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(`DELETE FROM LARA_REGUA_TEMPLATES`);
        for (const template of templates) {
          await execDml(
            `
            INSERT INTO LARA_REGUA_TEMPLATES (
              ID, ETAPA, NOME_TEMPLATE, CANAL, MENSAGEM_TEMPLATE, ATIVO, ORDEM_EXECUCAO, CREATED_AT, UPDATED_AT
            ) VALUES (
              :id, :etapa, :nomeTemplate, :canal, :mensagemTemplate, :ativo, :ordemExecucao, SYSTIMESTAMP, SYSTIMESTAMP
            )
            `,
            {
              id: template.id || generateLaraId("TMP"),
              etapa: template.etapa,
              nomeTemplate: template.nome_template,
              canal: template.canal,
              mensagemTemplate: template.mensagem_template,
              ativo: template.ativo ? 1 : 0,
              ordemExecucao: template.ordem_execucao,
            },
          );
        }
      },
      () => {
        memoryStore.templates = templates.map((template) => ({
          id: template.id || generateLaraId("TMP"),
          etapa: template.etapa,
          nome_template: template.nome_template,
          canal: template.canal,
          mensagem_template: template.mensagem_template,
          ativo: template.ativo,
          ordem_execucao: template.ordem_execucao,
          created_at: dateToIsoDateTime(new Date()),
          updated_at: dateToIsoDateTime(new Date()),
        }));
      },
    );
  }

  async listReguaExecucoes(limit = 200): Promise<LaraReguaExecucao[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<ReguaExecucaoRow>(
          `
          SELECT * FROM (
            SELECT
              ID, ETAPA, DATA_HORA_EXECUCAO, ELEGIVEL, DISPARADA, RESPONDIDA, CONVERTIDA, ERRO,
              BLOQUEADO_OPTOUT, VALOR_IMPACTADO, STATUS, DETALHES_JSON, CREATED_AT
            FROM LARA_REGUA_EXECUCOES
            ORDER BY DATA_HORA_EXECUCAO DESC
          ) WHERE ROWNUM <= :limitRows
          `,
          { limitRows: Math.max(1, limit) },
        );
        return rows.map(mapReguaExecucaoRow);
      },
      () => [...memoryStore.execucoes].sort((a, b) => b.data_hora.localeCompare(a.data_hora)).slice(0, limit),
    );
  }

  async addReguaExecucao(input: {
    etapa: string;
    data_hora_execucao?: string;
    elegivel: number;
    disparada: number;
    respondida: number;
    convertida: number;
    erro: number;
    bloqueado_optout: number;
    valor_impactado: number;
    status: string;
    detalhes_json?: Record<string, unknown>;
  }): Promise<LaraReguaExecucao> {
    const execucao: LaraReguaExecucao = {
      id: generateLaraId("REGUA"),
      data_hora: input.data_hora_execucao || dateToIsoDateTime(new Date()),
      etapa: input.etapa,
      elegivel: input.elegivel,
      disparada: input.disparada,
      respondida: input.respondida,
      convertida: input.convertida,
      erro: input.erro,
      bloqueado_optout: input.bloqueado_optout,
      valor_impactado: roundMoney(input.valor_impactado),
      status: input.status,
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_REGUA_EXECUCOES (
            ID, ETAPA, DATA_HORA_EXECUCAO, ELEGIVEL, DISPARADA, RESPONDIDA, CONVERTIDA, ERRO, BLOQUEADO_OPTOUT,
            VALOR_IMPACTADO, STATUS, DETALHES_JSON, CREATED_AT
          ) VALUES (
            :id, :etapa,
            CASE WHEN :dataExecucao IS NULL THEN SYSTIMESTAMP ELSE TO_TIMESTAMP(:dataExecucao, 'YYYY-MM-DD HH24:MI:SS') END,
            :elegivel, :disparada, :respondida, :convertida, :erro, :bloqueadoOptout,
            :valorImpactado, :status, :detalhesJson, SYSTIMESTAMP
          )
          `,
          {
            id: execucao.id,
            etapa: execucao.etapa,
            dataExecucao: execucao.data_hora || null,
            elegivel: execucao.elegivel,
            disparada: execucao.disparada,
            respondida: execucao.respondida,
            convertida: execucao.convertida,
            erro: execucao.erro,
            bloqueadoOptout: execucao.bloqueado_optout,
            valorImpactado: execucao.valor_impactado,
            status: execucao.status,
            detalhesJson: JSON.stringify(input.detalhes_json ?? {}),
          },
        );
      },
      () => {
        memoryStore.execucoes.unshift(execucao);
      },
    );
    return execucao;
  }

  async listConfiguracoes(): Promise<LaraConfiguracao[]> {
    ensureMemoryDefaults();
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<LaraConfiguracao>(`
          SELECT ID, CHAVE, VALOR, DESCRICAO, UPDATED_AT
          FROM LARA_CONFIGURACOES
          ORDER BY CHAVE ASC
        `);
        return rows.map((row) => ({
          id: toStringSafe((row as any).ID || (row as any).id),
          chave: toStringSafe((row as any).CHAVE || (row as any).chave),
          valor: toStringSafe((row as any).VALOR || (row as any).valor),
          descricao: toStringSafe((row as any).DESCRICAO || (row as any).descricao),
          updated_at: dateToIsoDateTime((row as any).UPDATED_AT || (row as any).updated_at),
        }));
      },
      () => [...memoryStore.configuracoes],
    );
  }

  async getConfiguracao(chave: string): Promise<string | null> {
    const all = await this.listConfiguracoes();
    const found = all.find((item) => item.chave.toUpperCase() === chave.toUpperCase());
    return found?.valor ?? null;
  }

  async upsertConfiguracao(chave: string, valor: string, descricao?: string): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `
          MERGE INTO LARA_CONFIGURACOES t
          USING (SELECT :chave AS CHAVE FROM DUAL) s
             ON (t.CHAVE = s.CHAVE)
          WHEN MATCHED THEN
            UPDATE SET t.VALOR = :valor, t.DESCRICAO = :descricao, t.UPDATED_AT = SYSTIMESTAMP
          WHEN NOT MATCHED THEN
            INSERT (ID, CHAVE, VALOR, DESCRICAO, UPDATED_AT)
            VALUES (:id, :chave, :valor, :descricao, SYSTIMESTAMP)
          `,
          {
            id: generateLaraId("CFG"),
            chave,
            valor,
            descricao: descricao || "",
          },
        );
      },
      () => {
        const idx = memoryStore.configuracoes.findIndex((item) => item.chave.toUpperCase() === chave.toUpperCase());
        const row: LaraConfiguracao = {
          id: idx >= 0 ? memoryStore.configuracoes[idx].id : generateLaraId("CFG"),
          chave,
          valor,
          descricao: descricao || "",
          updated_at: dateToIsoDateTime(new Date()),
        };
        if (idx >= 0) memoryStore.configuracoes[idx] = row;
        else memoryStore.configuracoes.push(row);
      },
    );
  }

  async findIntegrationByIdempotency(idempotencyKey: string): Promise<IntegrationLogRow | null> {
    return withOperationalFallback(
      async () => {
        const row = await queryOne<IntegrationLogRow>(
          `
          SELECT
            ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
            ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
          FROM LARA_INTEGRACOES_LOG
          WHERE IDEMPOTENCY_KEY = :idempotencyKey
          ORDER BY CREATED_AT DESC
          `,
          { idempotencyKey },
        );
        return row ?? null;
      },
      () => memoryStore.integracoes.find((item) => item.idempotency_key === idempotencyKey) ?? null,
    );
  }

  async getLastIntegrationByType(tipo: string): Promise<IntegrationLogRow | null> {
    return withOperationalFallback(
      async () => {
        const row = await queryOne<IntegrationLogRow>(
          `
          SELECT
            ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
            ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
          FROM (
            SELECT
              ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
              ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
            FROM LARA_INTEGRACOES_LOG
            WHERE TIPO = :tipo
            ORDER BY CREATED_AT DESC
          )
          WHERE ROWNUM = 1
          `,
          { tipo },
        );
        return row ?? null;
      },
      () =>
        [...memoryStore.integracoes]
          .filter((item) => item.tipo === tipo)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    );
  }

  async addIntegrationLog(input: {
    integracao: string;
    tipo: string;
    request_json?: Record<string, unknown>;
    response_json?: Record<string, unknown>;
    status_http?: number;
    status_operacao: string;
    erro_resumo?: string;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<IntegrationLogRow> {
    const row: IntegrationLogRow = {
      id: generateLaraId("INT"),
      integracao: input.integracao,
      tipo: input.tipo,
      request_json: JSON.stringify(sanitizePayloadJson(input.request_json ?? {})),
      response_json: JSON.stringify(sanitizePayloadJson(input.response_json ?? {})),
      status_http: input.status_http ?? null,
      status_operacao: input.status_operacao,
      erro_resumo: maskSensitiveText(input.erro_resumo || ""),
      idempotency_key: input.idempotency_key || "",
      correlation_id: input.correlation_id || "",
      created_at: dateToIsoDateTime(new Date()),
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_INTEGRACOES_LOG (
            ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
            ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
          ) VALUES (
            :id, :integracao, :tipo, :requestJson, :responseJson, :statusHttp, :statusOperacao,
            :erroResumo, :idempotencyKey, :correlationId, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            integracao: row.integracao,
            tipo: row.tipo,
            requestJson: row.request_json,
            responseJson: row.response_json,
            statusHttp: row.status_http,
            statusOperacao: row.status_operacao,
            erroResumo: row.erro_resumo,
            idempotencyKey: row.idempotency_key,
            correlationId: row.correlation_id,
          },
        );
      },
      () => {
        memoryStore.integracoes.unshift(row);
      },
    );
    return row;
  }

  async addComplianceAudit(input: {
    wa_id: string;
    codcli?: number;
    tenant_id: string;
    jurisdicao: string;
    canal: string;
    acao: string;
    intencao: string;
    score_confianca: number;
    permitido: boolean;
    base_legal: string;
    razao_automatizada: string;
    revisao_humana_disponivel: boolean;
    detalhes_json?: Record<string, unknown>;
  }): Promise<LaraComplianceAuditItem> {
    const row: LaraComplianceAuditItem = {
      id: generateLaraId("CMP"),
      data_hora: dateToIsoDateTime(new Date()),
      wa_id: input.wa_id,
      codcli: input.codcli ? String(input.codcli) : "",
      tenant_id: input.tenant_id || "default",
      jurisdicao: (input.jurisdicao || "GLOBAL") as any,
      canal: (input.canal || "OUTRO") as any,
      acao: (input.acao || "resposta_padrao") as any,
      intencao: input.intencao || "neutro",
      score_confianca: roundMoney(toNumber(input.score_confianca)),
      permitido: Boolean(input.permitido),
      base_legal: input.base_legal || "",
      razao_automatizada: maskSensitiveText(input.razao_automatizada || ""),
      revisao_humana_disponivel: Boolean(input.revisao_humana_disponivel),
      detalhes: sanitizePayloadJson(input.detalhes_json ?? {}),
    };

    await withOperationalFallback(
      async () => {
        await execDml(
          `
          INSERT INTO LARA_COMPLIANCE_AUDIT (
            ID, WA_ID, CODCLI, TENANT_ID, JURISDICAO, CANAL, ACAO, INTENCAO, SCORE_CONFIANCA,
            PERMITIDO, BASE_LEGAL, RAZAO_AUTOMATIZADA, REVISAO_HUMANA_DISPONIVEL, DETALHES_JSON, CREATED_AT
          ) VALUES (
            :id, :waId, :codcli, :tenantId, :jurisdicao, :canal, :acao, :intencao, :scoreConfianca,
            :permitido, :baseLegal, :razaoAutomatizada, :revisaoHumanaDisponivel, :detalhesJson, SYSTIMESTAMP
          )
          `,
          {
            id: row.id,
            waId: row.wa_id,
            codcli: row.codcli ? Number(row.codcli) : null,
            tenantId: row.tenant_id,
            jurisdicao: row.jurisdicao,
            canal: row.canal,
            acao: row.acao,
            intencao: row.intencao,
            scoreConfianca: row.score_confianca,
            permitido: row.permitido ? 1 : 0,
            baseLegal: row.base_legal,
            razaoAutomatizada: row.razao_automatizada,
            revisaoHumanaDisponivel: row.revisao_humana_disponivel ? 1 : 0,
            detalhesJson: JSON.stringify(row.detalhes),
          },
        );
      },
      () => {
        memoryStore.complianceAudits.unshift(row);
      },
    );

    return row;
  }

  async listComplianceAudits(limit = 5000): Promise<LaraComplianceAuditItem[]> {
    return withOperationalFallback(
      async () => {
        const rows = await queryRows<ComplianceAuditRow>(
          `
          SELECT * FROM (
            SELECT
              ID, WA_ID, CODCLI, TENANT_ID, JURISDICAO, CANAL, ACAO, INTENCAO, SCORE_CONFIANCA,
              PERMITIDO, BASE_LEGAL, RAZAO_AUTOMATIZADA, REVISAO_HUMANA_DISPONIVEL, DETALHES_JSON, CREATED_AT
            FROM LARA_COMPLIANCE_AUDIT
            ORDER BY CREATED_AT DESC
          ) WHERE ROWNUM <= :limitRows
          `,
          { limitRows: limit },
        );
        return rows.map(mapComplianceAuditRow);
      },
      () => [...memoryStore.complianceAudits].slice(0, limit),
    );
  }

  async purgeRetentionData(input?: {
    messageRetentionDays?: number;
    integrationRetentionDays?: number;
    complianceRetentionDays?: number;
  }): Promise<{ removedMessages: number; removedIntegrations: number; removedCompliance: number }> {
    const messageDays = Math.max(7, Math.min(3650, Math.trunc(Number(input?.messageRetentionDays ?? 365))));
    const integrationDays = Math.max(7, Math.min(3650, Math.trunc(Number(input?.integrationRetentionDays ?? 365))));
    const complianceDays = Math.max(30, Math.min(3650, Math.trunc(Number(input?.complianceRetentionDays ?? 730))));

    return withOperationalFallback(
      async () => {
        const beforeMessages = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_COB_MSG_LOG");
        const beforeIntegrations = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_INTEGRACOES_LOG");
        const beforeCompliance = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_COMPLIANCE_AUDIT");

        await execDml(
          `DELETE FROM LARA_COB_MSG_LOG WHERE CREATED_AT < (SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
          { days: messageDays },
        );
        await execDml(
          `DELETE FROM LARA_INTEGRACOES_LOG WHERE CREATED_AT < (SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
          { days: integrationDays },
        );
        await execDml(
          `DELETE FROM LARA_COMPLIANCE_AUDIT WHERE CREATED_AT < (SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
          { days: complianceDays },
        );

        const afterMessages = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_COB_MSG_LOG");
        const afterIntegrations = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_INTEGRACOES_LOG");
        const afterCompliance = await queryOne<{ CNT: number }>("SELECT COUNT(*) AS CNT FROM LARA_COMPLIANCE_AUDIT");

        return {
          removedMessages: Math.max(0, Number((beforeMessages as any)?.CNT ?? 0) - Number((afterMessages as any)?.CNT ?? 0)),
          removedIntegrations: Math.max(0, Number((beforeIntegrations as any)?.CNT ?? 0) - Number((afterIntegrations as any)?.CNT ?? 0)),
          removedCompliance: Math.max(0, Number((beforeCompliance as any)?.CNT ?? 0) - Number((afterCompliance as any)?.CNT ?? 0)),
        };
      },
      () => {
        const now = Date.now();
        const messageTs = now - messageDays * 24 * 60 * 60 * 1000;
        const integrationTs = now - integrationDays * 24 * 60 * 60 * 1000;
        const complianceTs = now - complianceDays * 24 * 60 * 60 * 1000;

        const beforeMessages = memoryStore.mensagens.length;
        const beforeIntegrations = memoryStore.integracoes.length;
        const beforeCompliance = memoryStore.complianceAudits.length;

        memoryStore.mensagens = memoryStore.mensagens.filter((item) => new Date(item.created_at).getTime() >= messageTs);
        memoryStore.integracoes = memoryStore.integracoes.filter((item) => new Date(item.created_at).getTime() >= integrationTs);
        memoryStore.complianceAudits = memoryStore.complianceAudits.filter((item) => new Date(item.data_hora).getTime() >= complianceTs);

        return {
          removedMessages: Math.max(0, beforeMessages - memoryStore.mensagens.length),
          removedIntegrations: Math.max(0, beforeIntegrations - memoryStore.integracoes.length),
          removedCompliance: Math.max(0, beforeCompliance - memoryStore.complianceAudits.length),
        };
      },
    );
  }

  async listLogs(limit = 500): Promise<LaraLogItem[]> {
    const [messages, integrations, cases] = await Promise.all([
      this.listAllMessages(limit),
      withOperationalFallback(
        async () => queryRows<IntegrationLogRow>(
          `
          SELECT * FROM (
            SELECT
              ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
              ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
            FROM LARA_INTEGRACOES_LOG
            ORDER BY CREATED_AT DESC
          ) WHERE ROWNUM <= :limitRows
          `,
          { limitRows: limit },
        ),
        () => [...memoryStore.integracoes].slice(0, limit),
      ),
      this.listCases(),
    ]);

    const logsFromMessages = messages.map(mapMessageToLog);

    const logsFromIntegrations: LaraLogItem[] = integrations.map((row) => ({
      id: toStringSafe(row.id),
      data_hora: dateToIsoDateTime(row.created_at),
      tipo: toStringSafe(row.tipo) || "Integração",
      modulo: toStringSafe(row.integracao),
      cliente: "-",
      wa_id: "-",
      codcli: "-",
      etapa: "-",
      mensagem: toStringSafe(row.erro_resumo) || `Integração ${row.integracao} concluída`,
      severidade: row.status_operacao === "erro" ? "erro" : "sucesso",
      status: toStringSafe(row.status_operacao) || "processado",
      origem: "integração",
    }));

    const logsFromCases: LaraLogItem[] = cases.map((item) => ({
      id: `CASELOG-${item.id}`,
      data_hora: item.data_hora,
      tipo: item.acao,
      modulo: "Cases",
      cliente: item.cliente || "-",
      wa_id: item.wa_id || "-",
      codcli: item.codcli || "-",
      etapa: item.etapa || "-",
      mensagem: item.detalhe,
      severidade: item.acao.includes("ERRO") ? "erro" : "aviso",
      status: item.status || "aberto",
      origem: item.origem || "case",
    }));

    return [...logsFromMessages, ...logsFromIntegrations, ...logsFromCases]
      .sort((a, b) => b.data_hora.localeCompare(a.data_hora))
      .slice(0, limit);
  }

  async listIntegrationLogs(integracao: string, limit = 5000): Promise<IntegrationLogRow[]> {
    return withOperationalFallback(
      async () =>
        queryRows<IntegrationLogRow>(
          `
          SELECT * FROM (
            SELECT
              ID, INTEGRACAO, TIPO, REQUEST_JSON, RESPONSE_JSON, STATUS_HTTP, STATUS_OPERACAO,
              ERRO_RESUMO, IDEMPOTENCY_KEY, CORRELATION_ID, CREATED_AT
            FROM LARA_INTEGRACOES_LOG
            WHERE INTEGRACAO = :integracao
            ORDER BY CREATED_AT DESC
          ) WHERE ROWNUM <= :limitRows
          `,
          { integracao, limitRows: limit },
        ),
      () =>
        memoryStore.integracoes
          .filter((r) => r.integracao === integracao)
          .slice(0, limit),
    );
  }

  async listFeedbackInteracoes(diasRetroativos = 30): Promise<{
    wa_id: string;
    codcli: string;
    etapa: string;
    acao: string;
    canal: string;
    hora_envio: number;
    resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
    tempo_resposta_min?: number;
    created_at: string;
  }[]> {
    const cutoff = new Date(Date.now() - diasRetroativos * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.listIntegrationLogs("feedback-loop", 50_000);
    return rows
      .filter((r) => String(r.created_at) >= cutoff)
      .map((r) => {
        const req = parseJsonSafe<Record<string, unknown>>(r.request_json as unknown as string, {});
        const res = parseJsonSafe<Record<string, unknown>>(r.response_json as unknown as string, {});
        return {
          wa_id: String(req.wa_id ?? ""),
          codcli: String(req.codcli ?? ""),
          etapa: String(req.etapa ?? ""),
          acao: String(req.acao ?? ""),
          canal: String(req.canal ?? "WHATSAPP"),
          hora_envio: Number(req.hora_envio ?? 0),
          resultado: (res.resultado ?? "ignorou") as "respondeu" | "pagou" | "ignorou" | "optout" | "escalou",
          tempo_resposta_min: res.tempo_resposta_min !== undefined ? Number(res.tempo_resposta_min) : undefined,
          created_at: dateToIsoDateTime(r.created_at),
        };
      });
  }

  // ─── Outcome Tracking ──────────────────────────────────────────────────────

  async insertOutcomeRecord(record: {
    id: string; wa_id: string; codcli: number | null; etapa: string; risco: string;
    intent_classified: string; confidence: number; action_taken: string;
    hora_envio: number; dia_semana: number; outcome: string; correlation_id: string;
    created_at: string; resolved_at: string | null;
  }): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `INSERT INTO LARA_OUTCOME_TRACKING (
            ID, WA_ID, CODCLI, ETAPA, RISCO, INTENT_CLASSIFIED, CONFIDENCE,
            ACTION_TAKEN, HORA_ENVIO, DIA_SEMANA, OUTCOME, CORRELATION_ID,
            CREATED_AT, RESOLVED_AT
          ) VALUES (
            :id, :wa_id, :codcli, :etapa, :risco, :intent_classified, :confidence,
            :action_taken, :hora_envio, :dia_semana, :outcome, :correlation_id,
            SYSTIMESTAMP, NULL
          )`,
          {
            id: record.id, wa_id: record.wa_id, codcli: record.codcli ?? null,
            etapa: record.etapa, risco: record.risco,
            intent_classified: record.intent_classified,
            confidence: record.confidence, action_taken: record.action_taken,
            hora_envio: record.hora_envio, dia_semana: record.dia_semana,
            outcome: record.outcome, correlation_id: record.correlation_id,
          },
        );
      },
      () => { /* memória gerida pelo outcomeTracker */ },
    );
  }

  async resolveOutcomeRecord(params: {
    wa_id: string; outcome: string; correlation_id?: string; resolved_at: string;
  }): Promise<void> {
    await withOperationalFallback(
      async () => {
        const whereClause = params.correlation_id
          ? "WA_ID = :wa_id AND CORRELATION_ID = :correlation_id AND RESOLVED_AT IS NULL"
          : "WA_ID = :wa_id AND RESOLVED_AT IS NULL AND ROWNUM = 1";
        const binds: Record<string, unknown> = {
          wa_id: params.wa_id, outcome: params.outcome,
          ...(params.correlation_id ? { correlation_id: params.correlation_id } : {}),
        };
        await execDml(
          `UPDATE LARA_OUTCOME_TRACKING SET OUTCOME = :outcome, RESOLVED_AT = SYSTIMESTAMP WHERE ${whereClause}`,
          binds,
        );
      },
      () => {},
    );
  }

  async resolveTimedOutOutcomes(wa_id: string, olderThanHours: number): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `UPDATE LARA_OUTCOME_TRACKING
              SET OUTCOME = 'ignorou', RESOLVED_AT = SYSTIMESTAMP
            WHERE WA_ID = :wa_id
              AND RESOLVED_AT IS NULL
              AND CREATED_AT < SYSTIMESTAMP - :hours / 24`,
          { wa_id, hours: olderThanHours },
        );
      },
      () => {},
    );
  }

  async listOutcomeRecords(diasRetroativos = 30): Promise<import("./outcomeTracker.js").OutcomeRecord[]> {
    return withOperationalFallback(
      async () => {
        type Row = Record<string, unknown>;
        const rows = await queryRows<Row>(
          `SELECT * FROM (
             SELECT ID, WA_ID, CODCLI, ETAPA, RISCO, INTENT_CLASSIFIED, CONFIDENCE,
                    ACTION_TAKEN, HORA_ENVIO, DIA_SEMANA, OUTCOME, CORRELATION_ID,
                    CREATED_AT, RESOLVED_AT
               FROM LARA_OUTCOME_TRACKING
              WHERE CREATED_AT >= SYSTIMESTAMP - :days
              ORDER BY CREATED_AT DESC
           ) WHERE ROWNUM <= 100000`,
          { days: diasRetroativos },
        );
        return rows.map((r) => ({
          id: String(r.ID ?? ""),
          wa_id: String(r.WA_ID ?? ""),
          codcli: r.CODCLI != null ? Number(r.CODCLI) : null,
          etapa: String(r.ETAPA ?? ""),
          risco: String(r.RISCO ?? ""),
          intent_classified: String(r.INTENT_CLASSIFIED ?? ""),
          confidence: Number(r.CONFIDENCE ?? 0),
          action_taken: String(r.ACTION_TAKEN ?? ""),
          hora_envio: Number(r.HORA_ENVIO ?? 0),
          dia_semana: Number(r.DIA_SEMANA ?? 0),
          outcome: String(r.OUTCOME ?? "ignorou") as import("./outcomeTracker.js").OutcomeType,
          correlation_id: String(r.CORRELATION_ID ?? ""),
          created_at: dateToIsoDateTime(r.CREATED_AT as string | Date | null),
          resolved_at: r.RESOLVED_AT ? dateToIsoDateTime(r.RESOLVED_AT as string | Date | null) : null,
        }));
      },
      () => [],
    );
  }

  // ─── NLU Corrections ───────────────────────────────────────────────────────

  async insertNluCorrection(params: {
    wa_id: string; original_action: string; corrected_intent: string; message_text: string;
  }): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `INSERT INTO LARA_NLU_CORRECTIONS (
            ID, WA_ID, ORIGINAL_ACTION, CORRECTED_INTENT, MESSAGE_TEXT, CREATED_AT
          ) VALUES (
            :id, :wa_id, :original_action, :corrected_intent, :message_text, SYSTIMESTAMP
          )`,
          {
            id: `NLU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            wa_id: params.wa_id,
            original_action: params.original_action.slice(0, 50),
            corrected_intent: params.corrected_intent.slice(0, 50),
            message_text: params.message_text.slice(0, 500),
          },
        );
      },
      () => {},
    );
  }

  async listNluCorrections(diasRetroativos = 30): Promise<{
    original_action: string; corrected_intent: string; message_text: string; count: number;
  }[]> {
    return withOperationalFallback(
      async () => {
        type Row = Record<string, unknown>;
        const rows = await queryRows<Row>(
          `SELECT ORIGINAL_ACTION, CORRECTED_INTENT, MESSAGE_TEXT, 1 AS CNT
             FROM LARA_NLU_CORRECTIONS
            WHERE CREATED_AT >= SYSTIMESTAMP - :days
            ORDER BY CREATED_AT DESC`,
          { days: diasRetroativos },
        );
        return rows.map((r) => ({
          original_action: String(r.ORIGINAL_ACTION ?? ""),
          corrected_intent: String(r.CORRECTED_INTENT ?? ""),
          message_text: String(r.MESSAGE_TEXT ?? ""),
          count: 1,
        }));
      },
      () => [],
    );
  }

  // ─── Learned Patterns ──────────────────────────────────────────────────────

  async upsertLearnedPattern(pattern: {
    pattern_key: string; action_recommended: string; success_rate: number;
    sample_count: number; last_updated: string; is_active: boolean;
  }): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `MERGE INTO LARA_LEARNED_PATTERNS tgt
           USING (SELECT :pattern_key AS PATTERN_KEY FROM DUAL) src
           ON (tgt.PATTERN_KEY = src.PATTERN_KEY)
           WHEN MATCHED THEN
             UPDATE SET ACTION_RECOMMENDED = :action_recommended,
                        SUCCESS_RATE = :success_rate,
                        SAMPLE_COUNT = :sample_count,
                        LAST_UPDATED = SYSTIMESTAMP,
                        IS_ACTIVE = :is_active
           WHEN NOT MATCHED THEN
             INSERT (PATTERN_KEY, ACTION_RECOMMENDED, SUCCESS_RATE, SAMPLE_COUNT, LAST_UPDATED, IS_ACTIVE)
             VALUES (:pattern_key, :action_recommended, :success_rate, :sample_count, SYSTIMESTAMP, :is_active)`,
          {
            pattern_key: pattern.pattern_key,
            action_recommended: pattern.action_recommended,
            success_rate: pattern.success_rate,
            sample_count: pattern.sample_count,
            is_active: pattern.is_active ? 1 : 0,
          },
        );
      },
      () => {},
    );
  }

  async listLearnedPatterns(): Promise<{
    pattern_key: string; action_recommended: string; success_rate: number;
    sample_count: number; last_updated: string; is_active: boolean;
  }[]> {
    return withOperationalFallback(
      async () => {
        type Row = Record<string, unknown>;
        const rows = await queryRows<Row>(
          `SELECT PATTERN_KEY, ACTION_RECOMMENDED, SUCCESS_RATE, SAMPLE_COUNT, LAST_UPDATED, IS_ACTIVE
             FROM LARA_LEARNED_PATTERNS
            ORDER BY SUCCESS_RATE DESC`,
          {},
        );
        return rows.map((r) => ({
          pattern_key: String(r.PATTERN_KEY ?? ""),
          action_recommended: String(r.ACTION_RECOMMENDED ?? ""),
          success_rate: Number(r.SUCCESS_RATE ?? 0),
          sample_count: Number(r.SAMPLE_COUNT ?? 0),
          last_updated: dateToIsoDateTime(r.LAST_UPDATED as string | Date | null),
          is_active: Number(r.IS_ACTIVE ?? 0) === 1,
        }));
      },
      () => [],
    );
  }

  async getLearnedPattern(patternKey: string): Promise<{
    pattern_key: string; action_recommended: string; success_rate: number;
    sample_count: number; last_updated: string; is_active: boolean;
  } | null> {
    return withOperationalFallback(
      async () => {
        type Row = Record<string, unknown>;
        const row = await queryOne<Row>(
          `SELECT PATTERN_KEY, ACTION_RECOMMENDED, SUCCESS_RATE, SAMPLE_COUNT, LAST_UPDATED, IS_ACTIVE
             FROM LARA_LEARNED_PATTERNS
            WHERE PATTERN_KEY = :pattern_key
              AND IS_ACTIVE = 1`,
          { pattern_key: patternKey },
        );
        if (!row) return null;
        return {
          pattern_key: String(row.PATTERN_KEY ?? ""),
          action_recommended: String(row.ACTION_RECOMMENDED ?? ""),
          success_rate: Number(row.SUCCESS_RATE ?? 0),
          sample_count: Number(row.SAMPLE_COUNT ?? 0),
          last_updated: dateToIsoDateTime(row.LAST_UPDATED as string | Date | null),
          is_active: Number(row.IS_ACTIVE ?? 0) === 1,
        };
      },
      () => null,
    );
  }

  // ─── Bandit State ──────────────────────────────────────────────────────────

  async listBanditArms(): Promise<import("./banditsEngine.js").BanditArm[]> {
    return withOperationalFallback(
      async () => {
        type Row = Record<string, unknown>;
        const rows = await queryRows<Row>(
          `SELECT PATTERN_KEY, ACTION, ALPHA, BETA_PARAM, LAST_UPDATED
             FROM LARA_BANDIT_STATE
            ORDER BY LAST_UPDATED DESC`,
          {},
        );
        return rows.map((r) => ({
          pattern_key: String(r.PATTERN_KEY ?? ""),
          action: String(r.ACTION ?? ""),
          alpha: Number(r.ALPHA ?? 1),
          beta_param: Number(r.BETA_PARAM ?? 1),
          last_updated: dateToIsoDateTime(r.LAST_UPDATED as string | Date | null),
        }));
      },
      () => [],
    );
  }

  async upsertBanditArm(arm: import("./banditsEngine.js").BanditArm): Promise<void> {
    await withOperationalFallback(
      async () => {
        await execDml(
          `MERGE INTO LARA_BANDIT_STATE tgt
           USING (SELECT :pattern_key AS PATTERN_KEY, :action AS ACTION FROM DUAL) src
           ON (tgt.PATTERN_KEY = src.PATTERN_KEY AND tgt.ACTION = src.ACTION)
           WHEN MATCHED THEN
             UPDATE SET ALPHA = :alpha, BETA_PARAM = :beta_param, LAST_UPDATED = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (PATTERN_KEY, ACTION, ALPHA, BETA_PARAM, LAST_UPDATED)
             VALUES (:pattern_key, :action, :alpha, :beta_param, SYSTIMESTAMP)`,
          {
            pattern_key: arm.pattern_key,
            action: arm.action,
            alpha: arm.alpha,
            beta_param: arm.beta_param,
          },
        );
      },
      () => {},
    );
  }

  buildConversationMessages(rows: MessageLogRow[]): LaraMensagem[] {
    return rows.map((row) => {
      const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const tipoFromPayload = String(payload.message_type ?? "").toLowerCase();
      const tipo: LaraMensagem["tipo"] =
        tipoFromPayload === "boleto" || row.message_type === "boleto"
          ? "boleto"
          : tipoFromPayload === "bolepix" || row.message_type === "bolepix"
            ? "bolepix"
          : tipoFromPayload === "pix" || row.message_type === "pix"
              ? "pix"
              : tipoFromPayload === "sistema" || row.message_type === "sistema"
                ? "sistema"
                : "texto";
      return {
        id: row.id,
        remetente: String(row.direction).toUpperCase() === "INBOUND" ? "cliente" : "lara",
        texto: row.message_text || "",
        data_hora: dateToIsoDateTime(row.created_at || row.sent_at || row.received_at),
        tipo,
      };
    });
  }
}

export const laraOperationalStore = new LaraOperationalStore();
