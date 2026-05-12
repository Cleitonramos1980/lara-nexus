import type { SesmtRecord } from "../types/sesmt.js";

type SesmtSpecificFieldType = "text" | "number" | "date" | "select" | "textarea";

interface SesmtSpecificField {
  key: string;
  type: SesmtSpecificFieldType;
  required?: boolean;
  options?: string[];
}

const yesNoOptions = ["SIM", "NAO"];
const controlHierarchyOptions = ["ELIMINACAO", "SUBSTITUICAO", "ENGENHARIA", "ADMINISTRATIVO", "EPI"];

const commonRiskFields: SesmtSpecificField[] = [
  { key: "perigo", type: "text", required: true },
  { key: "eventoIndesejado", type: "text" },
  { key: "consequencia", type: "textarea" },
  { key: "causa", type: "text" },
];

export const SESMT_FORM_SCHEMAS: Record<string, SesmtSpecificField[]> = {
  "atividades-por-nr": [
    { key: "atividade", type: "text", required: true },
    { key: "periodicidade", type: "text" },
    { key: "evidenciaObrigatoria", type: "text" },
    { key: "investimentoPrevisto", type: "number" },
  ],
  "riscos-barreiras-e-controles": [
    ...commonRiskFields,
    { key: "barreira", type: "text", required: true },
    { key: "tipoControle", type: "select", options: controlHierarchyOptions },
  ],
  "efetividade-dos-controles": [
    { key: "controleAtual", type: "text", required: true },
    { key: "hierarquia", type: "select", options: controlHierarchyOptions },
    { key: "eficaciaPercentual", type: "number", required: true },
    { key: "oportunidadeMigracao", type: "textarea" },
  ],
  "plano-de-acao-x-risco": [
    { key: "riscoRelacionamento", type: "text", required: true },
    { key: "acaoCorretiva", type: "textarea", required: true },
    { key: "prazoReavaliacao", type: "date" },
    { key: "riscoResidualReavaliado", type: "number" },
  ],
  "laudos-e-vinculos": [
    { key: "tipoLaudo", type: "text", required: true },
    { key: "codigoLaudo", type: "text", required: true },
    { key: "grupoExposto", type: "text" },
    { key: "vinculos", type: "textarea" },
  ],
  epi: [
    { key: "ca", type: "text", required: true },
    { key: "fornecedor", type: "text" },
    { key: "validadeCa", type: "date" },
    { key: "frequenciaTrocaDias", type: "number" },
    { key: "usoObrigatorio", type: "select", options: yesNoOptions },
  ],
  epc: [
    { key: "tipoEpc", type: "text", required: true },
    { key: "localidade", type: "text", required: true },
    { key: "planoManutencao", type: "textarea" },
    { key: "osVinculada", type: "text" },
  ],
  "inspecoes-e-visitas": [
    { key: "checklistAplicado", type: "text", required: true },
    { key: "achadosCriticos", type: "number" },
    { key: "reincidencia", type: "select", options: yesNoOptions },
    { key: "tratativa", type: "textarea" },
  ],
  "procedimentos-apr-pt-os": [
    { key: "tipoDocumento", type: "text", required: true },
    { key: "codigoDocumento", type: "text" },
    { key: "cienciaObrigatoria", type: "select", options: yesNoOptions },
    { key: "versaoVigente", type: "text" },
  ],
  "comunicacao-de-sst": [
    { key: "tipoComunicacao", type: "text", required: true },
    { key: "publicoAlvo", type: "text", required: true },
    { key: "aceiteCritico", type: "select", options: yesNoOptions },
    { key: "campanha", type: "text" },
  ],
  "participacao-do-trabalhador": [
    { key: "tipoParticipacao", type: "text", required: true },
    { key: "anonimato", type: "select", options: yesNoOptions },
    { key: "tratativaStatus", type: "text" },
    { key: "detalhesParticipacao", type: "textarea" },
  ],
  cipa: [
    { key: "mandatoInicio", type: "date", required: true },
    { key: "mandatoFim", type: "date", required: true },
    { key: "titulares", type: "number" },
    { key: "suplentes", type: "number" },
  ],
  "treinamentos-e-integracao": [
    { key: "catalogo", type: "text", required: true },
    { key: "cargaHoraria", type: "number" },
    { key: "periodicidadeReciclagem", type: "text" },
    { key: "necessidadePorRisco", type: "textarea" },
  ],
  "saude-ocupacional": [
    { key: "tipoAso", type: "text", required: true },
    { key: "statusPcmso", type: "text" },
    { key: "grupoHomogeneo", type: "text" },
    { key: "agenteExposicao", type: "textarea" },
  ],
  exames: [
    { key: "tipoExame", type: "text", required: true },
    { key: "laboratorio", type: "text" },
    { key: "dataConvocacao", type: "date" },
    { key: "resultadoExame", type: "textarea" },
  ],
  "ambulatorio-prontuario": [
    { key: "tipoAtendimento", type: "text", required: true },
    { key: "cid", type: "text" },
    { key: "afastamentoDias", type: "number" },
    { key: "retornoTrabalho", type: "date" },
  ],
  "medicamentos-vacinas": [
    { key: "tipoRegistro", type: "text", required: true },
    { key: "lote", type: "text" },
    { key: "validadeLote", type: "date" },
    { key: "coberturaVacinal", type: "number" },
  ],
  "ergonomia-nr-17": [
    { key: "aetStatus", type: "text", required: true },
    { key: "riscoBiomecanico", type: "text" },
    { key: "recomendacaoErgonomica", type: "textarea" },
    { key: "acaoErgonomica", type: "text" },
  ],
  "sinalizacao-nr-26": [
    { key: "tipoSinalizacao", type: "text", required: true },
    { key: "localImplantacao", type: "text" },
    { key: "reposicaoPrevista", type: "date" },
    { key: "evidenciaFotografica", type: "select", options: yesNoOptions },
  ],
  "emergencia-e-incendio": [
    { key: "tipoEquipamento", type: "text", required: true },
    { key: "brigadistasAtivos", type: "number" },
    { key: "simuladoPrevisto", type: "date" },
    { key: "situacaoPlano", type: "text" },
  ],
  residuos: [
    { key: "classificacao", type: "text", required: true },
    { key: "origem", type: "text" },
    { key: "armazenamento", type: "text" },
    { key: "destinacao", type: "textarea" },
  ],
  "obras-promat": [
    { key: "codigoObra", type: "text", required: true },
    { key: "faseObra", type: "text" },
    { key: "frenteServico", type: "text" },
    { key: "statusPromat", type: "text" },
  ],
  "documentos-controlados": [
    { key: "codigoDocumento", type: "text", required: true },
    { key: "versao", type: "text" },
    { key: "vigencia", type: "date" },
    { key: "aprovador", type: "text" },
  ],
  "biblioteca-tecnica": [
    { key: "tema", type: "text", required: true },
    { key: "nrRelacionada", type: "text" },
    { key: "setorDestino", type: "text" },
    { key: "formato", type: "text" },
  ],
  "notificacoes-e-respostas": [
    { key: "orgaoNotificador", type: "text", required: true },
    { key: "prazoResposta", type: "date" },
    { key: "criticidadeNotificacao", type: "text" },
    { key: "statusResposta", type: "text" },
  ],
  "terceiros-e-contratados": [
    { key: "empresaContratada", type: "text", required: true },
    { key: "numeroContrato", type: "text" },
    { key: "pendenciaDocumental", type: "text" },
    { key: "incidenteVinculado", type: "text" },
  ],
  "requisitos-legais": [
    { key: "origemLegal", type: "text", required: true },
    { key: "aplicabilidade", type: "text" },
    { key: "criterioAvaliacao", type: "text" },
    { key: "riscoDescumprimento", type: "text" },
  ],
  "sesmt-legal-dimensionamento": [
    { key: "efetivoUnidade", type: "number", required: true },
    { key: "exigidoLegal", type: "number", required: true },
    { key: "existente", type: "number", required: true },
    { key: "memoriaCalculo", type: "textarea" },
  ],
  "custos-sesmt": [
    { key: "categoriaCusto", type: "text", required: true },
    { key: "competencia", type: "text" },
    { key: "centroCusto", type: "text" },
    { key: "orcado", type: "number" },
  ],
  "cadastros-auxiliares": [
    { key: "tipoCadastro", type: "text", required: true },
    { key: "codigo", type: "text" },
    { key: "descricaoCadastro", type: "textarea" },
    { key: "ativo", type: "select", options: yesNoOptions },
  ],
};

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function asHttpError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function getSesmtFormSchema(moduleKey: string): SesmtSpecificField[] {
  return SESMT_FORM_SCHEMAS[moduleKey] ?? [];
}

export function validateSpecificFieldKey(moduleKey: string, fieldKey: string): void {
  const schema = getSesmtFormSchema(moduleKey);
  if (schema.length === 0) return;
  const allowed = new Set(schema.map((field) => field.key));
  if (!allowed.has(fieldKey)) {
    throw asHttpError(`Campo especifico '${fieldKey}' invalido para o submodulo ${moduleKey}.`);
  }
}

export function validateSesmtSpecificData(
  moduleKey: string,
  payloadValue: unknown,
  priorValue?: SesmtRecord["dadosEspecificos"],
): SesmtRecord["dadosEspecificos"] {
  const schema = getSesmtFormSchema(moduleKey);
  if (schema.length === 0) return undefined;

  const payload = payloadValue == null
    ? {}
    : (typeof payloadValue === "object" && !Array.isArray(payloadValue) ? payloadValue as Record<string, unknown> : null);
  if (payload === null) {
    throw asHttpError("Dados especificos invalidos para este submodulo.");
  }

  const allowedKeys = new Set(schema.map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      throw asHttpError(`Campo especifico '${key}' nao permitido para o submodulo ${moduleKey}.`);
    }
  }

  const prior = priorValue && typeof priorValue === "object" && !Array.isArray(priorValue)
    ? priorValue
    : {};

  const merged: Record<string, string | number | boolean | null> = {};
  for (const field of schema) {
    const hasPayloadField = Object.prototype.hasOwnProperty.call(payload, field.key);
    const source = hasPayloadField ? payload[field.key] : prior[field.key];

    if (source == null) {
      merged[field.key] = null;
      continue;
    }

    const asText = String(source).trim();
    if (asText.length === 0) {
      merged[field.key] = null;
      continue;
    }

    if (field.type === "number") {
      const parsed = Number(asText.replace(",", "."));
      if (!Number.isFinite(parsed)) {
        throw asHttpError(`Campo numerico invalido: ${field.key}.`);
      }
      merged[field.key] = parsed;
      continue;
    }

    if (field.type === "date") {
      if (!isDateString(asText)) {
        throw asHttpError(`Campo de data invalido: ${field.key}. Use formato YYYY-MM-DD.`);
      }
      merged[field.key] = asText;
      continue;
    }

    if (field.type === "select") {
      if (field.options && field.options.length > 0 && !field.options.includes(asText)) {
        throw asHttpError(`Valor invalido para ${field.key}.`);
      }
      merged[field.key] = asText;
      continue;
    }

    merged[field.key] = asText;
  }

  const requiredMissing = schema
    .filter((field) => field.required)
    .map((field) => field.key)
    .filter((fieldKey) => {
      const value = merged[fieldKey];
      if (value == null) return true;
      return String(value).trim().length === 0;
    });

  if (requiredMissing.length > 0) {
    throw asHttpError(`Campos especificos obrigatorios ausentes: ${requiredMissing.join(", ")}.`);
  }

  const hasData = Object.values(merged).some((value) => value != null && String(value).trim().length > 0);
  return hasData ? merged : undefined;
}
