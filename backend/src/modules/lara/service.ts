import { queryOne } from "../../repositories/baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import { env, isPilotAllowed, getPilotCodclis } from "../../config/env.js";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import forge from "node-forge";
import type { IncomingHttpHeaders } from "node:http";
import type {
  LaraAtendimento,
  LaraCaseItem,
  LaraCliente,
  LaraComplianceAuditItem,
  LaraConversa,
  LaraJurisdicao,
  LaraLogItem,
  LaraNegociacaoItem,
  LaraNextAction,
  LaraOptoutItem,
  LaraPagedResult,
  LaraReguaEtapa,
  LaraReguaExecucao,
  LaraReguaTemplate,
  LaraTitulo,
  LaraWebhookResponse,
  LaraWinthorBoleto,
} from "./types.js";
import {
  enviarTemplateEtapa,
  sendTextMessage,
  isWhatsAppConfigured,
} from "./whatsappTemplateManager.js";
import { sendText as uazapiSendText, isUazapiConfigured } from "./uazapiService.js";
import {
  baixarTituloOracle,
  consultarBoletoWinthor,
  findClientByDocument,
  findClientsByPhone,
  findCobrancasByTxid,
  findTitlesByPixIdentifiers,
  gerarOuRegenerarBoletoWinthor,
  getClientByCodcli,
  getOpenSummaryByCodcli,
  listPixIdentifierColumns,
  listFiliaisFromOracle,
  listOpenTitlesFromOracle,
  marcarPixCobrancaPago,
  prorrogarTituloWinthor,
  registrarPixCobranca,
  type OracleOpenTitleRow,
  type PixCobrancaRow,
} from "./oracleRepository.js";
import { laraOperationalStore } from "./operationalStore.js";
import { paginateRows } from "./pagination.js";
import { classifyIntentWithAiFallback, getIntentClassifierHealthSnapshot } from "./nluClassifier.js";
import { chooseNextBestAction } from "./nextBestAction.js";
import {
  trackAction as outcomeTrackAction,
  resolveOutcome,
  markAsPaid as outcomeMarkAsPaid,
  markPromiseFulfilled,
  markPromiseBroken,
  markAsIgnored,
  markAsWrongClassification,
  setOutcomeResolvedHook,
} from "./outcomeTracker.js";
import { onOutcomeReceived } from "./onlineLearner.js";
import { summarizeConversation, invalidateConversationSummary, formatSummaryForPrompt } from "./conversationSummarizer.js";
import { evaluatePolicy } from "./policyEngine.js";
import { analyzeSentiment } from "./sentimentAnalyzer.js";
import { calcPropensityScore, selecionarPoliticaPorEtapa } from "./propensityScorer.js";
import { gerarPropostasNegociacao, POLITICAS_PADRAO } from "./negotiationEngine.js";
import type { PoliticaNegociacao } from "./negotiationEngine.js";
import {
  dateToIsoDate,
  dateToIsoDateTime,
  extractDocumentFromText,
  extractPromessaDate,
  inferEtapaRegua,
  inferRisk,
  makeIdempotencyKey,
  normalizePhone,
  normalizeWaId,
  removeAccents,
  roundMoney,
  safeText,
  maskPhone,
  toNumber,
} from "./utils.js";

type SyncResult = {
  totalTitulos: number;
  totalClientes: number;
  codcliAfetados: string[];
  titulosRemovidos?: number;
  clientesRemovidos?: number;
  sincronizadoEm?: string;
};

type MensagemContexto = {
  codcli?: number;
  etapa?: string;
  duplicatas?: string[];
  valor_total?: number;
  created_at?: string;
};

type LaraSyncStatus = {
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
};

type LaraBoletoPayload = {
  tipo: "boleto";
  codcli: string;
  cliente: string;
  total: number;
  duplicatas: string[];
  url_boleto: string;
  linha_digitavel: string;
};

type LaraPixPayload = {
  tipo: "pix";
  codcli: string;
  cliente: string;
  total: number;
  duplicatas: string[];
  chave_pix: string;
  pix_copia_cola: string;
  txid?: string;
  provider?: "interno" | "bradesco";
  location?: string;
};

type LaraBolepixPayload = {
  tipo: "bolepix";
  codcli: string;
  cliente: string;
  total: number;
  duplicatas: string[];
  linha_digitavel: string;
  url_boleto: string;
  pix_copia_cola: string;
  txid?: string;
  nosso_numero?: string;
  qr_code_base64?: string;
  qr_code_url?: string;
  provider: "interno" | "bradesco";
  raw_response?: Record<string, unknown>;
};

type LaraPagamentoPayload = LaraBoletoPayload | LaraPixPayload | LaraBolepixPayload;

type MtlsConfig = {
  certPath: string;
  keyPath: string;
  pfxPath: string;
  passphrase: string;
  caPath: string;
  rejectUnauthorized: boolean;
};

type HttpRequestInput = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  mtls?: MtlsConfig;
};

type HttpRequestResult = {
  status: number;
  headers: Record<string, string>;
  payload: unknown;
  rawBody: string;
};

type BradescoBolepixOperation =
  | "gerar"
  | "alterar"
  | "consultar"
  | "listar"
  | "baixar"
  | "webhook-cadastrar"
  | "token-teste";

type LaraOrchestrationRecord = {
  status: "processing" | "completed" | "error";
  protocolId: string;
  conversationId: string;
  messageId: string;
  event_id: string;
  tenant_id: string;
  response?: string;
  laraResponse?: { mensagem: string };
  process_code: string;
  message: string;
  errorMessage?: string;
  technical_details: Record<string, unknown>;
  idempotent_replay?: boolean;
  created_at: string;
  updated_at: string;
};

type BradescoPixInput = {
  event_id?: string;
  tenant_id?: string;
  txid?: string;
  endToEndId?: string;
  end_to_end_id?: string;
  e2eid?: string;
  valor?: string | number;
  horario?: string;
  chave?: string;
  pix?: Array<Record<string, unknown>>;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

type LaraResponseComposeInput = {
  tenantId: string;
  waId: string;
  intent: string;
  action: LaraNextAction | "resposta_padrao";
  inboundMessage: string;
  cliente: LaraCliente;
  titulos: LaraTitulo[];
  total: number;
  duplicatas: string[];
  fallbackMessage: string;
  policyReason: string;
  correlationId?: string;
  historicoConversa?: Array<{ role: "cliente" | "lara"; texto: string }>;
  conversationSummary?: string; // resumo semântico gerado pelo AI summarizer
};

type LaraResponseComposeResult = {
  message: string;
  provider: "openai" | "fallback";
  requestId?: string;
  fallbackReason?: string;
};

const orchestrationResponses = new Map<string, LaraOrchestrationRecord>();
const ORCHESTRATION_TTL_MS = 6 * 60 * 60 * 1000;

function pruneOrchestrationResponses(): void {
  const now = Date.now();
  for (const [key, record] of orchestrationResponses.entries()) {
    const created = new Date(record.created_at).getTime();
    if (Number.isFinite(created) && now - created > ORCHESTRATION_TTL_MS) {
      orchestrationResponses.delete(key);
    }
  }
}

function parseDuplicatas(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[;,|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeTituloId(codcli: number, duplicata: string, prestacao: string): string {
  const normalizedDuplicata = duplicata.replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
  const normalizedPrestacao = prestacao.replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
  return `TIT-${codcli}-${normalizedDuplicata}-${normalizedPrestacao}`;
}

function mapOracleStatusToAtendimento(rawStatus: string | null | undefined): string {
  const normalized = String(rawStatus ?? "").trim().toUpperCase();
  if (!normalized) return "Em aberto";
  if (["A", "ABERTO", "EM_ABERTO", "EM ABERTO"].includes(normalized)) return "Em aberto";
  if (["P", "PARCIAL"].includes(normalized)) return "Pagamento parcial";
  if (["B", "BLOQUEADO"].includes(normalized)) return "Bloqueado";
  return String(rawStatus ?? "").trim();
}

function toAtendimento(conversa: LaraConversa, titulos: LaraTitulo[], optoutAtivo: boolean): LaraAtendimento {
  const clienteTitulos = titulos.filter((item) => item.codcli === conversa.codcli);
  return {
    id: conversa.id,
    codcli: conversa.codcli,
    cliente: conversa.cliente,
    telefone: conversa.telefone,
    wa_id: conversa.wa_id,
    status: conversa.status,
    origem: conversa.origem,
    ultima_mensagem: conversa.mensagens[conversa.mensagens.length - 1]?.texto ?? "",
    ultima_interacao: conversa.ultima_interacao,
    etapa: conversa.etapa,
    qtd_titulos: clienteTitulos.length,
    boleto_enviado: conversa.mensagens.some((msg) => msg.tipo === "boleto"),
    promessa: false,
    optout: optoutAtivo,
  };
}

function buildLinhaDigitavel(duplicata: string, valor: number): string {
  const base = `${duplicata.replace(/\D+/g, "").slice(0, 11)}${Math.round(valor * 100)}`.padEnd(32, "0");
  return `${base.slice(0, 5)}.${base.slice(5, 10)} ${base.slice(10, 15)}.${base.slice(15, 21)} ${base.slice(21, 26)}.${base.slice(26, 32)} 1 ${base.slice(0, 14)}`;
}

function parseBooleanConfig(value: string | null | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumberConfig(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.trunc(parsed);
  return Math.max(min, Math.min(max, integer));
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // noop
  }
  return {};
}

const httpFileCache = new Map<string, Buffer>();

async function readFileCached(filePath: string): Promise<Buffer> {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    throw new Error("Caminho de arquivo mTLS invalido.");
  }
  const cached = httpFileCache.get(normalized);
  if (cached) return cached;
  const content = await readFile(normalized);
  httpFileCache.set(normalized, content);
  return content;
}

type PemPair = { cert: Buffer; key: Buffer };
const pfxPemCache = new Map<string, PemPair>();

async function pfxToPem(pfxPath: string, passphrase: string): Promise<PemPair> {
  const cacheKey = `${pfxPath}::${passphrase}`;
  const cached = pfxPemCache.get(cacheKey);
  if (cached) return cached;

  const pfxBuf = await readFile(pfxPath);
  const pfxDer = forge.util.createBuffer(pfxBuf.toString("binary"));
  const p12Asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

  if (!certBags.length) throw new Error("PFX sem certificado");
  if (!keyBags.length)  throw new Error("PFX sem chave privada");

  // Preferir o certificado do e-CNPJ (sujeito contém o CNPJ)
  let mainCert = certBags[0].cert!;
  for (const bag of certBags) {
    const cn = bag.cert!.subject.getField("CN")?.value as string | undefined ?? "";
    if (/\d{14}/.test(cn.replace(/\D/g, ""))) { mainCert = bag.cert!; break; }
  }

  const pair: PemPair = {
    cert: Buffer.from(forge.pki.certificateToPem(mainCert), "utf8"),
    key:  Buffer.from(forge.pki.privateKeyToPem(keyBags[0].key!), "utf8"),
  };
  pfxPemCache.set(cacheKey, pair);
  return pair;
}

function mapHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      mapped[key.toLowerCase()] = value.join(", ");
      continue;
    }
    if (value !== undefined) {
      mapped[key.toLowerCase()] = String(value);
    }
  }
  return mapped;
}

async function httpRequest(input: HttpRequestInput): Promise<HttpRequestResult> {
  const timeout = Math.max(1000, Math.min(120000, Number(input.timeoutMs || 15000)));
  const url = new URL(input.url);
  const mtls = input.mtls;
  const hasMtlsMaterial = Boolean(
    mtls
    && (String(mtls.certPath || "").trim() || String(mtls.pfxPath || "").trim())
    && (String(mtls.keyPath || "").trim() || String(mtls.pfxPath || "").trim()),
  );

  if (!hasMtlsMaterial) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
      const rawBody = await response.text();
      let payload: unknown = {};
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        payload = { raw: rawBody };
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return {
        status: response.status,
        headers,
        payload,
        rawBody,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  let cert: Buffer | undefined = mtls?.certPath ? await readFileCached(mtls.certPath) : undefined;
  let key: Buffer | undefined  = mtls?.keyPath  ? await readFileCached(mtls.keyPath)  : undefined;
  const ca = mtls?.caPath ? await readFileCached(mtls.caPath) : undefined;

  // Quando só PFX é fornecido, converter para PEM via node-forge
  // (Node.js v24 não suporta todos os formatos PKCS12 legacy)
  if (mtls?.pfxPath && (!cert || !key)) {
    const pair = await pfxToPem(mtls.pfxPath, mtls.passphrase ?? "");
    if (!cert) cert = pair.cert;
    if (!key)  key  = pair.key;
  }

  return await new Promise<HttpRequestResult>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: input.method,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        headers: input.headers,
        cert,
        key,
        ca,
        rejectUnauthorized: mtls?.rejectUnauthorized ?? true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let payload: unknown = {};
          try {
            payload = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            payload = { raw: rawBody };
          }
          resolve({
            status: Number(res.statusCode ?? 0),
            headers: mapHeaders(res.headers),
            payload,
            rawBody,
          });
        });
      },
    );

    req.setTimeout(timeout, () => {
      req.destroy(new Error(`Timeout HTTP apos ${timeout}ms`));
    });

    req.on("error", (error) => reject(error));

    if (input.body) {
      req.write(input.body);
    }
    req.end();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractOpenAiOutputText(payload: unknown): string {
  if (!isRecord(payload)) return "";

  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

  const output = payload.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
        continue;
      }
      if (isRecord(part.text) && typeof part.text.value === "string" && part.text.value.trim()) {
        chunks.push(part.text.value.trim());
      }
    }
  }

  return chunks.join("\n").trim();
}

function sanitizeOutboundMessage(message: string, fallback: string): string {
  const trimmed = String(message ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!trimmed) return fallback;
  const maxLength = 1800;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function formatMoneyBr(value: number): string {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBr(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const asDate = new Date(raw);
  if (!Number.isFinite(asDate.getTime())) return raw;
  return asDate.toLocaleDateString("pt-BR");
}

function readPixString(source: Record<string, unknown> | undefined, keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function extractBolepixResultFields(payload: Record<string, unknown>): {
  linhaDigitavel: string;
  urlBoleto: string;
  pixCopiaECola: string;
  txid: string;
  nossoNumero: string;
  qrCodeBase64: string;
  qrCodeUrl: string;
} {
  const data = readNestedRecord(payload, "data") ?? payload;
  const boleto = readNestedRecord(data, "boleto");
  const qrcode = readNestedRecord(data, "qrcode") ?? readNestedRecord(data, "qrCode");

  const linhaDigitavel =
    readPixString(data, ["linhaDigitavel", "linha_digitavel", "linhadig", "linhaDig"])
    || readPixString(boleto, ["linhaDigitavel", "linha_digitavel", "linhadig", "linhaDig"]);
  const urlBoleto =
    readPixString(data, ["urlBoleto", "url_boleto", "linkBoleto", "link_boleto", "url", "link"])
    || readPixString(boleto, ["urlBoleto", "url_boleto", "linkBoleto", "link_boleto", "url", "link"]);
  const pixCopiaECola =
    readPixString(data, ["pixCopiaECola", "pix_copia_e_cola", "copiaECola", "pixCopyPaste"])
    || readPixString(qrcode, ["pixCopiaECola", "pix_copia_e_cola", "copiaECola", "pixCopyPaste"]);
  const txid =
    readPixString(data, ["txid", "txId", "TXID"])
    || readPixString(qrcode, ["txid", "txId", "TXID"]);
  const nossoNumero =
    readPixString(data, ["nossoNumero", "nosso_numero", "nossoNumeroTitulo"])
    || readPixString(boleto, ["nossoNumero", "nosso_numero", "nossoNumeroTitulo"]);
  const qrCodeBase64 =
    readPixString(data, ["qrCodeBase64", "qrcodeBase64", "qr_code_base64", "imagemQrCodeBase64"])
    || readPixString(qrcode, ["qrCodeBase64", "qrcodeBase64", "qr_code_base64", "imagemQrCodeBase64"]);
  const qrCodeUrl =
    readPixString(data, ["qrCodeUrl", "qrcodeUrl", "qr_code_url", "urlQrCode"])
    || readPixString(qrcode, ["qrCodeUrl", "qrcodeUrl", "qr_code_url", "urlQrCode"]);

  return {
    linhaDigitavel,
    urlBoleto,
    pixCopiaECola,
    txid,
    nossoNumero,
    qrCodeBase64,
    qrCodeUrl,
  };
}

function readNestedRecord(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function formatDateForBradesco(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return `${day}.${month}.${year}`;
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
  return raw;
}

function normalizeBradescoPixPayload(input: BradescoPixInput): {
  eventId: string;
  tenantId: string;
  txid: string;
  endToEndId: string;
  valor: number;
  horario: string;
  raw: Record<string, unknown>;
} {
  const firstPix =
    Array.isArray(input.pix) && input.pix[0] && typeof input.pix[0] === "object"
      ? input.pix[0]
      : undefined;
  const payload = input.payload && typeof input.payload === "object" ? input.payload : undefined;
  const raw = { ...input } as Record<string, unknown>;
  const txid = readPixString(input, ["txid", "txId", "TXID"])
    || readPixString(firstPix, ["txid", "txId", "TXID"])
    || readPixString(payload, ["txid", "txId", "TXID"]);
  const endToEndId = readPixString(input, ["endToEndId", "end_to_end_id", "e2eid", "endToEndID"])
    || readPixString(firstPix, ["endToEndId", "end_to_end_id", "e2eid", "endToEndID"])
    || readPixString(payload, ["endToEndId", "end_to_end_id", "e2eid", "endToEndID"]);
  const valorRaw = input.valor ?? firstPix?.valor ?? payload?.valor ?? 0;
  const valor = roundMoney(Number(String(valorRaw).replace(",", ".")));
  const horario = String(input.horario ?? firstPix?.horario ?? payload?.horario ?? "").trim();
  const eventId = String(input.event_id || endToEndId || txid || makeIdempotencyKey([JSON.stringify(raw)])).trim();
  const tenantId = String(input.tenant_id || "default").trim() || "default";

  return {
    eventId,
    tenantId,
    txid,
    endToEndId,
    valor: Number.isFinite(valor) ? valor : 0,
    horario,
    raw,
  };
}

function getIntegrationResponseJson(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const record = row as Record<string, unknown>;
  return String(record.response_json ?? record.RESPONSE_JSON ?? "");
}

function normalizeFilial(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function sortFiliais(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const aIsNumeric = /^\d+$/.test(a);
    const bIsNumeric = /^\d+$/.test(b);
    if (aIsNumeric && bIsNumeric) return Number(a) - Number(b);
    if (aIsNumeric) return -1;
    if (bIsNumeric) return 1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
  });
}

function normalizeFiliaisFilter(input: { filial?: string; filiais?: string[] }): Set<string> | null {
  const set = new Set<string>();
  const single = normalizeFilial(input.filial);
  if (single) set.add(single.toLowerCase());
  for (const item of input.filiais ?? []) {
    const normalized = normalizeFilial(item);
    if (normalized) set.add(normalized.toLowerCase());
  }
  return set.size ? set : null;
}

function matchesFilialFilter(filial: string, filterSet: Set<string> | null): boolean {
  if (!filterSet) return true;
  return filterSet.has(normalizeFilial(filial).toLowerCase());
}

function detectPerfilVulneravel(messageText: string, cliente: LaraCliente | null): boolean {
  const text = removeAccents(safeText(messageText).toLowerCase());
  const vulnerableKeywords = [
    "desempregado",
    "doenca",
    "hospital",
    "falencia",
    "superendivid",
    "nao consigo pagar",
    "sem renda",
  ];
  if (vulnerableKeywords.some((term) => text.includes(term))) return true;
  return cliente?.risco === "critico" && cliente?.etapa_regua === "D+30";
}

function mapOrigemToCanal(origem: string): "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO" {
  const normalized = String(origem ?? "").trim().toLowerCase();
  if (normalized.includes("whatsapp")) return "WHATSAPP";
  if (normalized.includes("sms")) return "SMS";
  if (normalized.includes("email")) return "EMAIL";
  if (normalized.includes("voice") || normalized.includes("telefone")) return "VOICE";
  return "OUTRO";
}

function formatDateTimeForIsoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateToIsoDate(value);
}

function normalizeTimestampForLog(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return dateToIsoDateTime(parsed);
  return "";
}

function saudacaoHoraria(timezone = "America/Sao_Paulo"): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "numeric", hour12: false })
      .format(new Date()),
  );
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

function normalizeAlphaNumeric(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildDynamicPixTxid(input: { codcli: string; duplicatas: string[] }): string {
  const codcliToken = normalizeAlphaNumeric(input.codcli).slice(-8) || "00000000";
  const duplicataToken = normalizeAlphaNumeric(input.duplicatas.join(""));
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  let txid = normalizeAlphaNumeric(`LARA${codcliToken}${duplicataToken}${entropy}`);
  if (txid.length < 26) txid = `${txid}${"X".repeat(26 - txid.length)}`;
  if (txid.length > 35) txid = txid.slice(0, 35);
  return txid;
}

function emvField(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixCopiaCola(input: {
  pixChave: string;
  valor: number;
  nomeCliente: string;
  codcli: string;
  cidade?: string;
}): string {
  const nome = input.nomeCliente
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 25);
  const cidade = (input.cidade ?? "SAO PAULO")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 15);
  const refLabel = normalizeAlphaNumeric(`LARA${input.codcli}`).slice(0, 25);
  const merchantInfo = emvField("00", "BR.GOV.BCB.PIX") + emvField("01", input.pixChave);
  const additionalData = emvField("05", refLabel);
  let payload =
    emvField("00", "01") +
    emvField("26", merchantInfo) +
    emvField("52", "0000") +
    emvField("53", "986") +
    emvField("54", input.valor.toFixed(2)) +
    emvField("58", "BR") +
    emvField("59", nome) +
    emvField("60", cidade) +
    emvField("62", additionalData) +
    "6304";
  return payload + crc16Ccitt(payload);
}

export class LaraService {
  private cacheWarmed = false;
  // In-process wa_id → codcli + narrowed duplicatas: survives across requests, cleared on restart
  private readonly waContextMap = new Map<string, { codcli: number; duplicatas?: string[]; updatedAt: number }>();
  private readonly WA_CONTEXT_TTL_MS = 72 * 60 * 60 * 1000;
  // Cache da config JANELA_CONTEXTO_HORAS para evitar query Oracle a cada mensagem recebida
  private janelaContextoCache: { value: number; cachedAt: number } | null = null;
  // Guard contra race condition: dois webhooks (Meta nativo + n8n) processando o mesmo evento simultaneamente.
  // Chave = idempotencyKey da mensagem → timestamp em que entrou no processamento.
  private readonly _processingGuard = new Map<string, number>();
  private readonly PROCESSING_GUARD_TTL_MS = 60_000;

  private async getClassifierMetrics(limit = 5000): Promise<{
    total_classificacoes: number;
    openai_usado: number;
    fallback_local: number;
    circuito_aberto_eventos: number;
    acuracia_estimada_media: number;
    intents: Array<{
      intent: string;
      total: number;
      confianca_media: number;
      acuracia_estimada: number;
      taxa_openai: number;
      taxa_fallback_local: number;
      taxa_escalacao_humana: number;
    }>;
  }> {
    const audits = await laraOperationalStore.listComplianceAudits(limit);
    const metricsMap = new Map<string, {
      total: number;
      confiancaSum: number;
      openaiUsado: number;
      fallbackLocal: number;
      escaladoHumano: number;
      circuitoAbertoEventos: number;
    }>();

    let totalClassificacoes = 0;
    let openAiUsado = 0;
    let fallbackLocal = 0;
    let circuitoAbertoEventos = 0;
    let confiancaGlobalSum = 0;
    let escaladoGlobal = 0;

    for (const audit of audits) {
      const intent = String(audit.intencao || "neutro").trim() || "neutro";
      const confidence = Math.max(0, Math.min(1, toNumber(audit.score_confianca)));
      const details = (audit.detalhes ?? {}) as Record<string, unknown>;
      const method = String(details.classifier_method ?? "").toLowerCase();
      const usedOpenAi = details.classifier_used_openai === true || method === "openai";
      const attemptedOpenAi = details.classifier_attempted_openai === true || usedOpenAi;
      const isFallbackLocal = attemptedOpenAi && !usedOpenAi;
      const fallbackReason = String(details.classifier_fallback_reason ?? "").toLowerCase();
      const circuitOpenEvent = fallbackReason.includes("circuit");
      const escaladoHumano = String(audit.acao ?? "").toLowerCase() === "escalar_humano";

      const bucket = metricsMap.get(intent) ?? {
        total: 0,
        confiancaSum: 0,
        openaiUsado: 0,
        fallbackLocal: 0,
        escaladoHumano: 0,
        circuitoAbertoEventos: 0,
      };
      bucket.total += 1;
      bucket.confiancaSum += confidence;
      if (usedOpenAi) bucket.openaiUsado += 1;
      if (isFallbackLocal) bucket.fallbackLocal += 1;
      if (escaladoHumano) bucket.escaladoHumano += 1;
      if (circuitOpenEvent) bucket.circuitoAbertoEventos += 1;
      metricsMap.set(intent, bucket);

      totalClassificacoes += 1;
      confiancaGlobalSum += confidence;
      if (usedOpenAi) openAiUsado += 1;
      if (isFallbackLocal) fallbackLocal += 1;
      if (circuitOpenEvent) circuitoAbertoEventos += 1;
      if (escaladoHumano) escaladoGlobal += 1;
    }

    const intents = Array.from(metricsMap.entries())
      .map(([intent, data]) => {
        const confidenceMedia = data.total > 0 ? data.confiancaSum / data.total : 0;
        const fallbackRate = data.total > 0 ? data.fallbackLocal / data.total : 0;
        const escalacaoRate = data.total > 0 ? data.escaladoHumano / data.total : 0;
        const confidencePct = confidenceMedia * 100;
        const acuraciaEstimada = roundMoney(
          Math.max(
            0,
            Math.min(100, confidencePct * (1 - fallbackRate * 0.2) * (1 - escalacaoRate * 0.15)),
          ),
        );
        return {
          intent,
          total: data.total,
          confianca_media: roundMoney(confidencePct),
          acuracia_estimada: acuraciaEstimada,
          taxa_openai: roundMoney(data.total > 0 ? (data.openaiUsado / data.total) * 100 : 0),
          taxa_fallback_local: roundMoney(data.total > 0 ? (data.fallbackLocal / data.total) * 100 : 0),
          taxa_escalacao_humana: roundMoney(data.total > 0 ? (data.escaladoHumano / data.total) * 100 : 0),
        };
      })
      .sort((a, b) => b.total - a.total);

    const fallbackRateGlobal = totalClassificacoes > 0 ? fallbackLocal / totalClassificacoes : 0;
    const escalacaoRateGlobal = totalClassificacoes > 0 ? escaladoGlobal / totalClassificacoes : 0;
    const confidenceGlobalPct = totalClassificacoes > 0 ? (confiancaGlobalSum / totalClassificacoes) * 100 : 0;
    const acuraciaEstimadaMedia = roundMoney(
      Math.max(
        0,
        Math.min(100, confidenceGlobalPct * (1 - fallbackRateGlobal * 0.2) * (1 - escalacaoRateGlobal * 0.15)),
      ),
    );

    return {
      total_classificacoes: totalClassificacoes,
      openai_usado: openAiUsado,
      fallback_local: fallbackLocal,
      circuito_aberto_eventos: circuitoAbertoEventos,
      acuracia_estimada_media: acuraciaEstimadaMedia,
      intents,
    };
  }

  private async getDefaultSyncLimit(): Promise<number> {
    const configuredLimit = await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT");
    return parseNumberConfig(configuredLimit, 30000, 100, 100000);
  }

  private async ensureWarmCache(): Promise<void> {
    if (this.cacheWarmed) return;
    const clientes = await laraOperationalStore.listClientesCache();
    if (clientes.length === 0 && isOracleEnabled()) {
      const limit = Math.min(await this.getDefaultSyncLimit(), 5000);
      await this.recarregarTitulosOracle({ limit, includeDesd: false });
    }
    this.cacheWarmed = true;
  }

  async recarregarTitulosOracle(input: { codcli?: number; limit?: number; includeDesd?: boolean; skipCodcobFilter?: boolean }): Promise<SyncResult> {
    const isFullSync = input.codcli === undefined;
    const syncMarkerTs = "1900-01-01 00:00:00.000";
    const configuredLimit = input.limit !== undefined
      ? String(input.limit)
      : await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT");
    const effectiveLimit = parseNumberConfig(configuredLimit, 30000, 100, 100000);
    const pageSize = Math.max(100, Math.min(1000, effectiveLimit));

    if (isFullSync) {
      await laraOperationalStore.markCacheForFullSync(syncMarkerTs);
    }

    const clientes = new Map<string, LaraCliente>();
    const maxDiasPorCliente = new Map<string, number>();
    const codcliSet = new Set<string>();
    const touchedTitleIds = new Set<string>();
    const hoje = dateToIsoDate(new Date());
    let totalTitulosProcessados = 0;

    while (totalTitulosProcessados < effectiveLimit) {
      const remaining = effectiveLimit - totalTitulosProcessados;
      const currentPageLimit = Math.min(pageSize, remaining);
      const rows = await listOpenTitlesFromOracle({
        codcli: input.codcli,
        limit: currentPageLimit,
        offset: totalTitulosProcessados,
        skipCodcobFilter: input.skipCodcobFilter,
      });
      if (!rows.length) break;

      const titulosLote: LaraTitulo[] = [];
      for (const row of rows) {
        const codcli = Number(row.CODCLI);
        if (!Number.isFinite(codcli)) continue;

        const codcliKey = String(codcli);
        codcliSet.add(codcliKey);

        const vencimento = dateToIsoDate(row.DTVENC);
        const diasAtraso = Number(row.DIAS_ATRASO ?? 0);
        const etapa = inferEtapaRegua(diasAtraso);
        const nomeCliente = safeText(row.CLIENTE) || `Cliente ${codcli}`;
        const telefone = safeText(row.TELEFONE);
        const documento = safeText(row.DOCUMENTO);
        const filial = safeText(row.FILIAL);
        const totalAbertoAtual = roundMoney(toNumber(row.VLRECEBER ?? row.VALOR));
        const isVencido = !vencimento || vencimento <= hoje;

        const currentMaxDias = Math.max(diasAtraso, maxDiasPorCliente.get(codcliKey) ?? 0);
        maxDiasPorCliente.set(codcliKey, currentMaxDias);

        const existingCliente = clientes.get(codcliKey);
        const riscoLinha = inferRisk(currentMaxDias, totalAbertoAtual);

        if (!existingCliente) {
          clientes.set(codcliKey, {
            codcli: codcliKey,
            cliente: nomeCliente,
            telefone,
            wa_id: normalizeWaId(telefone),
            cpf_cnpj: documento,
            filial,
            total_aberto: isVencido ? totalAbertoAtual : 0,
            qtd_titulos: isVencido ? 1 : 0,
            titulo_mais_antigo: isVencido ? vencimento : "",
            proximo_vencimento: vencimento && vencimento >= hoje ? vencimento : "",
            ultimo_contato: "",
            ultima_acao: "Sincronizado Oracle",
            proxima_acao: "Aguardar contato",
            optout: false,
            etapa_regua: etapa,
            status: "Em aberto",
            responsavel: "Lara Automacao",
            risco: riscoLinha,
          });
        } else {
          if (isVencido) {
            existingCliente.total_aberto = roundMoney(existingCliente.total_aberto + totalAbertoAtual);
            existingCliente.qtd_titulos += 1;
          }

          if (!existingCliente.telefone && telefone) {
            existingCliente.telefone = telefone;
            existingCliente.wa_id = normalizeWaId(telefone);
          }
          if (!existingCliente.cpf_cnpj && documento) {
            existingCliente.cpf_cnpj = documento;
          }
          if (!existingCliente.filial && filial) {
            existingCliente.filial = filial;
          }

          if (isVencido && (!existingCliente.titulo_mais_antigo || (vencimento && vencimento < existingCliente.titulo_mais_antigo))) {
            existingCliente.titulo_mais_antigo = vencimento;
          }
          if (
            vencimento
            && vencimento >= hoje
            && (!existingCliente.proximo_vencimento || vencimento < existingCliente.proximo_vencimento)
          ) {
            existingCliente.proximo_vencimento = vencimento;
          }

          existingCliente.risco = inferRisk(currentMaxDias, existingCliente.total_aberto);
          existingCliente.etapa_regua = inferEtapaRegua(currentMaxDias);
        }

        const statusAtendimento = mapOracleStatusToAtendimento(row.STATUS_TITULO);
        const titulo: LaraTitulo = {
          id: makeTituloId(codcli, String(row.DUPLICATA ?? ""), String(row.PRESTACAO ?? "")),
          duplicata: String(row.DUPLICATA ?? "").trim(),
          prestacao: String(row.PRESTACAO ?? "").trim(),
          numtransvenda: Number(row.NUMTRANSVENDA ?? 0),
          numnota: Number(row.NUMNOTA ?? 0),
          codcli: codcliKey,
          cliente: nomeCliente,
          fantasia: String(row.FANTASIA ?? row.CLIENTE ?? "").trim() || nomeCliente,
          telefone,
          valor: roundMoney(toNumber(row.VLRECEBER ?? row.VALOR)),
          vlreceber: roundMoney(toNumber(row.VLRECEBER ?? row.VALOR)),
          vldesc: roundMoney(toNumber(row.VLDESC ?? 0)),
          cmulta_prev: roundMoney(toNumber(row.CMULTA_PREV ?? 0)),
          percmulta: toNumber(row.PERCMULTA ?? 0),
          vencimento,
          dtemissao: dateToIsoDate(row.DTEMISSAO as Date | string | null | undefined),
          dtrecebimento_previsto: dateToIsoDate(row.DTRECEBIMENTO_PREVISTO as Date | string | null | undefined),
          dias_atraso: diasAtraso,
          codcob: String(row.CODCOB ?? "").trim(),
          cobranca: String(row.COBRANCA ?? row.CODCOB ?? "").trim(),
          rca: String(row.RCA ?? "").trim(),
          etapa_regua: etapa,
          status_atendimento: statusAtendimento,
          boleto_disponivel: true,
          pix_disponivel: true,
          titulo_com_data_prevista: String(row.TITULO_COM_DATA_PREVISTA ?? "") === "*",
          ultima_acao: `Sincronizado Oracle (${statusAtendimento})`,
          responsavel: "Lara Automacao",
          filial,
        };

        touchedTitleIds.add(titulo.id);
        titulosLote.push(titulo);
      }

      if (titulosLote.length > 0) {
        await laraOperationalStore.upsertTitulosCacheBatch(titulosLote);
      }

      totalTitulosProcessados += rows.length;
      if (rows.length < currentPageLimit) break;
    }

    const optoutsAtivos = await laraOperationalStore.listOptouts();
    const optoutByWa = new Set(
      optoutsAtivos
        .filter((item) => item.ativo)
        .map((item) => normalizeWaId(item.wa_id)),
    );

    const clientesArray = Array.from(clientes.values());
    for (const cliente of clientesArray) {
      const waIdCliente = normalizeWaId(cliente.wa_id);
      cliente.optout = Boolean(waIdCliente && optoutByWa.has(waIdCliente));
      if (cliente.optout) {
        cliente.status = "Opt-out ativo";
      }
      if (!cliente.proximo_vencimento && cliente.titulo_mais_antigo && cliente.titulo_mais_antigo >= hoje) {
        cliente.proximo_vencimento = cliente.titulo_mais_antigo;
      }
    }
    if (clientesArray.length > 0) {
      await laraOperationalStore.upsertClientesCacheBatch(clientesArray);
    }

    let titulosRemovidos = 0;
    let clientesRemovidos = 0;
    let carregamentoTruncadoPorLimite = false;
    if (isFullSync && totalTitulosProcessados >= effectiveLimit) {
      const probeRows = await listOpenTitlesFromOracle({
        limit: 1,
        offset: totalTitulosProcessados,
      });
      carregamentoTruncadoPorLimite = probeRows.length > 0;
    }

    if (isFullSync && !carregamentoTruncadoPorLimite) {
      const cleanup = await laraOperationalStore.pruneCacheAfterFullSync(
        syncMarkerTs,
        Array.from(touchedTitleIds),
        Array.from(codcliSet),
      );
      titulosRemovidos = cleanup.titulosRemovidos;
      clientesRemovidos = cleanup.clientesRemovidos;
    }

    return {
      totalTitulos: totalTitulosProcessados,
      totalClientes: clientes.size,
      codcliAfetados: Array.from(codcliSet),
      titulosRemovidos,
      clientesRemovidos,
      sincronizadoEm: dateToIsoDateTime(new Date()),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  DISPARO CONSOLIDADO DA RÉGUA — todos os títulos do cliente em UMA mensagem
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Regra: se o cliente possuir mais de um título em aberto, todos são enviados
   * em uma ÚNICA mensagem listando duplicata, valor e vencimento de cada um.
   * Se houver apenas um título, dispara o template WhatsApp da etapa correspondente.
   */
  async dispararReguaClienteConsolidado(input: { codcli: number }): Promise<{
    status: "ok" | "sem_titulos" | "optout" | "sem_wa_id" | "whatsapp_nao_configurado";
    wa_id?: string;
    titulos_count?: number;
    etapa?: string;
    mensagem?: string;
    wamid?: string;
  }> {
    await this.ensureWarmCache();

    const cliente = await this.getCliente(input.codcli);
    if (!cliente) throw new Error(`Cliente ${input.codcli} nao encontrado.`);

    if (cliente.optout) {
      return { status: "optout", wa_id: cliente.wa_id };
    }

    const waId = normalizeWaId(cliente.wa_id || cliente.telefone);
    if (!waId) return { status: "sem_wa_id" };

    if (!isUazapiConfigured() && !isWhatsAppConfigured()) {
      return { status: "whatsapp_nao_configurado", wa_id: waId };
    }

    const titulos = await this.listTitulos({ codcli: input.codcli });
    if (titulos.length === 0) return { status: "sem_titulos", wa_id: waId };

    const total = roundMoney(titulos.reduce((sum, t) => sum + t.valor, 0));
    const etapa = cliente.etapa_regua || titulos[0].etapa_regua;

    let mensagem: string;
    let wamid: string | undefined;

    const nome = cliente.cliente.split(" ")[0];
    const t0 = titulos[0];

    if (isUazapiConfigured()) {
      // Canal uazapi: tenta gerar PIX na primeira mensagem (Quick Win)
      let pixPayload: LaraPagamentoPayload | null = null;
      try {
        pixPayload = await this.gerarPayloadPagamento("pix", cliente, titulos);
      } catch {
        // fallback: PIX indisponivel, pede preferencia ao cliente
      }

      const pixCopiaCola = (pixPayload?.tipo === "pix" || pixPayload?.tipo === "bolepix")
        ? pixPayload.pix_copia_cola
        : "";

      if (pixPayload && pixCopiaCola) {
        // PIX disponivel: envia tudo na primeira mensagem
        const totalFmt = formatMoneyBr(pixPayload.total ?? total);
        let cabecalho: string;
        if (titulos.length === 1) {
          cabecalho =
            `Ola ${nome}! Identificamos um titulo em aberto:\n\n` +
            `📋 Duplicata: ${t0.duplicata}\n` +
            `💰 Valor: ${formatMoneyBr(t0.valor)}\n` +
            `📅 Vencimento: ${formatDateBr(t0.vencimento)}\n\n` +
            `Para facilitar, segue o PIX no valor de *${totalFmt}*:`;
        } else {
          const linhas = titulos.slice(0, 5).map((t) =>
            `• ${t.duplicata} — ${formatMoneyBr(t.valor)} (venc. ${formatDateBr(t.vencimento)})`
          ).join("\n");
          cabecalho =
            `Ola ${nome}! Voce possui ${titulos.length} titulo(s) em aberto totalizando *${formatMoneyBr(total)}*:\n\n` +
            `${linhas}${titulos.length > 5 ? `\n...e mais ${titulos.length - 5} titulo(s)` : ""}\n\n` +
            `Para facilitar, segue o PIX consolidado no valor de *${totalFmt}*:`;
        }
        const res = await uazapiSendText(waId, cabecalho);
        wamid = res.messageid;
        // Envia o codigo PIX como mensagem separada (facil de copiar)
        await new Promise((r) => setTimeout(r, 600));
        await uazapiSendText(waId, pixCopiaCola);
        await new Promise((r) => setTimeout(r, 400));
        await uazapiSendText(waId, `Apos o pagamento, responda *PAGO* para confirmarmos. Se preferir boleto, responda *BOLETO*.`);
        mensagem = titulos.length === 1
          ? `[uazapi-pix:${etapa}] ${t0.duplicata} | ${formatMoneyBr(t0.valor)}`
          : `[uazapi-pix:${etapa}] ${titulos.length} titulos | ${formatMoneyBr(total)}`;
      } else {
        // Fallback: PIX indisponivel, pede preferencia
        let texto: string;
        if (titulos.length === 1) {
          texto =
            `Ola ${nome}! Identificamos um titulo em aberto:\n\n` +
            `📋 Duplicata: ${t0.duplicata}\n` +
            `💰 Valor: ${formatMoneyBr(t0.valor)}\n` +
            `📅 Vencimento: ${formatDateBr(t0.vencimento)}\n\n` +
            `Para regularizar, responda *BOLETO* ou *PIX* e te envio o codigo de pagamento.`;
        } else {
          const linhas = titulos.slice(0, 5).map((t) =>
            `• ${t.duplicata} — ${formatMoneyBr(t.valor)} (venc. ${formatDateBr(t.vencimento)})`
          ).join("\n");
          texto =
            `Ola ${nome}! Voce possui ${titulos.length} titulo(s) em aberto totalizando *${formatMoneyBr(total)}*:\n\n` +
            `${linhas}${titulos.length > 5 ? `\n...e mais ${titulos.length - 5} titulo(s)` : ""}\n\n` +
            `Para regularizar, responda *BOLETO* ou *PIX* e te envio o codigo de pagamento.`;
        }
        const res = await uazapiSendText(waId, texto);
        wamid = res.messageid;
        mensagem = titulos.length === 1
          ? `[uazapi:${etapa}] ${t0.duplicata} | ${formatMoneyBr(t0.valor)}`
          : `[uazapi:${etapa}] ${titulos.length} titulos | ${formatMoneyBr(total)}`;
      }
    } else {
      // Canal Meta: usa template aprovado
      const result = await enviarTemplateEtapa({
        to: waId,
        etapa,
        cliente: nome,
        duplicata: titulos.length === 1 ? t0.duplicata : undefined,
        valor: formatMoneyBr(total),
        vencimento: titulos.length === 1 ? formatDateBr(t0.vencimento) : undefined,
      });
      wamid = result?.messages?.[0]?.id;
      mensagem = titulos.length === 1
        ? `[template:${etapa}] ${t0.duplicata} | ${formatMoneyBr(t0.valor)}`
        : `[template:${etapa}] ${titulos.length} titulos | ${formatMoneyBr(total)}`;
    }

    const duplicatasJoin = titulos.map((t) => t.duplicata).join(", ");
    const duplicatasList = titulos.map((t) => t.duplicata);

    await laraOperationalStore.addMessageLog({
      wa_id: waId,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      telefone: cliente.telefone,
      message_text: mensagem,
      direction: "OUTBOUND",
      origem: "regua-consolidado",
      etapa,
      duplics: duplicatasJoin,
      valor_total: total,
      payload_json: JSON.stringify({ acao: "disparo_regua_consolidado", titulos_count: titulos.length, wamid }),
      status: "enviado",
      sent_at: dateToIsoDateTime(new Date()),
      received_at: "",
      message_type: titulos.length === 1 ? "template" : "texto",
      operator_name: "Lara Automacao",
      idempotency_key: makeIdempotencyKey([waId, "regua-consolidado", etapa, String(input.codcli), dateToIsoDate(new Date())]),
    });

    // Registra contexto em memória: garante que respostas do cliente na mesma sessão
    // do servidor sejam associadas imediatamente ao codcli sem depender do Oracle.
    this.bindWaContext(waId, Number(cliente.codcli), duplicatasList);

    // Atualiza cache do cliente com wa_id resolvido (para novos inbounds)
    if (!cliente.wa_id && waId) {
      const atualizado = { ...cliente, wa_id: waId };
      await laraOperationalStore.upsertClienteCache(atualizado).catch(() => undefined);
    }

    return { status: "ok", wa_id: waId, titulos_count: titulos.length, etapa, mensagem, wamid };
  }

  async listClientes(filters: {
    search?: string;
    filial?: string;
    filiais?: string[];
    risco?: string;
    optout?: boolean;
    limit?: number;
  }): Promise<LaraCliente[]> {
    await this.ensureWarmCache();
    const clientes = await laraOperationalStore.listClientesCache();
    const optouts = await laraOperationalStore.listOptouts();
    const optByCodcli = new Map(optouts.filter((item) => item.ativo).map((item) => [item.codcli, item]));

    let rows = clientes.map((cliente) => {
      const opt = optByCodcli.get(cliente.codcli);
      return {
        ...cliente,
        optout: Boolean(opt),
        status: opt ? "Opt-out ativo" : cliente.status,
      };
    });

    if (filters.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.telefone.includes(search)
        || item.wa_id.includes(search),
      );
    }
    const filiaisSet = normalizeFiliaisFilter({ filial: filters.filial, filiais: filters.filiais });
    rows = rows.filter((item) => matchesFilialFilter(item.filial, filiaisSet));
    if (filters.risco) {
      rows = rows.filter((item) => item.risco === filters.risco);
    }
    if (filters.optout !== undefined) {
      rows = rows.filter((item) => item.optout === filters.optout);
    }
    rows = rows.sort((a, b) => b.total_aberto - a.total_aberto);
    if (filters.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listClientesPaged(filters: {
    search?: string;
    filial?: string;
    filiais?: string[];
    risco?: string;
    optout?: boolean;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraCliente>> {
    const rows = await this.listClientes({
      search: filters.search,
      filial: filters.filial,
      filiais: filters.filiais,
      risco: filters.risco,
      optout: filters.optout,
    });

    const sorted = [...rows].sort((a, b) => {
      if (b.total_aberto !== a.total_aberto) return b.total_aberto - a.total_aberto;
      return a.codcli.localeCompare(b.codcli);
    });

    return paginateRows(
      sorted,
      filters.page_size,
      filters.cursor,
      (row, cursor) => {
        const cursorTotal = Number(cursor.total_aberto ?? 0);
        const cursorCodcli = String(cursor.codcli ?? "");
        if (row.total_aberto < cursorTotal) return true;
        if (row.total_aberto === cursorTotal && row.codcli > cursorCodcli) return true;
        return false;
      },
      (row) => ({ total_aberto: row.total_aberto, codcli: row.codcli }),
    );
  }

  async getCliente(codcli: number): Promise<LaraCliente | null> {
    await this.ensureWarmCache();
    let cliente = await laraOperationalStore.getClienteCache(codcli);

    // Cache hit mas sem telefone: atualiza a partir do Oracle (fix para dados sincronizados
    // antes de a resolução de colunas de telefone incluir todas as variantes).
    if (cliente && !cliente.wa_id && !cliente.telefone && isOracleEnabled()) {
      const freshBase = await getClientByCodcli(codcli).catch(() => null);
      if (freshBase?.TELEFONE) {
        cliente = {
          ...cliente,
          telefone: freshBase.TELEFONE,
          wa_id: normalizeWaId(freshBase.TELEFONE),
        };
        await laraOperationalStore.upsertClienteCache(cliente).catch(() => undefined);
      }
    }

    if (!cliente && isOracleEnabled()) {
      const base = await getClientByCodcli(codcli);
      if (!base) return null;

      const [summary, titulosAberto] = await Promise.all([
        getOpenSummaryByCodcli(codcli),
        listOpenTitlesFromOracle({ codcli, limit: 5000 }),
      ]);

      const hoje = dateToIsoDate(new Date());
      let tituloMaisAntigo = "";
      let proximoVencimento = "";
      for (const titulo of titulosAberto) {
        const vencimento = dateToIsoDate(titulo.DTVENC);
        if (!vencimento) continue;
        if (!tituloMaisAntigo || vencimento < tituloMaisAntigo) {
          tituloMaisAntigo = vencimento;
        }
        if (vencimento >= hoje && (!proximoVencimento || vencimento < proximoVencimento)) {
          proximoVencimento = vencimento;
        }
      }

      cliente = {
        codcli: String(codcli),
        cliente: base.CLIENTE ?? `Cliente ${codcli}`,
        telefone: base.TELEFONE ?? "",
        wa_id: normalizeWaId(base.TELEFONE ?? ""),
        cpf_cnpj: base.CGCENT ?? "",
        filial: base.CODFILIAL ?? "",
        total_aberto: summary.totalAberto,
        qtd_titulos: summary.qtdTitulos,
        titulo_mais_antigo: tituloMaisAntigo,
        proximo_vencimento: proximoVencimento,
        ultimo_contato: "",
        ultima_acao: "Identificado via Oracle",
        proxima_acao: "Aguardar contato",
        optout: false,
        etapa_regua: inferEtapaRegua(summary.maxDiasAtraso),
        status: "Em aberto",
        responsavel: "Lara Automacao",
        risco: inferRisk(summary.maxDiasAtraso, summary.totalAberto),
      };
      await laraOperationalStore.upsertClienteCache(cliente);
    }
    if (!cliente) return null;
    const optout = await laraOperationalStore.findActiveOptoutByWaId(cliente.wa_id);
    return {
      ...cliente,
      optout: Boolean(optout),
      status: optout ? "Opt-out ativo" : cliente.status,
    };
  }

  async listTitulos(filters: {
    search?: string;
    codcli?: number;
    etapa?: string;
    filial?: string;
    filiais?: string[];
    atrasoMin?: number;
    atrasoMax?: number;
    limit?: number;
  }): Promise<LaraTitulo[]> {
    await this.ensureWarmCache();
    let rows = filters.codcli
      ? await laraOperationalStore.listTitulosByCodcli(filters.codcli)
      : await laraOperationalStore.listTitulosCache();
    if (filters.codcli) rows = rows.filter((item) => item.codcli === String(filters.codcli));
    if (filters.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.duplicata.toLowerCase().includes(search),
      );
    }
    if (filters.etapa) rows = rows.filter((item) => item.etapa_regua === filters.etapa);
    const filiaisSet = normalizeFiliaisFilter({ filial: filters.filial, filiais: filters.filiais });
    rows = rows.filter((item) => matchesFilialFilter(item.filial, filiaisSet));
    if (filters.atrasoMin !== undefined) rows = rows.filter((item) => item.dias_atraso >= filters.atrasoMin!);
    if (filters.atrasoMax !== undefined) rows = rows.filter((item) => item.dias_atraso <= filters.atrasoMax!);
    rows.sort((a, b) => b.dias_atraso - a.dias_atraso || b.valor - a.valor || a.id.localeCompare(b.id));
    if (filters.limit) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listTitulosPaged(filters: {
    search?: string;
    codcli?: number;
    etapa?: string;
    filial?: string;
    filiais?: string[];
    atrasoMin?: number;
    atrasoMax?: number;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraTitulo>> {
    const rows = await this.listTitulos({
      search: filters.search,
      codcli: filters.codcli,
      etapa: filters.etapa,
      filial: filters.filial,
      filiais: filters.filiais,
      atrasoMin: filters.atrasoMin,
      atrasoMax: filters.atrasoMax,
    });

    return paginateRows(
      rows,
      filters.page_size,
      filters.cursor,
      (row, cursor) => {
        const cursorDias = Number(cursor.dias_atraso ?? 0);
        const cursorValor = Number(cursor.valor ?? 0);
        const cursorId = String(cursor.id ?? "");
        if (row.dias_atraso < cursorDias) return true;
        if (row.dias_atraso > cursorDias) return false;
        if (row.valor < cursorValor) return true;
        if (row.valor > cursorValor) return false;
        return row.id > cursorId;
      },
      (row) => ({ dias_atraso: row.dias_atraso, valor: row.valor, id: row.id }),
    );
  }

  async listFiliais(): Promise<string[]> {
    const filiaisOracle = await listFiliaisFromOracle();
    if (filiaisOracle.length > 0) {
      return filiaisOracle;
    }

    await this.ensureWarmCache();
    const [clientes, titulos] = await Promise.all([
      laraOperationalStore.listClientesCache(),
      laraOperationalStore.listTitulosCache(),
    ]);

    const filiais = new Set<string>();
    for (const cliente of clientes) {
      const filial = normalizeFilial(cliente.filial);
      if (filial) filiais.add(filial);
    }
    for (const titulo of titulos) {
      const filial = normalizeFilial(titulo.filial);
      if (filial) filiais.add(filial);
    }
    return sortFiliais(Array.from(filiais));
  }

  async getTitulo(id: string): Promise<LaraTitulo | null> {
    return laraOperationalStore.getTituloCache(id);
  }

  private async buildConversaFromWaId(waId: string): Promise<LaraConversa | null> {
    const mensagensRows = await laraOperationalStore.listMessagesByWaId(waId);
    if (!mensagensRows.length) return null;
    const mensagens = laraOperationalStore.buildConversationMessages(mensagensRows);
    const ultima = mensagens[mensagens.length - 1];
    const inicio = mensagens[0];
    const lastRow = mensagensRows[mensagensRows.length - 1];
    const codcli = Number(lastRow.codcli ?? 0);
    const cliente = codcli ? await this.getCliente(codcli) : null;
    const statusAtual = cliente?.status || (String(lastRow.status || "").trim() || "Aguardando resposta");
    return {
      id: `conv-${waId}`,
      codcli: codcli ? String(codcli) : "",
      cliente: cliente?.cliente || lastRow.cliente || "Cliente nao identificado",
      telefone: cliente?.telefone || lastRow.telefone || "",
      wa_id: waId,
      status: statusAtual,
      etapa: cliente?.etapa_regua || (lastRow.etapa || "-"),
      origem: lastRow.origem || "receptivo",
      inicio: dateToIsoDateTime(inicio.data_hora),
      ultima_interacao: dateToIsoDateTime(ultima.data_hora),
      total_mensagens: mensagens.length,
      mensagens,
      encerrada: false,
      responsavel: "Lara Automacao",
    };
  }

  async listConversas(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    limit?: number;
  }): Promise<LaraConversa[]> {
    // Single Oracle query — uses client data embedded in the message rows (no N+1, no full cache scan)
    const allRows = await laraOperationalStore.listAllMessages(2000);

    // Group messages by wa_id (rows come DESC from Oracle, sort each group ASC)
    type MsgRow = typeof allRows[number];
    const byWaId = new Map<string, MsgRow[]>();
    for (const row of allRows) {
      if (!row.wa_id) continue;
      const list = byWaId.get(row.wa_id) ?? [];
      list.push(row);
      byWaId.set(row.wa_id, list);
    }

    const conversas: LaraConversa[] = [];
    for (const [waId, mensagensRows] of byWaId) {
      mensagensRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const mensagens = laraOperationalStore.buildConversationMessages(mensagensRows);
      if (!mensagens.length) continue;
      const ultima = mensagens[mensagens.length - 1];
      const inicio = mensagens[0];
      const lastRow = mensagensRows[mensagensRows.length - 1];
      const codcli = Number(lastRow.codcli ?? 0);
      conversas.push({
        id: `conv-${waId}`,
        codcli: codcli ? String(codcli) : "",
        cliente: lastRow.cliente || "Cliente nao identificado",
        telefone: lastRow.telefone || "",
        wa_id: waId,
        status: String(lastRow.status || "").trim() || "Aguardando resposta",
        etapa: lastRow.etapa || "-",
        origem: lastRow.origem || "receptivo",
        inicio: dateToIsoDateTime(inicio.data_hora),
        ultima_interacao: dateToIsoDateTime(ultima.data_hora),
        total_mensagens: mensagens.length,
        mensagens,
        encerrada: false,
        responsavel: "Lara Automacao",
      });
    }

    let rowsFiltered = [...conversas];

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rowsFiltered = rowsFiltered.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.telefone.includes(search)
        || item.wa_id.includes(search),
      );
    }

    if (filters?.canal) {
      const canal = String(filters.canal).trim().toUpperCase();
      rowsFiltered = rowsFiltered.filter((item) => mapOrigemToCanal(item.origem) === canal);
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      // Load client cache only when filial filter is explicitly requested
      const clientes = await laraOperationalStore.listClientesCache();
      const clienteMap = new Map(clientes.map((c) => [c.codcli, c]));
      rowsFiltered = rowsFiltered.filter((item) =>
        matchesFilialFilter(String(clienteMap.get(item.codcli)?.filial ?? ""), filiaisSet),
      );
    }

    rowsFiltered.sort((a, b) => b.ultima_interacao.localeCompare(a.ultima_interacao));
    if (filters?.limit && filters.limit > 0) rowsFiltered = rowsFiltered.slice(0, filters.limit);
    return rowsFiltered;
  }

  async listPromessas() {
    return laraOperationalStore.listPromessas();
  }

  async listConversasPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraConversa>> {
    const rows = await this.listConversas({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.ultima_interacao ?? "");
        const cursorWa = String(cursor.wa_id ?? "");
        if (row.ultima_interacao < cursorData) return true;
        if (row.ultima_interacao > cursorData) return false;
        return row.wa_id > cursorWa;
      },
      (row) => ({ ultima_interacao: row.ultima_interacao, wa_id: row.wa_id }),
    );
  }

  async getConversa(waId: string): Promise<LaraConversa | null> {
    return this.buildConversaFromWaId(waId);
  }

  async listAtendimentos(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    limit?: number;
  }): Promise<LaraAtendimento[]> {
    const [conversas, optouts] = await Promise.all([
      this.listConversas({
        search: filters?.search,
        filial: filters?.filial,
        filiais: filters?.filiais,
        canal: filters?.canal,
        limit: filters?.limit,
      }),
      laraOperationalStore.listOptouts(),
    ]);
    const optByWa = new Map(optouts.filter((item) => item.ativo).map((item) => [item.wa_id, true]));
    return conversas.map((conversa) => toAtendimento(conversa, [], Boolean(optByWa.get(conversa.wa_id))));
  }

  async listAtendimentosPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraAtendimento>> {
    const rows = await this.listAtendimentos({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.ultima_interacao ?? "");
        const cursorWa = String(cursor.wa_id ?? "");
        if (row.ultima_interacao < cursorData) return true;
        if (row.ultima_interacao > cursorData) return false;
        return row.wa_id > cursorWa;
      },
      (row) => ({ ultima_interacao: row.ultima_interacao, wa_id: row.wa_id }),
    );
  }

  async listCases(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    limit?: number;
  }): Promise<LaraCaseItem[]> {
    let rows = await laraOperationalStore.listCases();
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.acao.toLowerCase().includes(search)
        || item.detalhe.toLowerCase().includes(search),
      );
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listCasesPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraCaseItem>> {
    const rows = await this.listCases({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async listCasesByCodcli(codcli: number): Promise<LaraCaseItem[]> {
    return laraOperationalStore.listCasesByCodcli(codcli);
  }

  async createCase(input: Parameters<typeof laraOperationalStore.createCase>[0]): Promise<LaraCaseItem> {
    return laraOperationalStore.createCase(input);
  }

  async listOptouts(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    limit?: number;
  }): Promise<LaraOptoutItem[]> {
    let rows = await laraOperationalStore.listOptouts();
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.wa_id.includes(search),
      );
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listOptoutsPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraOptoutItem>> {
    const rows = await this.listOptouts({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_atualizacao ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_atualizacao < cursorData) return true;
        if (row.data_atualizacao > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_atualizacao: row.data_atualizacao, id: row.id }),
    );
  }

  async setOptout(input: Parameters<typeof laraOperationalStore.setOptout>[0]): Promise<LaraOptoutItem> {
    return laraOperationalStore.setOptout(input);
  }

  async removeOptout(id: string): Promise<boolean> {
    return laraOperationalStore.disableOptoutById(id);
  }

  async listLogs(filters?: {
    limit?: number;
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
  }): Promise<LaraLogItem[]> {
    let rows = await laraOperationalStore.listLogs(filters?.limit ?? 500);

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.tipo.toLowerCase().includes(search)
        || item.mensagem.toLowerCase().includes(search)
        || item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search),
      );
    }
    if (filters?.canal) {
      const canal = filters.canal.toLowerCase();
      rows = rows.filter((item) => item.origem.toLowerCase().includes(canal));
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    return rows;
  }

  async listLogsPaged(filters?: {
    limit?: number;
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraLogItem>> {
    const rows = await this.listLogs({
      limit: filters?.limit ?? 5000,
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async addComplianceAudit(input: {
    wa_id: string;
    codcli?: number;
    tenant_id: string;
    jurisdicao: LaraJurisdicao;
    canal: string;
    acao: LaraNextAction | "bloqueado_politica";
    intencao: string;
    score_confianca: number;
    permitido: boolean;
    base_legal: string;
    razao_automatizada: string;
    revisao_humana_disponivel: boolean;
    detalhes?: Record<string, unknown>;
  }): Promise<void> {
    await laraOperationalStore.addComplianceAudit({
      wa_id: input.wa_id,
      codcli: input.codcli,
      tenant_id: input.tenant_id,
      jurisdicao: input.jurisdicao,
      canal: input.canal,
      acao: input.acao,
      intencao: input.intencao,
      score_confianca: input.score_confianca,
      permitido: input.permitido,
      base_legal: input.base_legal,
      razao_automatizada: input.razao_automatizada,
      revisao_humana_disponivel: input.revisao_humana_disponivel,
      detalhes_json: input.detalhes,
    });
  }

  async listComplianceAuditPaged(filters?: {
    codcli?: number;
    wa_id?: string;
    tenant_id?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraComplianceAuditItem>> {
    let rows = await laraOperationalStore.listComplianceAudits();
    if (filters?.codcli) rows = rows.filter((item) => item.codcli === String(filters.codcli));
    if (filters?.wa_id) rows = rows.filter((item) => item.wa_id === filters.wa_id);
    if (filters?.tenant_id) rows = rows.filter((item) => item.tenant_id === filters.tenant_id);
    rows.sort((a, b) => b.data_hora.localeCompare(a.data_hora) || a.id.localeCompare(b.id));

    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async listReguaTemplates(): Promise<LaraReguaTemplate[]> {
    return laraOperationalStore.listReguaTemplates();
  }

  async listReguaExecucoes(limit = 200): Promise<LaraReguaExecucao[]> {
    return laraOperationalStore.listReguaExecucoes(limit);
  }

  async listConfiguracoes() {
    return laraOperationalStore.listConfiguracoes();
  }

  async saveReguaConfig(input: {
    templates?: Array<{
      id?: string;
      etapa: string;
      nome_template: string;
      canal: string;
      mensagem_template: string;
      ativo: boolean;
      ordem_execucao: number;
    }>;
    configuracoes?: Array<{
      chave: string;
      valor: string;
      descricao?: string;
    }>;
  }): Promise<void> {
    if (input.templates) {
      await laraOperationalStore.replaceReguaTemplates(input.templates);
    }
    for (const cfg of input.configuracoes ?? []) {
      await laraOperationalStore.upsertConfiguracao(cfg.chave, cfg.valor, cfg.descricao);
    }
  }

  async getStatusSincronizacaoDiaria(): Promise<LaraSyncStatus> {
    const [
      ativoRaw,
      horaRaw,
      minutoRaw,
      timezoneRaw,
      limitRaw,
      includeDesdRaw,
      startupRunRaw,
      lastRun,
    ] = await Promise.all([
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_ATIVO"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_HORA"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_MINUTO"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_TIMEZONE"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_INCLUDE_DESD"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_STARTUP_RUN"),
      laraOperationalStore.getLastIntegrationByType("pcprest-sync-diario"),
    ]);

    const configuracao = {
      ativo: parseBooleanConfig(ativoRaw, false),
      hora: parseNumberConfig(horaRaw, 6, 0, 23),
      minuto: parseNumberConfig(minutoRaw, 0, 0, 59),
      timezone: String(timezoneRaw ?? "America/Sao_Paulo"),
      limit: parseNumberConfig(limitRaw, 30000, 100, 100000),
      includeDesd: parseBooleanConfig(includeDesdRaw, false),
      startupRun: parseBooleanConfig(startupRunRaw, true),
    };

    if (!lastRun) {
      return {
        configuracao,
        ultima_execucao: null,
      };
    }

    const response = parseJsonObject(lastRun.response_json);
    const ultima_execucao = {
      status: String(lastRun.status_operacao || "desconhecido"),
      data_hora: dateToIsoDateTime(lastRun.created_at),
      total_titulos: toNumber(response.totalTitulos),
      total_clientes: toNumber(response.totalClientes),
      titulos_removidos: toNumber(response.titulosRemovidos),
      clientes_removidos: toNumber(response.clientesRemovidos),
      erro: String(lastRun.erro_resumo || ""),
    };

    return {
      configuracao,
      ultima_execucao,
    };
  }

  async updateJanelaSincronizacao(input: {
    ativo?: boolean;
    hora?: number;
    minuto?: number;
    timezone?: string;
    limit?: number;
    includeDesd?: boolean;
    startupRun?: boolean;
  }): Promise<LaraSyncStatus> {
    if (input.ativo !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_ATIVO", input.ativo ? "true" : "false");
    }
    if (input.hora !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_HORA", String(input.hora));
    }
    if (input.minuto !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_MINUTO", String(input.minuto));
    }
    if (input.timezone !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_TIMEZONE", String(input.timezone));
    }
    if (input.limit !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_LIMIT", String(input.limit));
    }
    if (input.includeDesd !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_INCLUDE_DESD", input.includeDesd ? "true" : "false");
    }
    if (input.startupRun !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_STARTUP_RUN", input.startupRun ? "true" : "false");
    }
    return this.getStatusSincronizacaoDiaria();
  }

  async buildReguaAtivaResumo(): Promise<{
    etapas: LaraReguaEtapa[];
    totalElegivel: number;
    totalRespondido: number;
    totalConvertido: number;
    totalErro: number;
  }> {
    const execucoes = await this.listReguaExecucoes(500);
    const aggregate = new Map<string, LaraReguaEtapa>();

    for (const execucao of execucoes) {
      const current = aggregate.get(execucao.etapa) ?? {
        etapa: execucao.etapa,
        elegivel: 0,
        enviado: 0,
        respondido: 0,
        convertido: 0,
        erro: 0,
        bloqueado_optout: 0,
        taxa_resposta: 0,
        taxa_recuperacao: 0,
      };
      current.elegivel += execucao.elegivel;
      current.enviado += execucao.disparada;
      current.respondido += execucao.respondida;
      current.convertido += execucao.convertida;
      current.erro += execucao.erro;
      current.bloqueado_optout += execucao.bloqueado_optout;
      current.taxa_resposta = current.enviado > 0 ? roundMoney((current.respondido / current.enviado) * 100) : 0;
      current.taxa_recuperacao = current.respondido > 0 ? roundMoney((current.convertido / current.respondido) * 100) : 0;
      aggregate.set(execucao.etapa, current);
    }

    const etapas = Array.from(aggregate.values()).sort((a, b) => a.etapa.localeCompare(b.etapa));
    const totalElegivel = etapas.reduce((sum, item) => sum + item.elegivel, 0);
    const totalRespondido = etapas.reduce((sum, item) => sum + item.respondido, 0);
    const totalConvertido = etapas.reduce((sum, item) => sum + item.convertido, 0);
    const totalErro = etapas.reduce((sum, item) => sum + item.erro, 0);

    return {
      etapas,
      totalElegivel,
      totalRespondido,
      totalConvertido,
      totalErro,
    };
  }

  async getDashboard(filters?: { filial?: string; filiais?: string[]; canal?: string }) {
    const [clientes, titulos, logs, reguaResumo, promessasRows, optoutsAtivos, classificador] = await Promise.all([
      this.listClientes({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }),
      this.listTitulos({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }),
      this.listLogs({ limit: 500 }),
      this.buildReguaAtivaResumo(),
      laraOperationalStore.listPromessas(),
      this.listOptouts({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }).then((rows) => rows.filter((item) => item.ativo)),
      this.getClassifierMetrics(3000),
    ]);

    const hoje = dateToIsoDate(new Date());
    const totalAberto = roundMoney(clientes.reduce((sum, item) => sum + item.total_aberto, 0));
    const clientesAberto = clientes.filter((item) => item.total_aberto > 0).length;
    const boletoEnviados = logs.filter(
      (item) => item.tipo === "Mensagem enviada" && item.mensagem.toLowerCase().includes("boleto"),
    ).length;
    const promessas = promessasRows.length;
    const optouts = optoutsAtivos.length;
    const reguaAtiva = clientes.filter((item) => item.etapa_regua !== "-").length;
    const valorRecuperado = roundMoney(reguaResumo.etapas.reduce((sum, item) => sum + ((item.convertido / 100) * totalAberto), 0));

    const faixaAtraso = [
      { faixa: "A vencer", valor: 0 },
      { faixa: "0-7 dias", valor: 0 },
      { faixa: "8-30 dias", valor: 0 },
      { faixa: "31-90 dias", valor: 0 },
      { faixa: "91-180 dias", valor: 0 },
      { faixa: "180+ dias", valor: 0 },
    ];
    let vencendoHoje = 0;
    let vencidoMaisTrintaDias = 0;
    for (const titulo of titulos) {
      const vlr = titulo.vlreceber ?? titulo.valor;
      if (titulo.vencimento === hoje) vencendoHoje += vlr;
      if (titulo.dias_atraso >= 30) vencidoMaisTrintaDias += vlr;
      if (titulo.vencimento > hoje) faixaAtraso[0].valor += vlr;
      else if (titulo.dias_atraso <= 7) faixaAtraso[1].valor += vlr;
      else if (titulo.dias_atraso <= 30) faixaAtraso[2].valor += vlr;
      else if (titulo.dias_atraso <= 90) faixaAtraso[3].valor += vlr;
      else if (titulo.dias_atraso <= 180) faixaAtraso[4].valor += vlr;
      else faixaAtraso[5].valor += vlr;
    }
    vencendoHoje = roundMoney(vencendoHoje);
    vencidoMaisTrintaDias = roundMoney(vencidoMaisTrintaDias);
    for (const item of faixaAtraso) item.valor = roundMoney(item.valor);

    const statusCounter = new Map<string, number>();
    for (const cliente of clientes) {
      statusCounter.set(cliente.status, (statusCounter.get(cliente.status) ?? 0) + 1);
    }

    const statusPie = Array.from(statusCounter.entries()).map(([name, value]) => ({ name, value }));
    const topClientes = [...clientes].sort((a, b) => b.total_aberto - a.total_aberto).slice(0, 5);

    const alertas = logs
      .filter((item) => item.severidade === "erro" || item.severidade === "aviso" || item.severidade === "bloqueado")
      .slice(0, 8)
      .map((item) => ({
        type: item.severidade === "erro" ? "error" : item.severidade === "bloqueado" ? "warning" : "info",
        title: item.tipo,
        description: item.mensagem,
      }));

    return {
      kpis: {
        totalAberto,
        clientesAberto,
        boletoEnviados,
        interacoesHoje: logs.filter((item) => item.data_hora.startsWith(dateToIsoDate(new Date()))).length,
        promessas,
        optouts,
        reguaAtiva,
        taxaResposta: reguaResumo.totalElegivel > 0 ? roundMoney((reguaResumo.totalRespondido / reguaResumo.totalElegivel) * 100) : 0,
        valorRecuperado,
        vencendoHoje,
        vencidoMaisTrintaDias,
      },
      faixaAtraso,
      statusPie,
      reguaEtapas: reguaResumo.etapas,
      topClientes,
      alertas,
      classificador,
    };
  }

  async getMonitoramentoHealth() {
    const classifierHealth = getIntentClassifierHealthSnapshot();
    const classifierStatus =
      !classifierHealth.enabled
        ? "nao-configurado"
        : !classifierHealth.openai_configured
          ? "degradado"
          : classifierHealth.circuit_state === "closed"
            ? "operacional"
            : "degradado";
    const classifierDetail =
      !classifierHealth.enabled
        ? "Classificador IA desativado por configuracao."
        : !classifierHealth.openai_configured
          ? "OPENAI_API_KEY nao configurada; fallback local ativo."
          : classifierHealth.circuit_state === "open"
            ? `Circuit breaker aberto ate ${classifierHealth.circuit_open_until || "N/A"}.`
            : classifierHealth.circuit_state === "half_open"
              ? "Circuit breaker em half-open (sondagem em andamento)."
              : `Operacional (modelo ${classifierHealth.model}, retry ${classifierHealth.retry_max_attempts}x).`;

    const healthOracle = {
      status: "nao-configurado",
      detalhe: "Oracle nÃ£o configurado",
    };

    if (isOracleEnabled()) {
      try {
        const row = await queryOne<{ STATUS: string }>(`SELECT 'OK' AS STATUS FROM DUAL`);
        healthOracle.status = row?.STATUS === "OK" ? "operacional" : "degradado";
        healthOracle.detalhe = row?.STATUS === "OK" ? "Conectado" : "Resposta inesperada";
      } catch (error) {
        healthOracle.status = "degradado";
        healthOracle.detalhe = error instanceof Error ? error.message : String(error);
      }
    }

    const webhookLimit = Number(await laraOperationalStore.getConfiguracao("RATE_LIMIT_WEBHOOK_POR_MIN") ?? "60");
    return {
      componentes: [
        { label: "Oracle / WinThor", status: healthOracle.status, detail: healthOracle.detalhe },
        { label: "Banco operacional Lara", status: "operacional", detail: "Tabelas LARA_* disponÃ­veis" },
        { label: "Webhooks WhatsApp/n8n", status: "operacional", detail: `Rate limit ${webhookLimit}/min` },
        { label: "Classificador IA (OpenAI+fallback)", status: classifierStatus, detail: classifierDetail },
        { label: "Backend / API", status: "operacional", detail: "Fastify em execuÃ§Ã£o" },
      ],
    };
  }

  async getResumoOperacional() {
    const [logs, conversas, clientesResumo, promessas, optouts, cases, classificador] = await Promise.all([
      this.listLogs({ limit: 500 }),
      this.listConversas(),
      laraOperationalStore.getClientesResumo(),
      laraOperationalStore.listPromessas(),
      this.listOptouts(),
      this.listCases(),
      this.getClassifierMetrics(3000),
    ]);

    const syncHoje = logs.some((item) =>
      item.tipo === "pcprest-sync-diario"
      && item.status.toLowerCase() === "sincronizado"
      && item.data_hora.startsWith(dateToIsoDate(new Date())),
    );
    const falhasSyncHoje = logs.filter((item) =>
      item.tipo === "pcprest-sync-diario" && item.status.toLowerCase() === "erro",
    ).length;

    return {
      mensagens_enviadas: logs.filter((item) => item.tipo === "Mensagem enviada").length,
      mensagens_recebidas: logs.filter((item) => item.tipo === "Mensagem recebida").length,
      fila_pendente: conversas.filter((item) => item.status.toLowerCase().includes("aguardando")).length,
      erros_integracao: logs.filter((item) => item.severidade === "erro").length,
      optouts_ativos: optouts.filter((item) => item.ativo).length,
      promessas_registradas: promessas.length,
      casos_escalados: cases.filter((item) => item.acao.includes("ESCAL")).length,
      clientes_risco_critico: clientesResumo.risco_critico,
      valor_total_aberto: clientesResumo.valor_total_aberto,
      sincronizacao_diaria_ok_hoje: syncHoje ? 1 : 0,
      falhas_sincronizacao_hoje: falhasSyncHoje,
      classificador_total_classificacoes: classificador.total_classificacoes,
      classificador_openai_usado: classificador.openai_usado,
      classificador_fallback_local: classificador.fallback_local,
      classificador_circuito_aberto_eventos: classificador.circuito_aberto_eventos,
      classificador_acuracia_estimada_media: classificador.acuracia_estimada_media,
      classificador_por_intent: classificador.intents,
    };
  }

  private async findRecentContextByWa(waId: string): Promise<MensagemContexto | null> {
    const nowForCache = Date.now();
    if (!this.janelaContextoCache || nowForCache - this.janelaContextoCache.cachedAt > 30_000) {
      const raw = await laraOperationalStore.getConfiguracao("JANELA_CONTEXTO_HORAS");
      this.janelaContextoCache = { value: Number(raw ?? "72"), cachedAt: nowForCache };
    }
    const windowHours = this.janelaContextoCache.value;
    const rows = await laraOperationalStore.listMessagesByWaId(waId);
    if (!rows.length) return null;

    const now = Date.now();
    const limitMs = windowHours * 60 * 60 * 1000;
    const outbound = [...rows]
      .reverse()
      .find((item) => String(item.direction).toUpperCase() === "OUTBOUND" && Number(item.codcli ?? 0) > 0);
    if (!outbound) return null;

    const createdAt = new Date(outbound.created_at).getTime();
    if (Number.isFinite(createdAt) && now - createdAt > limitMs) return null;

    return {
      codcli: outbound.codcli ?? undefined,
      etapa: outbound.etapa || undefined,
      duplicatas: parseDuplicatas(outbound.duplics),
      valor_total: toNumber(outbound.valor_total ?? 0),
      created_at: outbound.created_at,
    };
  }

  private bindWaContext(waId: string, codcli: number, duplicatas?: string[]): void {
    if (waId && codcli > 0) {
      const prev = this.waContextMap.get(waId);
      this.waContextMap.set(waId, {
        codcli,
        duplicatas: duplicatas ?? prev?.duplicatas,
        updatedAt: Date.now(),
      });
    }
  }

  private getWaContext(waId: string): { codcli: number; duplicatas?: string[] } | null {
    const entry = this.waContextMap.get(waId);
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > this.WA_CONTEXT_TTL_MS) {
      this.waContextMap.delete(waId);
      return null;
    }
    return { codcli: entry.codcli, duplicatas: entry.duplicatas };
  }

  private async identifyClient(input: {
    waId: string;
    telefone?: string;
    codcli?: number;
    messageText: string;
    contextoPreResolvido?: MensagemContexto | null;
  }): Promise<{ cliente: LaraCliente | null; contexto: MensagemContexto | null; ambiguidade: boolean; identifiedViaDocument: boolean }> {
    // 1. In-process context map (primary — zero latency, reliable within same server process)
    const mapped = this.getWaContext(input.waId);
    if (mapped) {
      const clienteMapped = await this.getCliente(mapped.codcli).catch(() => null);
      if (clienteMapped) {
        // Merge stored narrowed duplicatas into context so follow-up messages use same title
        const baseContexto = input.contextoPreResolvido ?? null;
        const contexto: MensagemContexto | null = mapped.duplicatas?.length
          ? {
              codcli: mapped.codcli,
              etapa: baseContexto?.etapa ?? clienteMapped.etapa_regua,
              duplicatas: mapped.duplicatas,
              valor_total: baseContexto?.valor_total ?? 0,
              created_at: baseContexto?.created_at ?? new Date().toISOString(),
            }
          : baseContexto;
        return { cliente: clienteMapped, contexto, ambiguidade: false, identifiedViaDocument: false };
      }
    }

    // 2. Oracle message log context (secondary — persists across restarts, may fail transiently)
    const contexto = input.contextoPreResolvido !== undefined
      ? input.contextoPreResolvido
      : await this.findRecentContextByWa(input.waId);

    if (contexto?.codcli) {
      const clienteContexto = await this.getCliente(contexto.codcli).catch(() => null);
      if (clienteContexto) {
        this.bindWaContext(input.waId, contexto.codcli);
        if (!clienteContexto.wa_id && input.waId) {
          const updated = { ...clienteContexto, wa_id: input.waId, telefone: clienteContexto.telefone || input.telefone || "" };
          await laraOperationalStore.upsertClienteCache(updated).catch(() => {});
          return { cliente: updated, contexto, ambiguidade: false, identifiedViaDocument: false };
        }
        return { cliente: clienteContexto, contexto, ambiguidade: false, identifiedViaDocument: false };
      }
      // getCliente falhou — tenta reconstruir direto do Oracle
      if (isOracleEnabled()) {
        const base = await getClientByCodcli(contexto.codcli).catch(() => null);
        if (base) {
          const [summary, titulosAberto] = await Promise.all([
            getOpenSummaryByCodcli(contexto.codcli).catch(() => ({ totalAberto: 0, qtdTitulos: 0, maxDiasAtraso: 0 })),
            listOpenTitlesFromOracle({ codcli: contexto.codcli, limit: 100 }).catch(() => [] as OracleOpenTitleRow[]),
          ]);
          const hoje = dateToIsoDate(new Date());
          let tituloMaisAntigo = "";
          let proximoVencimento = "";
          for (const t of titulosAberto) {
            const v = dateToIsoDate(t.DTVENC);
            if (!v) continue;
            if (!tituloMaisAntigo || v < tituloMaisAntigo) tituloMaisAntigo = v;
            if (v >= hoje && (!proximoVencimento || v < proximoVencimento)) proximoVencimento = v;
          }
          const clienteRecuperado: LaraCliente = {
            codcli: String(contexto.codcli),
            cliente: base.CLIENTE ?? `Cliente ${contexto.codcli}`,
            telefone: input.telefone || base.TELEFONE || "",
            wa_id: input.waId,
            cpf_cnpj: base.CGCENT || "",
            filial: base.CODFILIAL || "",
            total_aberto: contexto.valor_total ?? summary.totalAberto,
            qtd_titulos: summary.qtdTitulos,
            titulo_mais_antigo: tituloMaisAntigo,
            proximo_vencimento: proximoVencimento,
            ultimo_contato: "",
            ultima_acao: "Recuperado via contexto Oracle",
            proxima_acao: "Aguardar contato",
            optout: false,
            etapa_regua: contexto.etapa || inferEtapaRegua(summary.maxDiasAtraso),
            status: "Em aberto",
            responsavel: "Lara Automacao",
            risco: inferRisk(summary.maxDiasAtraso, contexto.valor_total ?? summary.totalAberto),
          };
          await laraOperationalStore.upsertClienteCache(clienteRecuperado).catch(() => {});
          this.bindWaContext(input.waId, contexto.codcli);
          return { cliente: clienteRecuperado, contexto, ambiguidade: false, identifiedViaDocument: false };
        }
      }
    }

    if (input.codcli) {
      const cliente = await this.getCliente(input.codcli);
      if (cliente) {
        this.bindWaContext(input.waId, Number(cliente.codcli));
        return { cliente, contexto, ambiguidade: false, identifiedViaDocument: false };
      }
    }

    const clientesCache = await this.listClientes({});
    const normalizedWa = normalizeWaId(input.waId);
    const normalizedPhone = normalizePhone(input.telefone ?? input.waId);
    const localMatches = clientesCache.filter((item) =>
      normalizeWaId(item.wa_id) === normalizedWa
      || normalizePhone(item.telefone) === normalizedPhone,
    );
    if (localMatches.length === 1) {
      this.bindWaContext(input.waId, Number(localMatches[0].codcli));
      return { cliente: localMatches[0], contexto, ambiguidade: false, identifiedViaDocument: false };
    }
    if (localMatches.length > 1) {
      return { cliente: null, contexto, ambiguidade: true, identifiedViaDocument: false };
    }

    if (normalizedPhone) {
      const oracleMatches = await findClientsByPhone(normalizedPhone);
      if (oracleMatches.length === 1) {
        const match = oracleMatches[0];
        const cliente = await this.getCliente(Number(match.CODCLI));
        if (cliente) {
          this.bindWaContext(input.waId, Number(cliente.codcli));
          return { cliente, contexto, ambiguidade: false, identifiedViaDocument: false };
        }
      }
      if (oracleMatches.length > 1) {
        return { cliente: null, contexto, ambiguidade: true, identifiedViaDocument: false };
      }
    }

    const doc = extractDocumentFromText(input.messageText);
    if (doc) {
      const byDoc = await findClientByDocument(doc);
      if (byDoc) {
        const cliente = await this.getCliente(Number(byDoc.CODCLI));
        if (cliente) {
          this.bindWaContext(input.waId, Number(cliente.codcli));
          if (!cliente.wa_id && input.waId) {
            const updated = { ...cliente, wa_id: input.waId, telefone: cliente.telefone || input.telefone || "" };
            await laraOperationalStore.upsertClienteCache(updated).catch(() => {});
            return { cliente: updated, contexto, ambiguidade: false, identifiedViaDocument: true };
          }
          return { cliente, contexto, ambiguidade: false, identifiedViaDocument: true };
        }
      }
      // Documento extraído mas não localizado no Oracle — sinaliza tentativa de documento
      return { cliente: null, contexto, ambiguidade: false, identifiedViaDocument: true };
    }

    return { cliente: null, contexto, ambiguidade: false, identifiedViaDocument: false };
  }

  private oracleTituloToLaraTitulo(row: OracleOpenTitleRow): LaraTitulo {
    const codcli = Number(row.CODCLI ?? 0);
    const duplicata = String(row.DUPLICATA ?? "").trim();
    const prestacao = String(row.PRESTACAO ?? "").trim();
    const vencimento = dateToIsoDate(row.DTVENC);
    const diasAtraso = Math.max(0, Math.round(toNumber(row.DIAS_ATRASO)));
    const statusAtendimento = mapOracleStatusToAtendimento(String(row.STATUS_TITULO ?? ""));
    const etapa = inferEtapaRegua(diasAtraso);
    const nomeCliente = String(row.CLIENTE ?? `Cliente ${codcli}`).trim();
    return {
      id: makeTituloId(codcli, duplicata, prestacao),
      duplicata,
      prestacao,
      numtransvenda: Number(row.NUMTRANSVENDA ?? 0),
      numnota: Number(row.NUMNOTA ?? 0),
      codcli: String(codcli),
      cliente: nomeCliente,
      fantasia: String(row.FANTASIA ?? row.CLIENTE ?? "").trim() || nomeCliente,
      telefone: String(row.TELEFONE ?? "").trim(),
      valor: roundMoney(toNumber(row.VLRECEBER ?? row.VALOR)),
      vlreceber: roundMoney(toNumber(row.VLRECEBER ?? row.VALOR)),
      vldesc: roundMoney(toNumber(row.VLDESC ?? 0)),
      cmulta_prev: roundMoney(toNumber(row.CMULTA_PREV ?? 0)),
      percmulta: toNumber(row.PERCMULTA ?? 0),
      vencimento,
      dtemissao: dateToIsoDate(row.DTEMISSAO as Date | string | null | undefined),
      dtrecebimento_previsto: dateToIsoDate(row.DTRECEBIMENTO_PREVISTO as Date | string | null | undefined),
      dias_atraso: diasAtraso,
      codcob: String(row.CODCOB ?? "").trim(),
      cobranca: String(row.COBRANCA ?? row.CODCOB ?? "").trim(),
      rca: String(row.RCA ?? "").trim(),
      etapa_regua: etapa,
      status_atendimento: statusAtendimento,
      boleto_disponivel: true,
      pix_disponivel: true,
      titulo_com_data_prevista: String(row.TITULO_COM_DATA_PREVISTA ?? "") === "*",
      ultima_acao: `Oracle direto (${statusAtendimento})`,
      responsavel: "Lara Automacao",
      filial: String(row.FILIAL ?? "").trim(),
    };
  }

  private async pickTitulosForContext(codcli: number, contexto: MensagemContexto | null): Promise<LaraTitulo[]> {
    let titulos = await this.listTitulos({ codcli, limit: 2000 });

    // Fallback Oracle direto quando o cache local está vazio (sync não executado)
    if (titulos.length === 0 && isOracleEnabled()) {
      const oracleRows = await listOpenTitlesFromOracle({ codcli, limit: 500 });
      titulos = oracleRows.map((row) => this.oracleTituloToLaraTitulo(row));
    }

    if (!contexto?.duplicatas || contexto.duplicatas.length === 0) return titulos;
    const set = new Set(contexto.duplicatas.map((item) => item.toLowerCase()));
    const filtered = titulos.filter((item) => set.has(item.duplicata.toLowerCase()));
    return filtered.length ? filtered : titulos;
  }

  private buildMensagemPagamento(payload: LaraPagamentoPayload): string {
    const totalFmt = Number(payload.total ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    if (payload.tipo === "boleto") {
      const partes = [`Segue o boleto atualizado. Valor total ${totalFmt}.`];
      if (String(payload.linha_digitavel ?? "").trim()) {
        partes.push("", "Linha digitavel:", payload.linha_digitavel);
      }
      if (String(payload.url_boleto ?? "").trim()) {
        partes.push(`URL boleto: ${payload.url_boleto}`);
      }
      return partes.join("\n");
    }

    if (payload.tipo === "bolepix") {
      const partes = [`Segue o BolePix para pagamento no valor total de ${totalFmt}.`];
      if (String(payload.pix_copia_cola ?? "").trim()) {
        partes.push("", "PIX copia e cola:", payload.pix_copia_cola);
      } else if (String(payload.linha_digitavel ?? "").trim()) {
        partes.push("", "Linha digitavel:", payload.linha_digitavel);
      }
      return partes.join("\n");
    }

    const partes = [`Segue PIX copia e cola para pagamento no valor de ${totalFmt}.`];
    if (String(payload.pix_copia_cola ?? "").trim()) {
      partes.push("", "PIX copia e cola:", payload.pix_copia_cola);
    }
    return partes.join("\n");
  }

  private buildTitulosResumoForLlm(titulos: LaraTitulo[]): Array<Record<string, unknown>> {
    return titulos.slice(0, 6).map((item) => ({
      duplicata: item.duplicata,
      prestacao: item.prestacao,
      valor: roundMoney(item.valor),
      vencimento: item.vencimento,
      dias_atraso: item.dias_atraso,
      status: item.status_atendimento,
    }));
  }

  private buildApresentacaoTitulosMsg(
    cliente: LaraCliente,
    titulos: LaraTitulo[],
    total: number,
    timezone = "America/Sao_Paulo",
  ): string {
    const saudacao = saudacaoHoraria(timezone);
    const nome = cliente.cliente.split(" ")[0];
    const totalFmt = formatMoneyBr(total);

    if (titulos.length === 0) {
      return `${saudacao}, ${nome}! Localizei seu cadastro, mas nao encontrei titulos em aberto no momento. Se tiver duvidas, estou aqui para ajudar.`;
    }

    const linhas: string[] = [
      `${saudacao}, ${nome}! Localizei seu cadastro. Voce possui ${titulos.length} titulo(s) em aberto:`,
    ];

    const amostra = titulos.slice(0, 5);
    for (const t of amostra) {
      const vencFmt = formatDateBr(t.vencimento);
      const valorFmt = formatMoneyBr(t.valor);
      const atrasoInfo = Number(t.dias_atraso) > 0
        ? ` - ${t.dias_atraso} dias em atraso`
        : " - a vencer";
      linhas.push(`• Duplic. ${t.duplicata} | ${valorFmt} | Venc. ${vencFmt}${atrasoInfo}`);
    }

    if (titulos.length > 5) {
      linhas.push(`...e mais ${titulos.length - 5} titulo(s).`);
    }

    linhas.push(`\nTotal em aberto: *${totalFmt}*`);
    linhas.push(`\nDeseja negociar? Posso oferecer opcoes de pagamento a vista, parcelamento ou gerar boleto/PIX.`);

    const result = linhas.join("\n");
    return result.length > 4096 ? `${result.slice(0, 4093)}...` : result;
  }

  private async composeRespostaCobranca(input: LaraResponseComposeInput): Promise<LaraResponseComposeResult> {
    const fallbackMessage = sanitizeOutboundMessage(input.fallbackMessage, "Recebemos sua mensagem e estamos processando.");
    const aiEnabled = Boolean(env.LARA_AI_RESPONSE_ENABLED);
    const apiKey = String(env.OPENAI_API_KEY ?? "").trim();

    if (!aiEnabled || !apiKey) {
      return {
        message: fallbackMessage,
        provider: "fallback",
        fallbackReason: aiEnabled ? "OPENAI_API_KEY ausente." : "LARA_AI_RESPONSE_ENABLED=false",
      };
    }

    const idempotencyKey = `openai-reply:${makeIdempotencyKey([
      input.tenantId,
      input.waId,
      input.action,
      input.intent,
      input.inboundMessage,
      input.total,
      input.duplicatas.join(","),
    ])}`;

    const saudacao = saudacaoHoraria();
    const nomeCliente = input.cliente.cliente.split(" ")[0];
    const historico = input.historicoConversa ?? [];
    const qtdTrocas = historico.length;
    const jaApresentouTitulos = historico.some(
      (h) => h.role === "lara" && (h.texto.includes("titulo") || h.texto.includes("duplicata") || h.texto.includes("aberto")),
    );
    const jaOfereceuPagamento = historico.some(
      (h) => h.role === "lara" && (h.texto.includes("PIX") || h.texto.includes("boleto") || h.texto.includes("pix")),
    );
    const clienteJaDisseQueVaiPagar = historico.some(
      (h) => h.role === "cliente" && /vou pagar|vou quitar|vou regularizar|pode gerar|pode mandar|manda o pix|manda o boleto/i.test(h.texto),
    );
    const estagio = qtdTrocas === 0 ? "primeiro_contato"
      : !jaApresentouTitulos ? "apresentacao"
      : !jaOfereceuPagamento ? "oferta"
      : clienteJaDisseQueVaiPagar ? "fechamento"
      : "conducao";

    const systemPrompt = [
      "Voce e Lara, assistente virtual de cobranca da empresa. Seu papel e CONDUZIR ativamente a conversa ate a regularizacao dos titulos em aberto.",
      "",
      "PRINCIPIOS DE CONDUCAO DA CONVERSA:",
      "- Leia o historico completo antes de responder. Nao repita o que ja foi dito.",
      "- Identifique em que estagio a conversa esta e avance para o proximo passo natural.",
      "- Cada resposta deve terminar com uma pergunta ou chamada para acao clara.",
      "- Se o cliente ja demonstrou intencao de pagar, vá direto para a geracao do meio de pagamento.",
      "- Se o cliente esta em duvida, esclareça e ofereça a opcao mais simples primeiro.",
      "- Se o cliente esta resistente, explore o motivo e proponha negociacao ou parcelamento.",
      "- Nunca deixe a conversa sem direcao — sempre indique o proximo passo.",
      "",
      "REGRAS ABSOLUTAS:",
      `- Inicie com: '${saudacao}, ${nomeCliente}!' somente se for o primeiro contato ou se a saudacao nao aparecer no historico.`,
      "- Nao inicie com saudacao se ja cumprimentou antes — vá direto ao ponto.",
      "- Use apenas dados do contexto fornecido. Nao invente valores, descontos, prazos ou confirmacoes.",
      "- Nao ameace, nao constranja, nao use linguagem agressiva ou juridica intimidadora.",
      "- Se o cliente mudar de assunto, redirecione educadamente ao escopo financeiro.",
      "- Nao use markdown. Maximo 6 linhas curtas e diretas.",
      "- Nunca confirme baixa ou pagamento sem evento homologado pelo sistema.",
      "",
      "ESTAGIOS E COMPORTAMENTOS ESPERADOS:",
      "  primeiro_contato → apresente os titulos em aberto e pergunte se quer quitar agora.",
      "  apresentacao     → explique os titulos e ofereça PIX ou boleto.",
      "  oferta           → reforce o beneficio de quitar hoje e pergunte qual forma de pagamento.",
      "  fechamento       → confirme a intencao, gere o meio de pagamento, encaminhe.",
      "  conducao         → analise a mensagem, identifique a necessidade, avance para fechamento.",
    ].join("\n");

    const titulosResumo = this.buildTitulosResumoForLlm(input.titulos);
    const maxAtraso = input.titulos.reduce((max, item) => Math.max(max, Number(item.dias_atraso ?? 0)), 0);
    const nextVencimento = [...input.titulos]
      .map((item) => String(item.vencimento ?? "").trim())
      .filter(Boolean)
      .sort()[0] ?? "";

    const instrucoesPorEstagio: Record<string, string[]> = {
      primeiro_contato: [
        `Apresente os ${input.titulos.length} titulo(s) com duplicata, valor e vencimento (maximo 5).`,
        "Informe o total em aberto.",
        "Pergunte diretamente: 'Deseja quitar hoje? Posso gerar PIX ou boleto.'",
      ],
      apresentacao: [
        "O cliente ainda nao viu os titulos claramente. Apresente-os de forma resumida.",
        "Ofereça PIX (pagamento instantaneo) ou boleto (1 dia util) como opcoes.",
        "Termine com uma pergunta direta sobre qual prefere.",
      ],
      oferta: [
        "Os titulos ja foram apresentados. Foque em fechar o pagamento.",
        "Reforce a facilidade do PIX ou boleto.",
        "Pergunte: 'Qual forma de pagamento prefere? PIX ou boleto?'",
        "Se o cliente hesitar, ofereça parcelamento ou negociacao.",
      ],
      fechamento: [
        "O cliente demonstrou intencao de pagar. Confirme e encaminhe para o pagamento.",
        "Diga que vai gerar o meio de pagamento solicitado.",
        "Seja objetivo e rapido — nao prolongue a conversa.",
      ],
      conducao: [
        "Analise o que o cliente disse e identifique o que ele precisa agora.",
        "Se for duvida: esclareça com objetividade.",
        "Se for resistencia: proponha negociacao ou parcelamento.",
        "Se for confirmacao: encaminhe para pagamento imediatamente.",
        "Sempre termine com o proximo passo claro.",
      ],
    };

    const userPayload = {
      tenant_id: input.tenantId,
      wa_id_masked: maskPhone(input.waId),
      estagio_conversa: estagio,
      intencao_detectada: input.intent,
      acao_recomendada: input.action,
      razao_politica: input.policyReason,
      mensagem_atual_do_cliente: input.inboundMessage,
      historico_conversa: historico.slice(-10).map((h, i) => ({
        turno: i + 1,
        remetente: h.role === "cliente" ? "CLIENTE" : "LARA",
        texto: h.texto.slice(0, 300),
      })),
      contexto_financeiro: {
        cliente: {
          codcli: input.cliente.codcli,
          nome: input.cliente.cliente,
          etapa_regua: input.cliente.etapa_regua,
          risco: input.cliente.risco,
        },
        resumo: {
          quantidade_titulos: input.titulos.length,
          total_aberto: roundMoney(input.total),
          total_aberto_formatado: formatMoneyBr(input.total),
          maior_atraso_dias: maxAtraso,
          proximo_vencimento: formatDateBr(nextVencimento),
        },
        titulos_amostra: titulosResumo,
      },
      fallback_base: fallbackMessage,
      instrucoes_para_este_turno: instrucoesPorEstagio[estagio] ?? instrucoesPorEstagio.conducao,
      ...(input.conversationSummary ? { resumo_semantico_da_conversa: input.conversationSummary } : {}),
    };

    const baseUrl = String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const url = `${baseUrl}/responses`;
    const timeoutMs = env.OPENAI_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: systemPrompt,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(userPayload, null, 2),
                },
              ],
            },
          ],
          max_output_tokens: env.LARA_AI_RESPONSE_MAX_TOKENS,
        }),
        signal: controller.signal,
      });

      const requestId = response.headers.get("x-request-id") || "";
      const payloadUnknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const outputText = extractOpenAiOutputText(payloadUnknown);
        throw new Error(`OpenAI HTTP ${response.status}. ${safeText(outputText || "Falha ao compor resposta.")}`);
      }

      const generatedText = sanitizeOutboundMessage(extractOpenAiOutputText(payloadUnknown), fallbackMessage);

      await laraOperationalStore.addIntegrationLog({
        integracao: "openai",
        tipo: "reply-composer",
        request_json: {
          tenant_id: input.tenantId,
          model: env.OPENAI_MODEL,
          action: input.action,
          intent: input.intent,
          total: roundMoney(input.total),
          titulos: input.titulos.length,
        },
        response_json: {
          request_id: requestId,
          provider: "openai",
          message_preview: generatedText.slice(0, 250),
        },
        status_operacao: "processado",
        idempotency_key: idempotencyKey,
        correlation_id: input.correlationId,
      });

      return {
        message: generatedText,
        provider: "openai",
        requestId: requestId || undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await laraOperationalStore.addIntegrationLog({
        integracao: "openai",
        tipo: "reply-composer",
        request_json: {
          tenant_id: input.tenantId,
          model: env.OPENAI_MODEL,
          action: input.action,
          intent: input.intent,
        },
        response_json: {
          provider: "fallback",
          fallback_message_preview: fallbackMessage.slice(0, 250),
        },
        status_operacao: "fallback_local",
        erro_resumo: errorMessage.slice(0, 900),
        idempotency_key: idempotencyKey,
        correlation_id: input.correlationId,
      });
      return {
        message: fallbackMessage,
        provider: "fallback",
        fallbackReason: safeText(errorMessage).slice(0, 300),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getBoletoModoPadrao(): Promise<"boleto" | "bolepix"> {
    const raw = String(
      await laraOperationalStore.getConfiguracao("LARA_BOLETO_MODO_PADRAO")
      ?? process.env.LARA_BOLETO_MODO_PADRAO
      ?? "boleto",
    ).trim().toLowerCase();
    return raw === "bolepix" ? "bolepix" : "boleto";
  }

  private async getBradescoPixConfig(): Promise<{
    enabled: boolean;
    failFast: boolean;
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    baseUrl: string;
    scope: string;
    timeoutMs: number;
    expiracaoSegundos: number;
    mtls: MtlsConfig;
  }> {
    const enabled = parseBooleanConfig(await laraOperationalStore.getConfiguracao("LARA_PIX_BRADESCO_ENABLED"), false);
    const failFast = parseBooleanConfig(await laraOperationalStore.getConfiguracao("LARA_PIX_BRADESCO_FAILFAST"), false);

    const ambienteRaw = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_AMBIENTE")
      ?? process.env.BRADESCO_PIX_AMBIENTE
      ?? "producao",
    ).trim().toLowerCase();
    const isSandbox = ["sandbox", "hml", "homolog", "homologacao"].includes(ambienteRaw);

    const defaultBaseUrl = isSandbox
      ? "https://openapisandbox.prebanco.com.br"
      : "https://qrpix.bradesco.com.br";
    const defaultTokenUrl = isSandbox
      ? "https://qrpix-h.bradesco.com.br/auth/server/oauth/token"
      : "https://qrpix.bradesco.com.br/auth/server/oauth/token";

    const baseUrl = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_BASE_URL")
      ?? process.env.BRADESCO_PIX_BASE_URL
      ?? defaultBaseUrl,
    ).trim().replace(/\/+$/, "");
    const tokenUrl = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_TOKEN_URL")
      ?? process.env.BRADESCO_PIX_TOKEN_URL
      ?? defaultTokenUrl,
    ).trim();

    const scope = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_SCOPE")
      ?? process.env.BRADESCO_PIX_SCOPE
      ?? "",
    ).trim();

    const timeoutMs = parseNumberConfig(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_TIMEOUT_MS"),
      15000,
      1000,
      45000,
    );
    const expiracaoSegundos = parseNumberConfig(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_EXPIRACAO_SEGUNDOS"),
      86400,
      30,
      259200,
    );

    const clientId = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_CLIENT_ID")
      ?? process.env.BRADESCO_PIX_CLIENT_ID
      ?? "",
    ).trim();
    const clientSecret = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_PIX_CLIENT_SECRET")
      ?? process.env.BRADESCO_PIX_CLIENT_SECRET
      ?? "",
    ).trim();

    const mtls: MtlsConfig = {
      certPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_PIX_MTLS_CERT_PATH")
        ?? process.env.BRADESCO_PIX_MTLS_CERT_PATH
        ?? "",
      ).trim(),
      keyPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_PIX_MTLS_KEY_PATH")
        ?? process.env.BRADESCO_PIX_MTLS_KEY_PATH
        ?? "",
      ).trim(),
      pfxPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_PIX_MTLS_PFX_PATH")
        ?? process.env.BRADESCO_PIX_MTLS_PFX_PATH
        ?? "",
      ).trim(),
      passphrase: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_PIX_MTLS_PASSPHRASE")
        ?? process.env.BRADESCO_PIX_MTLS_PASSPHRASE
        ?? "",
      ).trim(),
      caPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_PIX_MTLS_CA_PATH")
        ?? process.env.BRADESCO_PIX_MTLS_CA_PATH
        ?? "",
      ).trim(),
      rejectUnauthorized: true,
    };

    return {
      enabled,
      failFast,
      clientId,
      clientSecret,
      tokenUrl,
      baseUrl,
      scope,
      timeoutMs,
      expiracaoSegundos,
      mtls,
    };
  }

  private async getBradescoBolepixConfig(): Promise<{
    enabled: boolean;
    failFast: boolean;
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    baseUrl: string;
    scope: string;
    timeoutMs: number;
    codUsuario: string;
    mtls: MtlsConfig;
    beneficiario: {
      cnpjRaiz: string;
      filial: string;
      controle: string;
      negociacao: string;
      produto: number;
      tipoAcesso: number;
    };
  }> {
    const enabled = parseBooleanConfig(await laraOperationalStore.getConfiguracao("LARA_BOLEPIX_BRADESCO_ENABLED"), false);
    const failFast = parseBooleanConfig(await laraOperationalStore.getConfiguracao("LARA_BOLEPIX_BRADESCO_FAILFAST"), false);

    const ambienteRaw = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_AMBIENTE")
      ?? process.env.BRADESCO_BOLEPIX_AMBIENTE
      ?? "producao",
    ).trim().toLowerCase();
    const isSandbox = ["sandbox", "hml", "homolog", "homologacao"].includes(ambienteRaw);

    const defaultBaseUrl = isSandbox
      ? "https://openapisandbox.prebanco.com.br"
      : "https://openapi.bradesco.com.br";
    const defaultTokenUrl = `${defaultBaseUrl}/auth/server-mtls/v2/token`;

    const baseUrl = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_BASE_URL")
      ?? process.env.BRADESCO_BOLEPIX_BASE_URL
      ?? defaultBaseUrl,
    ).trim().replace(/\/+$/, "");
    const tokenUrl = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_TOKEN_URL")
      ?? process.env.BRADESCO_BOLEPIX_TOKEN_URL
      ?? defaultTokenUrl,
    ).trim();
    const scope = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_SCOPE")
      ?? process.env.BRADESCO_BOLEPIX_SCOPE
      ?? "",
    ).trim();

    const timeoutMs = parseNumberConfig(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_TIMEOUT_MS"),
      20000,
      1000,
      120000,
    );

    const clientId = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_CLIENT_ID")
      ?? process.env.BRADESCO_BOLEPIX_CLIENT_ID
      ?? "",
    ).trim();
    const clientSecret = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_CLIENT_SECRET")
      ?? process.env.BRADESCO_BOLEPIX_CLIENT_SECRET
      ?? "",
    ).trim();
    const codUsuario = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_COD_USUARIO")
      ?? process.env.BRADESCO_BOLEPIX_COD_USUARIO
      ?? "APISERVIC",
    ).trim();

    const rejectUnauthorizedValue =
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_REJECT_UNAUTHORIZED")
      ?? process.env.BRADESCO_BOLEPIX_MTLS_REJECT_UNAUTHORIZED
      ?? "true";
    const mtlsRejectUnauthorized = parseBooleanConfig(String(rejectUnauthorizedValue), true);

    const mtls: MtlsConfig = {
      certPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_CERT_PATH")
        ?? process.env.BRADESCO_BOLEPIX_MTLS_CERT_PATH
        ?? process.env.BRADESCO_PIX_MTLS_CERT_PATH
        ?? "",
      ).trim(),
      keyPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_KEY_PATH")
        ?? process.env.BRADESCO_BOLEPIX_MTLS_KEY_PATH
        ?? process.env.BRADESCO_PIX_MTLS_KEY_PATH
        ?? "",
      ).trim(),
      pfxPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_PFX_PATH")
        ?? process.env.BRADESCO_BOLEPIX_MTLS_PFX_PATH
        ?? process.env.BRADESCO_PIX_MTLS_PFX_PATH
        ?? "",
      ).trim(),
      passphrase: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_PASSPHRASE")
        ?? process.env.BRADESCO_BOLEPIX_MTLS_PASSPHRASE
        ?? process.env.BRADESCO_PIX_MTLS_PASSPHRASE
        ?? "",
      ).trim(),
      caPath: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_MTLS_CA_PATH")
        ?? process.env.BRADESCO_BOLEPIX_MTLS_CA_PATH
        ?? process.env.BRADESCO_PIX_MTLS_CA_PATH
        ?? "",
      ).trim(),
      rejectUnauthorized: mtlsRejectUnauthorized,
    };

    const beneficiario = {
      cnpjRaiz: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_BENEF_CNPJ_RAIZ")
        ?? process.env.BRADESCO_BOLEPIX_BENEF_CNPJ_RAIZ
        ?? "",
      ).trim(),
      filial: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_BENEF_FILIAL")
        ?? process.env.BRADESCO_BOLEPIX_BENEF_FILIAL
        ?? "",
      ).trim(),
      controle: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_BENEF_CONTROLE")
        ?? process.env.BRADESCO_BOLEPIX_BENEF_CONTROLE
        ?? "",
      ).trim(),
      negociacao: String(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_NEGOCIACAO")
        ?? process.env.BRADESCO_BOLEPIX_NEGOCIACAO
        ?? "",
      ).trim(),
      produto: parseNumberConfig(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_PRODUTO"),
        Number(process.env.BRADESCO_BOLEPIX_PRODUTO ?? 9),
        1,
        99,
      ),
      tipoAcesso: parseNumberConfig(
        await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_TIPO_ACESSO"),
        Number(process.env.BRADESCO_BOLEPIX_TIPO_ACESSO ?? 2),
        1,
        9,
      ),
    };

    return {
      enabled,
      failFast,
      clientId,
      clientSecret,
      tokenUrl,
      baseUrl,
      scope,
      timeoutMs,
      codUsuario,
      mtls,
      beneficiario,
    };
  }

  private async requestBradescoBolepixToken(input: {
    config: Awaited<ReturnType<LaraService["getBradescoBolepixConfig"]>>;
    correlationId?: string;
  }): Promise<{ accessToken: string; tokenType: string; expiresIn: number; rawPayload: Record<string, unknown> }> {
    const { config } = input;
    if (!config.clientId || !config.clientSecret) {
      throw new Error("BRADESCO_BOLEPIX_CLIENT_ID/BRADESCO_BOLEPIX_CLIENT_SECRET nao configurados.");
    }

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    if (config.scope) {
      params.set("scope", config.scope);
    }

    const response = await httpRequest({
      method: "POST",
      url: config.tokenUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      timeoutMs: config.timeoutMs,
      mtls: config.mtls,
    });

    const payload = isRecord(response.payload) ? response.payload : {};
    const accessToken = String(payload.access_token ?? payload.accessToken ?? payload.token ?? "").trim();
    const tokenType = String(payload.token_type ?? payload.tokenType ?? "Bearer").trim() || "Bearer";
    const expiresIn = Number(payload.expires_in ?? payload.expiresIn ?? 3600);

    if (response.status < 200 || response.status >= 300 || !accessToken) {
      const causa = isRecord(payload) ? String(payload.causa ?? payload.message ?? "").trim() : "";
      throw new Error(
        `Falha no token Bradesco BolePix. HTTP ${response.status}${causa ? ` - ${safeText(causa).slice(0, 200)}` : ""}.`,
      );
    }

    await laraOperationalStore.addIntegrationLog({
      integracao: "bradesco-bolepix",
      tipo: "token",
      request_json: {
        token_url: config.tokenUrl,
      },
      response_json: {
        token_type: tokenType,
        expires_in: Number.isFinite(expiresIn) ? expiresIn : 0,
      },
      status_http: response.status,
      status_operacao: "processado",
      correlation_id: input.correlationId,
      idempotency_key: `bolepix-token:${makeIdempotencyKey([config.tokenUrl, new Date().toISOString().slice(0, 13)])}`,
    });

    return {
      accessToken,
      tokenType,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
      rawPayload: payload,
    };
  }

  private async callBradescoBolepixOperation(input: {
    operation: BradescoBolepixOperation;
    endpointPath: string;
    payload: Record<string, unknown>;
    extraHeaders?: Record<string, string>;
    idempotencyKey?: string;
    correlationId?: string;
    allowWhenDisabled?: boolean;
  }): Promise<Record<string, unknown>> {
    const config = await this.getBradescoBolepixConfig();
    if (!config.enabled && !input.allowWhenDisabled) {
      throw new Error("Integracao Bradesco BolePix desativada em LARA_BOLEPIX_BRADESCO_ENABLED.");
    }
    if (!config.tokenUrl || !config.baseUrl) {
      throw new Error("BRADESCO_BOLEPIX_TOKEN_URL/BRADESCO_BOLEPIX_BASE_URL nao configurados.");
    }

    const dedupeKey = input.idempotencyKey
      || `bolepix:${input.operation}:${makeIdempotencyKey([JSON.stringify(input.payload), input.endpointPath])}`;

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(dedupeKey);
    const duplicateResponseJson = getIntegrationResponseJson(duplicate);
    if (duplicateResponseJson) {
      const previous = parseJsonObject(duplicateResponseJson);
      return {
        ...previous,
        status: "duplicate",
        process_status: "duplicate",
        idempotent_replay: true,
      };
    }

    const token = await this.requestBradescoBolepixToken({ config, correlationId: input.correlationId });
    const url = `${config.baseUrl}${input.endpointPath.startsWith("/") ? "" : "/"}${input.endpointPath}`;
    const response = await httpRequest({
      method: "POST",
      url,
      headers: {
        Authorization: `${token.tokenType} ${token.accessToken}`,
        "Content-Type": "application/json",
        ...(input.extraHeaders ?? {}),
      },
      body: JSON.stringify(input.payload ?? {}),
      timeoutMs: config.timeoutMs,
      mtls: config.mtls,
    });

    const responsePayload = isRecord(response.payload) ? response.payload : {};
    const statusOperacao = response.status >= 200 && response.status < 300 ? "processado" : "erro";
    const normalizedFields = extractBolepixResultFields(responsePayload);
    const mapped = {
      status: response.status >= 200 && response.status < 300 ? "ok" : "error",
      process_status: response.status >= 200 && response.status < 300 ? "ok" : "error",
      operation: input.operation,
      provider: "bradesco-bolepix",
      http_status: response.status,
      idempotency_key: dedupeKey,
      linha_digitavel: normalizedFields.linhaDigitavel,
      url_boleto: normalizedFields.urlBoleto,
      pix_copia_cola: normalizedFields.pixCopiaECola,
      txid: normalizedFields.txid,
      nosso_numero: normalizedFields.nossoNumero,
      qr_code_base64: normalizedFields.qrCodeBase64,
      qr_code_url: normalizedFields.qrCodeUrl,
      payload: responsePayload,
    };

    await laraOperationalStore.addIntegrationLog({
      integracao: "bradesco-bolepix",
      tipo: input.operation,
      request_json: {
        endpoint: input.endpointPath,
        payload: input.payload,
      },
      response_json: mapped as unknown as Record<string, unknown>,
      status_http: response.status,
      status_operacao: statusOperacao,
      erro_resumo:
        statusOperacao === "erro"
          ? safeText(
            String(
              responsePayload.causa
              ?? responsePayload.mensagem
              ?? responsePayload.message
              ?? response.rawBody
              ?? "",
            ),
          ).slice(0, 900)
          : "",
      idempotency_key: dedupeKey,
      correlation_id: input.correlationId,
    });

    return mapped as unknown as Record<string, unknown>;
  }

  private async generatePixPayloadWithBradesco(input: {
    codcli: string;
    cliente: string;
    total: number;
    duplicatas: string[];
    titulos?: Array<{ duplicata: string; prestacao: string; valor: number }>;
    chavePix: string;
    correlationId?: string;
  }): Promise<{ txid: string; pixCopiaECola: string; location: string }> {
    const config = await this.getBradescoPixConfig();
    if (!config.enabled) {
      throw new Error("Integracao oficial Bradesco PIX desativada em LARA_PIX_BRADESCO_ENABLED.");
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error("BRADESCO_PIX_CLIENT_ID/BRADESCO_PIX_CLIENT_SECRET nao configurados.");
    }
    if (!config.tokenUrl || !config.baseUrl) {
      throw new Error("BRADESCO_PIX_TOKEN_URL/BRADESCO_PIX_BASE_URL nao configurados.");
    }

    const txid = buildDynamicPixTxid({
      codcli: input.codcli,
      duplicatas: input.duplicatas,
    });
    const tokenParams = new URLSearchParams({ grant_type: "client_credentials" });
    if (config.scope) tokenParams.set("scope", config.scope);
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

    const tokenResult = await httpRequest({
      url: config.tokenUrl,
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
      timeoutMs: config.timeoutMs,
      mtls: config.mtls,
    });
    if (tokenResult.status < 200 || tokenResult.status >= 300) {
      throw new Error(`Falha no token Bradesco PIX. HTTP ${tokenResult.status}.`);
    }
    const tokenPayload = tokenResult.payload;
    let accessToken = "";
    if (isRecord(tokenPayload)) {
      accessToken = String(
        tokenPayload.access_token
        ?? tokenPayload.accessToken
        ?? tokenPayload.token
        ?? "",
      ).trim();
    }
    if (!accessToken) {
      throw new Error("Token Bradesco PIX nao retornou access_token.");
    }

    const solicitacaoPagador = `Pagamento de titulos ${input.duplicatas.slice(0, 6).join(", ")}`.slice(0, 140);
    const chargeBody = {
      calendario: { expiracao: config.expiracaoSegundos },
      valor: { original: Number(input.total).toFixed(2) },
      chave: input.chavePix,
      solicitacaoPagador,
      infoAdicionais: [
        { nome: "CODCLI", valor: input.codcli },
        { nome: "DUPLICATAS", valor: input.duplicatas.join(", ").slice(0, 200) },
      ],
    };

    const chargeResult = await httpRequest({
      url: `${config.baseUrl}/v2/cob/${txid}`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chargeBody),
      timeoutMs: config.timeoutMs,
      mtls: config.mtls,
    });
    if (chargeResult.status < 200 || chargeResult.status >= 300) {
      throw new Error(`Falha ao criar cobranca Bradesco PIX. HTTP ${chargeResult.status}.`);
    }
    const chargePayloadUnknown = chargeResult.payload;
    if (!isRecord(chargePayloadUnknown)) {
      throw new Error("Resposta da cobranca Bradesco PIX invalida.");
    }
    const pixCopiaECola = String(chargePayloadUnknown.pixCopiaECola ?? "").trim();
    if (!pixCopiaECola) {
      throw new Error("Bradesco PIX nao retornou pixCopiaECola.");
    }
    const locationFromLoc = isRecord(chargePayloadUnknown.loc)
      ? String(chargePayloadUnknown.loc.location ?? "").trim()
      : "";
    const location = String(chargePayloadUnknown.location ?? locationFromLoc).trim();

    await laraOperationalStore.addIntegrationLog({
      integracao: "bradesco-pix",
      tipo: "geracao-cob",
      request_json: {
        txid,
        codcli: input.codcli,
        total: input.total,
        duplicatas: input.duplicatas,
        base_url: config.baseUrl,
        token_url: config.tokenUrl,
      },
      response_json: {
        txid: String(chargePayloadUnknown.txid ?? txid),
        status: String(chargePayloadUnknown.status ?? ""),
        location,
        has_pix_copia_e_cola: true,
      },
      status_http: chargeResult.status,
      status_operacao: "processado",
      idempotency_key: `pix-cob:${txid}`,
      correlation_id: input.correlationId,
    });

    const finalTxid = String(chargePayloadUnknown.txid ?? txid);
    // Persiste mapeamento txid→título (prestacao e valor reais para baixa correta)
    const titulosMap = new Map((input.titulos ?? []).map((t) => [t.duplicata, t]));
    for (const dup of input.duplicatas) {
      const tInfo = titulosMap.get(dup);
      await registrarPixCobranca({
        txid: finalTxid,
        codcli: Number(input.codcli),
        duplicata: dup,
        prestacao: tInfo?.prestacao ?? "",
        valor: tInfo?.valor ?? input.total / input.duplicatas.length,
        provider: "bradesco",
        tenantId: "default",
      }).catch((err) => {
        // Logar falha — sem mapeamento TXID→título a baixa automática via webhook não funcionará
        void laraOperationalStore.addIntegrationLog({
          integracao: "bradesco-pix",
          tipo: "registrar-cobranca-erro",
          request_json: { txid: finalTxid, codcli: Number(input.codcli), duplicata: dup },
          response_json: {},
          status_operacao: "erro",
          erro_resumo: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        }).catch(() => {});
      });
    }
    return {
      txid: finalTxid,
      pixCopiaECola,
      location,
    };
  }

  private buildBolepixFallbackPayload(input: {
    cliente: LaraCliente;
    total: number;
    duplicatas: string[];
    pixChave: string;
    baseBoletoUrl: string;
  }): LaraBolepixPayload {
    return {
      tipo: "bolepix",
      codcli: input.cliente.codcli,
      cliente: input.cliente.cliente,
      total: input.total,
      duplicatas: input.duplicatas,
      linha_digitavel: buildLinhaDigitavel(input.duplicatas[0] ?? input.cliente.codcli, input.total),
      url_boleto: `${input.baseBoletoUrl}/${input.cliente.codcli}`,
      pix_copia_cola: buildPixCopiaCola({
        pixChave: input.pixChave,
        valor: input.total,
        nomeCliente: input.cliente.cliente,
        codcli: input.cliente.codcli,
      }),
      provider: "interno",
    };
  }

  private async buildBradescoBolepixPayloadFromTitulo(input: {
    cliente: LaraCliente;
    titulos: LaraTitulo[];
    total: number;
  }): Promise<Record<string, unknown>> {
    const config = await this.getBradescoBolepixConfig();
    const firstTitulo = input.titulos[0];
    const duplicataRef = String(firstTitulo?.duplicata ?? input.cliente.codcli).replace(/\s+/g, "").slice(0, 25);
    const nossoNumeroReferencia = `${Date.now()}`.slice(-11);
    const hoje = new Date();
    const vencimentoBase = firstTitulo?.vencimento || dateToIsoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    return {
      ctitloCobrCdent: 0,
      registrarTitulo: 1,
      nroCpfCnpjBenef: Number(config.beneficiario.cnpjRaiz || 0),
      codUsuario: config.codUsuario,
      filCpfCnpjBenef: config.beneficiario.filial,
      tipoAcesso: config.beneficiario.tipoAcesso,
      digCpfCnpjBenef: Number(config.beneficiario.controle || 0),
      cpssoaJuridContr: "",
      ctpoContrNegoc: "",
      cidtfdProdCobr: config.beneficiario.produto,
      nseqContrNegoc: "",
      cnegocCobr: Number(config.beneficiario.negociacao || 0),
      filler: "",
      eNseqContrNegoc: "",
      tipoRegistro: 1,
      codigoBanco: 237,
      cprodtServcOper: "",
      demisTitloCobr: formatDateForBradesco(dateToIsoDate(hoje)),
      ctitloCliCdent: `LARA${duplicataRef}`.slice(0, 15),
      dvctoTitloCobr: formatDateForBradesco(vencimentoBase),
      cindtfdTpoVcto: "",
      vnmnalTitloCobr: Math.round(Number(input.total || 0) * 100),
      cindcdEconmMoeda: 9,
      cespceTitloCobr: 2,
      qmoedaNegocTitlo: 0,
      ctpoProteTitlo: 0,
      cindcdAceitSacdo: "N",
      ctpoPrzProte: 0,
      ctpoPrzDecurs: 0,
      ctpoProteDecurs: 0,
      cctrlPartcTitlo: 0,
      cindcdPgtoParcial: "N",
      cformaEmisPplta: "02",
      qtdePgtoParcial: 0,
      qtdDecurPrz: "0",
      codNegativacao: "0",
      diasNegativacao: "0",
      ptxJuroVcto: 0,
      filler1: "",
      vdiaJuroMora: 0,
      pmultaAplicVcto: 0,
      qdiaInicJuro: 0,
      vmultaAtrsoPgto: 0,
      pdescBonifPgto01: 0,
      qdiaInicMulta: 0,
      vdescBonifPgto01: 0,
      pdescBonifPgto02: 0,
      dlimDescBonif1: "",
      vdescBonifPgto02: 0,
      pdescBonifPgto03: 0,
      dlimDescBonif2: "",
      vdescBonifPgto03: 0,
      ctpoPrzCobr: 0,
      dlimDescBonif3: "",
      pdescBonifPgto: 0,
      dlimBonifPgto: "",
      vdescBonifPgto: 0,
      vabtmtTitloCobr: 0,
      filler2: "",
      viofPgtoTitlo: 0,
      isacdoTitloCobr: input.cliente.cliente.slice(0, 40) || "CLIENTE LARA",
      enroLogdrSacdo: "0",
      elogdrSacdoTitlo: "NAO INFORMADO",
      ecomplLogdrSacdo: "",
      ccepSacdoTitlo: 0,
      ebairoLogdrSacdo: "NAO INFORMADO",
      ccomplCepSacdo: 0,
      imunSacdoTitlo: "NAO INFORMADO",
      indCpfCnpjSacdo: 1,
      csglUfSacdo: "SP",
      renderEletrSacdo: "",
      cdddFoneSacdo: 0,
      nroCpfCnpjSacdo: 0,
      bancoDeb: 0,
      cfoneSacdoTitlo: 0,
      agenciaDebDv: 0,
      agenciaDeb: 0,
      bancoCentProt: 0,
      contaDeb: 0,
      isacdrAvalsTitlo: "",
      agenciaDvCentPr: 0,
      enroLogdrSacdr: "0",
      elogdrSacdrAvals: "",
      ecomplLogdrSacdr: "",
      ccomplCepSacdr: 0,
      ebairoLogdrSacdr: "",
      csglUfSacdr: "",
      ccepSacdrTitlo: 0,
      imunSacdrAvals: "",
      indCpfCnpjSacdr: 0,
      renderEletrSacdr: "",
      nroCpfCnpjSacdr: 0,
      cdddFoneSacdr: 0,
      filler3: "0",
      cfoneSacdrTitlo: 0,
      iconcPgtoSpi: "",
      fase: "1",
      cindcdCobrMisto: "S",
      ialiasAdsaoCta: "",
      ilinkGeracQrcd: "",
      caliasAdsaoCta: "",
      wqrcdPdraoMercd: "",
      validadeAposVencimento: "",
      filler4: "",
      idLoc: "",
      nossoNumeroReferencia,
    };
  }

  private async generateBolepixPayloadWithBradesco(input: {
    cliente: LaraCliente;
    titulos: LaraTitulo[];
    total: number;
    duplicatas: string[];
    correlationId?: string;
    idempotencyKey?: string;
    customPayload?: Record<string, unknown>;
    txIdHeader?: string;
    operation?: BradescoBolepixOperation;
  }): Promise<LaraBolepixPayload> {
    const payload = input.customPayload ?? await this.buildBradescoBolepixPayloadFromTitulo({
      cliente: input.cliente,
      titulos: input.titulos,
      total: input.total,
    });

    const operation = input.operation ?? "gerar";
    const endpointPath = operation === "alterar"
      ? "/boleto-hibrido/cobranca-alteracao/v1/alteraBoletoConsulta"
      : "/boleto-hibrido/cobranca-registro/v1/gerarBoleto";
    const result = await this.callBradescoBolepixOperation({
      operation,
      endpointPath,
      payload,
      extraHeaders: input.txIdHeader ? { txId: input.txIdHeader } : undefined,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });

    const rawPayload = isRecord(result.payload) ? result.payload : {};
    const fields = extractBolepixResultFields(rawPayload);
    return {
      tipo: "bolepix",
      codcli: input.cliente.codcli,
      cliente: input.cliente.cliente,
      total: input.total,
      duplicatas: input.duplicatas,
      linha_digitavel: fields.linhaDigitavel || buildLinhaDigitavel(input.duplicatas[0] ?? input.cliente.codcli, input.total),
      url_boleto: fields.urlBoleto || "",
      pix_copia_cola: fields.pixCopiaECola || "",
      txid: fields.txid || undefined,
      nosso_numero: fields.nossoNumero || undefined,
      qr_code_base64: fields.qrCodeBase64 || undefined,
      qr_code_url: fields.qrCodeUrl || undefined,
      provider: "bradesco",
      raw_response: rawPayload,
    };
  }

  private async gerarPayloadPagamento(tipo: "boleto" | "pix" | "bolepix", cliente: LaraCliente, titulos: LaraTitulo[]): Promise<LaraPagamentoPayload> {
    const total = roundMoney(titulos.reduce((sum, item) => sum + item.valor, 0));
    const duplicatas = titulos.map((item) => item.duplicata);
    const baseBoletoUrl = await laraOperationalStore.getConfiguracao("LARA_BASE_BOLETO_URL") ?? "https://pagamentos.exemplo.local/boleto";
    if (tipo === "boleto") {
      return {
        tipo: "boleto",
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        total,
        duplicatas,
        url_boleto: `${baseBoletoUrl}/${cliente.codcli}`,
        linha_digitavel: buildLinhaDigitavel(duplicatas[0] ?? cliente.codcli, total),
      };
    }

    const pixChave = await laraOperationalStore.getConfiguracao("LARA_PIX_CHAVE") ?? "financeiro@empresa.com.br";

    if (tipo === "bolepix") {
      const bolepixConfig = await this.getBradescoBolepixConfig();
      if (bolepixConfig.enabled) {
        try {
          return await this.generateBolepixPayloadWithBradesco({
            cliente,
            titulos,
            total,
            duplicatas,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await laraOperationalStore.addIntegrationLog({
            integracao: "bradesco-bolepix",
            tipo: "gerar",
            request_json: {
              codcli: cliente.codcli,
              total,
              duplicatas,
            },
            response_json: {
              fallback_provider: "interno",
            },
            status_operacao: "fallback_local",
            erro_resumo: safeText(errorMessage).slice(0, 900),
          });
          if (bolepixConfig.failFast) {
            throw new Error(`Falha na geracao BolePix Bradesco: ${safeText(errorMessage)}`);
          }
        }
      }

      return this.buildBolepixFallbackPayload({
        cliente,
        total,
        duplicatas,
        pixChave,
        baseBoletoUrl,
      });
    }

    const bradescoConfig = await this.getBradescoPixConfig();
    if (bradescoConfig.enabled) {
      try {
        const bradescoPix = await this.generatePixPayloadWithBradesco({
          codcli: cliente.codcli,
          cliente: cliente.cliente,
          total,
          duplicatas,
          titulos: titulos.map((t) => ({ duplicata: t.duplicata, prestacao: t.prestacao, valor: t.valor })),
          chavePix: pixChave,
        });
        return {
          tipo: "pix",
          codcli: cliente.codcli,
          cliente: cliente.cliente,
          total,
          duplicatas,
          chave_pix: pixChave,
          pix_copia_cola: bradescoPix.pixCopiaECola,
          txid: bradescoPix.txid,
          location: bradescoPix.location,
          provider: "bradesco",
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await laraOperationalStore.addIntegrationLog({
          integracao: "bradesco-pix",
          tipo: "geracao-cob",
          request_json: {
            codcli: cliente.codcli,
            total,
            duplicatas,
          },
          response_json: {
            fallback_provider: "interno",
          },
          status_operacao: "fallback_local",
          erro_resumo: safeText(errorMessage).slice(0, 900),
        });
        if (bradescoConfig.failFast) {
          throw new Error(`Falha na geracao PIX Bradesco: ${safeText(errorMessage)}`);
        }
      }
    }

    return {
      tipo: "pix",
      codcli: cliente.codcli,
      cliente: cliente.cliente,
      total,
      duplicatas,
      chave_pix: pixChave,
      provider: "interno",
      pix_copia_cola: buildPixCopiaCola({
        pixChave,
        valor: total,
        nomeCliente: cliente.cliente,
        codcli: cliente.codcli,
      }),
    };
  }

  async registrarPromessa(input: {
    wa_id?: string;
    codcli: number;
    cliente?: string;
    duplicatas?: string[];
    valor_total?: number;
    data_prometida: string;
    observacao?: string;
    origem: string;
  }) {
    const promessa = await laraOperationalStore.createPromessa({
      wa_id: input.wa_id,
      codcli: input.codcli,
      cliente: input.cliente,
      duplicatas: (input.duplicatas ?? []).join(", "),
      valor_total: input.valor_total,
      data_prometida: input.data_prometida,
      observacao: input.observacao,
      origem: input.origem,
    });
    await this.createCase({
      wa_id: input.wa_id,
      codcli: input.codcli,
      cliente: input.cliente,
      tipo_case: "PROMESSA_PAGAMENTO",
      etapa: "",
      duplicatas: (input.duplicatas ?? []).join(", "),
      valor_total: input.valor_total,
      forma_pagamento: "",
      detalhe: `Promessa registrada para ${input.data_prometida}`,
      origem: input.origem,
      responsavel: "Lara Automação",
      status: "registrada",
    });
    // Rastreia a promessa para o follow-up scheduler marcar o resultado (cumpriu/não cumpriu)
    if (input.wa_id) {
      void outcomeTrackAction({
        wa_id: input.wa_id,
        codcli: input.codcli || null,
        etapa: "",
        risco: "",
        intent_classified: "promessa_pagamento",
        confidence: 0.95,
        action_taken: "registrar_promessa",
        correlation_id: promessa.id,
      }).catch(() => {});
    }
    return promessa;
  }

  async enviarPagamento(
    tipo: "boleto" | "pix" | "bolepix",
    input: {
      wa_id?: string;
      codcli: number;
      cliente?: string;
      duplicatas?: string[];
      origem: string;
      solicitante: string;
    },
  ): Promise<LaraPagamentoPayload> {
    const cliente = await this.getCliente(input.codcli);
    if (!cliente) {
      throw new Error("Cliente nÃ£o encontrado para envio de pagamento.");
    }
    const optout = await laraOperationalStore.findActiveOptoutByWaId(cliente.wa_id);
    if (optout?.ativo) {
      throw new Error("Cliente com opt-out ativo. Envio bloqueado.");
    }

    const titulos = await this.pickTitulosForContext(
      input.codcli,
      input.duplicatas?.length ? { duplicatas: input.duplicatas } : null,
    );
    const payload = await this.gerarPayloadPagamento(tipo, cliente, titulos);
    const duplicatasJoined = payload.duplicatas.join(", ");
    const duplicatasShort = duplicatasJoined.slice(0, 500);

    const messageText = this.buildMensagemPagamento(payload);

    await laraOperationalStore.addMessageLog({
      wa_id: cliente.wa_id,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      telefone: cliente.telefone,
      message_text: messageText,
      direction: "OUTBOUND",
      origem: input.origem,
      etapa: cliente.etapa_regua,
      duplics: duplicatasShort,
      valor_total: payload.total,
        payload_json: JSON.stringify(payload),
        status: "enviado",
        sent_at: dateToIsoDateTime(new Date()),
        received_at: "",
        message_type: tipo,
        operator_name: input.solicitante,
        idempotency_key: makeIdempotencyKey([tipo, cliente.codcli, duplicatasJoined, payload.total]),
      });

    const tipoCase =
      tipo === "boleto"
        ? "PAGAMENTO_ENVIADO"
        : tipo === "bolepix"
          ? "BOLEPIX_ENVIADO"
          : "PIX_ENVIADO";

    await this.createCase({
      wa_id: cliente.wa_id,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      tipo_case: tipoCase,
      etapa: cliente.etapa_regua,
      duplicatas: duplicatasShort,
      valor_total: payload.total,
      forma_pagamento: tipo.toUpperCase(),
      detalhe: `${tipo.toUpperCase()} enviado automaticamente.`,
      origem: input.origem,
      responsavel: input.solicitante,
      status: "concluido",
    });

    return payload;
  }

  async validarTokenBradescoBolepix(input?: { correlation_id?: string }): Promise<Record<string, unknown>> {
    const config = await this.getBradescoBolepixConfig();
    if (!config.enabled) {
      return {
        status: "disabled",
        process_status: "disabled",
        provider: "bradesco-bolepix",
        message: "Integracao BolePix Bradesco desativada.",
      };
    }
    const token = await this.requestBradescoBolepixToken({
      config,
      correlationId: input?.correlation_id,
    });
    return {
      status: "ok",
      process_status: "ok",
      provider: "bradesco-bolepix",
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      has_access_token: Boolean(token.accessToken),
    };
  }

  async gerarBolepixBradesco(input: {
    payload: Record<string, unknown>;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.callBradescoBolepixOperation({
      operation: "gerar",
      endpointPath: "/boleto-hibrido/cobranca-registro/v1/gerarBoleto",
      payload: input.payload,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
    });
  }

  async alterarBolepixBradesco(input: {
    payload: Record<string, unknown>;
    txId: string;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.callBradescoBolepixOperation({
      operation: "alterar",
      endpointPath: "/boleto-hibrido/cobranca-alteracao/v1/alteraBoletoConsulta",
      payload: input.payload,
      extraHeaders: { txId: input.txId },
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
    });
  }

  async consultarBolepixBradesco(input: {
    payload: Record<string, unknown>;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.callBradescoBolepixOperation({
      operation: "consultar",
      endpointPath: "/boleto-hibrido/cobranca-consulta-titulo/v1/consultar",
      payload: input.payload,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
    });
  }

  async listarLiquidadosBolepixBradesco(input: {
    payload: Record<string, unknown>;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.callBradescoBolepixOperation({
      operation: "listar",
      endpointPath: "/boleto-hibrido/cobranca-lista/v1/listar",
      payload: input.payload,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
    });
  }

  async baixarBoletoBradesco(input: {
    payload: Record<string, unknown>;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.callBradescoBolepixOperation({
      operation: "baixar",
      endpointPath: "/boleto/cobranca-baixa/v1/baixar",
      payload: input.payload,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
    });
  }

  async cadastrarWebhookBolepixBradesco(input: {
    payload: Record<string, unknown>;
    idempotency_key?: string;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    const config = await this.getBradescoBolepixConfig();
    const ambienteRaw = String(
      await laraOperationalStore.getConfiguracao("BRADESCO_BOLEPIX_AMBIENTE")
      ?? process.env.BRADESCO_BOLEPIX_AMBIENTE
      ?? "producao",
    ).trim().toLowerCase();
    const isSandbox = ["sandbox", "hml", "homolog", "homologacao"].includes(ambienteRaw);
    const endpointPath = isSandbox
      ? "/boleto/cobranca-webhook/v1/cadastrar"
      : "/boleto/cobranca-webhook/v1/executar";

    return this.callBradescoBolepixOperation({
      operation: "webhook-cadastrar",
      endpointPath,
      payload: input.payload,
      idempotencyKey: input.idempotency_key,
      correlationId: input.correlation_id,
      allowWhenDisabled: config.enabled,
    });
  }

  async registrarWebhookPagamentoBolepix(input: {
    event_id?: string;
    tenant_id?: string;
    payload: Record<string, unknown>;
    correlation_id?: string;
  }): Promise<Record<string, unknown>> {
    const payload = input.payload ?? {};
    const eventId = String(input.event_id || makeIdempotencyKey([JSON.stringify(payload)])).trim();
    const tenantId = String(input.tenant_id || "default").trim() || "default";
    const txid = readPixString(payload, ["txid", "txId", "TXID"]);
    const nossoNumero = readPixString(payload, ["nossoNumero", "nosso_numero"]);
    const valorPagamento = readPixString(payload, ["valorPagamento", "valor_pagamento", "valor"]);
    const dataPagamento = readPixString(payload, ["dataPagamento", "data_pagamento", "data"]);
    const horaPagamento = readPixString(payload, ["horaPagamento", "hora_pagamento", "hora"]);

    const idempotencyKey = `bolepix-webhook:${makeIdempotencyKey([tenantId, eventId, txid, nossoNumero, valorPagamento, dataPagamento, horaPagamento])}`;
    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate) {
      return {
        status: "duplicate",
        process_status: "duplicate",
        provider: "bradesco-bolepix",
        idempotent_replay: true,
      };
    }

    const response = {
      status: "ok",
      process_status: "ok",
      provider: "bradesco-bolepix",
      tenant_id: tenantId,
      event_id: eventId,
      txid,
      nosso_numero: nossoNumero,
      valor_pagamento: valorPagamento,
      data_pagamento: dataPagamento,
      hora_pagamento: horaPagamento,
      settlement_executed: false,
      message: "Webhook de pagamento BolePix registrado. Baixa financeira permanece dependente de rotina homologada.",
    };

    await laraOperationalStore.addIntegrationLog({
      integracao: "bradesco-bolepix",
      tipo: "webhook-pagamento",
      request_json: payload,
      response_json: response as unknown as Record<string, unknown>,
      status_operacao: "recebido",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return response;
  }

  async consultarBoletoWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    idempotency_key?: string;
    origem?: string;
  }): Promise<{
    status: "ok" | "nao_encontrado";
    boleto?: LaraWinthorBoleto;
  }> {
    const boleto = await consultarBoletoWinthor(input);
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-boleto-consulta",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
      ]);

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "boleto-consulta",
      request_json: input as unknown as Record<string, unknown>,
      response_json: boleto as unknown as Record<string, unknown> | undefined,
      status_operacao: boleto ? "consultado" : "nao_encontrado",
      idempotency_key: idempotencyKey,
    });

    if (!boleto) return { status: "nao_encontrado" };
    return { status: "ok", boleto };
  }

  async gerarBoletoWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    codbanco?: number;
    numdiasprotesto?: number;
    primeira_impressao?: boolean;
    force_regenerate?: boolean;
    idempotency_key?: string;
    origem?: string;
    solicitante?: string;
    correlation_id?: string;
  }): Promise<{
    status: "ok" | "duplicado";
    boleto: LaraWinthorBoleto;
  }> {
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-boleto-gerar",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
        input.force_regenerate ? "force" : "normal",
      ]);

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate?.response_json) {
      const payload = parseJsonObject(duplicate.response_json);
      if (payload?.boleto && typeof payload.boleto === "object") {
        return {
          status: "duplicado",
          boleto: payload.boleto as unknown as LaraWinthorBoleto,
        };
      }
    }

    const boleto = await gerarOuRegenerarBoletoWinthor({
      codcli: input.codcli,
      duplicata: input.duplicata,
      prestacao: input.prestacao,
      codfilial: input.codfilial,
      numtransvenda: input.numtransvenda,
      cgcent: input.cgcent,
      fantasia: input.fantasia,
      cliente: input.cliente,
      codbanco: input.codbanco,
      numdiasprotesto: input.numdiasprotesto,
      primeiraImpressao: input.primeira_impressao,
      forceRegenerate: input.force_regenerate,
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "boleto-gerar",
      request_json: input as unknown as Record<string, unknown>,
      response_json: { boleto } as Record<string, unknown>,
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    await this.createCase({
      codcli: Number(boleto.codcli),
      cliente: boleto.cliente,
      tipo_case: "BOLETO_GERADO_WINTHOR",
      etapa: "",
      duplicatas: `${boleto.duplicata}/${boleto.prestacao}`,
      valor_total: boleto.valor,
      forma_pagamento: "BOLETO",
      detalhe: `Boleto gerado/regenerado via Winthor para vencimento ${boleto.dtvenc}.`,
      origem: input.origem || "n8n",
      responsavel: input.solicitante || "Lara N8N",
      status: "concluido",
    });

    return {
      status: "ok",
      boleto,
    };
  }

  async prorrogarTituloWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    nova_data_vencimento: string;
    motivo?: string;
    observacao?: string;
    codfunc?: number;
    idempotency_key?: string;
    tenant_id?: string;
    wa_id?: string;
    origem?: string;
    solicitante?: string;
    correlation_id?: string;
  }): Promise<{
    status: "ok" | "duplicado";
    boleto: LaraWinthorBoleto;
    negociacao: LaraNegociacaoItem;
    dtvenc_anterior: string;
    dtvenc_prorrogada: string;
  }> {
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-prorrogar",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
        input.nova_data_vencimento,
      ]);

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate?.response_json) {
      const payload = parseJsonObject(duplicate.response_json);
      if (
        payload?.boleto
        && payload?.negociacao
        && typeof payload.boleto === "object"
        && typeof payload.negociacao === "object"
      ) {
        return {
          status: "duplicado",
          boleto: payload.boleto as unknown as LaraWinthorBoleto,
          negociacao: payload.negociacao as unknown as LaraNegociacaoItem,
          dtvenc_anterior: String(payload.dtvenc_anterior ?? ""),
          dtvenc_prorrogada: String(payload.dtvenc_prorrogada ?? ""),
        };
      }
    }

    const prorrogacao = await prorrogarTituloWinthor({
      codcli: input.codcli,
      duplicata: input.duplicata,
      prestacao: input.prestacao,
      codfilial: input.codfilial,
      numtransvenda: input.numtransvenda,
      cgcent: input.cgcent,
      fantasia: input.fantasia,
      cliente: input.cliente,
      novaDataVencimento: input.nova_data_vencimento,
      observacao: input.observacao || input.motivo,
      codfunc: input.codfunc,
      solicitanteRotina: input.solicitante,
    });

    const offsetRaw = await laraOperationalStore.getConfiguracao("LARA_NEGOCIACAO_OFFSET_DIAS");
    const offsetDias = parseNumberConfig(offsetRaw, 3, 0, 30);
    const baseCobranca = new Date(`${formatDateTimeForIsoDate(prorrogacao.dtvenc_prorrogada)}T09:00:00`);
    baseCobranca.setDate(baseCobranca.getDate() - offsetDias);
    const now = new Date();
    const proximaCobranca = baseCobranca.getTime() < now.getTime() ? now : baseCobranca;

    const negociacao = await laraOperationalStore.createNegociacao({
      codcli: Number(prorrogacao.boleto.codcli),
      wa_id: input.wa_id,
      filial: prorrogacao.boleto.codfilial,
      duplicata: prorrogacao.boleto.duplicata,
      prestacao: prorrogacao.boleto.prestacao,
      numtransvenda: prorrogacao.boleto.numtransvenda,
      dtvenc_original: formatDateTimeForIsoDate(prorrogacao.dtvenc_anterior),
      dtvenc_prorrogada: formatDateTimeForIsoDate(prorrogacao.dtvenc_prorrogada),
      valor_original: prorrogacao.boleto.valor,
      valor_negociado: prorrogacao.boleto.valor,
      tipo_negociacao: "PRORROGACAO",
      status_negociacao: "ATIVA",
      proxima_cobranca_em: dateToIsoDateTime(proximaCobranca),
      origem: input.origem || "n8n",
      observacao: input.observacao || input.motivo || "Prorrogacao automatizada",
      idempotency_key: idempotencyKey,
    });

    await this.createCase({
      wa_id: input.wa_id,
      codcli: Number(prorrogacao.boleto.codcli),
      cliente: prorrogacao.boleto.cliente,
      tipo_case: "NEGOCIACAO_PRORROGACAO",
      etapa: "",
      duplicatas: `${prorrogacao.boleto.duplicata}/${prorrogacao.boleto.prestacao}`,
      valor_total: prorrogacao.boleto.valor,
      forma_pagamento: "BOLETO",
      detalhe: `Titulo prorrogado de ${prorrogacao.dtvenc_anterior} para ${prorrogacao.dtvenc_prorrogada}.`,
      origem: input.origem || "n8n",
      responsavel: input.solicitante || "Lara N8N",
      status: "concluido",
    });

    await this.addComplianceAudit({
      wa_id: input.wa_id || "",
      codcli: Number(prorrogacao.boleto.codcli),
      tenant_id: String(input.tenant_id || "default"),
      jurisdicao: "BR",
      canal: "WHATSAPP",
      acao: "negociar",
      intencao: "prorrogacao_titulo",
      score_confianca: 1,
      permitido: true,
      base_legal: "LGPD Art. 7, X + CDC Art. 42 + Lei 14.181/2021",
      razao_automatizada: "Prorrogacao acordada com novo cronograma de cobranca.",
      revisao_humana_disponivel: true,
      detalhes: {
        dtvenc_anterior: prorrogacao.dtvenc_anterior,
        dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
        proxima_cobranca_em: negociacao.proxima_cobranca_em,
      },
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "titulo-prorrogar",
      request_json: input as unknown as Record<string, unknown>,
      response_json: {
        boleto: prorrogacao.boleto,
        negociacao,
        dtvenc_anterior: prorrogacao.dtvenc_anterior,
        dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
      },
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return {
      status: "ok",
      boleto: prorrogacao.boleto,
      negociacao,
      dtvenc_anterior: prorrogacao.dtvenc_anterior,
      dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
    };
  }

  async processarMensagemInbound(input: {
    event_id?: string;
    wa_id: string;
    telefone?: string;
    codcli?: number;
    message_text: string;
    origem: string;
    tenant_id?: string;
    jurisdicao?: LaraJurisdicao;
    canal?: "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO";
    received_at?: string;
    operator_name?: string;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  }): Promise<LaraWebhookResponse> {
    const waId = normalizeWaId(input.wa_id);
    const telefone = normalizePhone(input.telefone ?? input.wa_id);
    const messageText = safeText(input.message_text);
    const tenantId = String(input.tenant_id ?? "default").trim() || "default";
    const jurisdicao = input.jurisdicao ?? "BR";
    const canal = input.canal ?? mapOrigemToCanal(input.origem);
    const receivedAt = normalizeTimestampForLog(input.received_at);
    const idempotencyKey = input.event_id || makeIdempotencyKey([waId, messageText, receivedAt]);

    // Guard em memória: bloqueia chamada concorrente com a mesma chave antes de chegar ao banco.
    // Cobre o gap entre o check do DB e o addMessageLog quando dois webhooks chegam em paralelo.
    const nowGuard = Date.now();
    const inFlight = this._processingGuard.get(idempotencyKey);
    if (inFlight && nowGuard - inFlight < this.PROCESSING_GUARD_TTL_MS) {
      return { status: "duplicado", mensagem: "Evento ja sendo processado.", acao: "ignorar", wa_id: waId };
    }
    this._processingGuard.set(idempotencyKey, nowGuard);
    // Limpeza periódica para evitar crescimento ilimitado do Map
    if (this._processingGuard.size > 2000) {
      const cutoff = nowGuard - this.PROCESSING_GUARD_TTL_MS;
      for (const [k, ts] of this._processingGuard) {
        if (ts < cutoff) this._processingGuard.delete(k);
      }
    }

    const duplicate = await laraOperationalStore.findMessageByIdempotency(idempotencyKey);
    if (duplicate) {
      return {
        status: "duplicado",
        mensagem: "Evento ja processado anteriormente.",
        acao: "ignorar",
        wa_id: waId,
      };
    }

    // Mensagens de mídia: log + resposta amigável sem processar NLU (economia de tokens)
    if (/^\[(IMAGE|AUDIO|VIDEO|DOCUMENT|STICKER)\]$/.test(messageText)) {
      const ctxMedia = await this.findRecentContextByWa(waId).catch(() => null);
      const mediaInboundKey = idempotencyKey;
      await laraOperationalStore.addMessageLog({
        wa_id: waId, codcli: input.codcli ?? ctxMedia?.codcli ?? null,
        cliente: "", telefone, message_text: messageText, direction: "INBOUND",
        origem: input.origem, etapa: ctxMedia?.etapa ?? "", duplics: ctxMedia?.duplicatas?.join(", ") ?? "",
        valor_total: 0, payload_json: JSON.stringify(input.payload ?? {}), status: "recebido",
        sent_at: "", received_at: receivedAt || dateToIsoDateTime(new Date()),
        message_type: "midia", operator_name: input.operator_name ?? "Cliente",
        idempotency_key: mediaInboundKey,
      });
      const mediaMsg = "Recebi sua midia! Infelizmente nao consigo processar imagens, audios ou arquivos por aqui. Para consultar seus titulos ou regularizar seu debito, envie uma mensagem de texto. Posso te ajudar com boleto, PIX ou informacoes de pagamento!";
      await laraOperationalStore.addMessageLog({
        wa_id: waId, codcli: input.codcli ?? ctxMedia?.codcli ?? null,
        cliente: "", telefone, message_text: mediaMsg, direction: "OUTBOUND",
        origem: input.origem, etapa: ctxMedia?.etapa ?? "", duplics: ctxMedia?.duplicatas?.join(", ") ?? "",
        valor_total: 0, payload_json: "{}", status: "enviado",
        sent_at: dateToIsoDateTime(new Date()), received_at: "", message_type: "texto",
        operator_name: "Lara Automacao",
        idempotency_key: makeIdempotencyKey([waId, "media_resp", mediaInboundKey]),
      });
      return {
        status: "ok", mensagem: mediaMsg, acao: "media_nao_suportada", wa_id: waId,
        compliance: {
          permitido: true, razao: "Midia recebida — solicitando texto",
          base_legal: "LGPD Art. 7, X", revisao_humana_disponivel: false, score_confianca: 1,
        },
      };
    }

    const nlu = await classifyIntentWithAiFallback(messageText);
    const intent = nlu.intent;
    const timezone = String(await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_TIMEZONE") ?? "America/Sao_Paulo");
    const cooldownMin = Number(await laraOperationalStore.getConfiguracao("JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN") ?? "120");

    const writeAudit = async (
      action: LaraNextAction | "bloqueado_politica",
      allowed: boolean,
      reason: string,
      codcli?: number,
      details?: Record<string, unknown>,
    ) => {
      await this.addComplianceAudit({
        wa_id: waId,
        codcli,
        tenant_id: tenantId,
        jurisdicao,
        canal,
        acao: action,
        intencao: intent,
        score_confianca: nlu.confidence,
        permitido: allowed,
        base_legal: allowed
          ? "LGPD Art. 7, X + CDC Art. 42 + Lei 14.181/2021"
          : "Bloqueio preventivo por compliance e direitos do titular",
        razao_automatizada: reason,
        revisao_humana_disponivel: true,
        detalhes: {
          ...(details ?? {}),
          classifier_method: nlu.method,
          classifier_provider: nlu.classifier.provider,
          classifier_model: nlu.classifier.model,
          classifier_attempted_openai: nlu.classifier.attempted_openai,
          classifier_used_openai: nlu.classifier.used_openai,
          classifier_request_id: nlu.classifier.request_id || "",
          classifier_fallback_reason: nlu.classifier.fallback_reason || "",
          classifier_retry_attempts: nlu.classifier.retry_attempts ?? 0,
          classifier_circuit_state: nlu.classifier.circuit_state || "",
        },
      });
    };

    await laraOperationalStore.addIntegrationLog({
      integracao: "whatsapp",
      tipo: "inbound",
      request_json: {
        wa_id: waId,
        telefone,
        message_text: messageText,
        tenant_id: tenantId,
        jurisdicao,
        canal,
      },
      status_operacao: "recebido",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    // Resolve context before logging so INBOUND carries codcli for future context recovery
    const contextoInbound = await this.findRecentContextByWa(waId).catch(() => null);
    const inboundCodcli = input.codcli ?? contextoInbound?.codcli ?? null;

    await laraOperationalStore.addMessageLog({
      wa_id: waId,
      codcli: inboundCodcli,
      cliente: "",
      telefone,
      message_text: messageText,
      direction: "INBOUND",
      origem: input.origem,
      etapa: contextoInbound?.etapa ?? "",
      duplics: contextoInbound?.duplicatas?.join(", ") ?? "",
      valor_total: 0,
      payload_json: JSON.stringify(input.payload ?? {}),
      status: "recebido",
      sent_at: "",
      received_at: receivedAt || dateToIsoDateTime(new Date()),
      message_type: "texto",
      operator_name: input.operator_name ?? "Cliente",
      idempotency_key: idempotencyKey,
    });

    // Modo piloto: se codcli já é conhecido e não está autorizado, loga mas não responde
    if (inboundCodcli && !isPilotAllowed(inboundCodcli)) {
      // Loga para visibilidade mas não processa nem envia resposta
      void laraOperationalStore.addIntegrationLog({
        integracao: "whatsapp",
        tipo: "inbound-blocked-pilot",
        request_json: { wa_id: waId, codcli: inboundCodcli, pilot_codclis: Array.from(getPilotCodclis()) },
        response_json: { motivo: "codcli_nao_autorizado_piloto" },
        status_operacao: "bloqueado",
        idempotency_key: makeIdempotencyKey([waId, "pilot-block", idempotencyKey]),
      });
      return { status: "ok", mensagem: "", acao: "ignorar", wa_id: waId };
    }

    // Registro automático de feedback: cliente respondeu → alimenta o loop de aprendizado
    void laraOperationalStore.addIntegrationLog({
      integracao: "feedback-loop",
      tipo: "interacao-resultado",
      request_json: {
        wa_id: waId,
        codcli: String(input.codcli ?? ""),
        etapa: "",
        acao: "mensagem_recebida",
        canal,
        hora_envio: new Date().getHours(),
      },
      response_json: { resultado: "respondeu" },
      status_operacao: "respondeu",
      idempotency_key: makeIdempotencyKey([waId, "respondeu", Date.now()]),
    });

    if (nlu.classifier.attempted_openai) {
      await laraOperationalStore.addIntegrationLog({
        integracao: "openai",
        tipo: "intent-classifier",
        request_json: {
          tenant_id: tenantId,
          jurisdicao,
          canal,
          classifier_method: nlu.method,
          provider: nlu.classifier.provider,
          model: nlu.classifier.model,
        },
        response_json: {
          intent: nlu.intent,
          confidence: nlu.confidence,
          used_openai: nlu.classifier.used_openai,
          request_id: nlu.classifier.request_id || "",
        },
        status_operacao: nlu.classifier.used_openai ? "processado" : "fallback_local",
        erro_resumo: nlu.classifier.fallback_reason || "",
        idempotency_key: `${idempotencyKey}:intent-classifier`,
        correlation_id: input.correlation_id,
      });
    }

    // Opt-in: cliente quer voltar a receber mensagens
    if (intent === "optin") {
      const optoutAtivo = await laraOperationalStore.findActiveOptoutByWaId(waId);
      if (optoutAtivo?.id) {
        await laraOperationalStore.disableOptoutById(optoutAtivo.id);
        await this.createCase({
          wa_id: waId,
          codcli: input.codcli,
          tipo_case: "OPTIN_RETORNO",
          detalhe: "Cliente reativou contato apos opt-out",
          origem: "whatsapp-inbound",
          responsavel: "Lara Automacao",
        });
        const msgRetorno = "Que otimo! Seu contato foi reativado. Continuaremos te informando sobre seus titulos em aberto. Para parar de receber mensagens a qualquer momento, basta responder *PARAR*.";
        if (isUazapiConfigured()) {
          await uazapiSendText(waId, msgRetorno).catch(() => {});
        } else if (isWhatsAppConfigured()) {
          await sendTextMessage(waId, msgRetorno).catch(() => {});
        }
        await writeAudit("resposta_padrao", true, "Opt-in: cliente reativou contato.", input.codcli, { flow: "optin" });
        return {
          status: "ok",
          mensagem: msgRetorno,
          acao: "optin_aplicado",
          wa_id: waId,
          compliance: {
            permitido: true,
            razao: "Opt-in explicito do cliente",
            base_legal: "LGPD Art. 7, I",
            revisao_humana_disponivel: false,
            score_confianca: nlu.confidence,
          },
        };
      }
    }

    // Pagamento confirmado pelo cliente: agradecer e criar case para validação
    if (intent === "pagamento_confirmado") {
      const ctxPago = await this.findRecentContextByWa(waId).catch(() => null);
      const codcliPago = input.codcli ?? ctxPago?.codcli ?? null;
      await this.createCase({
        wa_id: waId,
        codcli: codcliPago ?? undefined,
        tipo_case: "PAGAMENTO_CONFIRMADO_CLIENTE",
        detalhe: `Cliente informou pagamento realizado. Mensagem: "${messageText.slice(0, 200)}"`,
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
        status: "pendente",
      });
      const msgAgradecimento = "Obrigado pela confirmacao! Nossa equipe ira verificar o pagamento em breve. Apos a confirmacao, seu titulo sera baixado. Qualquer duvida, estamos aqui!";
      if (isUazapiConfigured()) {
        await uazapiSendText(waId, msgAgradecimento).catch(() => {});
      } else if (isWhatsAppConfigured()) {
        await sendTextMessage(waId, msgAgradecimento).catch(() => {});
      }
      await laraOperationalStore.addMessageLog({
        wa_id: waId, codcli: codcliPago, cliente: "", telefone,
        message_text: msgAgradecimento, direction: "OUTBOUND",
        origem: "whatsapp-inbound", etapa: ctxPago?.etapa ?? "", duplics: ctxPago?.duplicatas?.join(", ") ?? "",
        valor_total: 0, payload_json: JSON.stringify({ acao: "pagamento_confirmado_cliente" }), status: "enviado",
        sent_at: dateToIsoDateTime(new Date()), received_at: "", message_type: "texto",
        operator_name: "Lara Automacao",
        idempotency_key: makeIdempotencyKey([waId, "pagamento_confirmado", messageText.slice(0, 40)]),
      });
      await writeAudit("registrar_promessa", true, "Cliente confirmou pagamento — aguardando validacao.", codcliPago ?? undefined, { flow: "pagamento_confirmado" });
      return {
        status: "ok",
        mensagem: msgAgradecimento,
        acao: "pagamento_confirmado_registrado",
        wa_id: waId,
        compliance: {
          permitido: true,
          razao: "Confirmacao de pagamento pelo cliente",
          base_legal: "LGPD Art. 7, I",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (intent === "optout") {
      await this.setOptout({
        wa_id: waId,
        codcli: input.codcli,
        motivo: "Solicitacao explicita do cliente",
        ativo: true,
        origem: "whatsapp-inbound",
        observacao: messageText,
      });
      await this.createCase({
        wa_id: waId,
        codcli: input.codcli,
        tipo_case: "OPTOUT_SET",
        detalhe: "Cliente solicitou opt-out",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      const msgOptout = "Solicitacao registrada. Nao enviaremos novas mensagens automaticas para este numero. Se quiser voltar a receber nossas comunicacoes, basta responder *CONTINUAR* a qualquer momento.";
      if (isUazapiConfigured()) {
        await uazapiSendText(waId, msgOptout).catch(() => {});
      } else if (isWhatsAppConfigured()) {
        await sendTextMessage(waId, msgOptout).catch(() => {});
      }
      await writeAudit("pausar_contato", false, "Opt-out detectado e bloqueio aplicado.", input.codcli, { flow: "optout" });
      return {
        status: "ok",
        mensagem: msgOptout,
        acao: "optout_aplicado",
        wa_id: waId,
        compliance: {
          permitido: false,
          razao: "Opt-out ativo",
          base_legal: "LGPD Art. 18 + CDC Art. 42",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const identificacao = await this.identifyClient({
      waId,
      telefone,
      codcli: input.codcli,
      messageText,
      contextoPreResolvido: contextoInbound,
    });

    if (identificacao.ambiguidade) {
      await this.createCase({
        wa_id: waId,
        tipo_case: "ESCALACAO_HUMANA",
        detalhe: "Ambiguidade de identificacao por telefone.",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, "Ambiguidade de identificacao exige revisao humana.", undefined, {
        ambiguidade: true,
        confidence: nlu.confidence,
      });
      return {
        status: "ok",
        mensagem: "Encontrei mais de um cadastro possivel. Vou direcionar para atendimento humano.",
        acao: "escalar_humano",
        wa_id: waId,
        escalado: true,
        compliance: {
          permitido: true,
          razao: "Revisao humana por ambiguidade de identidade",
          base_legal: "Prudencia de decisao automatizada",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (!identificacao.cliente) {
      const histMsgs = (await laraOperationalStore.listMessagesByWaId(waId)).slice(-50);
      const jaFoiPedidoId = histMsgs.some(
        (msg) => String(msg.direction).toUpperCase() === "OUTBOUND"
          && String(msg.message_text || "").toLowerCase().includes("cpf"),
      );
      const enviouDocumento = identificacao.identifiedViaDocument || Boolean(extractDocumentFromText(messageText));
      const jaDisseNaoEncontrado = histMsgs.some(
        (msg) => String(msg.direction).toUpperCase() === "OUTBOUND"
          && String(msg.message_text || "").toLowerCase().includes("nao encontrei"),
      );

      const logMsgId = async (msg: string) => {
        await laraOperationalStore.addMessageLog({
          wa_id: waId, codcli: null, cliente: "", telefone,
          message_text: msg, direction: "OUTBOUND",
          origem: "whatsapp-inbound", etapa: "", duplics: "",
          valor_total: 0, payload_json: "{}", status: "enviado",
          sent_at: dateToIsoDateTime(new Date()), received_at: "",
          message_type: "texto", operator_name: "Lara Automacao",
          idempotency_key: makeIdempotencyKey([waId, "id_flow", msg.slice(0, 40), Date.now()]),
        });
      };

      // Passo 1 — primeiro contato sem documento: apresenta-se e pede CPF
      if (!jaFoiPedidoId && !enviouDocumento) {
        const saudacao = saudacaoHoraria(timezone);
        const empresa = String(await laraOperationalStore.getConfiguracao("EMPRESA_NOME") ?? env.WHATSAPP_BUSINESS_NAME ?? "nossa empresa").trim();
        const msgIdentificacao = `${saudacao}! Sou a Lara, assistente de cobrancas da ${empresa}. Para consultar seu cadastro e titulos em aberto, por favor informe seu CPF ou CNPJ.`;
        await logMsgId(msgIdentificacao);
        await writeAudit("escalar_humano", true, "Primeiro contato — solicitando identificacao.", undefined, { flow: "solicitar_identificacao" });
        return {
          status: "ok", mensagem: msgIdentificacao, acao: "solicitar_identificacao", wa_id: waId,
          compliance: { permitido: true, razao: "Solicitando identificacao do titular", base_legal: "Minimizacao de risco de cobranca indevida", revisao_humana_disponivel: true, score_confianca: nlu.confidence },
        };
      }

      // Passo 2 — CPF/CNPJ enviado mas não localizado no Oracle (primeira tentativa)
      if (enviouDocumento && !jaDisseNaoEncontrado) {
        const saudacao = saudacaoHoraria(timezone);
        const msgNaoEncontrado = `${saudacao}! Nao encontrei um cadastro com o CPF/CNPJ informado. Por favor, verifique o numero digitado ou informe seu nome completo para que eu tente localizar seu cadastro.`;
        await logMsgId(msgNaoEncontrado);
        await writeAudit("escalar_humano", true, "CPF/CNPJ enviado mas nao localizado — pedindo nova tentativa.", undefined, { flow: "cpf_nao_encontrado" });
        return {
          status: "ok", mensagem: msgNaoEncontrado, acao: "solicitar_identificacao", wa_id: waId,
          compliance: { permitido: true, razao: "CPF nao localizado — solicitando confirmacao", base_legal: "Minimizacao de risco de cobranca indevida", revisao_humana_disponivel: true, score_confianca: nlu.confidence },
        };
      }

      // Passo 3 — múltiplas tentativas sem sucesso → escala
      await this.createCase({
        wa_id: waId,
        tipo_case: "ESCALACAO_HUMANA",
        detalhe: "Cliente nao localizado apos multiplas tentativas de identificacao.",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, "Nao foi possivel identificar cliente apos multiplas tentativas.", undefined, { confidence: nlu.confidence });
      return {
        status: "ok",
        mensagem: "Nao consegui localizar seu cadastro com as informacoes fornecidas. Um especialista vai entrar em contato em breve para ajudar.",
        acao: "escalar_humano",
        wa_id: waId,
        escalado: true,
        compliance: { permitido: true, razao: "Identificacao inconclusiva com escalacao assistida", base_legal: "Minimizacao de risco de cobranca indevida", revisao_humana_disponivel: true, score_confianca: nlu.confidence },
      };
    }

    const cliente = identificacao.cliente;
    let titulos = await this.pickTitulosForContext(Number(cliente.codcli), identificacao.contexto);

    // Busca duplicata mencionada primeiro nos títulos do contexto, depois em TODOS os títulos
    // do cliente — necessário quando o contexto foi estreitado para uma duplicata anterior
    // (ex: cliente pediu pix do 1436995, depois diz "agora quero o 641")
    let mentionedTitulo = titulos.find((t) => messageText.includes(t.duplicata));
    if (!mentionedTitulo) {
      const allTitulos = await this.listTitulos({ codcli: Number(cliente.codcli) });
      const foundInAll = allTitulos.find((t) => messageText.includes(t.duplicata));
      if (foundInAll) {
        mentionedTitulo = foundInAll;
      }
    }

    if (mentionedTitulo) {
      // Query Oracle PCPREST for the real valor in case the cache is stale
      if (isOracleEnabled()) {
        const oracleRows = await listOpenTitlesFromOracle({
          codcli: Number(cliente.codcli),
          duplicata: mentionedTitulo.duplicata,
        }).catch(() => [] as OracleOpenTitleRow[]);
        if (oracleRows.length) {
          titulos = oracleRows.map((row) => this.oracleTituloToLaraTitulo(row));
        } else {
          titulos = [mentionedTitulo];
        }
      } else {
        titulos = [mentionedTitulo];
      }
      // Persiste a duplicata selecionada para que follow-ups ("agora quero o X") continuem funcionando
      this.bindWaContext(waId, Number(cliente.codcli), titulos.map((t) => t.duplicata));
    }
    const total = roundMoney(titulos.reduce((sum, item) => sum + item.valor, 0));
    const duplicatas = titulos.map((item) => item.duplicata);
    const outboundOperator = input.operator_name || "Lara Automacao";

    // Cliente identificado via CPF/CNPJ nesta mensagem → apresenta títulos e inicia negociação
    if (identificacao.identifiedViaDocument) {
      const msgApresentacao = this.buildApresentacaoTitulosMsg(cliente, titulos, total, timezone);
      await laraOperationalStore.addMessageLog({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        telefone: cliente.telefone,
        message_text: msgApresentacao,
        direction: "OUTBOUND",
        origem: "whatsapp-inbound",
        etapa: cliente.etapa_regua,
        duplics: duplicatas.join(", "),
        valor_total: total,
        payload_json: JSON.stringify({ acao: "apresentar_titulos", identificado_via: "documento" }),
        status: "enviado",
        sent_at: dateToIsoDateTime(new Date()),
        received_at: "",
        message_type: "texto",
        operator_name: outboundOperator,
        idempotency_key: makeIdempotencyKey([waId, "apresentar_titulos", cliente.codcli, total]),
      });
      await writeAudit("resposta_padrao", true, "Cliente identificado via documento — apresentando titulos.", Number(cliente.codcli), {
        titulos: titulos.length,
        total,
        flow: "identificacao_por_documento",
      });
      return {
        status: "ok",
        mensagem: msgApresentacao,
        acao: "apresentar_titulos",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: "Cliente se identificou voluntariamente via CPF/CNPJ",
          base_legal: "Titular solicitou consulta propria",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const mensagensHistorico = await laraOperationalStore.listMessagesByWaId(waId);
    // Invalida cache do resumo semântico: nova mensagem do cliente pode mudar o contexto
    invalidateConversationSummary(waId);
    // Aquece o cache de resumo em background (usado na próxima composeRespostaCobranca)
    const convMsgs = laraOperationalStore.buildConversationMessages(mensagensHistorico.slice(-30));
    const convSummaryPromise = summarizeConversation(waId, convMsgs).catch(() => null);
    const nowTs = Date.now();
    const outbound24h = mensagensHistorico.filter((item) => {
      const direction = String(item.direction ?? "").toUpperCase();
      if (direction !== "OUTBOUND") return false;
      const created = new Date(item.created_at).getTime();
      return Number.isFinite(created) && nowTs - created <= 24 * 60 * 60 * 1000;
    }).length;
    const promisesOpen = (await laraOperationalStore.listPromessas()).filter((item) =>
      String(item.codcli ?? "") === cliente.codcli && String(item.status ?? "").toLowerCase() !== "paga",
    ).length;
    const perfilVulneravel = detectPerfilVulneravel(messageText, cliente);
    const optoutAtivo = await laraOperationalStore.findActiveOptoutByWaId(waId);

    const policy = evaluatePolicy({
      now: new Date(),
      timezone,
      tenantId,
      waId,
      jurisdicao,
      canal,
      initiatedByCustomer: true,
      optoutAtivo: Boolean(optoutAtivo?.ativo),
      perfilVulneravel,
      etapaRegua: cliente.etapa_regua,
      mensagensOutboundUltimas24h: outbound24h,
      cooldownMinutos: Number.isFinite(cooldownMin) ? cooldownMin : 120,
    });

    if (!policy.permitido) {
      await this.createCase({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        tipo_case: "COMPLIANCE_BLOQUEIO",
        etapa: cliente.etapa_regua,
        duplicatas: duplicatas.join(", "),
        valor_total: total,
        detalhe: policy.razao,
        origem: "policy-engine",
        responsavel: "Lara Automacao",
      });
      await writeAudit("bloqueado_politica", false, policy.razao, Number(cliente.codcli), {
        outbound_24h: outbound24h,
        perfil_vulneravel: perfilVulneravel,
      });
      return {
        status: "ok",
        mensagem: "Contato pausado por politica de compliance. Um especialista pode seguir com revisao humana.",
        acao: "pausar_contato",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: false,
          razao: policy.razao,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: policy.revisaoHumanaDisponivel,
          score_confianca: nlu.confidence,
        },
      };
    }

    // Quando o cliente menciona uma duplicata específica da lista de cobrança, infere solicitar_pix
    // EXCETO quando a mensagem contém palavras de agendamento — nesse caso promessa_pagamento tem prioridade
    const normalizedMsg = removeAccents(messageText.toLowerCase());

    // Detecta TODOS os títulos do cliente mencionados na mensagem (word-boundary para evitar substring)
    const allTitulosForDetection = await this.listTitulos({ codcli: Number(cliente.codcli) });
    const anyMentionedTitulo = allTitulosForDetection.some(
      (t) => new RegExp(`\\b${removeAccents(t.duplicata.toLowerCase())}\\b`).test(normalizedMsg),
    );
    const hasMentionedTitulo = anyMentionedTitulo || Boolean(mentionedTitulo);

    const hasSchedulingWords = (
      /\bagendar\b|\bagend[ao]\b/.test(normalizedMsg)
      || /\bpara o dia\s+\d|\bno dia\s+\d|\bpagar.*dia\s+\d|\bdia\s+\d.*pagar/.test(normalizedMsg)
      || /\bvou pagar\b|\bpago.*dia\b/.test(normalizedMsg)
      || /\bpagar (amanha|hoje|depois)\b|\bpago (amanha|hoje|depois)\b|\bdepois de amanha\b/.test(normalizedMsg)
      || /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira)?\b/.test(normalizedMsg)
      || /\b(fim|final)\s+do\s+mes\b|\bultimo\s+dia\b/.test(normalizedMsg)
      || /\bmes\s+que\s+vem\b|\bproximo\s+mes\b|\bmes\s+seguinte\b/.test(normalizedMsg)
      || /\bsemana\s+que\s+vem\b|\bproxima\s+semana\b/.test(normalizedMsg)
      || /\bdia\s+util\b|\bdias?\s+uteis?\b/.test(normalizedMsg)
    );

    const hasPaymentContext = Boolean(
      identificacao.contexto
      && (identificacao.contexto.duplicatas?.length || titulos.length > 0),
    );
    const isAffirmativeContextReply = /\b(ok|sim|certo|beleza|fechado|confirmo|confirmado|pode|manda|mandar|envia|enviar)\b/.test(normalizedMsg);
    const shouldSendByContext =
      hasPaymentContext
      && !hasSchedulingWords
      && (
        intent === "confirmacao_contexto"
        || (nlu.confidence < 0.55 && (hasMentionedTitulo || isAffirmativeContextReply))
      );

    const nbaIntent = (hasMentionedTitulo && hasSchedulingWords)
      ? "promessa_pagamento"
      : hasMentionedTitulo
        ? "solicitar_pix"
        : hasSchedulingWords && (intent === "solicitar_pagamento" || intent === "promessa_pagamento")
          ? "promessa_pagamento"
          : shouldSendByContext
            ? "solicitar_boleto"
            : intent;

    // Sempre eleva confiança quando o título está explícito na mensagem — o intent é inequívoco
    const nbaConfidence = hasMentionedTitulo || shouldSendByContext ? 0.95 : nlu.confidence;

    const nba = await chooseNextBestAction({
      intent: nbaIntent,
      confidence: nbaConfidence,
      etapaRegua: cliente.etapa_regua,
      risco: cliente.risco,
      perfilVulneravel,
      policyAllowed: policy.permitido,
      mensagensOutboundUltimas24h: outbound24h,
      promessasEmAberto: promisesOpen,
      initiatedByCustomer: true,
    });

    // Resolve resumo semântico com timeout curto (aproveita cache se já aquecido)
    const convSummaryRaw = await Promise.race([
      convSummaryPromise,
      new Promise<null>((r) => setTimeout(() => r(null), 250)),
    ]);
    const convSummaryStr = convSummaryRaw ? formatSummaryForPrompt(convSummaryRaw) : undefined;

    // Rastreia a ação escolhida para alimentar o loop de aprendizado
    void outcomeTrackAction({
      wa_id: waId,
      codcli: Number(cliente.codcli) || null,
      etapa: cliente.etapa_regua,
      risco: cliente.risco,
      intent_classified: nbaIntent,
      confidence: nbaConfidence,
      action_taken: nba.action,
      correlation_id: input.correlation_id || idempotencyKey,
    }).catch(() => "");

    // Detecta correção imediata de intenção: se última ação registrada para este wa_id
    // foi uma ação de tipo X mas o cliente respondeu com intent Y diferente,
    // sinaliza como classificação errada para o learningEngine ajustar o lexicon.
    void (async () => {
      const lastOutbound = await laraOperationalStore.listMessagesByWaId(waId).catch(() => []);
      const lastOutboundMsg = lastOutbound.find((m) => String(m.direction).toUpperCase() === "OUTBOUND");
      if (lastOutboundMsg) {
        const lastAction = String((lastOutboundMsg as Record<string, unknown>).origem ?? "");
        const incompatiblePairs: [string, string][] = [
          ["enviar_pix", "solicitar_boleto"],
          ["enviar_boleto", "solicitar_pix"],
          ["resposta_padrao", "solicitar_pix"],
          ["resposta_padrao", "solicitar_boleto"],
          ["resposta_padrao", "solicitar_pagamento"],
        ];
        for (const [prevAction, curIntent] of incompatiblePairs) {
          if (lastAction.includes(prevAction) && nbaIntent === curIntent) {
            void markAsWrongClassification({
              wa_id: waId,
              original_action: prevAction,
              corrected_intent: curIntent,
              message_text: messageText,
            }).catch(() => {});
            break;
          }
        }
      }
    })();

    if (nba.action === "enviar_boleto") {
      const boletoModo = await this.getBoletoModoPadrao();
      const payload = await this.enviarPagamento(boletoModo, {
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        duplicatas,
        origem: "whatsapp-inbound",
        solicitante: outboundOperator,
      });
      await writeAudit("enviar_boleto", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
        payment_mode: boletoModo,
      });
      const mensagemFinal = this.buildMensagemPagamento(payload);
      return {
        status: "ok",
        mensagem: mensagemFinal,
        acao: "enviar_boleto",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        payload_whatsapp: payload as unknown as Record<string, unknown>,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "enviar_pix") {
      const payload = await this.enviarPagamento("pix", {
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        duplicatas,
        origem: "whatsapp-inbound",
        solicitante: outboundOperator,
      });
      await writeAudit("enviar_pix", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
      });
      const mensagemFinal = this.buildMensagemPagamento(payload);
      return {
        status: "ok",
        mensagem: mensagemFinal,
        acao: "enviar_pix",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        payload_whatsapp: payload as unknown as Record<string, unknown>,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "registrar_promessa") {
      // ── Extrai pares (título, data) — suporta N agendamentos numa única mensagem ──
      const allClientTitulos = allTitulosForDetection;
      const msgNorm = removeAccents(safeText(messageText).toLowerCase());

      // Localiza todos os títulos mencionados com suas posições (word-boundary evita substring)
      const mentionedWithPos: Array<{ titulo: LaraTitulo; pos: number }> = [];
      for (const t of allClientTitulos) {
        const dup = removeAccents(t.duplicata.toLowerCase());
        const match = new RegExp(`\\b${dup}\\b`).exec(msgNorm);
        if (match) mentionedWithPos.push({ titulo: t, pos: match.index });
      }
      mentionedWithPos.sort((a, b) => a.pos - b.pos);

      // Para cada título, extrai a data do segmento de texto entre ele e o próximo título
      const promessaItems: Array<{ titulo: LaraTitulo; dataPrometida: string }> = [];
      for (let i = 0; i < mentionedWithPos.length; i++) {
        const { titulo, pos } = mentionedWithPos[i];
        const nextPos = i + 1 < mentionedWithPos.length ? mentionedWithPos[i + 1].pos : messageText.length;
        const segment = messageText.slice(pos, nextPos);
        const data = extractPromessaDate(segment);
        if (data) promessaItems.push({ titulo, dataPrometida: data });
      }

      // Se algum título ficou sem data no seu segmento, usa a data global como fallback
      const globalDate = extractPromessaDate(messageText)
        ?? dateToIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
      for (const { titulo } of mentionedWithPos) {
        if (!promessaItems.some((p) => p.titulo.duplicata === titulo.duplicata)) {
          promessaItems.push({ titulo, dataPrometida: globalDate });
        }
      }

      // Sem títulos explícitos: usa o contexto atual (duplicatas / titulos)
      const itemsToRegister: Array<{ titulo: LaraTitulo; dataPrometida: string }> =
        promessaItems.length > 0
          ? promessaItems
          : titulos.map((t) => ({ titulo: t, dataPrometida: globalDate }));

      // Registra uma promessa por par (título, data)
      for (const item of itemsToRegister) {
        await this.registrarPromessa({
          wa_id: waId,
          codcli: Number(cliente.codcli),
          cliente: cliente.cliente,
          duplicatas: [item.titulo.duplicata],
          valor_total: item.titulo.valor,
          data_prometida: item.dataPrometida,
          observacao: messageText,
          origem: "whatsapp-inbound",
        });
      }

      await writeAudit("registrar_promessa", true, nba.reason, Number(cliente.codcli), {
        count: itemsToRegister.length,
        items: itemsToRegister.map((i) => ({ duplicata: i.titulo.duplicata, data: i.dataPrometida })),
      });

      const nomeCliente = cliente.cliente.split(" ")[0];
      let msgPromessa: string;

      if (itemsToRegister.length > 1) {
        const linhas = itemsToRegister
          .map((item) => {
            const vStr = item.titulo.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const [, mm, dd] = item.dataPrometida.split("-");
            return `• Duplic. ${item.titulo.duplicata} (${vStr}) — dia ${dd}/${mm}`;
          })
          .join("\n");
        const totalMulti = roundMoney(itemsToRegister.reduce((s, i) => s + i.titulo.valor, 0));
        const totalStr = totalMulti.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        msgPromessa = `Combinado, ${nomeCliente}! Agendei os pagamentos:\n\n${linhas}\n\nTotal: ${totalStr}\n\nNos dias marcados enviarei o PIX para voce efetuar o pagamento. Qualquer duvida estou aqui!`;
      } else {
        const item = itemsToRegister[0];
        const valorStr = item.titulo.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const dupStr = `duplicata ${item.titulo.duplicata}`;
        const [, mm, dd] = item.dataPrometida.split("-");
        msgPromessa = `Combinado, ${nomeCliente}! Agendei o pagamento da ${dupStr} (${valorStr}) para o dia ${dd}/${mm}. No dia marcado enviarei o PIX para voce efetuar o pagamento. Qualquer duvida estou aqui!`;
      }

      return {
        status: "ok",
        mensagem: msgPromessa,
        acao: "registrar_promessa",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "apresentar_opcoes_pagamento") {
      const saudacao = saudacaoHoraria(timezone);
      const nomeCliente = cliente.cliente.split(" ")[0];
      const valorStr = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const msgOpcoes = `${saudacao}, ${nomeCliente}! Para regularizar seu saldo de ${valorStr}, posso gerar:\n\n• *PIX copia e cola* — pagamento instantâneo\n• *Boleto bancário* — vencimento em 1 dia util\n\nQual prefere? Responda *PIX* ou *Boleto*.`;
      await laraOperationalStore.addMessageLog({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        telefone: cliente.telefone,
        message_text: msgOpcoes,
        direction: "OUTBOUND",
        origem: "whatsapp-inbound",
        etapa: cliente.etapa_regua,
        duplics: duplicatas.join(", "),
        valor_total: total,
        payload_json: JSON.stringify({ acao: "apresentar_opcoes_pagamento" }),
        status: "enviado",
        sent_at: dateToIsoDateTime(new Date()),
        received_at: "",
        message_type: "texto",
        operator_name: outboundOperator,
        idempotency_key: makeIdempotencyKey([waId, "opcoes_pagamento", cliente.codcli, total]),
      });
      await writeAudit("resposta_padrao", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
        flow: "apresentar_opcoes_pagamento",
      });
      return {
        status: "ok",
        mensagem: msgOpcoes,
        acao: "apresentar_opcoes_pagamento",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "escalar_humano") {
      await this.createCase({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        tipo_case: "ESCALACAO_HUMANA",
        etapa: cliente.etapa_regua,
        duplicatas: duplicatas.join(", "),
        valor_total: total,
        detalhe: nba.reason,
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
      });
      return {
        status: "ok",
        mensagem: "Tudo certo. Vou encaminhar para atendimento humano.",
        acao: "escalar_humano",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        escalado: true,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "pausar_contato") {
      await writeAudit("pausar_contato", true, nba.reason, Number(cliente.codcli), {
        outbound_24h: outbound24h,
      });
      return {
        status: "ok",
        mensagem: "Contato pausado temporariamente para evitar excesso de frequencia.",
        acao: "pausar_contato",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "negociar") {
      const saudacao = saudacaoHoraria();
      const nomeCliente = cliente.cliente.split(" ")[0];
      const negotiationFallback = `${saudacao}, ${nomeCliente}! Podemos montar uma proposta para regularizacao dos titulos em aberto no total de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Deseja seguir com negociacao assistida?`;
      const negotiationReply = await this.composeRespostaCobranca({
        tenantId,
        waId,
        intent,
        action: "negociar",
        inboundMessage: messageText,
        cliente,
        titulos,
        total,
        duplicatas,
        fallbackMessage: negotiationFallback,
        policyReason: nba.reason,
        correlationId: input.correlation_id,
        historicoConversa: mensagensHistorico.slice(-20).map((m) => ({
          role: String(m.direction).toUpperCase() === "INBOUND" ? "cliente" as const : "lara" as const,
          texto: String(m.message_text || ""),
        })),
        conversationSummary: convSummaryStr,
      });
      const negotiationMessage = negotiationReply.message;
      await laraOperationalStore.addMessageLog({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        telefone: cliente.telefone,
        message_text: negotiationMessage,
        direction: "OUTBOUND",
        origem: "whatsapp-inbound",
        etapa: cliente.etapa_regua,
        duplics: duplicatas.join(", "),
        valor_total: total,
        payload_json: JSON.stringify({
          acao: "negociar",
          reply_provider: negotiationReply.provider,
          reply_request_id: negotiationReply.requestId || "",
          reply_fallback_reason: negotiationReply.fallbackReason || "",
        }),
        status: "enviado",
        sent_at: dateToIsoDateTime(new Date()),
        received_at: "",
        message_type: "texto",
        operator_name: outboundOperator,
        idempotency_key: makeIdempotencyKey([waId, "negociar", total, duplicatas.join(",")]),
      });
      await writeAudit("negociar", true, nba.reason, Number(cliente.codcli), { total });
      return {
        status: "ok",
        mensagem: negotiationMessage,
        acao: "negociar",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const saudacaoPadrao = saudacaoHoraria();
    const nomeClientePadrao = cliente.cliente.split(" ")[0];
    const defaultFallback = `${saudacaoPadrao}, ${nomeClientePadrao}! Localizei ${titulos.length} titulo(s) em aberto no total de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Deseja boleto ou PIX?`;
    const defaultReply = await this.composeRespostaCobranca({
      tenantId,
      waId,
      intent,
      action: "resposta_padrao",
      inboundMessage: messageText,
      cliente,
      titulos,
      total,
      duplicatas,
      fallbackMessage: defaultFallback,
      policyReason: nba.reason,
      correlationId: input.correlation_id,
      historicoConversa: mensagensHistorico.slice(-20).map((m) => ({
        role: String(m.direction).toUpperCase() === "INBOUND" ? "cliente" as const : "lara" as const,
        texto: String(m.message_text || ""),
      })),
      conversationSummary: convSummaryStr,
    });
    const defaultMessage = defaultReply.message;
    await laraOperationalStore.addMessageLog({
      wa_id: waId,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      telefone: cliente.telefone,
      message_text: defaultMessage,
      direction: "OUTBOUND",
      origem: "whatsapp-inbound",
      etapa: cliente.etapa_regua,
      duplics: duplicatas.join(", "),
      valor_total: total,
      payload_json: JSON.stringify({
        acao: "resposta_padrao",
        reply_provider: defaultReply.provider,
        reply_request_id: defaultReply.requestId || "",
        reply_fallback_reason: defaultReply.fallbackReason || "",
      }),
      status: "enviado",
      sent_at: dateToIsoDateTime(new Date()),
      received_at: "",
      message_type: "texto",
      operator_name: outboundOperator,
      idempotency_key: makeIdempotencyKey([waId, "resposta_padrao", total, duplicatas.join(",")]),
    });
    await writeAudit("resposta_padrao", true, nba.reason, Number(cliente.codcli), { confidence: nlu.confidence });

    return {
      status: "ok",
      mensagem: defaultMessage,
      acao: "resposta_padrao",
      wa_id: waId,
      codcli: cliente.codcli,
      cliente: cliente.cliente,
      compliance: {
        permitido: true,
        razao: nba.reason,
        base_legal: policy.baseLegal,
        revisao_humana_disponivel: true,
        score_confianca: nlu.confidence,
      },
    };
  }

  async processarMensagemOrquestracao(input: {
    conversationId?: string;
    messageId?: string;
    phone?: string;
    message?: string;
    timestamp?: string;
    tenant_id?: string;
    event_id?: string;
    phoneNumberId?: string;
    canal?: "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO";
    jurisdicao?: LaraJurisdicao;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  }): Promise<LaraOrchestrationRecord> {
    pruneOrchestrationResponses();

    const tenantId = String(input.tenant_id || "default").trim() || "default";
    const phone = normalizePhone(String(input.phone || ""));
    const messageText = safeText(input.message);
    const receivedAt = normalizeTimestampForLog(input.timestamp);
    const messageId = String(input.messageId || input.event_id || "").trim()
      || makeIdempotencyKey([phone, messageText, receivedAt || input.timestamp || ""]).slice(0, 24);
    const eventId = String(input.event_id || messageId).trim();
    const conversationId = String(input.conversationId || phone || messageId).trim();
    const protocolId = `LARA-${makeIdempotencyKey(["orquestracao", tenantId, eventId]).slice(0, 24).toUpperCase()}`;
    const idempotencyKey = `orquestracao:${tenantId}:${eventId}`;
    const now = dateToIsoDateTime(new Date());

    const fromMemory = orchestrationResponses.get(protocolId);
    if (fromMemory) {
      return { ...fromMemory, idempotent_replay: true };
    }

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    const duplicateResponseJson = getIntegrationResponseJson(duplicate);
    if (duplicateResponseJson) {
      const parsed = parseJsonObject(duplicateResponseJson) as Partial<LaraOrchestrationRecord>;
      if (parsed.protocolId) {
        const replay: LaraOrchestrationRecord = {
          status: parsed.status === "error" ? "error" : "completed",
          protocolId: String(parsed.protocolId),
          conversationId: String(parsed.conversationId || conversationId),
          messageId: String(parsed.messageId || messageId),
          event_id: String(parsed.event_id || eventId),
          tenant_id: String(parsed.tenant_id || tenantId),
          response: parsed.response ? String(parsed.response) : undefined,
          laraResponse: parsed.response ? { mensagem: String(parsed.response) } : undefined,
          process_code: String(parsed.process_code || "OK_ALREADY_PROCESSED"),
          message: String(parsed.message || "Evento ja processado anteriormente."),
          errorMessage: parsed.errorMessage ? String(parsed.errorMessage) : undefined,
          technical_details: {
            ...(parsed.technical_details ?? {}),
            idempotent_replay: true,
          },
          idempotent_replay: true,
          created_at: String(parsed.created_at || now),
          updated_at: now,
        };
        orchestrationResponses.set(replay.protocolId, replay);
        orchestrationResponses.set(`conversation:${tenantId}:${replay.conversationId}`, replay);
        return replay;
      }
    }

    if (!phone || !messageText) {
      const record: LaraOrchestrationRecord = {
        status: "error",
        protocolId,
        conversationId,
        messageId,
        event_id: eventId,
        tenant_id: tenantId,
        process_code: "ERR_MISSING_REQUIRED_DATA",
        message: "Payload WhatsApp sem phone ou message validos.",
        errorMessage: "phone e message sao obrigatorios para orquestracao Lara.",
        technical_details: {
          has_phone: Boolean(phone),
          has_message: Boolean(messageText),
          phoneNumberId: input.phoneNumberId || "",
        },
        created_at: now,
        updated_at: now,
      };
      orchestrationResponses.set(protocolId, record);
      await laraOperationalStore.addIntegrationLog({
        integracao: "lara-orquestracao",
        tipo: "mensagens",
        request_json: input as Record<string, unknown>,
        response_json: record as unknown as Record<string, unknown>,
        status_operacao: "erro",
        erro_resumo: record.errorMessage,
        idempotency_key: idempotencyKey,
        correlation_id: input.correlation_id,
      });
      return record;
    }

    const result = await this.processarMensagemInbound({
      event_id: eventId,
      wa_id: phone,
      telefone: phone,
      message_text: messageText,
      origem: "n8n-orquestracao",
      tenant_id: tenantId,
      jurisdicao: input.jurisdicao ?? "BR",
      canal: input.canal ?? "WHATSAPP",
      received_at: receivedAt,
      payload: {
        ...(input.payload ?? {}),
        conversationId,
        messageId,
        phoneNumberId: input.phoneNumberId || "",
      },
      correlation_id: input.correlation_id,
    });

    const responseText = safeText(result.mensagem);
    const isDuplicate = result.status === "duplicado";
    const record: LaraOrchestrationRecord = {
      status: result.status === "erro" || !responseText ? "error" : "completed",
      protocolId,
      conversationId,
      messageId,
      event_id: eventId,
      tenant_id: tenantId,
      response: responseText || undefined,
      laraResponse: responseText ? { mensagem: responseText } : undefined,
      process_code: isDuplicate ? "OK_ALREADY_PROCESSED" : responseText ? "OK_LARA_RESPONSE_READY" : "ERR_LARA_EMPTY_RESPONSE",
      message: isDuplicate ? "Evento ja processado anteriormente." : "Mensagem processada pela Lara.",
      errorMessage: responseText ? undefined : "Lara nao retornou mensagem para envio ao WhatsApp.",
      technical_details: {
        acao: result.acao,
        codcli: result.codcli || "",
        wa_id: result.wa_id,
        escalado: Boolean(result.escalado),
        phoneNumberId: input.phoneNumberId || "",
        compliance: result.compliance ?? null,
      },
      idempotent_replay: isDuplicate,
      created_at: now,
      updated_at: now,
    };

    orchestrationResponses.set(protocolId, record);
    orchestrationResponses.set(`conversation:${tenantId}:${conversationId}`, record);
    await laraOperationalStore.addIntegrationLog({
      integracao: "lara-orquestracao",
      tipo: "mensagens",
      request_json: input as Record<string, unknown>,
      response_json: record as unknown as Record<string, unknown>,
      status_operacao: record.status,
      erro_resumo: record.errorMessage || "",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return record;
  }

  async consultarRespostaOrquestracao(input: {
    protocolId?: string;
    conversationId?: string;
    tenant_id?: string;
  }): Promise<LaraOrchestrationRecord> {
    pruneOrchestrationResponses();
    const tenantId = String(input.tenant_id || "default").trim() || "default";
    const protocolId = String(input.protocolId || "").trim();
    const conversationId = String(input.conversationId || "").trim();
    const record =
      (protocolId ? orchestrationResponses.get(protocolId) : undefined)
      || (conversationId ? orchestrationResponses.get(`conversation:${tenantId}:${conversationId}`) : undefined);

    if (record) return record;

    return {
      status: "error",
      protocolId,
      conversationId,
      messageId: "",
      event_id: "",
      tenant_id: tenantId,
      process_code: "ERR_RESPONSE_NOT_FOUND",
      message: "Resposta Lara nao encontrada para o protocolo/conversa informado.",
      errorMessage: "Resposta nao encontrada ou expirada no cache de orquestracao.",
      technical_details: {
        ttl_ms: ORCHESTRATION_TTL_MS,
        has_protocolId: Boolean(protocolId),
        has_conversationId: Boolean(conversationId),
      },
      created_at: dateToIsoDateTime(new Date()),
      updated_at: dateToIsoDateTime(new Date()),
    };
  }

  private async handleBradescoPix(
    input: BradescoPixInput & { correlation_id?: string; webhook_secret_validated?: boolean },
    tipo: "webhook" | "reconciliar",
  ): Promise<Record<string, unknown>> {
    const normalized = normalizeBradescoPixPayload(input);
    const idempotencyKey = `bradesco-pix:${makeIdempotencyKey([
      normalized.tenantId,
      normalized.eventId,
      normalized.txid,
      normalized.endToEndId,
    ])}`;

    const buildResponse = (
      processStatus: string,
      processCode: string,
      message: string,
      details: Record<string, unknown> = {},
    ) => ({
      success: processStatus === "ok" || processStatus === "duplicate",
      status: processStatus,
      payment_confirmed: processStatus === "ok",
      title_found: Boolean(details.title_found),
      multiple_titles_found: Boolean(details.multiple_titles_found),
      title_already_settled: Boolean(details.title_already_settled),
      amount_match: details.amount_match ?? null,
      idempotent_replay: Boolean(details.idempotent_replay),
      settlement_executed: Boolean(details.settlement_executed),
      codbanco_used: null,
      process_status: processStatus,
      process_code: processCode,
      message,
      txid: normalized.txid,
      endToEndId: normalized.endToEndId,
      technical_details: {
        tenant_id: normalized.tenantId,
        event_id: normalized.eventId,
        valor: normalized.valor,
        horario: normalized.horario,
        webhook_secret_validated: Boolean(input.webhook_secret_validated),
        baixa_financeira: "nao_executada_sem_rotina_homologada",
        ...details,
      },
    });

    if (!normalized.txid) {
      const response = buildResponse(
        "invalid_payload",
        "ERR_PIX_MISSING_TXID",
        "Webhook PIX sem TXID. Nenhuma conciliacao ou baixa foi executada.",
      );
      await laraOperationalStore.addIntegrationLog({
        integracao: "bradesco-pix",
        tipo,
        request_json: normalized.raw,
        response_json: response,
        status_operacao: "invalid_payload",
        erro_resumo: "TXID ausente",
        idempotency_key: idempotencyKey,
        correlation_id: input.correlation_id,
      });
      return response;
    }

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    const duplicateResponseJson = getIntegrationResponseJson(duplicate);
    if (duplicateResponseJson) {
      const previous = parseJsonObject(duplicateResponseJson);
      return {
        ...previous,
        status: "duplicate",
        process_status: "duplicate",
        process_code: "OK_ALREADY_PROCESSED",
        idempotent_replay: true,
        technical_details: {
          ...((previous.technical_details as Record<string, unknown> | undefined) ?? {}),
          idempotent_replay: true,
        },
      };
    }

    // Lookup primário: LARA_PIX_COBRANCAS (mapeamento txid→título gerado pela Lara)
    const cobrancas: PixCobrancaRow[] = await findCobrancasByTxid(normalized.txid).catch(() => []);
    if (cobrancas.length > 0) {
      // Se todas já foram baixadas, retorna duplicate imediatamente
      if (cobrancas.every((c) => c.pago)) {
        const response = buildResponse("duplicate", "OK_TITLE_ALREADY_SETTLED", "Titulo(s) ja baixado(s) para este TXID.", { title_found: true, title_already_settled: true });
        await laraOperationalStore.addIntegrationLog({
          integracao: "bradesco-pix", tipo,
          request_json: normalized.raw, response_json: response,
          status_operacao: "duplicate", erro_resumo: "",
          idempotency_key: idempotencyKey, correlation_id: input.correlation_id,
        });
        return response;
      }

      const autoBaixaRaw = await laraOperationalStore.getConfiguracao("LARA_PIX_AUTO_BAIXA_HABILITADO");
      const autoBaixaEnabled = autoBaixaRaw !== null
        ? ["1", "true", "sim"].includes(String(autoBaixaRaw).toLowerCase())
        : env.LARA_PIX_AUTO_BAIXA_HABILITADO;
      let totalSettled = 0;
      const settlementErrors: string[] = [];
      const pendentes = cobrancas.filter((c) => !c.pago);
      const valorTotal = roundMoney(pendentes.reduce((s, c) => s + c.valor, 0));

      if (autoBaixaEnabled) {
        for (const c of pendentes) {
          try {
            const valorPago = pendentes.length === 1 && normalized.valor > 0 ? normalized.valor : c.valor;
            const baixa = await baixarTituloOracle({
              duplicata: c.duplicata,
              prestacao: c.prestacao,
              codcli: c.codcli,
              valor_pago: valorPago,
              txid: normalized.txid,
              endToEndId: normalized.endToEndId,
            });
            if (baixa.rows_updated > 0) totalSettled++;
          } catch (err) {
            settlementErrors.push(err instanceof Error ? err.message : String(err));
          }
        }

        if (totalSettled > 0) {
          await marcarPixCobrancaPago(normalized.txid, new Date()).catch((err) => {
            void laraOperationalStore.addIntegrationLog({
              integracao: "bradesco-pix",
              tipo: "marcar-pago-erro",
              request_json: { txid: normalized.txid },
              response_json: {},
              status_operacao: "erro",
              erro_resumo: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            }).catch(() => {});
          });
          // Notifica o outcomeTracker: pagamento confirmado para todos os wa_ids dos pendentes
          const waIdsPagos = [...new Set(pendentes.map((c) => {
            const wa = String((c as Record<string, unknown>).wa_id || "").trim();
            return wa ? normalizeWaId(wa) : "";
          }).filter(Boolean))];
          for (const wId of waIdsPagos) {
            void outcomeMarkAsPaid(wId).catch(() => {});
          }
          const primeiro = pendentes[0];
          const clienteOracle = await getClientByCodcli(primeiro.codcli).catch(() => null);
          const telefone = String(clienteOracle?.TELEFONE || "").trim();
          if (telefone) {
            const valorFmt = (normalized.valor > 0 ? normalized.valor : valorTotal)
              .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const nomeCliente = String(clienteOracle?.CLIENTE || "cliente").split(" ")[0];
            await laraOperationalStore.addMessageLog({
              wa_id: normalizeWaId(telefone),
              codcli: primeiro.codcli,
              cliente: String(clienteOracle?.CLIENTE || ""),
              telefone,
              message_text: `✅ Pagamento PIX de ${valorFmt} confirmado! Obrigado, ${nomeCliente}. Seu(s) titulo(s) foi(foram) baixado(s).`,
              direction: "OUTBOUND",
              origem: "webhook-pix-confirmado",
              etapa: "",
              duplics: pendentes.map((c) => c.duplicata).join(", "),
              valor_total: normalized.valor > 0 ? normalized.valor : valorTotal,
              payload_json: JSON.stringify({ acao: "comprovante_pix", txid: normalized.txid }),
              status: "enviado",
              sent_at: dateToIsoDateTime(new Date()),
              received_at: "",
              message_type: "texto",
              operator_name: "Lara Automacao",
              idempotency_key: makeIdempotencyKey(["comprovante", normalized.txid, normalized.endToEndId]),
            });
          }
        }
      }

      const settlementExecuted = totalSettled > 0;
      const response = buildResponse(
        "ok",
        settlementExecuted ? "OK_PIX_RECONCILED_AND_SETTLED"
          : autoBaixaEnabled ? "OK_PIX_RECONCILED_SETTLEMENT_FAILED"
          : "OK_PIX_RECONCILED_PENDING_SETTLEMENT",
        settlementExecuted
          ? `PIX reconciliado via LARA_PIX_COBRANCAS. ${totalSettled}/${pendentes.length} titulo(s) baixado(s).`
          : `PIX reconciliado via LARA_PIX_COBRANCAS. Baixa ${autoBaixaEnabled ? `falhou: ${settlementErrors.join("; ")}` : "desabilitada"}.`,
        {
          title_found: true,
          amount_match: normalized.valor > 0 ? Math.abs(normalized.valor - valorTotal) <= 0.01 : null,
          settlement_executed: settlementExecuted,
          titulos_baixados: totalSettled,
          titulos_pendentes: pendentes.length,
        },
      );
      await laraOperationalStore.addIntegrationLog({
        integracao: "bradesco-pix", tipo,
        request_json: normalized.raw, response_json: response,
        status_operacao: String(response.process_status || "processado"),
        erro_resumo: String(response.process_status) === "ok" ? "" : String(response.message || ""),
        idempotency_key: idempotencyKey, correlation_id: input.correlation_id,
      });
      return response;
    }

    // Fallback: lookup por coluna TXID/E2E direto na PCPREST (Winthor com suporte nativo)
    const identifierColumns = await listPixIdentifierColumns();
    const matches = await findTitlesByPixIdentifiers({
      txid: normalized.txid,
      endToEndId: normalized.endToEndId,
      limit: 25,
    });

    let response: Record<string, unknown>;
    if (!identifierColumns.length) {
      response = buildResponse(
        "reconciliation_required",
        "ERR_PIX_SCHEMA_NO_TXID_FIELD",
        "PCPREST sem coluna TXID reconhecida e titulo nao encontrado em LARA_PIX_COBRANCAS. Reconciliacao manual necessaria.",
        {
          identifier_columns: identifierColumns,
          title_found: false,
        },
      );
    } else if (matches.length === 0) {
      response = buildResponse(
        "reconciliation_required",
        "ERR_TITLE_NOT_FOUND",
        "Nenhum titulo localizado na PCPREST para o TXID recebido.",
        {
          identifier_columns: identifierColumns,
          title_found: false,
        },
      );
    } else if (matches.length > 1) {
      response = buildResponse(
        "reconciliation_required",
        "ERR_MULTIPLE_TITLES_FOUND",
        "Mais de um titulo foi localizado para o TXID recebido. Baixa bloqueada.",
        {
          identifier_columns: identifierColumns,
          title_found: true,
          multiple_titles_found: true,
          matches_count: matches.length,
        },
      );
    } else {
      const match = matches[0];
      const saldoAberto = roundMoney(toNumber(match.SALDO_ABERTO));
      const valorTitulo = roundMoney(toNumber(match.VALOR));
      const alreadySettled = Boolean(match.DTPAG) || saldoAberto <= 0;
      const amountMatch =
        normalized.valor > 0
          ? Math.abs(normalized.valor - (saldoAberto > 0 ? saldoAberto : valorTitulo)) <= 0.01
          : null;
      const titleDetails = {
        codcli: Number(match.CODCLI),
        cliente: String(match.CLIENTE || ""),
        duplicata: String(match.DUPLICATA || ""),
        prestacao: String(match.PRESTACAO || ""),
        valor: valorTitulo,
        saldo_aberto: saldoAberto,
        dtpag: dateToIsoDateTime(match.DTPAG),
        dtvenc: dateToIsoDate(match.DTVENC),
        codcob: String(match.CODCOB || ""),
        status_titulo: String(match.STATUS_TITULO || ""),
      };

      if (alreadySettled) {
        response = buildResponse(
          "duplicate",
          "OK_TITLE_ALREADY_SETTLED",
          "Titulo ja consta como pago/sem saldo aberto. Nenhuma baixa foi executada.",
          {
            identifier_columns: identifierColumns,
            title_found: true,
            title_already_settled: true,
            amount_match: amountMatch,
            titulo: titleDetails,
          },
        );
      } else if (amountMatch === false) {
        response = buildResponse(
          "reconciliation_required",
          "ERR_PAYMENT_MISMATCH",
          "Valor do PIX diverge do saldo localizado. Baixa bloqueada.",
          {
            identifier_columns: identifierColumns,
            title_found: true,
            amount_match: false,
            titulo: titleDetails,
          },
        );
      } else {
        // Tenta baixa automática se habilitada
        const autoBaixaRaw = await laraOperationalStore.getConfiguracao("LARA_PIX_AUTO_BAIXA_HABILITADO");
        const autoBaixaEnabled = autoBaixaRaw !== null
          ? ["1", "true", "sim"].includes(String(autoBaixaRaw).toLowerCase())
          : env.LARA_PIX_AUTO_BAIXA_HABILITADO;

        let settlementExecuted = false;
        let settlementError: string | undefined;
        let baixaResult: Record<string, unknown> | undefined;

        if (autoBaixaEnabled) {
          try {
            const baixa = await baixarTituloOracle({
              duplicata: String(match.DUPLICATA || ""),
              prestacao: String(match.PRESTACAO || ""),
              codcli: Number(match.CODCLI),
              valor_pago: normalized.valor > 0 ? normalized.valor : (saldoAberto > 0 ? saldoAberto : valorTitulo),
              txid: normalized.txid,
              endToEndId: normalized.endToEndId,
            });
            settlementExecuted = baixa.rows_updated > 0;
            baixaResult = baixa as unknown as Record<string, unknown>;

            // Enfileira comprovante via WhatsApp buscando o telefone do cliente
            if (settlementExecuted) {
              const clienteOracle = await getClientByCodcli(Number(match.CODCLI)).catch(() => null);
              const telefone = String(clienteOracle?.TELEFONE || "").trim();
              if (telefone) {
                const valorFmt = (normalized.valor > 0 ? normalized.valor : valorTitulo)
                  .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                await laraOperationalStore.addIntegrationLog({
                  integracao: "pix-comprovante-whatsapp",
                  tipo: "pendente-envio",
                  request_json: {
                    telefone,
                    codcli: Number(match.CODCLI),
                    duplicata: String(match.DUPLICATA || ""),
                    valor: normalized.valor > 0 ? normalized.valor : valorTitulo,
                    txid: normalized.txid,
                    endToEndId: normalized.endToEndId,
                    mensagem: `✅ Pagamento PIX de ${valorFmt} confirmado! Obrigado, ${String(match.CLIENTE || "cliente").split(" ")[0]}. Seu título foi baixado. Qualquer dúvida estamos à disposição.`,
                  },
                  response_json: {},
                  status_operacao: "pendente",
                  idempotency_key: makeIdempotencyKey(["comprovante", normalized.txid, normalized.endToEndId]),
                  correlation_id: input.correlation_id,
                });
              }
            }
          } catch (err) {
            settlementError = err instanceof Error ? err.message : String(err);
          }
        }

        response = buildResponse(
          "ok",
          settlementExecuted
            ? "OK_PIX_RECONCILED_AND_SETTLED"
            : autoBaixaEnabled
              ? "OK_PIX_RECONCILED_SETTLEMENT_FAILED"
              : "OK_PIX_RECONCILED_PENDING_SETTLEMENT",
          settlementExecuted
            ? "PIX reconciliado e titulo baixado automaticamente no Oracle."
            : autoBaixaEnabled
              ? `PIX reconciliado mas baixa automatica falhou: ${settlementError ?? "erro desconhecido"}`
              : "PIX reconciliado por TXID. Baixa automatica desabilitada (LARA_PIX_AUTO_BAIXA_HABILITADO).",
          {
            identifier_columns: identifierColumns,
            title_found: true,
            amount_match: amountMatch,
            titulo: titleDetails,
            settlement_executed: settlementExecuted,
            ...(baixaResult ? { baixa_result: baixaResult } : {}),
            ...(settlementError ? { settlement_error: settlementError } : {}),
          },
        );
      }
    }

    await laraOperationalStore.addIntegrationLog({
      integracao: "bradesco-pix",
      tipo,
      request_json: normalized.raw,
      response_json: response,
      status_operacao: String(response.process_status || response.status || "processado"),
      erro_resumo: String(response.process_status) === "ok" ? "" : String(response.message || ""),
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return response;
  }

  async processarWebhookBradescoPix(
    input: BradescoPixInput & { correlation_id?: string; webhook_secret_validated?: boolean },
  ): Promise<Record<string, unknown>> {
    return this.handleBradescoPix(input, "webhook");
  }

  async reconciliarBradescoPix(
    input: BradescoPixInput & { correlation_id?: string; webhook_secret_validated?: boolean },
  ): Promise<Record<string, unknown>> {
    return this.handleBradescoPix(input, "reconciliar");
  }

  async registrarWebhookStatus(input: {
    event_id?: string;
    message_id?: string;
    wa_id?: string;
    status: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  }) {
    const idempotencyKey = input.event_id || makeIdempotencyKey([input.message_id, input.wa_id, input.status, input.timestamp]);
    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate) {
      return { status: "duplicado", idempotency_key: idempotencyKey };
    }
    await laraOperationalStore.addIntegrationLog({
      integracao: "whatsapp",
      tipo: "status",
      request_json: input.payload ?? {
        message_id: input.message_id,
        wa_id: input.wa_id,
        status: input.status,
        timestamp: input.timestamp,
      },
      status_operacao: "recebido",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });
    return { status: "ok", idempotency_key: idempotencyKey };
  }

  async registrarWebhookReguaResultado(input: {
    event_id?: string;
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
    correlation_id?: string;
  }) {
    const idempotencyKey = input.event_id || makeIdempotencyKey([
      input.etapa,
      input.data_hora_execucao,
      input.elegivel,
      input.disparada,
      input.respondida,
      input.convertida,
      input.erro,
    ]);
    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate) {
      return { status: "duplicado", idempotency_key: idempotencyKey };
    }

    const execucao = await laraOperationalStore.addReguaExecucao({
      etapa: input.etapa,
      data_hora_execucao: input.data_hora_execucao,
      elegivel: input.elegivel,
      disparada: input.disparada,
      respondida: input.respondida,
      convertida: input.convertida,
      erro: input.erro,
      bloqueado_optout: input.bloqueado_optout,
      valor_impactado: input.valor_impactado,
      status: input.status,
      detalhes_json: input.detalhes_json,
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "n8n",
      tipo: "regua-resultado",
      request_json: input as unknown as Record<string, unknown>,
      response_json: { execucaoId: execucao.id },
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return { status: "ok", idempotency_key: idempotencyKey, execucao };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ANÁLISE DE SENTIMENTO
  // ════════════════════════════════════════════════════════════════════════════

  async analisarSentimento(messageText: string) {
    return analyzeSentiment(messageText);
  }

  async getSentimentoConversa(waId: string) {
    const msgs = await laraOperationalStore.listMessagesByWaId(waId);
    const inbound = msgs.filter((m) => String(m.direction).toUpperCase() === "INBOUND");
    if (inbound.length === 0) return { sentimento_geral: null, mensagens_analisadas: 0, historico: [] };

    const historico = inbound.slice(-10).map((m) => ({
      texto: m.message_text,
      data: m.created_at,
      sentimento: analyzeSentiment(m.message_text),
    }));

    // Sentimento geral: média dos scores
    const scoreMedia = roundMoney(historico.reduce((s, h) => s + h.sentimento.score, 0) / historico.length);
    const critico = historico.some((h) => h.sentimento.requer_escalacao_imediata);
    const maxStress = Math.max(...historico.map((h) => h.sentimento.stress_level)) as 0 | 1 | 2 | 3;

    return {
      sentimento_geral: { score: scoreMedia, stress_level: maxStress, requer_atencao: critico },
      mensagens_analisadas: inbound.length,
      historico,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SCORE DE PROPENSÃO
  // ════════════════════════════════════════════════════════════════════════════

  async calcularPropensityScore(codcli: number) {
    const [cliente, promessas] = await Promise.all([
      this.getCliente(codcli),
      laraOperationalStore.listPromessas(),
    ]);

    if (!cliente) throw new Error(`Cliente ${codcli} não encontrado.`);

    const waId = cliente.wa_id;
    const agora = Date.now();
    const sete_dias_ms = 7 * 24 * 60 * 60 * 1000;
    const um_dia_ms = 24 * 60 * 60 * 1000;

    const msgsPorWa = await laraOperationalStore.listMessagesByWaId(waId);

    const msgs7d = msgsPorWa.filter((m) => agora - new Date(m.created_at).getTime() <= sete_dias_ms);
    const msgs24h = msgsPorWa.filter((m) => agora - new Date(m.created_at).getTime() <= um_dia_ms);

    const enviadas7d = msgs7d.filter((m) => String(m.direction).toUpperCase() === "OUTBOUND").length;
    const respostas7d = msgs7d.filter((m) => String(m.direction).toUpperCase() === "INBOUND").length;
    const enviadas24h = msgs24h.filter((m) => String(m.direction).toUpperCase() === "OUTBOUND").length;

    // Histórico real de horas em que o cliente respondeu (para melhor_hora real)
    const horasResposta = msgsPorWa
      .filter((m) => String(m.direction).toUpperCase() === "INBOUND")
      .map((m) => new Date(m.created_at).getHours());

    const promessasCliente = promessas.filter((p) => String(p.codcli) === String(codcli));
    const promessasAbertas = promessasCliente.filter((p) => p.status === "pendente" || p.status === "aberta").length;
    const promessasCumpridas = promessasCliente.filter((p) => p.status === "cumprida" || p.status === "paga").length;
    const temPromessaRecente = promessasCliente.some(
      (p) => (p.status === "pendente" || p.status === "aberta") &&
              agora - new Date(p.created_at).getTime() <= 7 * um_dia_ms,
    );

    const optout = await laraOperationalStore.findActiveOptoutByWaId(waId);
    const ultimaMsg = msgsPorWa.at(-1);
    const diasSemContato = ultimaMsg
      ? Math.floor((agora - new Date(ultimaMsg.created_at).getTime()) / um_dia_ms)
      : 999;

    // Sentimento da última mensagem inbound para integrar no score
    const ultimaMsgInbound = [...msgsPorWa]
      .reverse()
      .find((m) => String(m.direction).toUpperCase() === "INBOUND");
    const sentimentoAtual = ultimaMsgInbound
      ? analyzeSentiment(ultimaMsgInbound.message_text)
      : null;

    const resultado = calcPropensityScore({
      cliente,
      qtd_mensagens_enviadas_7d: enviadas7d,
      qtd_respostas_7d: respostas7d,
      qtd_promessas_abertas: promessasAbertas,
      qtd_promessas_cumpridas: promessasCumpridas,
      qtd_interacoes_total: msgsPorWa.length,
      tem_optout_historico: Boolean(optout),
      dias_desde_ultimo_contato: diasSemContato,
      // Campos enriquecidos (melhoria v2)
      sentimento_atual: sentimentoAtual,
      horas_resposta_historico: horasResposta,
      qtd_mensagens_enviadas_24h: enviadas24h,
      tem_promessa_recente: temPromessaRecente,
      pagamentos_parciais_historico: promessasCumpridas,
    });

    return { ...resultado, calculado_em: dateToIsoDateTime(new Date()), codcli: String(codcli) };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  NEGOCIAÇÃO AUTÔNOMA
  // ════════════════════════════════════════════════════════════════════════════

  async listPoliticasNegociacao(): Promise<PoliticaNegociacao[]> {
    return POLITICAS_PADRAO;
  }

  async upsertPoliticaNegociacao(input: Omit<PoliticaNegociacao, "id" | "created_at" | "updated_at">) {
    // Atualiza configurações dinâmicas no store
    await laraOperationalStore.upsertConfiguracao(
      `LARA_NEG_${input.etapa_regua.replace('+', 'MAIS').replace('-', 'MENOS')}_DESCONTO`,
      String(input.desconto_maximo_pct),
    );
    await laraOperationalStore.upsertConfiguracao(
      `LARA_NEG_${input.etapa_regua.replace('+', 'MAIS').replace('-', 'MENOS')}_PARCELAS`,
      String(input.parcelas_maximas),
    );
    await laraOperationalStore.upsertConfiguracao(
      `LARA_NEG_${input.etapa_regua.replace('+', 'MAIS').replace('-', 'MENOS')}_ENTRADA`,
      String(input.entrada_minima_pct),
    );
    await laraOperationalStore.upsertConfiguracao(
      `LARA_NEG_${input.etapa_regua.replace('+', 'MAIS').replace('-', 'MENOS')}_ATIVO`,
      input.ativo ? "true" : "false",
    );
    return { ok: true, ...input };
  }

  async simularNegociacao(codcli: number, duplicatas?: string[]) {
    const [cliente, titulos] = await Promise.all([
      this.getCliente(codcli),
      this.listTitulos({ codcli }),
    ]);
    if (!cliente) throw new Error(`Cliente ${codcli} não encontrado.`);

    const politica = selecionarPoliticaPorEtapa(cliente.etapa_regua, POLITICAS_PADRAO);
    const resultado = gerarPropostasNegociacao({
      cliente,
      titulos,
      duplicatas_selecionadas: duplicatas,
      politica,
      horas_validade: 24,
    });

    return { codcli: String(codcli), etapa: cliente.etapa_regua, politica, ...resultado };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PORTAL SELF-SERVICE
  // ════════════════════════════════════════════════════════════════════════════

  async gerarPortalToken(codcli: number, waId?: string) {
    const { randomUUID } = await import("node:crypto");
    const cliente = await this.getCliente(codcli);
    if (!cliente) throw new Error(`Cliente ${codcli} não encontrado.`);

    const horasRaw = await laraOperationalStore.getConfiguracao("LARA_PORTAL_TOKEN_HORAS");
    const horas = Number(horasRaw ?? "48");
    const validoAte = new Date(Date.now() + horas * 60 * 60 * 1000);
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const publicUrl = (await laraOperationalStore.getConfiguracao("LARA_APP_PUBLIC_URL")) ?? "";
    const linkPortal = publicUrl ? `${publicUrl.replace(/\/$/, "")}/lara/portal/${token}` : `/lara/portal/${token}`;

    await laraOperationalStore.upsertConfiguracao(
      `LARA_PORTAL_TOKEN_${token}`,
      JSON.stringify({ codcli, valido_ate: validoAte.toISOString(), wa_id: waId ?? "" }),
      `Portal token para codcli ${codcli}`,
    );

    return {
      token,
      valido_ate: dateToIsoDateTime(validoAte),
      link_portal: linkPortal,
      codcli: String(codcli),
      cliente: cliente.cliente,
    };
  }

  private async resolvePortalToken(token: string): Promise<{ codcli: number; wa_id: string }> {
    if (!token || token.length < 10) throw Object.assign(new Error("Token inválido."), { statusCode: 400 });
    const raw = await laraOperationalStore.getConfiguracao(`LARA_PORTAL_TOKEN_${token}`);
    if (!raw) throw Object.assign(new Error("Token não encontrado ou expirado."), { statusCode: 404 });
    let parsed: { codcli: number; valido_ate: string; wa_id: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("Token corrompido."), { statusCode: 400 });
    }
    if (!parsed.codcli || !parsed.valido_ate) {
      throw Object.assign(new Error("Token sem dados obrigatórios."), { statusCode: 400 });
    }
    if (new Date(parsed.valido_ate) < new Date()) {
      throw Object.assign(new Error("Token expirado."), { statusCode: 401 });
    }
    return { codcli: Number(parsed.codcli), wa_id: String(parsed.wa_id ?? "") };
  }

  async getPortalData(token: string) {
    const { codcli } = await this.resolvePortalToken(token);
    const [cliente, titulos] = await Promise.all([
      this.getCliente(codcli),
      this.listTitulos({ codcli }),
    ]);
    if (!cliente) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });

    const titulosAbertos = titulos.filter((t) => t.valor > 0);
    const valorTotal = roundMoney(titulosAbertos.reduce((s, t) => s + t.valor, 0));
    const politica = selecionarPoliticaPorEtapa(cliente.etapa_regua, POLITICAS_PADRAO);
    const negociacao = gerarPropostasNegociacao({
      cliente,
      titulos,
      duplicatas_selecionadas: undefined,
      politica,
      horas_validade: 24,
    });

    return {
      token,
      status: "valido",
      codcli: String(codcli),
      cliente: cliente.cliente,
      etapa: cliente.etapa_regua,
      valor_total: valorTotal,
      titulos_em_aberto: titulosAbertos.length,
      titulos: titulosAbertos.map((t) => ({
        duplicata: t.duplicata,
        prestacao: t.prestacao,
        valor: t.valor,
        vencimento: t.vencimento,
        dias_atraso: t.dias_atraso ?? 0,
      })),
      propostas_negociacao: negociacao.propostas,
      mensagem_apresentacao: negociacao.mensagem_apresentacao,
      politica: {
        desconto_maximo_pct: politica.desconto_maximo_pct,
        parcelas_maximas: politica.parcelas_maximas,
      },
    };
  }

  async processarPagamentoPortal(token: string, forma: "pix" | "boleto" | "negociacao", propostaIndex?: number) {
    const { codcli, wa_id } = await this.resolvePortalToken(token);
    const [cliente, titulos] = await Promise.all([
      this.getCliente(codcli),
      this.listTitulos({ codcli }),
    ]);
    if (!cliente) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
    const titulosAbertos = titulos.filter((t) => t.valor > 0);
    if (titulosAbertos.length === 0) {
      return { status: "sem_titulos", mensagem: "Nenhum título em aberto encontrado.", codcli: String(codcli) };
    }

    if (forma === "pix" || forma === "boleto") {
      const payload = await this.gerarPayloadPagamento(forma, cliente, titulosAbertos);
      await laraOperationalStore.addIntegrationLog({
        integracao: "portal-pagamento",
        tipo: forma,
        request_json: { token, codcli, forma },
        response_json: payload as unknown as Record<string, unknown>,
        status_operacao: "gerado",
        idempotency_key: makeIdempotencyKey([token, forma, Date.now()]),
      });
      return { status: "gerado", forma, ...payload };
    }

    // Negociação
    const politica = selecionarPoliticaPorEtapa(cliente.etapa_regua, POLITICAS_PADRAO);
    const negociacao = gerarPropostasNegociacao({
      cliente,
      titulos,
      duplicatas_selecionadas: undefined,
      politica,
      horas_validade: 24,
    });
    const idx = propostaIndex ?? 0;
    const proposta = negociacao.propostas[idx];
    if (!proposta) {
      throw Object.assign(new Error(`Proposta ${idx} não encontrada. Total: ${negociacao.propostas.length}`), { statusCode: 400 });
    }

    const valorTotal = roundMoney(titulosAbertos.reduce((s, t) => s + t.valor, 0));
    await laraOperationalStore.createPromessa({
      wa_id,
      codcli,
      cliente: cliente.cliente,
      duplicatas: titulosAbertos.map((t) => t.duplicata).join(", "),
      valor_total: valorTotal,
      data_prometida: proposta.valida_ate,
      observacao: `Portal self-service: ${proposta.mensagem_oferta}`,
      origem: "portal-self-service",
      status: "pendente",
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "portal-pagamento",
      tipo: "negociacao",
      request_json: { token, codcli, forma, proposta_index: idx },
      response_json: { proposta } as unknown as Record<string, unknown>,
      status_operacao: "aceita",
      idempotency_key: makeIdempotencyKey([token, "negociacao", idx]),
    });

    return {
      status: "aceita",
      forma: "negociacao",
      proposta_selecionada: proposta,
      codcli: String(codcli),
      mensagem: `Proposta aceita: ${proposta.mensagem_oferta}. Aguarde confirmação.`,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  FEEDBACK LOOP
  // ════════════════════════════════════════════════════════════════════════════

  async registrarFeedbackInteracao(input: {
    wa_id: string;
    codcli?: string;
    etapa?: string;
    acao: string;
    canal?: string;
    hora_envio: number;
    resultado: "respondeu" | "pagou" | "ignorou" | "optout" | "escalou";
    tempo_resposta_min?: number;
  }) {
    await laraOperationalStore.addIntegrationLog({
      integracao: "feedback-loop",
      tipo: "interacao-resultado",
      request_json: { wa_id: input.wa_id, acao: input.acao, hora_envio: input.hora_envio },
      response_json: { resultado: input.resultado, tempo_resposta_min: input.tempo_resposta_min },
      status_operacao: input.resultado === "pagou" ? "convertido" : input.resultado,
      idempotency_key: makeIdempotencyKey([input.wa_id, input.acao, input.hora_envio, input.resultado, Date.now()]),
    });
    return { ok: true, resultado: input.resultado };
  }

  async getInsightsFeedback(etapa?: string, dias = 30) {
    const logs = await laraOperationalStore.listIntegrationLogs("feedback-loop", 10000);
    const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    const filtrados = logs.filter((l) => l.created_at >= cutoff);

    const por_resultado: Record<string, number> = {};
    const por_hora: Record<number, { total: number; sucesso: number }> = {};

    for (const log of filtrados) {
      const resp = typeof log.response_json === "string"
        ? JSON.parse(log.response_json || "{}")
        : (log.response_json as any) ?? {};
      const req = typeof log.request_json === "string"
        ? JSON.parse(log.request_json || "{}")
        : (log.request_json as any) ?? {};

      const resultado = String(resp.resultado ?? "desconhecido");
      const hora = Number(req.hora_envio ?? 0);

      por_resultado[resultado] = (por_resultado[resultado] ?? 0) + 1;
      if (!por_hora[hora]) por_hora[hora] = { total: 0, sucesso: 0 };
      por_hora[hora].total += 1;
      if (resultado === "pagou" || resultado === "respondeu") por_hora[hora].sucesso += 1;
    }

    const melhor_hora = Object.entries(por_hora)
      .map(([h, v]) => ({ hora: Number(h), taxa: v.total > 0 ? roundMoney(v.sucesso / v.total) : 0 }))
      .sort((a, b) => b.taxa - a.taxa)
      .slice(0, 3);

    const total = filtrados.length;
    const pagamentos = por_resultado["pagou"] ?? 0;
    const taxa_conversao = total > 0 ? roundMoney(pagamentos / total) : 0;

    return {
      periodo_dias: dias,
      etapa_filtro: etapa ?? "todas",
      total_interacoes: total,
      taxa_conversao,
      por_resultado,
      melhores_horas: melhor_hora,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  A/B TESTING DE TEMPLATES
  // ════════════════════════════════════════════════════════════════════════════

  async getAbTestAnalysis(etapa: string) {
    const [templates, feedbacks] = await Promise.all([
      laraOperationalStore.listReguaTemplates(),
      laraOperationalStore.listFeedbackInteracoes(30),
    ]);

    const templatesDaEtapa = templates.filter((t) => t.etapa === etapa && t.ativo);
    if (templatesDaEtapa.length === 0) {
      return { etapa, variantes: [], mensagem: "Nenhum template ativo para esta etapa." };
    }

    // Agrupa por variante (campo variante pode não existir ainda — trata como "A")
    const varianteMap = new Map<string, { disparos: number; respostas: number; pagamentos: number; nome: string; id: string }>();
    for (const t of templatesDaEtapa) {
      const variante = (t as any).variante ?? "A";
      varianteMap.set(variante, { disparos: 0, respostas: 0, pagamentos: 0, nome: t.nome_template, id: t.id });
    }

    // Conta resultados do feedback por etapa (sem discriminação de variante ainda — base para evolução)
    const feedbacksDaEtapa = feedbacks.filter((f) => f.etapa === etapa || !f.etapa);
    const totalDisparos = feedbacksDaEtapa.length || 1;
    const totalRespostas = feedbacksDaEtapa.filter((f) => f.resultado === "respondeu" || f.resultado === "pagou").length;
    const totalPagamentos = feedbacksDaEtapa.filter((f) => f.resultado === "pagou").length;

    const variantes = templatesDaEtapa.map((t) => {
      const variante = (t as any).variante ?? "A";
      return {
        variante,
        template_id: t.id,
        nome_template: t.nome_template,
        peso_distribuicao: (t as any).peso_distribuicao ?? 100,
        total_disparos: totalDisparos,
        total_respostas: totalRespostas,
        total_pagamentos: totalPagamentos,
        taxa_resposta: Math.round((totalRespostas / totalDisparos) * 1000) / 10,
        taxa_conversao: Math.round((totalPagamentos / totalDisparos) * 1000) / 10,
      };
    });

    const vencedora = variantes.reduce((best, v) => v.taxa_conversao > best.taxa_conversao ? v : best, variantes[0]);

    return {
      etapa,
      variantes,
      vencedora: vencedora?.variante ?? "A",
      recomendacao: variantes.length > 1
        ? `Variante ${vencedora?.variante} converte mais (${vencedora?.taxa_conversao}%). Considere aumentar seu peso.`
        : "Apenas uma variante ativa. Crie uma variante B para iniciar o teste.",
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ALERTAS INTELIGENTES DO DASHBOARD
  // ════════════════════════════════════════════════════════════════════════════

  async getAlertasInteligentes(filial?: string) {
    const hoje = dateToIsoDate(new Date());
    const [clientes, logs, promessas] = await Promise.all([
      this.listClientes({ filial }),
      this.listLogs({ limit: 500 }),
      laraOperationalStore.listPromessas(),
    ]);

    const alertas: Array<{ tipo: "critico" | "aviso" | "info"; titulo: string; descricao: string; valor?: number }> = [];

    // Alerta 1: Clientes de risco crítico sem contato em 7+ dias
    const semContato = clientes.filter((c) => {
      if (c.risco !== "critico" && c.risco !== "alto") return false;
      if (!c.ultimo_contato) return true;
      const dias = Math.floor((Date.now() - new Date(c.ultimo_contato).getTime()) / (1000 * 60 * 60 * 24));
      return dias >= 7;
    });
    if (semContato.length > 0) {
      alertas.push({
        tipo: "critico",
        titulo: "Clientes críticos sem contato",
        descricao: `${semContato.length} clientes de risco crítico/alto sem contato há 7+ dias.`,
        valor: semContato.reduce((s, c) => s + c.total_aberto, 0),
      });
    }

    // Alerta 2: Promessas vencidas não cumpridas
    const promessasVencidas = promessas.filter((p) => {
      const data = String(p.data_prometida ?? "");
      return (p.status === "pendente" || p.status === "aberta") && data && data < hoje;
    });
    if (promessasVencidas.length > 0) {
      alertas.push({
        tipo: "aviso",
        titulo: "Promessas vencidas não cumpridas",
        descricao: `${promessasVencidas.length} promessas de pagamento estão vencidas e não foram cumpridas.`,
      });
    }

    // Alerta 3: Erros de integração hoje
    const errosHoje = logs.filter((l) => l.severidade === "erro" && l.data_hora.startsWith(hoje));
    if (errosHoje.length > 5) {
      alertas.push({
        tipo: "aviso",
        titulo: "Erros de integração elevados",
        descricao: `${errosHoje.length} erros de integração registrados hoje. Verifique Oracle e APIs externas.`,
      });
    }

    // Alerta 4: Valor total em D+30 acima de threshold
    const clientesD30 = clientes.filter((c) => c.etapa_regua === "D+30");
    const valorD30 = roundMoney(clientesD30.reduce((s, c) => s + c.total_aberto, 0));
    if (valorD30 > 100000) {
      alertas.push({
        tipo: "aviso",
        titulo: "Alto valor em atraso crítico (D+30)",
        descricao: `R$ ${valorD30.toLocaleString("pt-BR")} em atraso há mais de 30 dias em ${clientesD30.length} clientes.`,
        valor: valorD30,
      });
    }

    // Alerta 5: Taxa de opt-out alta
    const optoutsHoje = logs.filter((l) => l.tipo === "Opt-out registrado" && l.data_hora.startsWith(hoje));
    if (optoutsHoje.length > 5) {
      alertas.push({
        tipo: "aviso",
        titulo: "Alta taxa de opt-out hoje",
        descricao: `${optoutsHoje.length} opt-outs registrados hoje. Revise o tom das mensagens.`,
      });
    }

    // Alerta 6: Sem sincronização Oracle hoje
    const syncHoje = logs.some(
      (l) => l.tipo === "pcprest-sync-diario" && l.status === "sincronizado" && l.data_hora.startsWith(hoje),
    );
    if (!syncHoje && clientes.length > 0) {
      alertas.push({
        tipo: "info",
        titulo: "Sincronização Oracle pendente",
        descricao: "A sincronização diária de títulos ainda não foi executada hoje.",
      });
    }

    return {
      total: alertas.length,
      criticos: alertas.filter((a) => a.tipo === "critico").length,
      avisos: alertas.filter((a) => a.tipo === "aviso").length,
      infos: alertas.filter((a) => a.tipo === "info").length,
      alertas,
      gerado_em: dateToIsoDateTime(new Date()),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEADING INDICATORS — Dashboard Preditivo
  // ════════════════════════════════════════════════════════════════════════════

  async getDashboardPreditivo(filial?: string) {
    const agora = Date.now();
    const hojeStr = dateToIsoDate(new Date());
    const em48h = dateToIsoDate(new Date(agora + 48 * 60 * 60 * 1000));

    const [clientes, promessas, feedbacks] = await Promise.all([
      this.listClientes({ filial }),
      laraOperationalStore.listPromessas(),
      laraOperationalStore.listFeedbackInteracoes(30),
    ]);

    // ── 1. Promessas vencendo em 48h ─────────────────────────────────────────
    const promessasVencendo48h = promessas.filter((p) => {
      const dt = String(p.data_prometida ?? "").slice(0, 10);
      return (p.status === "pendente" || p.status === "aberta") && dt >= hojeStr && dt <= em48h;
    });
    const valorPromessas48h = roundMoney(promessasVencendo48h.reduce((s, p) => s + toNumber(p.valor_total), 0));

    // ── 2. Pipeline de conversão estimada (próximos 7 dias) ──────────────────
    // Clientes com propensão alta ou muito_alta multiplicados por taxa histórica de conversão
    const taxaConversaoHistorica = feedbacks.length > 0
      ? feedbacks.filter((f) => f.resultado === "pagou").length / feedbacks.length
      : 0.15; // fallback: 15% se sem histórico

    const clientesAltaPropensao = clientes.filter((c) =>
      c.risco === "baixo" && ["D-3", "D0", "D+3"].includes(c.etapa_regua),
    );
    const pipelineEstimado7d = roundMoney(
      clientesAltaPropensao.reduce((s, c) => s + c.total_aberto, 0) * taxaConversaoHistorica,
    );

    // ── 3. Clientes para priorizar hoje (score composto) ─────────────────────
    // Critérios: etapa avançada + risco alto/crítico + sem contato recente
    const clientesPrioritarios = clientes
      .filter((c) => {
        const diasSemContato = c.ultimo_contato
          ? Math.floor((agora - new Date(c.ultimo_contato).getTime()) / (1000 * 60 * 60 * 24))
          : 99;
        const etapaAvancada = ["D+7", "D+15", "D+30"].includes(c.etapa_regua);
        const riscoElevado = c.risco === "alto" || c.risco === "critico";
        return etapaAvancada && riscoElevado && diasSemContato >= 3;
      })
      .sort((a, b) => b.total_aberto - a.total_aberto)
      .slice(0, 20)
      .map((c) => ({
        codcli: c.codcli,
        cliente: c.cliente,
        etapa_regua: c.etapa_regua,
        risco: c.risco,
        total_aberto: c.total_aberto,
        dias_sem_contato: c.ultimo_contato
          ? Math.floor((agora - new Date(c.ultimo_contato).getTime()) / (1000 * 60 * 60 * 24))
          : 99,
        prioridade_score: c.total_aberto * (c.risco === "critico" ? 2 : 1),
      }));

    // ── 4. Projeção de recuperação semanal ───────────────────────────────────
    const totalCarteira = roundMoney(clientes.reduce((s, c) => s + c.total_aberto, 0));
    const recuperacaoProjetada7d = pipelineEstimado7d;
    const percentualRecuperacao = totalCarteira > 0
      ? Math.round((recuperacaoProjetada7d / totalCarteira) * 1000) / 10
      : 0;

    // ── 5. Tendência de opt-out (sinal de alerta) ────────────────────────────
    const optoutsUltimos7d = feedbacks.filter((f) => f.resultado === "optout").length;
    const tendenciaOptout = optoutsUltimos7d > 10
      ? "alta"
      : optoutsUltimos7d > 3
        ? "moderada"
        : "normal";

    // ── 6. Melhor janela de contato para hoje ────────────────────────────────
    const horasMaisEfetivas = feedbacks
      .filter((f) => f.resultado === "pagou" || f.resultado === "respondeu")
      .reduce((acc, f) => {
        acc[f.hora_envio] = (acc[f.hora_envio] ?? 0) + 1;
        return acc;
      }, {} as Record<number, number>);

    const melhorJanela = Object.entries(horasMaisEfetivas)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hora]) => Number(hora))
      .sort((a, b) => a - b);

    return {
      gerado_em: dateToIsoDateTime(new Date()),
      promessas_vencendo_48h: {
        quantidade: promessasVencendo48h.length,
        valor_total: valorPromessas48h,
        descricao: `${promessasVencendo48h.length} promessas vencem nas próximas 48h — R$ ${valorPromessas48h.toLocaleString("pt-BR")}`,
      },
      pipeline_conversao_7d: {
        valor_estimado: recuperacaoProjetada7d,
        percentual_carteira: percentualRecuperacao,
        taxa_historica_usada: Math.round(taxaConversaoHistorica * 1000) / 10,
        descricao: `Projeção de R$ ${recuperacaoProjetada7d.toLocaleString("pt-BR")} de recuperação nos próximos 7 dias`,
      },
      clientes_prioritarios_hoje: {
        quantidade: clientesPrioritarios.length,
        lista: clientesPrioritarios,
        valor_impactavel: roundMoney(clientesPrioritarios.reduce((s, c) => s + c.total_aberto, 0)),
      },
      tendencia_optout: {
        nivel: tendenciaOptout,
        quantidade_7d: optoutsUltimos7d,
        alerta: tendenciaOptout !== "normal",
      },
      melhor_janela_contato_hoje: {
        horas: melhorJanela.length > 0 ? melhorJanela : [10, 14, 19],
        fonte: melhorJanela.length > 0 ? "historico_real" : "padrao",
      },
      carteira_total: totalCarteira,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HANDOFF ESTRUTURADO PARA HUMANO
  // ════════════════════════════════════════════════════════════════════════════

  async escalarComContexto(input: {
    waId: string;
    codcli?: number;
    motivo: string;
    sentimento?: { valence: string; stress_level: number; keywords_detectadas: string[]; risco_legal?: boolean };
    etapa?: string;
    valor_total?: number;
    duplicatas?: string[];
    urgencia?: "baixa" | "normal" | "alta" | "critica";
  }) {
    const urgencia = input.urgencia ?? "normal";
    const sla_minutos = urgencia === "critica" ? 15 : urgencia === "alta" ? 60 : 240;
    const sla_retorno = dateToIsoDateTime(new Date(Date.now() + sla_minutos * 60 * 1000));

    // Busca histórico de conversas para contexto
    const msgs = await laraOperationalStore.listMessagesByWaId(input.waId).catch(() => []);
    const ultimasMensagens = msgs.slice(-5).map((m) => ({
      direcao: String(m.direction).toUpperCase() === "INBOUND" ? "cliente" : "lara",
      texto: String(m.message_text ?? "").slice(0, 200),
      data: dateToIsoDateTime(m.created_at),
    }));

    // Gera script sugerido baseado no contexto
    const scriptSugerido = gerarScriptHumano({
      motivo: input.motivo,
      sentimento: input.sentimento,
      etapa: input.etapa,
      valor: input.valor_total,
      urgencia,
    });

    const caseData = {
      wa_id: input.waId,
      codcli: input.codcli ?? undefined,
      cliente: "",
      tipo_case: "escalar_humano",
      etapa: input.etapa ?? "",
      duplicatas: (input.duplicatas ?? []).join(", "),
      valor_total: input.valor_total ?? 0,
      forma_pagamento: "",
      detalhe: JSON.stringify({
        motivo: input.motivo,
        urgencia,
        sla_retorno,
        sla_minutos,
        sentimento: input.sentimento ?? null,
        ultimas_mensagens: ultimasMensagens,
        script_sugerido: scriptSugerido,
      }),
      origem: "lara-automatico",
      responsavel: "",
      status: "aguardando_humano",
    };

    const escalacao = await laraOperationalStore.createCase(caseData);

    return {
      id: escalacao.id,
      status: "escalado",
      urgencia,
      sla_retorno,
      sla_minutos,
      script_sugerido: scriptSugerido,
      mensagem: `Escalado para atendimento humano. SLA: ${sla_minutos} minutos.`,
    };
  }
}

function gerarScriptHumano(input: {
  motivo: string;
  sentimento?: { valence: string; stress_level: number; keywords_detectadas: string[]; risco_legal?: boolean } | undefined;
  etapa?: string;
  valor?: number;
  urgencia: string;
}): string {
  const linhas: string[] = [
    "=== SCRIPT SUGERIDO PELA LARA ===",
    "",
    `Motivo da escalação: ${input.motivo}`,
  ];

  if (input.sentimento) {
    linhas.push(`Tom emocional do cliente: ${input.sentimento.valence} (stress ${input.sentimento.stress_level}/3)`);
    if (input.sentimento.keywords_detectadas.length > 0) {
      linhas.push(`Palavras detectadas: ${input.sentimento.keywords_detectadas.slice(0, 4).join(", ")}`);
    }
    if (input.sentimento.risco_legal) {
      linhas.push("⚠️ ATENÇÃO: Cliente mencionou ação legal (PROCON/advogado). Encaminhe para supervisão jurídica.");
    }
  }

  linhas.push("", "--- Abordagem Recomendada ---");

  const valence = input.sentimento?.valence ?? "neutro";
  const stress = input.sentimento?.stress_level ?? 0;

  if (valence === "critico" || stress === 3) {
    linhas.push(
      "1. INICIE com empatia: 'Entendo que a situação está difícil, estou aqui para ajudar.'",
      "2. NÃO comece pela cobrança. Pergunte como o cliente está.",
      "3. Ofereça flexibilidade máxima: parcelamento, prazo estendido, desconto especial.",
      "4. Se mencionar crise pessoal: acione protocolo de vulnerabilidade.",
    );
  } else if (valence === "negativo" || stress === 2) {
    linhas.push(
      "1. Reconheça a dificuldade: 'Compreendo que está sendo um momento desafiador.'",
      "2. Proponha solução imediatamente — não espere o cliente pedir.",
      "3. Ofereça parcelamento com entrada reduzida.",
    );
  } else if (valence === "positivo") {
    linhas.push(
      "1. Cliente receptivo — vá direto ao ponto.",
      "2. Confirme o valor e ofereça PIX ou boleto.",
      "3. Se necessário, parcelamento com condições favoráveis.",
    );
  } else {
    linhas.push(
      "1. Apresente-se e confirme a dívida.",
      "2. Ofereça as opções de pagamento disponíveis.",
      "3. Se houver hesitação, ofereça parcelamento.",
    );
  }

  if (input.valor && input.valor > 0) {
    const valorFmt = input.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    linhas.push("", `Valor em aberto: ${valorFmt}${input.etapa ? ` | Etapa: ${input.etapa}` : ""}`);
  }

  linhas.push("", "=================================");
  return linhas.join("\n");
}

export const laraService = new LaraService();

// Registra o hook de aprendizado online: cada outcome resolvido alimenta o bandit engine
setOutcomeResolvedHook((record) => {
  onOutcomeReceived({
    wa_id: record.wa_id,
    etapa: record.etapa,
    risco: record.risco,
    hora_envio: record.hora_envio,
    action_taken: record.action_taken,
    outcome: record.outcome,
  });
});
