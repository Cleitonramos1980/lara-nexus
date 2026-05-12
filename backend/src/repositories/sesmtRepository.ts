
import { isOracleEnabled } from "../db/oracle.js";
import { execDml, queryOne, queryRows } from "./baseRepository.js";
import { appendAudit, db } from "./dataStore.js";
import {
  getSesmtModuleDefinition,
  SESMT_EXECUTIVE_VIEWS,
  SESMT_MENU_TREE,
  SESMT_MODULE_DEFINITIONS,
} from "./sesmtCatalog.js";
import {
  validateSesmtSpecificData,
  validateSpecificFieldKey,
} from "./sesmtFormSchemaCatalog.js";
import type {
  SesmtAttachment,
  SesmtEvidence,
  SesmtFavoritePreset,
  SesmtRecord,
  SesmtRecordListResult,
} from "../types/sesmt.js";

const ALL_UNITS = ["MAO", "BEL", "AGR"];

const READ_PROFILES = new Set([
  "ADMIN",
  "CORPORATIVO_SST",
  "SESMT",
  "TECNICO_SEGURANCA",
  "ENFERMAGEM_TRABALHO",
  "MEDICO_TRABALHO",
  "RH",
  "GESTOR_UNIDADE",
  "AUDITOR",
  "DIRETORIA",
  "LEITOR_RESTRITO",
  "GESTOR_CONTRATOS",
  "TERCEIRO_CONSULTA_LIMITADA",
  "LIDER_OPERACIONAL",
  "RH_OCUPACIONAL",
  "COMITE_SST",
  "DIRETOR_EXECUTIVO_SST",
  "QUALIDADE",
  "ASSISTENCIA",
  "SAC",
]);

const WRITE_PROFILES = new Set([
  "ADMIN",
  "CORPORATIVO_SST",
  "SESMT",
  "TECNICO_SEGURANCA",
  "ENFERMAGEM_TRABALHO",
  "MEDICO_TRABALHO",
  "RH",
  "GESTOR_UNIDADE",
  "GESTOR_CONTRATOS",
  "LIDER_OPERACIONAL",
  "RH_OCUPACIONAL",
  "COMITE_SST",
  "DIRETOR_EXECUTIVO_SST",
]);

const SENSITIVE_HEALTH_READ_PROFILES = new Set([
  "ADMIN",
  "CORPORATIVO_SST",
  "SESMT",
  "MEDICO_TRABALHO",
  "ENFERMAGEM_TRABALHO",
  "RH_OCUPACIONAL",
  "DIRETOR_EXECUTIVO_SST",
]);

const SENSITIVE_HEALTH_WRITE_PROFILES = new Set([
  "ADMIN",
  "CORPORATIVO_SST",
  "SESMT",
  "MEDICO_TRABALHO",
  "ENFERMAGEM_TRABALHO",
  "RH_OCUPACIONAL",
]);

const RESTRICTED_UNIT_PROFILES = new Set(["GESTOR_UNIDADE", "LIDER_OPERACIONAL", "TERCEIRO_CONSULTA_LIMITADA"]);

function ensureStore(): any {
  if (!db.sesmt || typeof db.sesmt !== "object") {
    (db as any).sesmt = {
      registros: [],
      acessosSensiveis: [],
      custos: [],
      documentosControlados: [],
      indicadores: [],
      unidades: [],
      setores: [],
      cargos: [],
      funcoes: [],
      colaboradores: [],
      profissionaisSesmt: [],
      dimensionamentoSesmt: [],
      requisitosLegais: [],
      cadastrosAuxiliares: [],
      bibliotecaTecnica: [],
      favoritePresets: [],
    };
  }

  if (!Array.isArray(db.sesmt.registros)) db.sesmt.registros = [];
  if (!Array.isArray(db.sesmt.acessosSensiveis)) db.sesmt.acessosSensiveis = [];
  if (!Array.isArray(db.sesmt.favoritePresets)) db.sesmt.favoritePresets = [];

  return db.sesmt;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAllowedUnits(profile: string, userId: string): string[] {
  if (!RESTRICTED_UNIT_PROFILES.has(profile)) return ALL_UNITS;
  const idx = hashText(userId || profile) % ALL_UNITS.length;
  return [ALL_UNITS[idx]];
}

function assertRead(profile: string): void {
  if (!READ_PROFILES.has(profile)) {
    throw Object.assign(new Error("Perfil sem acesso ao modulo SESMT/SST."), { statusCode: 403 });
  }
}

function assertSensitiveRead(profile: string, moduleKey: string, userName: string): void {
  if (!SENSITIVE_HEALTH_READ_PROFILES.has(profile)) {
    throw Object.assign(new Error("Perfil sem acesso a dados ocupacionais sensiveis."), { statusCode: 403 });
  }
  const store = ensureStore();
  store.acessosSensiveis.unshift({
    id: `SENS-${String(store.acessosSensiveis.length + 1).padStart(4, "0")}`,
    data: nowIso(),
    usuario: userName,
    perfil: profile,
    moduleKey,
    acao: "LEITURA_SENSIVEL",
  });
  appendAudit("ACESSO_SENSIVEL", "SESMT_SAUDE", moduleKey, `Acesso sensivel de ${userName} (${profile})`, userName);
}

function assertWrite(profile: string, isSensitive: boolean): void {
  if (!WRITE_PROFILES.has(profile)) {
    throw Object.assign(new Error("Perfil sem permissao de escrita no modulo SESMT/SST."), { statusCode: 403 });
  }
  if (isSensitive && !SENSITIVE_HEALTH_WRITE_PROFILES.has(profile)) {
    throw Object.assign(new Error("Perfil sem permissao de escrita para dados de saude ocupacional."), { statusCode: 403 });
  }
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return normalizeNumber(value) ?? fallback;
}

function buildHistoryEntry(acao: string, descricao: string, usuario: string) {
  return {
    id: `HIS-${Math.floor(Math.random() * 1_000_000)}`,
    data: nowIso(),
    usuario,
    acao,
    descricao,
  };
}

function cleanString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSpecificValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  return undefined;
}

function normalizeSpecificData(
  payloadValue: unknown,
  priorValue?: SesmtRecord["dadosEspecificos"],
): SesmtRecord["dadosEspecificos"] {
  const merged: Record<string, string | number | boolean | null> = { ...(priorValue || {}) };
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  for (const [key, value] of Object.entries(payloadValue as Record<string, unknown>)) {
    const normalized = normalizeSpecificValue(value);
    if (normalized === undefined) continue;
    merged[key] = normalized;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeSpecificFilters(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key, String(raw ?? "").trim()] as const)
    .filter(([, normalized]) => normalized.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeSortDir(value: unknown, fallback: "asc" | "desc" = "desc"): "asc" | "desc" {
  const normalized = cleanString(value)?.toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return fallback;
}

function applyUnitFilter(records: SesmtRecord[], allowedUnits: string[]): SesmtRecord[] {
  if (allowedUnits.length === 0) return [];
  return records.filter((record) => allowedUnits.includes(record.unidade));
}

function sortRecords(records: SesmtRecord[], sortBy?: string, sortDir: "asc" | "desc" = "desc"): SesmtRecord[] {
  const getSortValue = (record: SesmtRecord, key?: string): unknown => {
    if (!key || key === "updatedAt") return record.updatedAt;
    if (key.startsWith("specific:")) {
      const specificKey = key.slice("specific:".length);
      return record.dadosEspecificos?.[specificKey];
    }
    return (record as any)[key];
  };

  const normalizeSortValue = (value: unknown): string | number => {
    if (value == null) return "";
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    if (typeof value === "boolean") return value ? 1 : 0;

    const text = String(value).trim();
    if (text.length === 0) return "";

    if (/^-?\d+(?:[.,]\d+)?$/.test(text)) {
      const parsedNumber = Number(text.replace(",", "."));
      if (Number.isFinite(parsedNumber)) return parsedNumber;
    }

    if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]*)?$/.test(text)) {
      const timestamp = Date.parse(text);
      if (!Number.isNaN(timestamp)) return timestamp;
    }

    return text.toLowerCase();
  };

  const sorted = [...records];
  sorted.sort((a, b) => {
    const va = normalizeSortValue(getSortValue(a, sortBy));
    const vb = normalizeSortValue(getSortValue(b, sortBy));
    if (typeof va === "number" && typeof vb === "number") {
      return sortDir === "asc" ? va - vb : vb - va;
    }
    const sa = String(va);
    const sb = String(vb);
    const compared = sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    if (compared !== 0) return compared;
    return sortDir === "asc"
      ? String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""))
      : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return sorted;
}

function monthsBack(amount: number): string[] {
  const result: string[] = [];
  const date = new Date();
  date.setDate(1);
  for (let i = amount - 1; i >= 0; i -= 1) {
    const d = new Date(date);
    d.setMonth(d.getMonth() - i);
    result.push(d.toISOString().slice(0, 7));
  }
  return result;
}

function mapRecordInput(moduleKey: string, payload: any, userName: string, existing?: SesmtRecord): SesmtRecord {
  const prior = existing ?? ({} as SesmtRecord);
  const criticalityRaw = cleanString(payload.criticidade)?.toUpperCase();
  const criticidade = ["BAIXA", "MEDIA", "ALTA", "CRITICA"].includes(criticalityRaw || "")
    ? (criticalityRaw as SesmtRecord["criticidade"])
    : (prior.criticidade || "MEDIA");

  const date = nowIso();
  return {
    id: prior.id || `SES-${moduleKey.slice(0, 3).toUpperCase()}-${String(Date.now()).slice(-6)}`,
    moduleKey,
    titulo: cleanString(payload.titulo) || prior.titulo || "Registro SESMT",
    descricao: cleanString(payload.descricao) || prior.descricao || "",
    unidade: cleanString(payload.unidade) || prior.unidade || "MAO",
    status: cleanString(payload.status) || prior.status || "ABERTO",
    responsavel: cleanString(payload.responsavel) || prior.responsavel || userName,
    criticidade,
    nr: cleanString(payload.nr) || prior.nr,
    periodoInicio: cleanString(payload.periodoInicio) || prior.periodoInicio,
    periodoFim: cleanString(payload.periodoFim) || prior.periodoFim,
    setor: cleanString(payload.setor) || prior.setor,
    funcao: cleanString(payload.funcao) || prior.funcao,
    investimento: normalizeNumber(payload.investimento) ?? prior.investimento,
    custo: normalizeNumber(payload.custo) ?? prior.custo,
    riscoInerente: normalizeNumber(payload.riscoInerente) ?? prior.riscoInerente,
    riscoResidual: normalizeNumber(payload.riscoResidual) ?? prior.riscoResidual,
    vencimentoAt: cleanString(payload.vencimentoAt) || prior.vencimentoAt,
    dadosSaudeSensiveis: Boolean(payload.dadosSaudeSensiveis ?? prior.dadosSaudeSensiveis),
    dadosEspecificos: validateSesmtSpecificData(moduleKey, payload.dadosEspecificos, prior.dadosEspecificos),
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean) : prior.tags || [],
    anexos: prior.anexos || [],
    evidencias: prior.evidencias || [],
    historico: prior.historico || [],
    origemVinculada: Array.isArray(payload.origemVinculada)
      ? payload.origemVinculada.map((item: any) => ({ tipo: String(item.tipo || ""), id: String(item.id || "") }))
      : prior.origemVinculada || [],
    createdAt: prior.createdAt || date,
    updatedAt: date,
    createdBy: prior.createdBy || userName,
    updatedBy: userName,
  };
}

function withModuleMetadata(record: SesmtRecord): SesmtRecord & { moduleLabel: string; moduleGroup: string } {
  const moduleDef = getSesmtModuleDefinition(record.moduleKey);
  return {
    ...record,
    moduleLabel: moduleDef?.label ?? record.moduleKey,
    moduleGroup: moduleDef?.groupLabel ?? "SESMT/SST",
  };
}

type DossieColaboradorStatus = "ATIVO" | "AFASTADO" | "FERIAS" | "DESLIGADO";

type DossieActor = {
  profile: string;
  userId: string;
  userName: string;
  colaboradorId: string;
};

type DossieColaboradorResumo = {
  id: string;
  nome: string;
  matricula: string;
  cpf: string;
  unidade: string;
  setor: string;
  cargo: string;
  funcao: string;
  gestor: string;
  dataAdmissao: string;
  status: DossieColaboradorStatus;
  grupoRisco?: string;
  situacaoOcupacional: string;
  scoreAtencao: number;
  alertas: string[];
};

type DossieCompleto = {
  colaborador: DossieColaboradorResumo;
  exames: Array<Record<string, unknown>>;
  asos: Array<Record<string, unknown>>;
  treinamentos: Array<Record<string, unknown>>;
  integracoes: Array<Record<string, unknown>>;
  atendimentos: Array<Record<string, unknown>>;
  vacinas: Array<Record<string, unknown>>;
  medicacoes: Array<Record<string, unknown>>;
  acidentes: Array<Record<string, unknown>>;
  afastamentos: Array<Record<string, unknown>>;
  atestados: Array<Record<string, unknown>>;
  restricoes: Array<Record<string, unknown>>;
  laudos: Array<Record<string, unknown>>;
  monitoramentos: Array<Record<string, unknown>>;
  epis: Array<Record<string, unknown>>;
  advertencias: Array<Record<string, unknown>>;
  comunicados: Array<Record<string, unknown>>;
  documentos: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  prontuarioResumido: Record<string, unknown>;
  alertas: string[];
  pendencias: string[];
};

function toDateOnly(value: unknown): string {
  const normalized = cleanString(value);
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toISOString().slice(0, 10);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "sim";
  }
  return false;
}

function normalizeCollaboratorStatus(value: unknown): DossieColaboradorStatus {
  const normalized = cleanString(value)?.toUpperCase();
  if (normalized === "ATIVO" || normalized === "AFASTADO" || normalized === "FERIAS" || normalized === "DESLIGADO") {
    return normalized;
  }
  return "ATIVO";
}

function safeStatus(value: unknown, fallback: string): string {
  const normalized = cleanString(value);
  return normalized ? normalized.toUpperCase() : fallback;
}

function buildDossieAlerts(input: {
  exames: Array<Record<string, unknown>>;
  asos: Array<Record<string, unknown>>;
  treinamentos: Array<Record<string, unknown>>;
  vacinas: Array<Record<string, unknown>>;
  afastamentos: Array<Record<string, unknown>>;
  restricoes: Array<Record<string, unknown>>;
}): string[] {
  const alertas: string[] = [];
  if (input.exames.some((row) => safeStatus(row.status, "") === "VENCIDO")) alertas.push("Exame vencido");
  if (input.exames.some((row) => safeStatus(row.status, "") === "PENDENTE")) alertas.push("Exame pendente");
  if (input.asos.some((row) => safeStatus(row.status, "") === "VENCIDO")) alertas.push("ASO vencido");
  if (input.asos.some((row) => safeStatus(row.status, "") === "PROXIMO_VENCIMENTO")) alertas.push("ASO próximo do vencimento");
  if (input.treinamentos.some((row) => safeStatus(row.status, "") === "VENCIDO")) alertas.push("Treinamento vencido");
  if (input.treinamentos.some((row) => safeStatus(row.status, "") === "PENDENTE")) alertas.push("Treinamento pendente");
  if (input.vacinas.some((row) => {
    const status = safeStatus(row.status, "");
    return status === "PENDENTE" || status === "ATRASADA";
  })) alertas.push("Pendência vacinal");
  if (input.afastamentos.some((row) => {
    const status = safeStatus(row.status, "");
    return status === "ATIVO" || status === "PRORROGADO";
  })) alertas.push("Afastamento ativo");
  if (input.restricoes.some((row) => safeStatus(row.status, "") === "ATIVA")) alertas.push("Restrição ocupacional ativa");
  return Array.from(new Set(alertas));
}

async function appendSesmtAuditEvent(input: {
  acao: string;
  entidade: string;
  entidadeId?: string;
  userId: string;
  userName: string;
  profile: string;
  detalhe: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  appendAudit(input.acao, input.entidade, input.entidadeId ?? "N/A", input.detalhe, input.userName);
  if (!isOracleEnabled()) return;
  try {
    await execDml(
      `INSERT INTO SESMT_LOG_AUDITORIA (
        ID, ACAO, ENTIDADE, ENTIDADE_ID, USUARIO_ID, USUARIO_NOME, PERFIL, DETALHE, PAYLOAD
      ) VALUES (
        :id, :acao, :entidade, :entidadeId, :usuarioId, :usuarioNome, :perfil, :detalhe, :payload
      )`,
      {
        id: `AUD-${Math.floor(Math.random() * 1_000_000_000)}`,
        acao: input.acao,
        entidade: input.entidade,
        entidadeId: input.entidadeId ?? null,
        usuarioId: input.userId,
        usuarioNome: input.userName,
        perfil: input.profile,
        detalhe: input.detalhe,
        payload: input.payload ? JSON.stringify(input.payload) : null,
      },
    );
  } catch {
    // Falha de auditoria nao deve derrubar o fluxo principal.
  }
}

async function loadOracleDossie(actor: DossieActor, allowedUnits: string[]): Promise<DossieCompleto | null> {
  const base = await queryOne<Record<string, unknown>>(
    `SELECT
      ID,
      MATRICULA,
      NOME,
      CPF,
      UNIDADE,
      SETOR,
      CARGO,
      FUNCAO,
      GESTOR,
      TO_CHAR(DATA_ADMISSAO, 'YYYY-MM-DD') AS DATA_ADMISSAO,
      STATUS,
      GRUPO_RISCO,
      SITUACAO_OCUPACIONAL,
      SCORE_ATENCAO
    FROM SESMT_COLABORADORES
    WHERE ID = :id`,
    { id: actor.colaboradorId },
  );

  if (!base) return null;
  const unidade = cleanString(base.UNIDADE) ?? "";
  if (!allowedUnits.includes(unidade)) {
    throw Object.assign(new Error("Colaborador fora do escopo de unidade deste perfil."), { statusCode: 403 });
  }

  const examesRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TIPO,
      TO_CHAR(DATA_EXAME, 'YYYY-MM-DD') AS DATA_EXAME,
      RESULTADO,
      STATUS,
      LABORATORIO,
      CUSTO,
      TO_CHAR(VALIDADE, 'YYYY-MM-DD') AS VALIDADE
    FROM SESMT_EXAMES
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_EXAME DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const asosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TIPO,
      TO_CHAR(DATA_ASO, 'YYYY-MM-DD') AS DATA_ASO,
      RESULTADO,
      MEDICO,
      TO_CHAR(VALIDADE, 'YYYY-MM-DD') AS VALIDADE,
      STATUS
    FROM SESMT_ASOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_ASO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const treinamentosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      NOME,
      TIPO,
      TO_CHAR(DATA_TREINAMENTO, 'YYYY-MM-DD') AS DATA_TREINAMENTO,
      CARGA_HORARIA,
      STATUS,
      TO_CHAR(VALIDADE, 'YYYY-MM-DD') AS VALIDADE,
      INSTRUTOR
    FROM SESMT_TREINAMENTOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_TREINAMENTO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const atendimentosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TO_CHAR(DATA_ATENDIMENTO, 'YYYY-MM-DD') AS DATA_ATENDIMENTO,
      TIPO,
      DESCRICAO,
      PROFISSIONAL,
      STATUS,
      CID,
      RESTRICAO
    FROM SESMT_ATENDIMENTOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_ATENDIMENTO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const vacinasRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      VACINA,
      DOSE,
      TO_CHAR(DATA_APLICACAO, 'YYYY-MM-DD') AS DATA_APLICACAO,
      STATUS,
      CAMPANHA,
      TO_CHAR(PROXIMA_DOSE, 'YYYY-MM-DD') AS PROXIMA_DOSE
    FROM SESMT_VACINAS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_APLICACAO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const medicacoesRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      MEDICAMENTO,
      TO_CHAR(DATA_REGISTRO, 'YYYY-MM-DD') AS DATA_REGISTRO,
      TIPO,
      QUANTIDADE,
      RESPONSAVEL
    FROM SESMT_MEDICACOES
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_REGISTRO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const acidentesRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TIPO,
      TO_CHAR(DATA_OCORRENCIA, 'YYYY-MM-DD') AS DATA_OCORRENCIA,
      DESCRICAO,
      NATUREZA_LESAO,
      CAUSA,
      DIAS_AFASTAMENTO,
      STATUS
    FROM SESMT_ACIDENTES
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_OCORRENCIA DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const afastamentosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TIPO,
      TO_CHAR(DATA_INICIO, 'YYYY-MM-DD') AS DATA_INICIO,
      TO_CHAR(DATA_FIM, 'YYYY-MM-DD') AS DATA_FIM,
      MOTIVO,
      CID,
      DIAS_AFASTADO,
      STATUS
    FROM SESMT_AFASTAMENTOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_INICIO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const atestadosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TO_CHAR(DATA_ATESTADO, 'YYYY-MM-DD') AS DATA_ATESTADO,
      DIAS,
      CID,
      MEDICO,
      STATUS
    FROM SESMT_ATESTADOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_ATESTADO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const restricoesRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      DESCRICAO,
      TO_CHAR(DATA_INICIO, 'YYYY-MM-DD') AS DATA_INICIO,
      TO_CHAR(DATA_FIM, 'YYYY-MM-DD') AS DATA_FIM,
      STATUS
    FROM SESMT_RESTRICOES
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_INICIO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const episRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      DESCRICAO,
      CA,
      TO_CHAR(DATA_ENTREGA, 'YYYY-MM-DD') AS DATA_ENTREGA,
      TO_CHAR(DATA_DEVOLUCAO, 'YYYY-MM-DD') AS DATA_DEVOLUCAO,
      MOTIVO,
      ASSINATURA
    FROM SESMT_EPI_ENTREGAS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_ENTREGA DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const comunicadosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TITULO,
      TIPO,
      TO_CHAR(DATA_REGISTRO, 'YYYY-MM-DD') AS DATA_REGISTRO,
      STATUS
    FROM SESMT_COMUNICADOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_REGISTRO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  const documentosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      NOME,
      TIPO,
      TO_CHAR(DATA_DOCUMENTO, 'YYYY-MM-DD') AS DATA_DOCUMENTO,
      MIME_TYPE,
      TAMANHO_BYTES
    FROM SESMT_DOCUMENTOS
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_DOCUMENTO DESC NULLS LAST, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  let laudosRows = await queryRows<Record<string, unknown>>(
    `SELECT
      l.ID,
      l.TIPO,
      COALESCE(l.TITULO, l.CODIGO, l.ID) AS TITULO,
      TO_CHAR(l.DATA_EMISSAO, 'YYYY-MM-DD') AS DATA_EMISSAO,
      TO_CHAR(l.DATA_VALIDADE, 'YYYY-MM-DD') AS DATA_VALIDADE
    FROM SESMT_LAUDOS l
    JOIN SESMT_LAUDOS_VINCULOS v ON v.LAUDO_ID = l.ID
    WHERE v.TIPO_VINCULO = 'COLABORADOR'
      AND v.ENTIDADE_ID = :id
    ORDER BY l.DATA_EMISSAO DESC NULLS LAST, l.CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  if (laudosRows.length === 0) {
    laudosRows = await queryRows<Record<string, unknown>>(
      `SELECT
        ID,
        TIPO,
        COALESCE(TITULO, CODIGO, ID) AS TITULO,
        TO_CHAR(DATA_EMISSAO, 'YYYY-MM-DD') AS DATA_EMISSAO,
        TO_CHAR(DATA_VALIDADE, 'YYYY-MM-DD') AS DATA_VALIDADE
      FROM SESMT_LAUDOS
      WHERE UNIDADE = :unidade
      ORDER BY DATA_EMISSAO DESC NULLS LAST, CREATED_AT DESC`,
      { unidade },
    );
  }

  let timelineRows = await queryRows<Record<string, unknown>>(
    `SELECT
      ID,
      TO_CHAR(DATA_EVENTO, 'YYYY-MM-DD') AS DATA_EVENTO,
      TIPO,
      TITULO,
      DESCRICAO,
      COR
    FROM SESMT_EVENTOS_COLABORADOR
    WHERE COLABORADOR_ID = :id
    ORDER BY DATA_EVENTO DESC, CREATED_AT DESC`,
    { id: actor.colaboradorId },
  );

  if (timelineRows.length === 0) {
    timelineRows = [
      ...examesRows.map((row) => ({
        ID: row.ID,
        DATA_EVENTO: row.DATA_EXAME,
        TIPO: "EXAME",
        TITULO: `Exame ${cleanString(row.TIPO) ?? ""}`,
        DESCRICAO: cleanString(row.RESULTADO) ?? "Exame ocupacional registrado.",
        COR: "success",
      })),
      ...treinamentosRows.map((row) => ({
        ID: row.ID,
        DATA_EVENTO: row.DATA_TREINAMENTO,
        TIPO: "TREINAMENTO",
        TITULO: cleanString(row.NOME) ?? "Treinamento",
        DESCRICAO: `Status: ${safeStatus(row.STATUS, "EM_ANDAMENTO")}`,
        COR: safeStatus(row.STATUS, "") === "CONCLUIDO" ? "success" : "warning",
      })),
    ].sort((a, b) => String(b.DATA_EVENTO ?? "").localeCompare(String(a.DATA_EVENTO ?? "")));
  }

  const exames = examesRows.map((row) => ({
    id: String(row.ID),
    tipo: cleanString(row.TIPO) ?? "Exame",
    data: toDateOnly(row.DATA_EXAME),
    resultado: cleanString(row.RESULTADO) ?? "",
    status: safeStatus(row.STATUS, "PENDENTE"),
    laboratorio: cleanString(row.LABORATORIO) ?? undefined,
    custo: asNumber(row.CUSTO, 0) || undefined,
    validade: toDateOnly(row.VALIDADE) || undefined,
  }));

  const asos = asosRows.map((row) => ({
    id: String(row.ID),
    tipo: safeStatus(row.TIPO, "PERIODICO"),
    data: toDateOnly(row.DATA_ASO),
    resultado: safeStatus(row.RESULTADO, "APTO"),
    medico: cleanString(row.MEDICO) ?? "",
    validade: toDateOnly(row.VALIDADE),
    status: safeStatus(row.STATUS, "VIGENTE"),
  }));

  const treinamentos = treinamentosRows.map((row) => ({
    id: String(row.ID),
    nome: cleanString(row.NOME) ?? "Treinamento",
    tipo: safeStatus(row.TIPO, "ESPECIFICO"),
    data: toDateOnly(row.DATA_TREINAMENTO),
    cargaHoraria: asNumber(row.CARGA_HORARIA, 0),
    status: safeStatus(row.STATUS, "EM_ANDAMENTO"),
    certificado: safeStatus(row.STATUS, "") === "CONCLUIDO",
    validade: toDateOnly(row.VALIDADE) || undefined,
    instrutor: cleanString(row.INSTRUTOR) ?? undefined,
  }));

  const integracoes = treinamentos.filter((row) => safeStatus(row.tipo, "") === "INTEGRACAO");

  const atendimentos = atendimentosRows.map((row) => ({
    id: String(row.ID),
    data: toDateOnly(row.DATA_ATENDIMENTO),
    tipo: cleanString(row.TIPO) ?? "Atendimento",
    descricao: cleanString(row.DESCRICAO) ?? "",
    profissional: cleanString(row.PROFISSIONAL) ?? "",
    status: safeStatus(row.STATUS, "CONCLUIDO"),
    cid: cleanString(row.CID) ?? undefined,
    restricao: cleanString(row.RESTRICAO) ?? undefined,
  }));

  const vacinas = vacinasRows.map((row) => ({
    id: String(row.ID),
    vacina: cleanString(row.VACINA) ?? "Vacina",
    dose: cleanString(row.DOSE) ?? "",
    data: toDateOnly(row.DATA_APLICACAO),
    status: safeStatus(row.STATUS, "PENDENTE"),
    campanha: cleanString(row.CAMPANHA) ?? undefined,
    proximaDose: toDateOnly(row.PROXIMA_DOSE) || undefined,
  }));

  const medicacoes = medicacoesRows.map((row) => ({
    id: String(row.ID),
    medicamento: cleanString(row.MEDICAMENTO) ?? "",
    data: toDateOnly(row.DATA_REGISTRO),
    tipo: safeStatus(row.TIPO, "DISPENSACAO"),
    quantidade: asNumber(row.QUANTIDADE, 0),
    responsavel: cleanString(row.RESPONSAVEL) ?? "",
  }));

  const acidentes = acidentesRows.map((row) => ({
    id: String(row.ID),
    tipo: safeStatus(row.TIPO, "INCIDENTE"),
    data: toDateOnly(row.DATA_OCORRENCIA),
    descricao: cleanString(row.DESCRICAO) ?? "",
    naturezaLesao: cleanString(row.NATUREZA_LESAO) ?? undefined,
    causa: cleanString(row.CAUSA) ?? undefined,
    diasAfastamento: asNumber(row.DIAS_AFASTAMENTO, 0),
    status: safeStatus(row.STATUS, "EM_INVESTIGACAO"),
  }));

  const afastamentos = afastamentosRows.map((row) => ({
    id: String(row.ID),
    tipo: cleanString(row.TIPO) ?? "Afastamento",
    dataInicio: toDateOnly(row.DATA_INICIO),
    dataFim: toDateOnly(row.DATA_FIM) || undefined,
    motivo: cleanString(row.MOTIVO) ?? "",
    cid: cleanString(row.CID) ?? undefined,
    diasAfastado: asNumber(row.DIAS_AFASTADO, 0),
    status: safeStatus(row.STATUS, "ATIVO"),
  }));

  const atestados = atestadosRows.map((row) => ({
    id: String(row.ID),
    data: toDateOnly(row.DATA_ATESTADO),
    dias: asNumber(row.DIAS, 0),
    cid: cleanString(row.CID) ?? undefined,
    medico: cleanString(row.MEDICO) ?? "",
    status: safeStatus(row.STATUS, "ACEITO"),
  }));

  const restricoes = restricoesRows.map((row) => ({
    id: String(row.ID),
    descricao: cleanString(row.DESCRICAO) ?? "",
    dataInicio: toDateOnly(row.DATA_INICIO),
    dataFim: toDateOnly(row.DATA_FIM) || undefined,
    status: safeStatus(row.STATUS, "ATIVA"),
  }));

  const laudos = laudosRows.map((row) => ({
    id: String(row.ID),
    tipo: cleanString(row.TIPO) ?? "LAUDO",
    descricao: cleanString(row.TITULO) ?? String(row.ID),
    data: toDateOnly(row.DATA_EMISSAO),
    vigencia: toDateOnly(row.DATA_VALIDADE) || undefined,
  }));

  const epis = episRows.map((row) => ({
    id: String(row.ID),
    descricao: cleanString(row.DESCRICAO) ?? "",
    ca: cleanString(row.CA) ?? "",
    dataEntrega: toDateOnly(row.DATA_ENTREGA),
    dataDevolucao: toDateOnly(row.DATA_DEVOLUCAO) || undefined,
    motivo: safeStatus(row.MOTIVO, "ENTREGA"),
    assinatura: toBoolean(row.ASSINATURA),
  }));

  const comunicados = comunicadosRows.map((row) => ({
    id: String(row.ID),
    titulo: cleanString(row.TITULO) ?? "",
    tipo: safeStatus(row.TIPO, "COMUNICADO"),
    data: toDateOnly(row.DATA_REGISTRO),
    status: safeStatus(row.STATUS, "LIDO"),
  }));

  const advertencias = comunicados
    .filter((row) => safeStatus(row.tipo, "").includes("ADVERTENCIA"))
    .map((row) => ({
      id: row.id,
      data: row.data,
      tipo: row.tipo,
      descricao: row.titulo,
      responsavel: cleanString(base.GESTOR) ?? "SESMT",
    }));

  const documentos = documentosRows.map((row) => ({
    id: String(row.ID),
    nome: cleanString(row.NOME) ?? "",
    tipo: cleanString(row.TIPO) ?? "DOCUMENTO",
    data: toDateOnly(row.DATA_DOCUMENTO),
    mimeType: cleanString(row.MIME_TYPE) ?? undefined,
    tamanho: row.TAMANHO_BYTES != null ? `${asNumber(row.TAMANHO_BYTES, 0)} bytes` : undefined,
  }));

  const timeline = timelineRows.map((row) => ({
    id: String(row.ID),
    data: toDateOnly(row.DATA_EVENTO),
    tipo: cleanString(row.TIPO) ?? "EVENTO",
    titulo: cleanString(row.TITULO) ?? "Evento",
    descricao: cleanString(row.DESCRICAO) ?? "",
    cor: cleanString(row.COR) ?? "info",
  }));

  const alertas = buildDossieAlerts({ exames, asos, treinamentos, vacinas, afastamentos, restricoes });
  const pendencias = alertas;

  const colaborador: DossieColaboradorResumo = {
    id: String(base.ID),
    nome: cleanString(base.NOME) ?? "",
    matricula: cleanString(base.MATRICULA) ?? "",
    cpf: cleanString(base.CPF) ?? "",
    unidade,
    setor: cleanString(base.SETOR) ?? "",
    cargo: cleanString(base.CARGO) ?? "",
    funcao: cleanString(base.FUNCAO) ?? "",
    gestor: cleanString(base.GESTOR) ?? "",
    dataAdmissao: toDateOnly(base.DATA_ADMISSAO),
    status: normalizeCollaboratorStatus(base.STATUS),
    grupoRisco: cleanString(base.GRUPO_RISCO) ?? undefined,
    situacaoOcupacional: cleanString(base.SITUACAO_OCUPACIONAL) ?? "Regular",
    scoreAtencao: asNumber(base.SCORE_ATENCAO, 0),
    alertas,
  };

  return {
    colaborador,
    exames,
    asos,
    treinamentos,
    integracoes,
    atendimentos,
    vacinas,
    medicacoes,
    acidentes,
    afastamentos,
    atestados,
    restricoes,
    laudos,
    monitoramentos: exames.filter((row) => safeStatus(row.status, "") === "PENDENTE"),
    epis,
    advertencias,
    comunicados,
    documentos,
    timeline,
    prontuarioResumido: {
      ultimoAso: asos[0]?.data ?? null,
      ultimoExame: exames[0]?.data ?? null,
      ultimoAtendimento: atendimentos[0]?.data ?? null,
      restricoesAtivas: restricoes.filter((row) => safeStatus(row.status, "") === "ATIVA").length,
    },
    alertas,
    pendencias,
  };
}

function buildFallbackDossie(actor: DossieActor, allowedUnits: string[]): DossieCompleto | null {
  const store = ensureStore();
  const colaboradores = Array.isArray(store.colaboradores) ? (store.colaboradores as Array<Record<string, unknown>>) : [];
  const colaboradorSeed = colaboradores.find((item) => String(item.id) === actor.colaboradorId);
  if (!colaboradorSeed) return null;
  const unidade = cleanString(colaboradorSeed.unidade) ?? "MAO";
  if (!allowedUnits.includes(unidade)) {
    throw Object.assign(new Error("Colaborador fora do escopo de unidade deste perfil."), { statusCode: 403 });
  }

  const registros = Array.isArray(store.registros) ? (store.registros as SesmtRecord[]) : [];
  const related = registros.filter((row) => row.unidade === unidade);
  const exames = related
    .filter((row) => row.moduleKey === "exames" || row.moduleKey === "saude-ocupacional")
    .map((row) => ({
      id: row.id,
      tipo: row.titulo,
      data: toDateOnly(row.createdAt),
      resultado: row.descricao || "",
      status: safeStatus(row.status, "PENDENTE"),
      laboratorio: undefined,
      validade: row.vencimentoAt,
    }));

  const treinamentos = related
    .filter((row) => row.moduleKey === "treinamentos-e-integracao")
    .map((row) => ({
      id: row.id,
      nome: row.titulo,
      tipo: "ESPECIFICO",
      data: toDateOnly(row.createdAt),
      cargaHoraria: 8,
      status: safeStatus(row.status, "EM_ANDAMENTO"),
      certificado: row.status === "CONCLUIDO",
      validade: row.vencimentoAt,
      instrutor: row.responsavel,
    }));

  const timeline = related.slice(0, 20).map((row) => ({
    id: row.id,
    data: toDateOnly(row.updatedAt || row.createdAt),
    tipo: row.moduleKey.toUpperCase(),
    titulo: row.titulo,
    descricao: row.descricao || "",
    cor: row.status === "CONCLUIDO" ? "success" : "info",
  }));

  const colaborador: DossieColaboradorResumo = {
    id: String(colaboradorSeed.id),
    nome: cleanString(colaboradorSeed.nome) ?? "Colaborador",
    matricula: cleanString(colaboradorSeed.matricula) ?? `MAT-${String(colaboradorSeed.id).replace(/\D/g, "").padStart(4, "0")}`,
    cpf: cleanString(colaboradorSeed.cpf) ?? "",
    unidade,
    setor: cleanString(colaboradorSeed.setor) ?? "",
    cargo: cleanString(colaboradorSeed.cargo) ?? "Colaborador",
    funcao: cleanString(colaboradorSeed.funcao) ?? "Colaborador",
    gestor: cleanString(colaboradorSeed.gestor) ?? "SESMT",
    dataAdmissao: toDateOnly(colaboradorSeed.dataAdmissao),
    status: normalizeCollaboratorStatus(colaboradorSeed.status),
    grupoRisco: cleanString(colaboradorSeed.grupoRisco) ?? undefined,
    situacaoOcupacional: cleanString(colaboradorSeed.situacaoOcupacional) ?? "Regular",
    scoreAtencao: asNumber(colaboradorSeed.scoreAtencao, 75),
    alertas: [],
  };

  const emptyArray: Array<Record<string, unknown>> = [];
  const alertas = buildDossieAlerts({
    exames,
    asos: emptyArray,
    treinamentos,
    vacinas: emptyArray,
    afastamentos: emptyArray,
    restricoes: emptyArray,
  });
  colaborador.alertas = alertas;

  return {
    colaborador,
    exames,
    asos: emptyArray,
    treinamentos,
    integracoes: treinamentos.filter((row) => safeStatus(row.tipo, "") === "INTEGRACAO"),
    atendimentos: emptyArray,
    vacinas: emptyArray,
    medicacoes: emptyArray,
    acidentes: emptyArray,
    afastamentos: emptyArray,
    atestados: emptyArray,
    restricoes: emptyArray,
    laudos: emptyArray,
    monitoramentos: exames.filter((row) => safeStatus(row.status, "") === "PENDENTE"),
    epis: emptyArray,
    advertencias: emptyArray,
    comunicados: emptyArray,
    documentos: emptyArray,
    timeline,
    prontuarioResumido: {
      ultimoAso: null,
      ultimoExame: exames[0]?.data ?? null,
      ultimoAtendimento: null,
      restricoesAtivas: 0,
    },
    alertas,
    pendencias: alertas,
  };
}

async function resolveDossie(actor: DossieActor): Promise<DossieCompleto | null> {
  const allowedUnits = getAllowedUnits(actor.profile, actor.userId);
  if (isOracleEnabled()) {
    return loadOracleDossie(actor, allowedUnits);
  }
  return buildFallbackDossie(actor, allowedUnits);
}
export const sesmtRepo = {
  listMenu(profile: string) {
    assertRead(profile);
    return SESMT_MENU_TREE.map((group) => ({
      ...group,
      children: group.children.filter((child) => {
        const moduleDef = getSesmtModuleDefinition(child.key);
        if (!moduleDef) return true;
        if (moduleDef.visibility === "SENSITIVE_HEALTH" && !SENSITIVE_HEALTH_READ_PROFILES.has(profile)) {
          return false;
        }
        return true;
      }),
    }));
  },

  listModuleDefinitions(profile: string) {
    assertRead(profile);
    return SESMT_MODULE_DEFINITIONS.filter((item) => {
      if (item.visibility === "SENSITIVE_HEALTH") {
        return SENSITIVE_HEALTH_READ_PROFILES.has(profile);
      }
      return true;
    });
  },

  listExecutiveViews(profile: string) {
    assertRead(profile);
    return SESMT_EXECUTIVE_VIEWS.filter((item) => {
      if ((item as any).visibility === "SENSITIVE_HEALTH") {
        return SENSITIVE_HEALTH_READ_PROFILES.has(profile);
      }
      return true;
    });
  },

  getLookups(profile: string, userId: string) {
    assertRead(profile);
    const store = ensureStore();
    const allowedUnits = getAllowedUnits(profile, userId);
    return {
      unidades: (store.unidades as any[]).filter((unit) => allowedUnits.includes(unit.codigo)),
      setores: (store.setores as any[]).filter((setor) => allowedUnits.includes(setor.unidade)),
      cargos: store.cargos,
      funcoes: store.funcoes,
      colaboradores: (store.colaboradores as any[]).filter((col) => allowedUnits.includes(col.unidade)),
      profissionaisSesmt: (store.profissionaisSesmt as any[]).filter((prof) => allowedUnits.includes(prof.unidade)),
      fornecedoresLaboratorios: store.fornecedoresLaboratorios ?? [],
      cadastrosAuxiliares: store.cadastrosAuxiliares ?? [],
      allowedUnits,
    };
  },

  listRecords(input: {
    profile: string;
    userId: string;
    userName: string;
    moduleKey: string;
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    unidade?: string;
    responsavel?: string;
    criticidade?: string;
    nr?: string;
    periodStart?: string;
    periodEnd?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    specificFilters?: Record<string, string>;
  }): SesmtRecordListResult {
    assertRead(input.profile);

    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) {
      throw Object.assign(new Error("Submodulo SESMT/SST nao encontrado."), { statusCode: 404 });
    }

    if (moduleDef.visibility === "SENSITIVE_HEALTH") {
      assertSensitiveRead(input.profile, moduleDef.key, input.userName);
    }

    if (input.sortBy?.startsWith("specific:")) {
      validateSpecificFieldKey(input.moduleKey, input.sortBy.slice("specific:".length));
    }

    if (input.specificFilters && Object.keys(input.specificFilters).length > 0) {
      Object.keys(input.specificFilters).forEach((fieldKey) => validateSpecificFieldKey(input.moduleKey, fieldKey));
    }

    const store = ensureStore();
    const allowedUnits = getAllowedUnits(input.profile, input.userId);
    let records = (store.registros as SesmtRecord[]).filter((record) => record.moduleKey === input.moduleKey);
    records = applyUnitFilter(records, allowedUnits);

    if (input.unidade) records = records.filter((record) => record.unidade === input.unidade);
    if (input.status) records = records.filter((record) => record.status === input.status);
    if (input.responsavel) {
      const normalized = input.responsavel.toLowerCase();
      records = records.filter((record) => record.responsavel.toLowerCase().includes(normalized));
    }
    if (input.criticidade) records = records.filter((record) => record.criticidade === input.criticidade);
    if (input.nr) records = records.filter((record) => record.nr === input.nr);

    if (input.periodStart) records = records.filter((record) => !record.periodoInicio || record.periodoInicio >= input.periodStart!);
    if (input.periodEnd) records = records.filter((record) => !record.periodoFim || record.periodoFim <= input.periodEnd!);

    if (input.search?.trim()) {
      const normalized = input.search.trim().toLowerCase();
      records = records.filter((record) => [record.titulo, record.descricao, record.responsavel, record.setor, record.funcao]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(normalized)));
    }

    if (input.specificFilters && Object.keys(input.specificFilters).length > 0) {
      const filters = Object.entries(input.specificFilters)
        .map(([key, value]) => [key, String(value).trim().toLowerCase()] as const)
        .filter(([, value]) => value.length > 0);

      if (filters.length > 0) {
        records = records.filter((record) => filters.every(([fieldKey, expected]) => {
          const value = record.dadosEspecificos?.[fieldKey];
          if (value == null) return false;
          return String(value).toLowerCase().includes(expected);
        }));
      }
    }

    records = sortRecords(records, input.sortBy, input.sortDir);

    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(Math.max(1, input.limit ?? 20), 100);
    const start = (page - 1) * limit;

    return {
      page,
      limit,
      total: records.length,
      items: records.slice(start, start + limit).map(withModuleMetadata),
    };
  },

  getRecordById(input: { profile: string; userId: string; userName: string; moduleKey: string; id: string }) {
    assertRead(input.profile);
    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) throw Object.assign(new Error("Submodulo nao encontrado."), { statusCode: 404 });

    if (moduleDef.visibility === "SENSITIVE_HEALTH") {
      assertSensitiveRead(input.profile, moduleDef.key, input.userName);
    }

    const store = ensureStore();
    const allowedUnits = getAllowedUnits(input.profile, input.userId);
    const record = (store.registros as SesmtRecord[]).find((item) => item.moduleKey === input.moduleKey && item.id === input.id);
    if (!record) throw Object.assign(new Error("Registro nao encontrado."), { statusCode: 404 });
    if (!allowedUnits.includes(record.unidade)) {
      throw Object.assign(new Error("Registro fora do escopo de unidade deste perfil."), { statusCode: 403 });
    }

    return withModuleMetadata(record);
  },

  createRecord(input: { profile: string; userId: string; userName: string; moduleKey: string; payload: any }) {
    assertRead(input.profile);
    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) throw Object.assign(new Error("Submodulo nao encontrado."), { statusCode: 404 });

    const isSensitive = moduleDef.visibility === "SENSITIVE_HEALTH" || Boolean(input.payload?.dadosSaudeSensiveis);
    if (isSensitive && !SENSITIVE_HEALTH_READ_PROFILES.has(input.profile)) {
      throw Object.assign(new Error("Perfil sem acesso ao contexto de saude ocupacional."), { statusCode: 403 });
    }
    assertWrite(input.profile, isSensitive);

    const unit = cleanString(input.payload?.unidade) || "MAO";
    const allowedUnits = getAllowedUnits(input.profile, input.userId);
    if (!allowedUnits.includes(unit)) {
      throw Object.assign(new Error("Nao e permitido criar registros fora da unidade do perfil."), { statusCode: 403 });
    }

    const store = ensureStore();
    const record = mapRecordInput(input.moduleKey, input.payload, input.userName);
    record.historico.unshift(buildHistoryEntry("CRIADO", "Registro criado no modulo SESMT/SST.", input.userName));

    (store.registros as SesmtRecord[]).unshift(record);
    if (Array.isArray((store as any)[moduleDef.collectionKey])) {
      (store as any)[moduleDef.collectionKey].unshift(record);
    }

    appendAudit("CRIAR", "SESMT_REGISTRO", record.id, `Criado em ${moduleDef.label}`, input.userName);
    return withModuleMetadata(record);
  },

  updateRecord(input: {
    profile: string;
    userId: string;
    userName: string;
    moduleKey: string;
    id: string;
    payload: any;
  }) {
    assertRead(input.profile);
    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) throw Object.assign(new Error("Submodulo nao encontrado."), { statusCode: 404 });

    const store = ensureStore();
    const list = store.registros as SesmtRecord[];
    const idx = list.findIndex((item) => item.moduleKey === input.moduleKey && item.id === input.id);
    if (idx < 0) throw Object.assign(new Error("Registro nao encontrado."), { statusCode: 404 });

    const existing = list[idx];
    const allowedUnits = getAllowedUnits(input.profile, input.userId);
    if (!allowedUnits.includes(existing.unidade)) {
      throw Object.assign(new Error("Registro fora do escopo de unidade deste perfil."), { statusCode: 403 });
    }

    const isSensitive = Boolean(moduleDef.visibility === "SENSITIVE_HEALTH" || existing.dadosSaudeSensiveis);
    if (isSensitive && !SENSITIVE_HEALTH_READ_PROFILES.has(input.profile)) {
      throw Object.assign(new Error("Perfil sem acesso ao contexto de saude ocupacional."), { statusCode: 403 });
    }
    assertWrite(input.profile, isSensitive);

    const next = mapRecordInput(input.moduleKey, input.payload, input.userName, existing);
    next.historico = [
      buildHistoryEntry("ATUALIZADO", "Registro atualizado no modulo SESMT/SST.", input.userName),
      ...(existing.historico || []),
    ];

    list[idx] = next;
    if (Array.isArray((store as any)[moduleDef.collectionKey])) {
      const moduleList = (store as any)[moduleDef.collectionKey] as SesmtRecord[];
      const moduleIdx = moduleList.findIndex((item) => item.id === input.id);
      if (moduleIdx >= 0) moduleList[moduleIdx] = next;
    }

    appendAudit("ATUALIZAR", "SESMT_REGISTRO", input.id, `Atualizado em ${moduleDef.label}`, input.userName);
    return withModuleMetadata(next);
  },

  getFavoritePreset(input: { profile: string; userId: string; moduleKey: string }) {
    assertRead(input.profile);
    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) throw Object.assign(new Error("Submodulo nao encontrado."), { statusCode: 404 });
    if (moduleDef.visibility === "SENSITIVE_HEALTH" && !SENSITIVE_HEALTH_READ_PROFILES.has(input.profile)) {
      throw Object.assign(new Error("Perfil sem acesso ao submodulo sensivel."), { statusCode: 403 });
    }

    const store = ensureStore();
    const favorite = (store.favoritePresets as SesmtFavoritePreset[])
      .find((item) => item.userId === input.userId && item.moduleKey === input.moduleKey);

    if (!favorite) return { favoritePreset: null };

    return {
      favoritePreset: {
        moduleKey: favorite.moduleKey,
        presetKey: favorite.presetKey,
        status: favorite.status,
        criticidade: favorite.criticidade,
        unidade: favorite.unidade,
        sortBy: favorite.sortBy,
        sortDir: favorite.sortDir,
        specificFilters: favorite.specificFilters,
        updatedAt: favorite.updatedAt,
        updatedBy: favorite.updatedBy,
      },
    };
  },

  saveFavoritePreset(input: {
    profile: string;
    userId: string;
    userName: string;
    moduleKey: string;
    payload: {
      presetKey?: unknown;
      status?: unknown;
      criticidade?: unknown;
      unidade?: unknown;
      sortBy?: unknown;
      sortDir?: unknown;
      specificFilters?: unknown;
      clear?: boolean;
    };
  }) {
    assertRead(input.profile);
    const moduleDef = getSesmtModuleDefinition(input.moduleKey);
    if (!moduleDef) throw Object.assign(new Error("Submodulo nao encontrado."), { statusCode: 404 });
    if (moduleDef.visibility === "SENSITIVE_HEALTH" && !SENSITIVE_HEALTH_READ_PROFILES.has(input.profile)) {
      throw Object.assign(new Error("Perfil sem acesso ao submodulo sensivel."), { statusCode: 403 });
    }

    const specificFilters = normalizeSpecificFilters(input.payload?.specificFilters);
    if (specificFilters) {
      Object.keys(specificFilters).forEach((fieldKey) => validateSpecificFieldKey(input.moduleKey, fieldKey));
    }

    const sortByRaw = cleanString(input.payload?.sortBy) || "updatedAt";
    if (sortByRaw.startsWith("specific:")) {
      validateSpecificFieldKey(input.moduleKey, sortByRaw.slice("specific:".length));
    }

    const store = ensureStore();
    const list = store.favoritePresets as SesmtFavoritePreset[];
    const index = list.findIndex((item) => item.userId === input.userId && item.moduleKey === input.moduleKey);

    if (Boolean(input.payload?.clear)) {
      if (index >= 0) list.splice(index, 1);
      appendAudit("REMOVER", "SESMT_PRESET_FAVORITO", input.moduleKey, `Favorito removido em ${moduleDef.label}`, input.userName);
      return { favoritePreset: null };
    }

    const timestamp = nowIso();
    const prior = index >= 0 ? list[index] : undefined;

    const favorite: SesmtFavoritePreset = {
      userId: input.userId,
      moduleKey: input.moduleKey,
      presetKey: cleanString(input.payload?.presetKey) ?? null,
      status: cleanString(input.payload?.status),
      criticidade: cleanString(input.payload?.criticidade),
      unidade: cleanString(input.payload?.unidade),
      sortBy: sortByRaw || prior?.sortBy || "updatedAt",
      sortDir: normalizeSortDir(input.payload?.sortDir, prior?.sortDir || "desc"),
      specificFilters,
      createdAt: prior?.createdAt || timestamp,
      updatedAt: timestamp,
      createdBy: prior?.createdBy || input.userName,
      updatedBy: input.userName,
    };

    if (index >= 0) {
      list[index] = favorite;
    } else {
      list.unshift(favorite);
    }

    appendAudit("ATUALIZAR", "SESMT_PRESET_FAVORITO", input.moduleKey, `Favorito salvo em ${moduleDef.label}`, input.userName);
    return {
      favoritePreset: {
        moduleKey: favorite.moduleKey,
        presetKey: favorite.presetKey,
        status: favorite.status,
        criticidade: favorite.criticidade,
        unidade: favorite.unidade,
        sortBy: favorite.sortBy,
        sortDir: favorite.sortDir,
        specificFilters: favorite.specificFilters,
        updatedAt: favorite.updatedAt,
        updatedBy: favorite.updatedBy,
      },
    };
  },
  addEvidence(input: {
    profile: string;
    userId: string;
    userName: string;
    moduleKey: string;
    id: string;
    payload: {
      descricao: string;
      tipo?: string;
      data?: string;
      responsavel?: string;
      anexoId?: string;
    };
  }) {
    const record = sesmtRepo.getRecordById({
      profile: input.profile,
      userId: input.userId,
      userName: input.userName,
      moduleKey: input.moduleKey,
      id: input.id,
    });

    const moduleDef = getSesmtModuleDefinition(input.moduleKey)!;
    const isSensitive = Boolean(moduleDef.visibility === "SENSITIVE_HEALTH" || record.dadosSaudeSensiveis);
    assertWrite(input.profile, isSensitive);

    const evidence: SesmtEvidence = {
      id: `EVD-${Math.floor(Math.random() * 1_000_000)}`,
      descricao: cleanString(input.payload.descricao) || "Evidencia registrada",
      tipo: cleanString(input.payload.tipo) || "EVIDENCIA",
      data: cleanString(input.payload.data) || nowIso().slice(0, 10),
      responsavel: cleanString(input.payload.responsavel) || input.userName,
      anexoId: cleanString(input.payload.anexoId),
      criadoAt: nowIso(),
      criadoPor: input.userName,
    };

    const store = ensureStore();
    const list = store.registros as SesmtRecord[];
    const idx = list.findIndex((item) => item.id === input.id && item.moduleKey === input.moduleKey);
    if (idx < 0) throw Object.assign(new Error("Registro nao encontrado."), { statusCode: 404 });

    list[idx].evidencias = [evidence, ...(list[idx].evidencias || [])];
    list[idx].historico = [
      buildHistoryEntry("EVIDENCIA", `Evidencia adicionada: ${evidence.descricao}`, input.userName),
      ...(list[idx].historico || []),
    ];
    list[idx].updatedAt = nowIso();
    list[idx].updatedBy = input.userName;

    appendAudit("CRIAR", "SESMT_EVIDENCIA", input.id, `Evidencia adicionada em ${moduleDef.label}`, input.userName);
    return list[idx];
  },

  addAttachmentMetadata(input: {
    profile: string;
    userId: string;
    userName: string;
    moduleKey: string;
    id: string;
    attachment: Omit<SesmtAttachment, "id" | "criadoAt" | "criadoPor">;
  }) {
    const record = sesmtRepo.getRecordById({
      profile: input.profile,
      userId: input.userId,
      userName: input.userName,
      moduleKey: input.moduleKey,
      id: input.id,
    });

    const moduleDef = getSesmtModuleDefinition(input.moduleKey)!;
    const isSensitive = Boolean(moduleDef.visibility === "SENSITIVE_HEALTH" || record.dadosSaudeSensiveis);
    assertWrite(input.profile, isSensitive);

    const attachment: SesmtAttachment = {
      id: `ANX-${Math.floor(Math.random() * 1_000_000)}`,
      ...input.attachment,
      criadoAt: nowIso(),
      criadoPor: input.userName,
    };

    const store = ensureStore();
    const list = store.registros as SesmtRecord[];
    const idx = list.findIndex((item) => item.id === input.id && item.moduleKey === input.moduleKey);
    if (idx < 0) throw Object.assign(new Error("Registro nao encontrado."), { statusCode: 404 });

    list[idx].anexos = [attachment, ...(list[idx].anexos || [])];
    list[idx].historico = [
      buildHistoryEntry("ANEXO", `Anexo adicionado: ${attachment.nomeArquivo}`, input.userName),
      ...(list[idx].historico || []),
    ];
    list[idx].updatedAt = nowIso();
    list[idx].updatedBy = input.userName;

    appendAudit("UPLOAD", "SESMT_ANEXO", input.id, `Anexo ${attachment.nomeArquivo} em ${moduleDef.label}`, input.userName);
    return attachment;
  },

  getMasterDashboard(profile: string, userId: string, userName: string, filters?: { unidade?: string; periodStart?: string; periodEnd?: string }) {
    assertRead(profile);

    const store = ensureStore();
    const allowedUnits = getAllowedUnits(profile, userId);
    const filterUnit = cleanString(filters?.unidade);

    let records = applyUnitFilter(store.registros as SesmtRecord[], allowedUnits);
    if (filterUnit) records = records.filter((record) => record.unidade === filterUnit);

    if (filters?.periodStart) records = records.filter((record) => !record.createdAt || record.createdAt.slice(0, 10) >= filters.periodStart!);
    if (filters?.periodEnd) records = records.filter((record) => !record.createdAt || record.createdAt.slice(0, 10) <= filters.periodEnd!);

    const now = new Date();
    const in60Days = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);

    const concluido = records.filter((item) => item.status === "CONCLUIDO").length;
    const scoreGeral = records.length > 0 ? Number(((concluido / records.length) * 100).toFixed(1)) : 0;

    const documentosVencendo = (store.documentosControlados as any[])
      .filter((doc) => {
        const due = String(doc.vigenciaAt || "");
        if (!due) return false;
        return due >= now.toISOString().slice(0, 10) && due <= in60Days;
      }).length;

    const asoVencendo = records.filter((record) => record.moduleKey === "exames" && record.vencimentoAt && record.vencimentoAt <= in60Days).length;
    const treinamentosVencendo = records.filter((record) => record.moduleKey === "treinamentos-e-integracao" && record.vencimentoAt && record.vencimentoAt <= in60Days).length;
    const inspecoesAtrasadas = records.filter((record) => record.moduleKey === "inspecoes-e-visitas" && record.status === "ATRASADO").length;
    const acoesCriticasAbertas = records.filter((record) => record.moduleKey === "plano-de-acao-x-risco" && record.criticidade === "CRITICA" && record.status !== "CONCLUIDO").length;

    const byUnit = records.reduce<Record<string, { total: number; concluidos: number; criticos: number }>>((acc, record) => {
      if (!acc[record.unidade]) acc[record.unidade] = { total: 0, concluidos: 0, criticos: 0 };
      acc[record.unidade].total += 1;
      if (record.status === "CONCLUIDO") acc[record.unidade].concluidos += 1;
      if (record.criticidade === "CRITICA") acc[record.unidade].criticos += 1;
      return acc;
    }, {});

    const rankingUnidades = Object.entries(byUnit)
      .map(([unidade, stats]) => ({
        unidade,
        score: stats.total > 0 ? Number((((stats.concluidos - stats.criticos * 0.35) / stats.total) * 100).toFixed(1)) : 0,
        total: stats.total,
        concluidos: stats.concluidos,
        criticos: stats.criticos,
      }))
      .sort((a, b) => b.score - a.score);

    const visaoNr = Object.entries(records.reduce<Record<string, number>>((acc, record) => {
      const key = record.nr || "NR-NA";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).map(([nr, total]) => ({ nr, total }));

    const custoAnual = (store.custos as any[])
      .filter((item) => String(item.competencia || "").startsWith(String(now.getFullYear())))
      .reduce((sum, item) => sum + Number(item.valor || 0), 0);

    const months = monthsBack(6);
    const tendencia = months.map((month) => {
      const monthRecords = records.filter((item) => item.createdAt.slice(0, 7) === month);
      return {
        mes: month,
        abertos: monthRecords.filter((item) => item.status !== "CONCLUIDO").length,
        concluidos: monthRecords.filter((item) => item.status === "CONCLUIDO").length,
      };
    });

    const pendenciasPrioritarias = records
      .filter((item) => item.criticidade === "CRITICA" && item.status !== "CONCLUIDO")
      .sort((a, b) => (a.vencimentoAt || "9999-12-31").localeCompare(b.vencimentoAt || "9999-12-31"))
      .slice(0, 10)
      .map((item) => ({ id: item.id, titulo: item.titulo, unidade: item.unidade, responsavel: item.responsavel, vencimentoAt: item.vencimentoAt, moduleKey: item.moduleKey }));

    return {
      scoreGeral,
      documentosVencendo,
      asoVencendo,
      treinamentosVencendo,
      inspecoesAtrasadas,
      acoesCriticasAbertas,
      rankingUnidades,
      visaoNr,
      custoAnual,
      tendencia,
      pendenciasPrioritarias,
      generatedAt: nowIso(),
      generatedBy: userName,
    };
  },

  getMaturityDashboard(profile: string, userId: string, userName: string, filters?: { unidade?: string }) {
    const base = sesmtRepo.getMasterDashboard(profile, userId, userName, filters);
    const eixoDetalhado = [
      { eixo: "Riscos criticos controlados", peso: 1.4, valor: Math.max(0, 100 - base.acoesCriticasAbertas * 4) },
      { eixo: "Inspecoes e tratativas", peso: 1.2, valor: Math.max(0, 100 - base.inspecoesAtrasadas * 6) },
      { eixo: "Saude ocupacional", peso: 1.4, valor: Math.max(0, 100 - base.asoVencendo * 5) },
      { eixo: "Treinamentos", peso: 1.1, valor: Math.max(0, 100 - base.treinamentosVencendo * 3) },
      { eixo: "Emergencia", peso: 1.0, valor: Math.max(0, 100 - Math.round(base.acoesCriticasAbertas * 2.2)) },
      { eixo: "Terceiros", peso: 0.9, valor: Math.max(0, 100 - Math.round(base.documentosVencendo * 1.7)) },
      { eixo: "Ambiente fisico", peso: 1.0, valor: Math.max(0, 100 - Math.round(base.inspecoesAtrasadas * 2.5)) },
      { eixo: "Documentacao", peso: 0.8, valor: Math.max(0, 100 - Math.round(base.documentosVencendo * 2.8)) },
      { eixo: "Participacao do trabalhador", peso: 0.7, valor: Math.max(0, 65 + (base.pendenciasPrioritarias.length === 0 ? 15 : 0)) },
    ];

    const weighted = eixoDetalhado.reduce((acc, item) => {
      acc.totalPeso += item.peso;
      acc.totalValor += item.valor * item.peso;
      return acc;
    }, { totalPeso: 0, totalValor: 0 });

    return {
      indiceMaturidade: weighted.totalPeso > 0 ? Number((weighted.totalValor / weighted.totalPeso).toFixed(1)) : 0,
      eixoDetalhado,
      rankingUnidades: base.rankingUnidades,
      generatedAt: nowIso(),
    };
  },
  getPredictiveDashboard(profile: string, userId: string, userName: string, filters?: { unidade?: string }) {
    assertRead(profile);
    const base = sesmtRepo.getMasterDashboard(profile, userId, userName, filters);

    const riscosFuturos = base.rankingUnidades.map((item) => {
      const pressure = Math.max(0, 100 - item.score);
      const reincidencia = Math.min(100, Math.round(item.criticos * 14 + pressure * 0.35));
      const degradacao = Math.min(100, Math.round(base.inspecoesAtrasadas * 4 + (100 - item.score) * 0.4));
      const riscoFuturo = Math.min(100, Math.round((reincidencia * 0.45) + (degradacao * 0.55)));
      return {
        unidade: item.unidade,
        riscoFuturo,
        reincidencia,
        degradacao,
        justificativa: `Criticos: ${item.criticos}, score unidade: ${item.score}, inspecoes atrasadas corporativas: ${base.inspecoesAtrasadas}.`,
      };
    });

    const alertas = riscosFuturos
      .filter((item) => item.riscoFuturo >= 60)
      .map((item) => ({
        unidade: item.unidade,
        nivel: item.riscoFuturo >= 80 ? "ALTO" : "MODERADO",
        titulo: "Probabilidade elevada de reincidencia",
        descricao: `Risco projetado em ${item.riscoFuturo}% para os proximos 30 dias.`,
        justificativa: item.justificativa,
      }));

    return {
      riscosFuturos,
      alertas,
      generatedAt: nowIso(),
    };
  },

  getIndicatorsDashboard(profile: string, userId: string, userName: string, filters?: { unidade?: string }) {
    assertRead(profile);
    const base = sesmtRepo.getMasterDashboard(profile, userId, userName, filters);

    const scopedRecords = applyUnitFilter(ensureStore().registros as SesmtRecord[], getAllowedUnits(profile, userId));

    const statusDistribuicao = Object.entries(scopedRecords.reduce<Record<string, number>>((acc, record) => {
      acc[record.status] = (acc[record.status] || 0) + 1;
      return acc;
    }, {})).map(([status, total]) => ({ status, total }));

    const criticidadeDistribuicao = Object.entries(scopedRecords.reduce<Record<string, number>>((acc, record) => {
      acc[record.criticidade] = (acc[record.criticidade] || 0) + 1;
      return acc;
    }, {})).map(([criticidade, total]) => ({ criticidade, total }));

    return {
      cards: [
        { titulo: "Score geral SST", valor: base.scoreGeral, meta: 90, unidade: "%" },
        { titulo: "Acoes criticas", valor: base.acoesCriticasAbertas, meta: 8, unidade: "itens" },
        { titulo: "Inspecoes atrasadas", valor: base.inspecoesAtrasadas, meta: 3, unidade: "itens" },
        { titulo: "Documentos vencendo", valor: base.documentosVencendo, meta: 10, unidade: "itens" },
      ],
      statusDistribuicao,
      criticidadeDistribuicao,
      visaoNr: base.visaoNr,
      tendencia: base.tendencia,
      generatedAt: nowIso(),
    };
  },

  getGerencialOcupacionalDashboard(profile: string, userId: string, userName: string, filters?: { unidade?: string }) {
    assertRead(profile);
    assertSensitiveRead(profile, "gerencial-ocupacional", userName);

    const store = ensureStore();
    const allowedUnits = getAllowedUnits(profile, userId);
    const selectedUnit = cleanString(filters?.unidade);
    const records = applyUnitFilter(store.registros as SesmtRecord[], allowedUnits)
      .filter((record) => record.moduleKey === "saude-ocupacional" || record.moduleKey === "exames" || record.moduleKey === "ambulatorio-prontuario")
      .filter((record) => !selectedUnit || record.unidade === selectedUnit);

    const agendaExames = records
      .filter((record) => record.moduleKey === "exames")
      .map((record) => ({
        id: record.id,
        colaborador: record.titulo,
        unidade: record.unidade,
        vencimentoAt: record.vencimentoAt,
        status: record.status,
      }))
      .sort((a, b) => String(a.vencimentoAt || "").localeCompare(String(b.vencimentoAt || "")))
      .slice(0, 20);

    const afastamentos = records.filter((record) => record.status === "ATRASADO").length;
    const restricoesAtivas = records.filter((record) => record.criticidade === "ALTA" || record.criticidade === "CRITICA").length;

    return {
      kpis: {
        totalProntuarios: records.filter((record) => record.moduleKey === "ambulatorio-prontuario").length,
        examesPendentes: records.filter((record) => record.moduleKey === "exames" && record.status !== "CONCLUIDO").length,
        afastamentos,
        restricoesAtivas,
      },
      agendaExames,
      historicoAtendimentos: records
        .filter((record) => record.moduleKey === "ambulatorio-prontuario")
        .slice(0, 10)
        .map((record) => ({ id: record.id, titulo: record.titulo, unidade: record.unidade, updatedAt: record.updatedAt, status: record.status })),
      generatedAt: nowIso(),
    };
  },

  async listDossieColaboradores(input: {
    profile: string;
    userId: string;
    userName: string;
    search?: string;
    unidade?: string;
    status?: string;
  }) {
    assertRead(input.profile);
    assertSensitiveRead(input.profile, "dossie-colaborador", input.userName);

    const allowedUnits = getAllowedUnits(input.profile, input.userId);
    const filterUnit = cleanString(input.unidade);
    const search = cleanString(input.search)?.toLowerCase();
    const status = cleanString(input.status)?.toUpperCase();

    if (isOracleEnabled()) {
      const rows = await queryRows<Record<string, unknown>>(
        `SELECT
          ID,
          NOME,
          MATRICULA,
          CPF,
          UNIDADE,
          SETOR,
          CARGO,
          FUNCAO,
          GESTOR,
          TO_CHAR(DATA_ADMISSAO, 'YYYY-MM-DD') AS DATA_ADMISSAO,
          STATUS,
          GRUPO_RISCO,
          SITUACAO_OCUPACIONAL,
          SCORE_ATENCAO
        FROM SESMT_COLABORADORES
        ORDER BY NOME`,
      );

      let items = rows
        .map((row) => ({
          id: String(row.ID),
          nome: cleanString(row.NOME) ?? "",
          matricula: cleanString(row.MATRICULA) ?? "",
          cpf: cleanString(row.CPF) ?? "",
          unidade: cleanString(row.UNIDADE) ?? "",
          setor: cleanString(row.SETOR) ?? "",
          cargo: cleanString(row.CARGO) ?? "",
          funcao: cleanString(row.FUNCAO) ?? "",
          gestor: cleanString(row.GESTOR) ?? "",
          dataAdmissao: toDateOnly(row.DATA_ADMISSAO),
          status: normalizeCollaboratorStatus(row.STATUS),
          grupoRisco: cleanString(row.GRUPO_RISCO) ?? undefined,
          situacaoOcupacional: cleanString(row.SITUACAO_OCUPACIONAL) ?? "Regular",
          scoreAtencao: asNumber(row.SCORE_ATENCAO, 0),
          alertas: [] as string[],
        }))
        .filter((item) => allowedUnits.includes(item.unidade));

      if (filterUnit) items = items.filter((item) => item.unidade === filterUnit);
      if (status) items = items.filter((item) => item.status === status);
      if (search) {
        items = items.filter((item) =>
          [item.nome, item.matricula, item.cpf, item.cargo, item.unidade]
            .filter(Boolean)
            .some((part) => part.toLowerCase().includes(search)),
        );
      }
      return items;
    }

    const store = ensureStore();
    const base = Array.isArray(store.colaboradores) ? (store.colaboradores as Array<Record<string, unknown>>) : [];
    let items = base.map((row) => ({
      id: String(row.id ?? ""),
      nome: cleanString(row.nome) ?? "",
      matricula: cleanString(row.matricula) ?? `MAT-${String(row.id ?? "").replace(/\D/g, "").padStart(4, "0")}`,
      cpf: cleanString(row.cpf) ?? "",
      unidade: cleanString(row.unidade) ?? "MAO",
      setor: cleanString(row.setor) ?? "",
      cargo: cleanString(row.cargo) ?? "Colaborador",
      funcao: cleanString(row.funcao) ?? "Colaborador",
      gestor: cleanString(row.gestor) ?? "SESMT",
      dataAdmissao: toDateOnly(row.dataAdmissao),
      status: normalizeCollaboratorStatus(row.status),
      grupoRisco: cleanString(row.grupoRisco) ?? undefined,
      situacaoOcupacional: cleanString(row.situacaoOcupacional) ?? "Regular",
      scoreAtencao: asNumber(row.scoreAtencao, 75),
      alertas: [] as string[],
    }))
      .filter((item) => item.id.length > 0)
      .filter((item) => allowedUnits.includes(item.unidade));

    if (filterUnit) items = items.filter((item) => item.unidade === filterUnit);
    if (status) items = items.filter((item) => item.status === status);
    if (search) {
      items = items.filter((item) =>
        [item.nome, item.matricula, item.cpf, item.cargo, item.unidade]
          .filter(Boolean)
          .some((part) => part.toLowerCase().includes(search)),
      );
    }
    return items;
  },

  async getColaboradorDossie(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
  }) {
    assertRead(input.profile);
    assertSensitiveRead(input.profile, "dossie-colaborador", input.userName);
    const dossie = await resolveDossie(input);
    if (!dossie) {
      throw Object.assign(new Error("Colaborador nao encontrado para o dossie."), { statusCode: 404 });
    }
    await appendSesmtAuditEvent({
      acao: "LEITURA_DOSSIE",
      entidade: "SESMT_DOSSIE_COLABORADOR",
      entidadeId: input.colaboradorId,
      userId: input.userId,
      userName: input.userName,
      profile: input.profile,
      detalhe: `Dossie consultado para colaborador ${input.colaboradorId}.`,
    });
    return dossie;
  },

  async getColaboradorDossieTimeline(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
  }) {
    const dossie = await sesmtRepo.getColaboradorDossie(input);
    return {
      colaboradorId: input.colaboradorId,
      timeline: dossie.timeline,
    };
  },

  async getColaboradorDossieDocumentos(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
  }) {
    const dossie = await sesmtRepo.getColaboradorDossie(input);
    return {
      colaboradorId: input.colaboradorId,
      documentos: dossie.documentos,
      anexos: dossie.documentos,
    };
  },

  async getColaboradorDossieAlertas(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
  }) {
    const dossie = await sesmtRepo.getColaboradorDossie(input);
    return {
      colaboradorId: input.colaboradorId,
      alertas: dossie.alertas,
      pendencias: dossie.pendencias,
    };
  },

  async getColaboradorDossieRelatorio(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
  }) {
    const dossie = await sesmtRepo.getColaboradorDossie(input);
    return {
      colaborador: dossie.colaborador,
      resumo: {
        totalExames: dossie.exames.length,
        examesVencidos: dossie.exames.filter((item) => safeStatus(item.status, "") === "VENCIDO").length,
        totalAsos: dossie.asos.length,
        asosVencidos: dossie.asos.filter((item) => safeStatus(item.status, "") === "VENCIDO").length,
        totalTreinamentos: dossie.treinamentos.length,
        treinamentosPendentes: dossie.treinamentos.filter((item) => {
          const status = safeStatus(item.status, "");
          return status === "PENDENTE" || status === "VENCIDO";
        }).length,
        totalVacinas: dossie.vacinas.length,
        vacinasPendentes: dossie.vacinas.filter((item) => {
          const status = safeStatus(item.status, "");
          return status === "PENDENTE" || status === "ATRASADA";
        }).length,
        totalAcidentes: dossie.acidentes.length,
        totalAfastamentos: dossie.afastamentos.length,
        totalDocumentos: dossie.documentos.length,
        scoreAtencao: dossie.colaborador.scoreAtencao,
      },
      alertas: dossie.alertas,
      pendencias: dossie.pendencias,
      generatedAt: nowIso(),
      generatedBy: input.userName,
    };
  },

  async exportColaboradorDossie(input: {
    profile: string;
    userId: string;
    userName: string;
    colaboradorId: string;
    payload?: Record<string, unknown>;
  }) {
    const relatorio = await sesmtRepo.getColaboradorDossieRelatorio(input);
    await appendSesmtAuditEvent({
      acao: "EXPORTAR_DOSSIE",
      entidade: "SESMT_DOSSIE_COLABORADOR",
      entidadeId: input.colaboradorId,
      userId: input.userId,
      userName: input.userName,
      profile: input.profile,
      detalhe: `Solicitacao de exportacao de dossie para ${input.colaboradorId}.`,
      payload: input.payload,
    });
    return {
      status: "QUEUED",
      colaboradorId: input.colaboradorId,
      exportId: `EXP-${Math.floor(Math.random() * 1_000_000)}`,
      solicitadoPor: input.userName,
      solicitadoEm: nowIso(),
      relatorio,
    };
  },

  listAccessAudit(profile: string) {
    assertRead(profile);
    if (!SENSITIVE_HEALTH_READ_PROFILES.has(profile)) {
      throw Object.assign(new Error("Perfil sem acesso ao log sensivel."), { statusCode: 403 });
    }
    return ensureStore().acessosSensiveis;
  },
};

