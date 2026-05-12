/**
 * WhatsApp Business Cloud API — Template Manager
 *
 * Gerencia o ciclo de vida completo dos templates UTILITY da Lara:
 *   - Criação e submissão para aprovação na Meta
 *   - Consulta de status (PENDING → APPROVED / REJECTED)
 *   - Envio de mensagens usando templates aprovados
 *   - Definição centralizada dos 10 templates da régua de cobrança
 *
 * Requisitos no .env:
 *   WHATSAPP_WABA_ID, WHATSAPP_ACCESS_TOKEN,
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_NAME
 */

import { env } from "../../config/env.js";

// ─── Tipos da Graph API ────────────────────────────────────────────────────────

export type WaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type WaTemplateStatus   = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "DELETED";
export type WaTemplateLanguage = "pt_BR" | "en_US" | "es" | string;

export type WaComponentType = "HEADER" | "BODY" | "FOOTER" | "BUTTONS";

export type WaButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }
  | { type: "URL"; text: string; url: string; example?: string[] };

export interface WaComponent {
  type: WaComponentType;
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  buttons?: WaButton[];
  example?: {
    header_text?: string[];
    body_text?: string[][];
    header_handle?: string[];
  };
}

export interface WaTemplateDefinition {
  name: string;
  language: WaTemplateLanguage;
  category: WaTemplateCategory;
  components: WaComponent[];
}

export interface WaTemplateRecord {
  id: string;
  name: string;
  status: WaTemplateStatus;
  category: WaTemplateCategory;
  language: WaTemplateLanguage;
  quality_score?: { score: string; date: number };
  components: WaComponent[];
  rejected_reason?: string;
}

export interface WaTemplateCreateResponse {
  id: string;
  status: WaTemplateStatus;
  category: WaTemplateCategory;
}

// ─── Templates da Régua Lara ──────────────────────────────────────────────────

export const LARA_TEMPLATES: WaTemplateDefinition[] = [
  {
    name: "lara_vencimento_d3",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Aviso de Vencimento",
      },
      {
        type: "BODY",
        text: "Prezado(a) {{1}},\n\nInformamos que o titulo {{2}} no valor de {{3}} vence em {{4}}.\n\nCaso o pagamento ja tenha sido realizado, desconsidere este aviso. Em caso de duvidas, responda esta mensagem.\n\nAtenciosamente,\nDepartamento Financeiro",
        example: {
          body_text: [["Joao Silva", "NF-2024-001234", "R$ 1.250,00", "15/05/2026"]],
        },
      },
      {
        type: "FOOTER",
        text: "Para cancelar avisos, responda PARAR.",
      },
    ],
  },

  {
    name: "lara_aviso_vencimento_d0",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "📅 Vence hoje",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, hoje é a data de vencimento do título {{2}} no valor de {{3}}.\n\nRegularize agora para evitar encargos de mora e juros.",
        example: {
          body_text: [["João Silva", "NF-2024-001", "R$ 1.250,00"]],
        },
      },
      {
        type: "FOOTER",
        text: "Cobrança automática — responda PARAR para cancelar",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Quero o boleto" },
          { type: "QUICK_REPLY", text: "Quero o PIX" },
        ],
      },
    ],
  },

  {
    name: "lara_cobranca_d3",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "📋 Título em atraso",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, o título {{2}} está vencido há 3 dias. Valor atualizado: {{3}}.\n\nEntre em contato para regularizar e evitar restrições cadastrais.",
        example: {
          body_text: [["João Silva", "NF-2024-001", "R$ 1.287,50"]],
        },
      },
      {
        type: "FOOTER",
        text: "Cobrança automática — responda PARAR para cancelar",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Quero pagar" },
          { type: "QUICK_REPLY", text: "Quero negociar" },
          { type: "QUICK_REPLY", text: "Falar com atendente" },
        ],
      },
    ],
  },

  {
    name: "lara_cobranca_d7",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "⚠️ Pendência financeira",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, você possui pendências financeiras vencidas há mais de 7 dias totalizando {{2}}.\n\nEntre em contato para regularizar sua situação e evitar restrições ao crédito.",
        example: {
          body_text: [["João Silva", "R$ 3.750,00"]],
        },
      },
      {
        type: "FOOTER",
        text: "Cobrança automática — responda PARAR para cancelar",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Quero pagar" },
          { type: "QUICK_REPLY", text: "Quero negociar" },
          { type: "QUICK_REPLY", text: "Falar com atendente" },
        ],
      },
    ],
  },

  {
    name: "lara_cobranca_d15",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, suas pendências financeiras totalizando {{2}} estão vencidas há mais de 15 dias.\n\nÉ importante regularizar sua situação o quanto antes para evitar medidas adicionais de cobrança.",
        example: {
          body_text: [["João Silva", "R$ 5.200,00"]],
        },
      },
      {
        type: "FOOTER",
        text: "Cobrança automática — responda PARAR para cancelar",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ver opções de pagamento" },
          { type: "QUICK_REPLY", text: "Falar com atendente" },
        ],
      },
    ],
  },

  {
    name: "lara_cobranca_d30",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, pendências financeiras de {{2}} estão em atraso há mais de 30 dias.\n\nA não regularização pode resultar em inclusão em cadastros de restrição ao crédito. Entre em contato urgente.",
        example: {
          body_text: [["João Silva", "R$ 7.800,00"]],
        },
      },
      {
        type: "FOOTER",
        text: "Cobrança automática — responda PARAR para cancelar",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Quero regularizar" },
          { type: "QUICK_REPLY", text: "Falar com atendente" },
        ],
      },
    ],
  },

  {
    name: "lara_boleto_gerado",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "🧾 Boleto disponível",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, segue o boleto referente ao título {{2}} no valor de {{3}} com vencimento em {{4}}.\n\n*Linha digitável:*\n{{5}}\n\nPague pelo aplicativo do seu banco, internet banking ou casa lotérica.",
        example: {
          body_text: [["João Silva", "NF-2024-001", "R$ 1.287,50", "20/05/2025", "34191.09008 12345.678901 23456.789012 3 92340000128750"]],
        },
      },
      {
        type: "FOOTER",
        text: "Dúvidas? Responda esta mensagem.",
      },
    ],
  },

  {
    name: "lara_pix_disponivel",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Pagamento via PIX",
      },
      {
        type: "BODY",
        text: "Prezado(a) {{1}},\n\nSeu codigo PIX para quitacao do titulo {{2}} no valor de {{3}} foi gerado e esta disponivel por {{4}} horas.\n\nResponda esta mensagem para receber o codigo PIX Copia e Cola e efetuar o pagamento.\n\nAtenciosamente,\nDepartamento Financeiro",
        example: {
          body_text: [["Joao Silva", "NF-2024-001234", "R$ 1.312,50", "24"]],
        },
      },
      {
        type: "FOOTER",
        text: "Para cancelar avisos, responda PARAR.",
      },
    ],
  },

  {
    name: "lara_promessa_confirmada",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "✅ Promessa registrada",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, sua promessa de pagamento foi registrada com sucesso.\n\n📌 Valor: {{2}}\n📅 Data combinada: {{3}}\n\nAguardamos a confirmação do pagamento na data acordada.",
        example: {
          body_text: [["João Silva", "R$ 1.287,50", "25/05/2025"]],
        },
      },
      {
        type: "FOOTER",
        text: "Caso não consiga pagar na data, entre em contato antecipadamente.",
      },
    ],
  },

  {
    name: "lara_pix_confirmado",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "✅ Pagamento confirmado",
      },
      {
        type: "BODY",
        text: "Olá {{1}}, identificamos o recebimento do pagamento PIX de {{2}} referente ao título {{3}}.\n\nSua pendência foi regularizada com sucesso. Obrigado!",
        example: {
          body_text: [["João Silva", "R$ 1.287,50", "NF-2024-001"]],
        },
      },
    ],
  },
];

// ─── Mapeamento: etapa_regua → nome do template ───────────────────────────────

export const ETAPA_TEMPLATE_MAP: Record<string, string> = {
  "D-3":  "lara_vencimento_d3",
  "D0":   "lara_aviso_vencimento_d0",
  "D+3":  "lara_cobranca_d3",
  "D+7":  "lara_cobranca_d7",
  "D+15": "lara_cobranca_d15",
  "D+30": "lara_cobranca_d30",
};

// ─── Cliente Graph API ────────────────────────────────────────────────────────

function graphUrl(path: string): string {
  const version = env.WHATSAPP_API_VERSION;
  return `https://graph.facebook.com/${version}${path}`;
}

function graphHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
  };
}

async function graphFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { ...graphHeaders(), ...(init?.headers ?? {}) } });
  const body = await resp.json() as Record<string, unknown>;
  if (!resp.ok) {
    const err = (body.error as Record<string, unknown>) ?? {};
    throw new Error(`Meta API ${resp.status}: ${err.message ?? JSON.stringify(body)}`);
  }
  return body as T;
}

// ─── Funções de Template ──────────────────────────────────────────────────────

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_WABA_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Lista todos os templates do WABA com status atual. */
export async function listTemplates(): Promise<WaTemplateRecord[]> {
  if (!isWhatsAppConfigured()) return [];
  const url = graphUrl(`/${env.WHATSAPP_WABA_ID}/message_templates?limit=200&fields=id,name,status,category,language,components,quality_score,rejected_reason`);
  const data = await graphFetch<{ data: WaTemplateRecord[] }>(url);
  return data.data ?? [];
}

/** Cria (submete para aprovação) um template. */
export async function createTemplate(def: WaTemplateDefinition): Promise<WaTemplateCreateResponse> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp não configurado");
  const url = graphUrl(`/${env.WHATSAPP_WABA_ID}/message_templates`);
  return graphFetch<WaTemplateCreateResponse>(url, {
    method: "POST",
    body: JSON.stringify(def),
  });
}

/** Exclui um template pelo nome. */
export async function deleteTemplate(name: string): Promise<{ success: boolean }> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp não configurado");
  const url = graphUrl(`/${env.WHATSAPP_WABA_ID}/message_templates?name=${encodeURIComponent(name)}`);
  return graphFetch<{ success: boolean }>(url, { method: "DELETE" });
}

/** Submete todos os templates da Lara que ainda não existem no WABA. */
export async function submitLaraTemplates(): Promise<{
  submetidos: Array<{ name: string; id: string; status: WaTemplateStatus }>;
  ja_existentes: string[];
  erros: Array<{ name: string; error: string }>;
}> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp não configurado");

  const existentes = await listTemplates();
  const nomesExistentes = new Set(existentes.map((t) => t.name));

  const submetidos: Array<{ name: string; id: string; status: WaTemplateStatus }> = [];
  const ja_existentes: string[] = [];
  const erros: Array<{ name: string; error: string }> = [];

  for (const def of LARA_TEMPLATES) {
    if (nomesExistentes.has(def.name)) {
      ja_existentes.push(def.name);
      continue;
    }
    try {
      const res = await createTemplate(def);
      submetidos.push({ name: def.name, id: res.id, status: res.status });
    } catch (err: unknown) {
      erros.push({ name: def.name, error: err instanceof Error ? err.message : String(err) });
    }
    // Respeita rate limit da API de templates (não há limite rigoroso, mas aguardamos 200ms)
    await new Promise((r) => setTimeout(r, 200));
  }

  return { submetidos, ja_existentes, erros };
}

// ─── Envio de Mensagem via Template ──────────────────────────────────────────

export type WaTemplateParam = { type: "text"; text: string } | { type: "image"; image: { link: string } };

export interface WaSendTemplateInput {
  to: string;           // número E.164 sem +, ex: "5511999999999"
  template_name: string;
  language?: WaTemplateLanguage;
  header_params?: WaTemplateParam[];
  body_params?: WaTemplateParam[];
  button_params?: Array<{ index: number; sub_type: "quick_reply" | "url"; parameters: WaTemplateParam[] }>;
}

export interface WaSendTemplateResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

// Guard contra disparo duplicado: mesmo template para o mesmo número dentro de 10 min é bloqueado.
const _recentTemplateSends = new Map<string, number>(); // `${to}:${templateName}` → timestamp
const TEMPLATE_DEDUP_WINDOW_MS = 10 * 60 * 1000;

/** Envia uma mensagem de template WhatsApp. */
export async function sendTemplate(input: WaSendTemplateInput): Promise<WaSendTemplateResponse> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp não configurado");

  const dedupeKey = `${input.to}:${input.template_name}`;
  const nowTs = Date.now();
  const lastSent = _recentTemplateSends.get(dedupeKey);
  if (lastSent && nowTs - lastSent < TEMPLATE_DEDUP_WINDOW_MS) {
    return {
      messaging_product: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to }],
      messages: [{ id: `dedup:${dedupeKey}:${lastSent}`, message_status: "deduplicated" }],
    };
  }
  _recentTemplateSends.set(dedupeKey, nowTs);
  if (_recentTemplateSends.size > 10000) {
    const cutoff = nowTs - TEMPLATE_DEDUP_WINDOW_MS;
    for (const [k, ts] of _recentTemplateSends) {
      if (ts < cutoff) _recentTemplateSends.delete(k);
    }
  }

  const components: unknown[] = [];

  if (input.header_params?.length) {
    components.push({ type: "header", parameters: input.header_params });
  }
  if (input.body_params?.length) {
    components.push({ type: "body", parameters: input.body_params });
  }
  if (input.button_params?.length) {
    for (const btn of input.button_params) {
      components.push({ type: "button", sub_type: btn.sub_type, index: String(btn.index), parameters: btn.parameters });
    }
  }

  const payload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.template_name,
      language: { code: input.language ?? "pt_BR" },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const url = graphUrl(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`);
  return graphFetch<WaSendTemplateResponse>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Helpers de Envio para a Régua ───────────────────────────────────────────

/** Envia template de cobrança pela etapa da régua. */
export async function enviarTemplateEtapa(input: {
  to: string;
  etapa: string;
  cliente: string;
  duplicata?: string;
  valor?: string;
  vencimento?: string;
}): Promise<WaSendTemplateResponse | null> {
  const templateName = ETAPA_TEMPLATE_MAP[input.etapa];
  if (!templateName) return null;

  const bodyParams: WaTemplateParam[] = [{ type: "text", text: input.cliente }];

  if (input.etapa === "D-3") {
    // lara_vencimento_d3: cliente, titulo, valor, vencimento (4 params)
    if (input.duplicata) bodyParams.push({ type: "text", text: input.duplicata });
    if (input.valor) bodyParams.push({ type: "text", text: input.valor });
    if (input.vencimento) bodyParams.push({ type: "text", text: input.vencimento });
  } else if (input.etapa === "D0") {
    // lara_aviso_vencimento_d0: cliente, titulo, valor (3 params — sem vencimento)
    if (input.duplicata) bodyParams.push({ type: "text", text: input.duplicata });
    if (input.valor) bodyParams.push({ type: "text", text: input.valor });
  } else {
    // D+3: duplicata + valor; D+7, D+15, D+30: só valor total
    if (input.etapa === "D+3" && input.duplicata) {
      bodyParams.push({ type: "text", text: input.duplicata });
    }
    if (input.valor) bodyParams.push({ type: "text", text: input.valor });
  }

  return sendTemplate({ to: input.to, template_name: templateName, body_params: bodyParams });
}

/** Envia template de boleto gerado. */
export async function enviarTemplateBoleto(input: {
  to: string;
  cliente: string;
  duplicata: string;
  valor: string;
  vencimento: string;
  linha_digitavel: string;
}): Promise<WaSendTemplateResponse> {
  return sendTemplate({
    to: input.to,
    template_name: "lara_boleto_gerado",
    body_params: [
      { type: "text", text: input.cliente },
      { type: "text", text: input.duplicata },
      { type: "text", text: input.valor },
      { type: "text", text: input.vencimento },
      { type: "text", text: input.linha_digitavel },
    ],
  });
}

// Dedup de texto livre: mesma mensagem para o mesmo número dentro de 10 min não é reenviada
const _recentTextSends = new Map<string, number>();

/** Envia mensagem de texto simples (requer janela de 24h ativa). */
export async function sendTextMessage(to: string, text: string): Promise<WaSendTemplateResponse> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp não configurado");

  const dedupeKey = `${to}:${text.slice(0, 200)}`;
  const nowTs = Date.now();
  const lastSent = _recentTextSends.get(dedupeKey);
  if (lastSent && nowTs - lastSent < TEMPLATE_DEDUP_WINDOW_MS) {
    return {
      messaging_product: "whatsapp",
      contacts: [{ input: to, wa_id: to }],
      messages: [{ id: `dedup-text:${to}:${lastSent}`, message_status: "deduplicated" }],
    };
  }
  _recentTextSends.set(dedupeKey, nowTs);
  if (_recentTextSends.size > 5000) {
    const cutoff = nowTs - TEMPLATE_DEDUP_WINDOW_MS;
    for (const [k, ts] of _recentTextSends) {
      if (ts < cutoff) _recentTextSends.delete(k);
    }
  }

  const url = graphUrl(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`);
  return graphFetch<WaSendTemplateResponse>(url, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

/** Envia template de PIX disponível e, em seguida, o código como texto separado. */
export async function enviarTemplatePix(input: {
  to: string;
  cliente: string;
  duplicata: string;
  valor: string;
  pix_copia_cola: string;
  validade_horas?: number;
}): Promise<WaSendTemplateResponse> {
  const result = await sendTemplate({
    to: input.to,
    template_name: "lara_pix_disponivel",
    body_params: [
      { type: "text", text: input.cliente },
      { type: "text", text: input.duplicata },
      { type: "text", text: input.valor },
      { type: "text", text: String(input.validade_horas ?? 24) },
    ],
  });
  // Envia o código PIX como mensagem de texto dentro da janela aberta pelo template
  await sendTextMessage(input.to, `Código PIX Copia e Cola:\n${input.pix_copia_cola}`);
  return result;
}

/** Envia confirmação de PIX recebido (pós-conciliação). */
export async function enviarTemplatePixConfirmado(input: {
  to: string;
  cliente: string;
  valor: string;
  duplicata: string;
}): Promise<WaSendTemplateResponse> {
  return sendTemplate({
    to: input.to,
    template_name: "lara_pix_confirmado",
    body_params: [
      { type: "text", text: input.cliente },
      { type: "text", text: input.valor },
      { type: "text", text: input.duplicata },
    ],
  });
}

/** Envia confirmação de promessa de pagamento. */
export async function enviarTemplatePromessa(input: {
  to: string;
  cliente: string;
  valor: string;
  data_prometida: string;
}): Promise<WaSendTemplateResponse> {
  return sendTemplate({
    to: input.to,
    template_name: "lara_promessa_confirmada",
    body_params: [
      { type: "text", text: input.cliente },
      { type: "text", text: input.valor },
      { type: "text", text: input.data_prometida },
    ],
  });
}
