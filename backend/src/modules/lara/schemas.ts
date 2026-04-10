import { z } from "zod";

function parseFiliaisList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

const boolFromQuery = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const normalized = value.toLowerCase();
    if (["1", "true", "sim", "yes"].includes(normalized)) return true;
    if (["0", "false", "nao", "no"].includes(normalized)) return false;
    return undefined;
  });

export const listClientesQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  risco: z.enum(["baixo", "medio", "alto", "critico"]).optional(),
  optout: boolFromQuery,
  limit: z.coerce.number().int().min(1).max(100000).optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listTitulosQuerySchema = z.object({
  search: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive().optional(),
  etapa: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  atrasoMin: z.coerce.number().int().optional(),
  atrasoMax: z.coerce.number().int().optional(),
  somenteAbertos: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return true;
      return ["1", "true", "sim", "yes"].includes(value.toLowerCase());
    }),
  limit: z.coerce.number().int().min(1).max(100000).optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listConversasQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  canal: z.string().trim().optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listAtendimentosQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  canal: z.string().trim().optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listCasesQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listOptoutQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  filiais: z
    .string()
    .optional()
    .transform((value) => parseFiliaisList(value)),
  canal: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const listComplianceAuditQuerySchema = z.object({
  codcli: z.coerce.number().int().positive().optional(),
  wa_id: z.string().trim().optional(),
  tenant_id: z.string().trim().optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().optional(),
});

export const recarregarTitulosBodySchema = z.object({
  codcli: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100000).optional(),
  includeDesd: z.boolean().optional(),
});

export const processarMensagemBodySchema = z.object({
  event_id: z.string().trim().min(1).optional(),
  wa_id: z.string().trim().min(3),
  telefone: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive().optional(),
  message_text: z.string().trim().min(1).max(4000),
  origem: z.string().trim().default("whatsapp-inbound"),
  tenant_id: z.string().trim().default("default"),
  jurisdicao: z.enum(["BR", "US", "EU", "UK", "GLOBAL"]).default("BR"),
  canal: z.enum(["WHATSAPP", "SMS", "EMAIL", "VOICE", "OUTRO"]).default("WHATSAPP"),
  received_at: z.string().datetime().optional(),
  operator_name: z.string().trim().optional(),
  payload: z.record(z.any()).optional(),
});

export const escalarAtendimentoBodySchema = z.object({
  wa_id: z.string().trim().min(3),
  codcli: z.coerce.number().int().positive().optional(),
  cliente: z.string().trim().optional(),
  detalhe: z.string().trim().min(3).max(4000),
  tipo_case: z.string().trim().default("ESCALACAO_HUMANA"),
  origem: z.string().trim().default("manual"),
  responsavel: z.string().trim().default("Operador"),
  etapa: z.string().trim().optional(),
  duplicatas: z.array(z.string().trim()).optional(),
  valor_total: z.coerce.number().optional(),
});

export const pagamentoBoletoBodySchema = z.object({
  wa_id: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive(),
  cliente: z.string().trim().optional(),
  duplicatas: z.array(z.string().trim()).optional(),
  origem: z.string().trim().default("api"),
  solicitante: z.string().trim().default("Lara"),
});

export const pagamentoPixBodySchema = z.object({
  wa_id: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive(),
  cliente: z.string().trim().optional(),
  duplicatas: z.array(z.string().trim()).optional(),
  origem: z.string().trim().default("api"),
  solicitante: z.string().trim().default("Lara"),
});

export const promessaBodySchema = z.object({
  wa_id: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive(),
  cliente: z.string().trim().optional(),
  duplicatas: z.array(z.string().trim()).optional(),
  valor_total: z.coerce.number().nonnegative().optional(),
  data_prometida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().trim().max(2000).optional(),
  origem: z.string().trim().default("api"),
});

export const caseBodySchema = z.object({
  wa_id: z.string().trim().optional(),
  codcli: z.coerce.number().int().positive().optional(),
  cliente: z.string().trim().optional(),
  tipo_case: z.string().trim().min(2),
  etapa: z.string().trim().optional(),
  duplicatas: z.string().trim().optional(),
  valor_total: z.coerce.number().optional(),
  forma_pagamento: z.string().trim().optional(),
  detalhe: z.string().trim().min(2).max(4000),
  origem: z.string().trim().default("manual"),
  responsavel: z.string().trim().default("Operador"),
  status: z.string().trim().default("aberto"),
});

export const optoutBodySchema = z.object({
  wa_id: z.string().trim().min(3),
  codcli: z.coerce.number().int().positive().optional(),
  cliente: z.string().trim().optional(),
  motivo: z.string().trim().min(2).max(300),
  origem: z.string().trim().default("manual"),
  observacao: z.string().trim().max(2000).optional(),
  ativo: z.boolean().default(true),
});

export const reguaConfigPutBodySchema = z.object({
  templates: z.array(
    z.object({
      id: z.string().trim().optional(),
      etapa: z.string().trim().min(2),
      nome_template: z.string().trim().min(2),
      canal: z.string().trim().default("WHATSAPP"),
      mensagem_template: z.string().trim().min(5),
      ativo: z.boolean().default(true),
      ordem_execucao: z.coerce.number().int().min(0).default(0),
    }),
  ).optional(),
  configuracoes: z
    .array(
      z.object({
        chave: z.string().trim().min(2),
        valor: z.string().trim(),
        descricao: z.string().trim().optional(),
      }),
    )
    .optional(),
});

export const reguaDisparoTesteBodySchema = z.object({
  etapa: z.string().trim().min(2),
  elegivel: z.coerce.number().int().min(0).default(0),
  disparada: z.coerce.number().int().min(0).default(0),
  respondida: z.coerce.number().int().min(0).default(0),
  convertida: z.coerce.number().int().min(0).default(0),
  erro: z.coerce.number().int().min(0).default(0),
  bloqueado_optout: z.coerce.number().int().min(0).default(0),
  valor_impactado: z.coerce.number().min(0).default(0),
  detalhes_json: z.record(z.any()).optional(),
});

export const webhookWhatsappInboundSchema = z.object({
  event_id: z.string().trim().optional(),
  wa_id: z.string().trim().min(3),
  telefone: z.string().trim().optional(),
  message_text: z.string().trim().min(1).max(4000),
  tenant_id: z.string().trim().default("default"),
  jurisdicao: z.enum(["BR", "US", "EU", "UK", "GLOBAL"]).default("BR"),
  canal: z.enum(["WHATSAPP", "SMS", "EMAIL", "VOICE", "OUTRO"]).default("WHATSAPP"),
  received_at: z.string().datetime().optional(),
  payload: z.record(z.any()).optional(),
});

export const webhookWhatsappStatusSchema = z.object({
  event_id: z.string().trim().optional(),
  message_id: z.string().trim().optional(),
  wa_id: z.string().trim().optional(),
  status: z.string().trim().min(2),
  timestamp: z.string().datetime().optional(),
  payload: z.record(z.any()).optional(),
});

export const webhookReguaResultadoSchema = z.object({
  event_id: z.string().trim().optional(),
  etapa: z.string().trim().min(2),
  data_hora_execucao: z.string().datetime().optional(),
  elegivel: z.coerce.number().int().min(0).default(0),
  disparada: z.coerce.number().int().min(0).default(0),
  respondida: z.coerce.number().int().min(0).default(0),
  convertida: z.coerce.number().int().min(0).default(0),
  erro: z.coerce.number().int().min(0).default(0),
  bloqueado_optout: z.coerce.number().int().min(0).default(0),
  valor_impactado: z.coerce.number().min(0).default(0),
  status: z.string().trim().default("recebido"),
  detalhes_json: z.record(z.any()).optional(),
});

export const syncJanelaBodySchema = z
  .object({
    ativo: z.boolean().optional(),
    hora: z.coerce.number().int().min(0).max(23).optional(),
    minuto: z.coerce.number().int().min(0).max(59).optional(),
    timezone: z.string().trim().min(3).max(80).optional(),
    limit: z.coerce.number().int().min(100).max(100000).optional(),
    includeDesd: z.boolean().optional(),
    startupRun: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar a janela de sincronizacao.",
  });

const winthorTituloLookupShape = {
  codcli: z.coerce.number().int().positive().optional(),
  duplicata: z.string().trim().optional(),
  prestacao: z.string().trim().optional(),
  codfilial: z.string().trim().optional(),
  numtransvenda: z.coerce.number().int().positive().optional(),
  cgcent: z.string().trim().optional(),
  fantasia: z.string().trim().optional(),
  cliente: z.string().trim().optional(),
};

const winthorLookupRefine = (value: z.infer<z.ZodObject<typeof winthorTituloLookupShape>>) =>
  Boolean(
    value.numtransvenda
    || value.codcli
    || value.cgcent
    || value.fantasia
    || value.cliente
    || (value.duplicata && value.prestacao),
  );

const winthorLookupMessage =
  "Informe numtransvenda, codcli, cgcent, fantasia, cliente ou o par duplicata + prestacao para localizar o titulo.";

export const winthorBoletoConsultaBodySchema = z
  .object(winthorTituloLookupShape)
  .refine(winthorLookupRefine, { message: winthorLookupMessage });

export const winthorBoletoGerarBodySchema = z
  .object({
    ...winthorTituloLookupShape,
    codbanco: z.coerce.number().int().positive().optional(),
    numdiasprotesto: z.coerce.number().int().min(0).max(365).optional(),
    primeira_impressao: z.boolean().default(true),
    force_regenerate: z.boolean().default(false),
    idempotency_key: z.string().trim().optional(),
    origem: z.string().trim().default("n8n"),
    solicitante: z.string().trim().default("Lara N8N"),
  })
  .refine(winthorLookupRefine, { message: winthorLookupMessage });

export const winthorProrrogarTituloBodySchema = z
  .object({
    ...winthorTituloLookupShape,
    nova_data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motivo: z.string().trim().optional(),
    observacao: z.string().trim().max(2000).optional(),
    codfunc: z.coerce.number().int().positive().default(270),
    idempotency_key: z.string().trim().optional(),
    tenant_id: z.string().trim().default("default"),
    wa_id: z.string().trim().optional(),
    origem: z.string().trim().default("n8n"),
    solicitante: z.string().trim().default("Lara N8N"),
  })
  .refine(winthorLookupRefine, { message: winthorLookupMessage });
