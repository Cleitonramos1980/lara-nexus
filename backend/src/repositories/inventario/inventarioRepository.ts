import { randomUUID } from "node:crypto";
import { isOracleEnabled } from "../../db/oracle.js";
import { execDml, queryOne, queryRows } from "../baseRepository.js";
import { appendAudit, db, nextId } from "../dataStore.js";
import { CHECKLIST_PRE_INVENTARIO_TEMPLATE } from "./checklistTemplate.js";

type InventoryStatus =
  | "NAO_INICIADO"
  | "EM_ANDAMENTO"
  | "CONCLUIDO"
  | "VALIDADO"
  | "NAO_FEITO"
  | "ATRASADO"
  | "RECONTAGEM"
  | "CANCELADO";

type ChecklistStatus = "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDO" | "CANCELADO" | "NAO_APLICAVEL";
type ChecklistCriticidade = "ALTA" | "MEDIA" | "BAIXA";
type ChecklistStatusGeral = "ABERTO" | "EM_ANDAMENTO" | "CONCLUIDO" | "CANCELADO";

function normalizeDate(input?: string | null): string | undefined {
  if (!input) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function normalizeTimestamp(input?: string | null): string | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function toOracleDateLiteral(input?: string | null): string | null {
  const d = normalizeDate(input);
  return d ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNumber(input: unknown, fallback = 0): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim()) {
    const n = Number(input.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function calculateRiskLevel(acuracidade: number): "ok" | "atencao" | "alta" | "sem_contagem" {
  if (acuracidade <= 0) return "sem_contagem";
  if (acuracidade < 80) return "alta";
  if (acuracidade < 95) return "atencao";
  return "ok";
}

function deriveConsensusStatus(
  qtd1?: number | null,
  qtd2?: number | null,
  qtd3?: number | null,
): { status: "PENDENTE" | "CONSENSO_2_DE_3" | "SEM_CONSENSO_3_CONTAGENS"; consenso: number | null; escalado: boolean } {
  const vals = [qtd1, qtd2, qtd3].filter((value) => value != null) as number[];
  if (vals.length < 2) {
    return { status: "PENDENTE", consenso: null, escalado: false };
  }

  const [a, b, c] = [qtd1, qtd2, qtd3];
  if (a != null && b != null && a === b) return { status: "CONSENSO_2_DE_3", consenso: a, escalado: false };
  if (a != null && c != null && a === c) return { status: "CONSENSO_2_DE_3", consenso: a, escalado: false };
  if (b != null && c != null && b === c) return { status: "CONSENSO_2_DE_3", consenso: b, escalado: false };

  if (qtd1 != null && qtd2 != null && qtd3 != null) {
    return { status: "SEM_CONSENSO_3_CONTAGENS", consenso: null, escalado: true };
  }

  return { status: "PENDENTE", consenso: null, escalado: false };
}

async function writeAuditEvent(input: {
  modulo: string;
  acao: string;
  entidade: string;
  entidadeId?: string;
  usuarioId?: string;
  usuarioNome?: string;
  perfil?: string;
  detalhe?: string;
  payload?: unknown;
}): Promise<void> {
  appendAudit(
    input.acao,
    input.entidade,
    input.entidadeId ?? "N/A",
    input.detalhe ?? "",
    input.usuarioNome ?? "system",
  );

  if (!isOracleEnabled()) return;

  await execDml(
    `INSERT INTO SGQ_AUDITORIA_EVENTOS (
      ID, MODULO, ACAO, ENTIDADE, ENTIDADE_ID, USUARIO_ID, USUARIO_NOME, PERFIL, DETALHE, PAYLOAD
    ) VALUES (
      :id, :modulo, :acao, :entidade, :entidadeId, :usuarioId, :usuarioNome, :perfil, :detalhe, :payload
    )`,
    {
      id: randomUUID(),
      modulo: input.modulo,
      acao: input.acao,
      entidade: input.entidade,
      entidadeId: input.entidadeId ?? null,
      usuarioId: input.usuarioId ?? null,
      usuarioNome: input.usuarioNome ?? null,
      perfil: input.perfil ?? null,
      detalhe: input.detalhe ?? null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    },
  );
}

async function listContagemItemsOracle(contagemId: string): Promise<any[]> {
  const rows = await queryRows<any>(
    `SELECT
      ID,
      ORDEM_ITEM,
      CODIGO_ITEM,
      CODIGO_BARRAS,
      DESCRICAO,
      ESTOQUE_SISTEMA,
      QTD_CONTAGEM_1,
      QTD_CONTAGEM_2,
      QTD_CONTAGEM_3,
      QTD_CONSENSO,
      DIFERENCA,
      MOTIVO_DIVERGENCIA,
      OBSERVACAO,
      STATUS_CONSENSO,
      ESCALADO_SUPERVISOR
    FROM ITENS_CONTAGEM
    WHERE CONTAGEM_ID = :contagemId
    ORDER BY ORDEM_ITEM, ID`,
    { contagemId },
  );

  return rows.map((row) => ({
    id: String(row.ID),
    codigoItem: String(row.CODIGO_ITEM ?? ""),
    codigoBarras: String(row.CODIGO_BARRAS ?? ""),
    descricao: String(row.DESCRICAO ?? ""),
    estoqueSistema: asNumber(row.ESTOQUE_SISTEMA),
    quantidadeContada: row.QTD_CONSENSO == null ? null : asNumber(row.QTD_CONSENSO),
    diferenca: row.DIFERENCA == null ? null : asNumber(row.DIFERENCA),
    motivoDivergencia: row.MOTIVO_DIVERGENCIA ?? undefined,
    observacao: row.OBSERVACAO ?? undefined,
    contagens: {
      primeira: row.QTD_CONTAGEM_1 == null ? null : asNumber(row.QTD_CONTAGEM_1),
      segunda: row.QTD_CONTAGEM_2 == null ? null : asNumber(row.QTD_CONTAGEM_2),
      terceira: row.QTD_CONTAGEM_3 == null ? null : asNumber(row.QTD_CONTAGEM_3),
    },
    consenso: {
      status: String(row.STATUS_CONSENSO ?? "PENDENTE"),
      escaladoSupervisor: Number(row.ESCALADO_SUPERVISOR ?? 0) === 1,
    },
  }));
}

function listContagemItemsFallback(contagem: any): any[] {
  return (contagem?.itens ?? []).map((item: any) => ({
    ...item,
    contagens: {
      primeira: item.qtdContagem1 ?? item.quantidadeContada ?? null,
      segunda: item.qtdContagem2 ?? null,
      terceira: item.qtdContagem3 ?? null,
    },
    consenso: {
      status: item.statusConsenso ?? "PENDENTE",
      escaladoSupervisor: !!item.escaladoSupervisor,
    },
  }));
}

function mapContagemRow(row: any, itens: any[]): any {
  const itensContados = itens.filter((item) => item.quantidadeContada != null).length;
  const itensDivergentes = itens.filter((item) => asNumber(item.diferenca, 0) !== 0).length;
  const acuracidade = itens.length > 0
    ? Number((((itens.length - itensDivergentes) / itens.length) * 100).toFixed(2))
    : asNumber(row.ACURACIDADE, 0);

  return {
    id: String(row.ID),
    numero: String(row.NUMERO),
    tarefaId: row.TAREFA_ID ? String(row.TAREFA_ID) : "",
    data: normalizeDate(String(row.DATA_CONTAGEM)) ?? new Date().toISOString().slice(0, 10),
    lojaId: String(row.LOJA_ID),
    lojaNome: String(row.LOJA_NOME ?? row.LOJA_ID),
    regional: String(row.REGIONAL ?? ""),
    gerente: String(row.GERENTE ?? ""),
    supervisor: String(row.SUPERVISOR ?? ""),
    departamentoId: String(row.DEPARTAMENTO_ID),
    departamentoNome: String(row.DEPARTAMENTO_NOME ?? row.DEPARTAMENTO_ID),
    frequencia: String(row.FREQUENCIA),
    responsavel: String(row.RESPONSAVEL ?? ""),
    status: String(row.STATUS) as InventoryStatus,
    itens,
    itensContados,
    itensDivergentes,
    acuracidade,
    iniciadoEm: normalizeTimestamp(row.INICIADO_EM ? String(row.INICIADO_EM) : null),
    concluidoEm: normalizeTimestamp(row.CONCLUIDO_EM ? String(row.CONCLUIDO_EM) : null),
    validadoEm: normalizeTimestamp(row.VALIDADO_EM ? String(row.VALIDADO_EM) : null),
    validadoPor: row.VALIDADO_POR ? String(row.VALIDADO_POR) : undefined,
    recontagem: Number(row.RECONTAGEM ?? 0) === 1,
    recontagemOrigem: row.RECONTAGEM_ORIGEM ? String(row.RECONTAGEM_ORIGEM) : undefined,
    consenso: {
      status: String(row.CONSENSO_STATUS ?? "NAO_APLICAVEL"),
      escaladoSupervisor: Number(row.ESCALADO_SUPERVISOR ?? 0) === 1,
    },
  };
}

async function loadContagemOracle(id: string): Promise<any | null> {
  const row = await queryOne<any>(
    `SELECT
      c.ID,
      c.NUMERO,
      c.TAREFA_ID,
      TO_CHAR(c.DATA_CONTAGEM, 'YYYY-MM-DD') AS DATA_CONTAGEM,
      c.LOJA_ID,
      c.DEPARTAMENTO_ID,
      c.FREQUENCIA,
      c.RESPONSAVEL,
      c.STATUS,
      c.ITENS_CONTADOS,
      c.ITENS_DIVERGENTES,
      c.ACURACIDADE,
      c.CONSENSO_STATUS,
      c.RISCO_DIVERGENCIA,
      c.RECONTAGEM,
      c.RECONTAGEM_ORIGEM,
      c.INICIADO_EM,
      c.CONCLUIDO_EM,
      c.VALIDADO_EM,
      c.VALIDADO_POR,
      c.ESCALADO_SUPERVISOR,
      l.NOME AS LOJA_NOME,
      l.REGIONAL,
      l.GERENTE,
      l.SUPERVISOR,
      d.NOME AS DEPARTAMENTO_NOME
    FROM CONTAGENS c
    JOIN LOJAS_INVENTARIO l ON l.ID = c.LOJA_ID
    JOIN DEPARTAMENTOS_INVENTARIO d ON d.ID = c.DEPARTAMENTO_ID
    WHERE c.ID = :id`,
    { id },
  );
  if (!row) return null;
  const itens = await listContagemItemsOracle(id);
  return mapContagemRow(row, itens);
}

function recalculateContagemFromItens(itens: any[]): { itensContados: number; itensDivergentes: number; acuracidade: number; consensoStatus: string; escalado: number; risco: "ok" | "atencao" | "alta" | "sem_contagem" } {
  const itensContados = itens.filter((item) => item.qtdConsenso != null || item.QTD_CONSENSO != null).length;
  const itensDivergentes = itens.filter((item) => {
    const estoque = asNumber(item.estoqueSistema ?? item.ESTOQUE_SISTEMA, 0);
    const consenso = item.qtdConsenso ?? item.QTD_CONSENSO;
    if (consenso == null) return false;
    return asNumber(consenso, estoque) !== estoque;
  }).length;
  const total = itens.length;
  const acuracidade = total > 0 ? Number((((total - itensDivergentes) / total) * 100).toFixed(2)) : 0;
  const hasEscalado = itens.some((item) => Number(item.escaladoSupervisor ?? item.ESCALADO_SUPERVISOR ?? 0) === 1);
  const hasPendente = itens.some((item) => String(item.statusConsenso ?? item.STATUS_CONSENSO ?? "PENDENTE") === "PENDENTE");
  const consensoStatus = hasEscalado
    ? "SEM_CONSENSO_3_CONTAGENS"
    : hasPendente
      ? "NAO_APLICAVEL"
      : "CONSENSO_2_DE_3";
  return {
    itensContados,
    itensDivergentes,
    acuracidade,
    consensoStatus,
    escalado: hasEscalado ? 1 : 0,
    risco: calculateRiskLevel(acuracidade),
  };
}

function calculateChecklistSummary(items: Array<{ status: ChecklistStatus; ncAberta?: boolean }>, bloqueioNc: boolean): { statusGeral: ChecklistStatusGeral; progresso: number } {
  if (items.length === 0) return { statusGeral: "ABERTO", progresso: 0 };

  const allPendente = items.every((item) => item.status === "PENDENTE");
  if (allPendente) return { statusGeral: "ABERTO", progresso: 0 };

  const concluiveis = new Set<ChecklistStatus>(["CONCLUIDO", "CANCELADO", "NAO_APLICAVEL"]);
  const allConcluiveis = items.every((item) => concluiveis.has(item.status));
  const hasNcAberta = items.some((item) => !!item.ncAberta);
  const concluidoCount = items.filter((item) => item.status === "CONCLUIDO" || item.status === "NAO_APLICAVEL").length;
  const progresso = Number(((concluidoCount / items.length) * 100).toFixed(2));

  if (allConcluiveis) {
    if (bloqueioNc && hasNcAberta) return { statusGeral: "EM_ANDAMENTO", progresso };
    return { statusGeral: "CONCLUIDO", progresso: 100 };
  }

  return { statusGeral: "EM_ANDAMENTO", progresso };
}

function mapChecklistItemFallback(item: any): any {
  return {
    id: String(item.id),
    blocoId: String(item.blocoId),
    descricao: String(item.descricao),
    status: String(item.status) as ChecklistStatus,
    responsavel: String(item.responsavel ?? ""),
    data: item.data ? String(item.data) : "",
    setor: String(item.setor ?? ""),
    criticidade: String(item.criticidade ?? "MEDIA") as ChecklistCriticidade,
    evidencia: item.evidencia ?? undefined,
    nc: !!item.nc,
    planoAcao: item.planoAcao ?? undefined,
    observacao: item.observacao ?? undefined,
    evidencias: Array.isArray(item.evidencias) ? item.evidencias : [],
    historico: Array.isArray(item.historico) ? item.historico : [],
  };
}

function ensureFallbackChecklists(): any[] {
  if (!Array.isArray((db as any).inventarioChecklists)) {
    (db as any).inventarioChecklists = [];
  }

  const list = (db as any).inventarioChecklists as any[];
  if (list.length > 0) return list;

  const seeds = [
    { id: "CKL-001", nome: "Checklist Inventario Q2 - CD Sao Paulo", unidade: "CD Sao Paulo", tipoInventario: "Inventario Geral", dataPrevistaInventario: new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10), responsavelGeral: "Carlos Lima", criadoPor: "Ana Souza" },
    { id: "CKL-002", nome: "Checklist Inventario Rotativo - Filial BH", unidade: "Filial Belo Horizonte", tipoInventario: "Inventario Rotativo", dataPrevistaInventario: new Date(Date.now() + 23 * 86400000).toISOString().slice(0, 10), responsavelGeral: "Fernanda Dias", criadoPor: "Roberto Mendes" },
    { id: "CKL-003", nome: "Checklist Inventario Anual - CD Curitiba", unidade: "CD Curitiba", tipoInventario: "Inventario Geral", dataPrevistaInventario: new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10), responsavelGeral: "Juliana Rocha", criadoPor: "Ana Souza" },
  ];

  for (const seed of seeds) {
    const blocos = CHECKLIST_PRE_INVENTARIO_TEMPLATE.map((bloco) => ({
      id: `${seed.id}-${bloco.codigo}`,
      ordem: bloco.ordem,
      nome: bloco.nome,
      itens: bloco.itens.map((item, idx) => ({
        id: `${seed.id}-${bloco.codigo}-I${String(idx + 1).padStart(2, "0")}`,
        blocoId: `${seed.id}-${bloco.codigo}`,
        descricao: item.descricao,
        status: "PENDENTE" as ChecklistStatus,
        responsavel: seed.responsavelGeral,
        data: seed.dataPrevistaInventario,
        setor: "Operacao",
        criticidade: item.criticidade,
        nc: false,
        planoAcao: undefined,
        observacao: undefined,
        evidencia: undefined,
        evidencias: [],
        historico: [
          {
            id: randomUUID(),
            data: nowIso(),
            usuario: seed.criadoPor,
            acao: "CRIACAO",
            detalhe: "Item criado automaticamente no checklist.",
          },
        ],
      })),
    }));

    list.push({
      ...seed,
      statusGeral: "ABERTO",
      observacoes: "Checklist gerado automaticamente com template padrao.",
      criadoEm: nowIso(),
      blocos,
    });
  }

  return list;
}

async function loadChecklistByIdOracle(checklistId: string): Promise<any | null> {
  const checklist = await queryOne<any>(
    `SELECT
      ID,
      NOME,
      UNIDADE,
      TO_CHAR(DATA_PREVISTA_INVENTARIO, 'YYYY-MM-DD') AS DATA_PREVISTA_INVENTARIO,
      TIPO_INVENTARIO,
      RESPONSAVEL_GERAL,
      STATUS_GERAL,
      OBSERVACOES,
      PROGRESSO_GERAL,
      BLOQUEAR_CONCLUSAO_POR_NC,
      CRIADO_POR,
      CRIADO_EM,
      UPDATED_AT
    FROM CHECKLISTS_PRE_INVENTARIO
    WHERE ID = :id`,
    { id: checklistId },
  );
  if (!checklist) return null;

  const blocoRows = await queryRows<any>(
    `SELECT ID, CODIGO, ORDEM, NOME, PROGRESSO, TOTAL_ITENS
     FROM CHECKLIST_BLOCOS
     WHERE CHECKLIST_ID = :checklistId
     ORDER BY ORDEM, ID`,
    { checklistId },
  );
  const itemRows = await queryRows<any>(
    `SELECT
      ID,
      BLOCO_ID,
      CODIGO,
      ORDEM,
      DESCRICAO,
      STATUS,
      RESPONSAVEL,
      TO_CHAR(DATA_REFERENCIA, 'YYYY-MM-DD') AS DATA_REFERENCIA,
      SETOR,
      CRITICIDADE,
      NC_ABERTA,
      PLANO_ACAO,
      OBSERVACAO,
      EVIDENCIA_RESUMO,
      ULTIMA_ALTERACAO_POR,
      ULTIMA_ALTERACAO_EM
     FROM CHECKLIST_ITENS
     WHERE CHECKLIST_ID = :checklistId
     ORDER BY BLOCO_ID, ORDEM, ID`,
    { checklistId },
  );
  const evidRows = await queryRows<any>(
    `SELECT
      ID,
      ITEM_ID,
      NOME_ARQUIVO,
      CAMINHO,
      MIME_TYPE,
      TAMANHO_BYTES,
      DESCRICAO,
      CRIADO_POR,
      CRIADO_EM
     FROM CHECKLIST_ITENS_EVIDENCIAS
     WHERE CHECKLIST_ID = :checklistId
     ORDER BY CRIADO_EM DESC`,
    { checklistId },
  );
  const histRows = await queryRows<any>(
    `SELECT
      ID,
      ITEM_ID,
      ACAO,
      DETALHE,
      USUARIO,
      DATA_EVENTO
     FROM CHECKLIST_ITENS_HISTORICO
     WHERE CHECKLIST_ID = :checklistId
     ORDER BY DATA_EVENTO DESC`,
    { checklistId },
  );

  const evidByItem = new Map<string, any[]>();
  for (const row of evidRows) {
    const itemId = String(row.ITEM_ID);
    const list = evidByItem.get(itemId) ?? [];
    list.push(row);
    evidByItem.set(itemId, list);
  }

  const histByItem = new Map<string, any[]>();
  for (const row of histRows) {
    const itemId = String(row.ITEM_ID);
    const list = histByItem.get(itemId) ?? [];
    list.push(row);
    histByItem.set(itemId, list);
  }

  const itemsByBlock = new Map<string, any[]>();
  for (const row of itemRows) {
    const itemId = String(row.ID);
    const evidencias = (evidByItem.get(itemId) ?? []).map((e) => String(e.NOME_ARQUIVO ?? e.CAMINHO ?? "evidencia"));
    const historico = (histByItem.get(itemId) ?? []).map((h) => ({
      id: String(h.ID),
      data: normalizeTimestamp(String(h.DATA_EVENTO)) ?? String(h.DATA_EVENTO),
      usuario: String(h.USUARIO ?? "system"),
      acao: String(h.ACAO ?? ""),
      detalhe: String(h.DETALHE ?? ""),
    }));

    const mapped = {
      id: itemId,
      blocoId: String(row.BLOCO_ID),
      descricao: String(row.DESCRICAO),
      status: String(row.STATUS) as ChecklistStatus,
      responsavel: String(row.RESPONSAVEL ?? ""),
      data: normalizeDate(String(row.DATA_REFERENCIA)) ?? "",
      setor: String(row.SETOR ?? ""),
      criticidade: String(row.CRITICIDADE ?? "MEDIA") as ChecklistCriticidade,
      evidencia: row.EVIDENCIA_RESUMO ? String(row.EVIDENCIA_RESUMO) : (evidencias[0] ?? undefined),
      nc: Number(row.NC_ABERTA ?? 0) === 1,
      planoAcao: row.PLANO_ACAO ? String(row.PLANO_ACAO) : undefined,
      observacao: row.OBSERVACAO ? String(row.OBSERVACAO) : undefined,
      evidencias,
      historico,
    };

    const blockId = String(row.BLOCO_ID);
    const list = itemsByBlock.get(blockId) ?? [];
    list.push(mapped);
    itemsByBlock.set(blockId, list);
  }

  const blocos = blocoRows.map((row) => ({
    id: String(row.ID),
    ordem: asNumber(row.ORDEM, 0),
    nome: String(row.NOME),
    itens: itemsByBlock.get(String(row.ID)) ?? [],
  }));

  return {
    id: String(checklist.ID),
    nome: String(checklist.NOME),
    unidade: String(checklist.UNIDADE),
    dataPrevistaInventario: normalizeDate(String(checklist.DATA_PREVISTA_INVENTARIO)) ?? "",
    tipoInventario: String(checklist.TIPO_INVENTARIO),
    responsavelGeral: String(checklist.RESPONSAVEL_GERAL),
    statusGeral: String(checklist.STATUS_GERAL) as ChecklistStatusGeral,
    observacoes: checklist.OBSERVACOES ? String(checklist.OBSERVACOES) : undefined,
    progressoGeral: asNumber(checklist.PROGRESSO_GERAL, 0),
    bloquearConclusaoPorNc: Number(checklist.BLOQUEAR_CONCLUSAO_POR_NC ?? 1) === 1,
    criadoPor: String(checklist.CRIADO_POR ?? "system"),
    criadoEm: normalizeTimestamp(String(checklist.CRIADO_EM)) ?? String(checklist.CRIADO_EM),
    atualizadoEm: normalizeTimestamp(String(checklist.UPDATED_AT)) ?? String(checklist.UPDATED_AT),
    blocos,
  };
}

async function recalcChecklistStatusOracle(checklistId: string): Promise<{ status: ChecklistStatusGeral; progresso: number }> {
  const rows = await queryRows<any>(
    `SELECT STATUS, NC_ABERTA
     FROM CHECKLIST_ITENS
     WHERE CHECKLIST_ID = :checklistId`,
    { checklistId },
  );
  const checklist = await queryOne<any>(
    `SELECT BLOQUEAR_CONCLUSAO_POR_NC FROM CHECKLISTS_PRE_INVENTARIO WHERE ID = :id`,
    { id: checklistId },
  );
  const bloqueioNc = Number(checklist?.BLOQUEAR_CONCLUSAO_POR_NC ?? 1) === 1;
  const summary = calculateChecklistSummary(
    rows.map((row) => ({
      status: String(row.STATUS ?? "PENDENTE") as ChecklistStatus,
      ncAberta: Number(row.NC_ABERTA ?? 0) === 1,
    })),
    bloqueioNc,
  );

  await execDml(
    `UPDATE CHECKLISTS_PRE_INVENTARIO
        SET STATUS_GERAL = :statusGeral,
            PROGRESSO_GERAL = :progresso,
            UPDATED_AT = SYSTIMESTAMP
      WHERE ID = :id`,
    { id: checklistId, statusGeral: summary.statusGeral, progresso: summary.progresso },
  );

  const blocoRows = await queryRows<any>(
    `SELECT ID FROM CHECKLIST_BLOCOS WHERE CHECKLIST_ID = :checklistId`,
    { checklistId },
  );
  for (const bloco of blocoRows) {
    const blocoId = String(bloco.ID);
    const items = await queryRows<any>(
      `SELECT STATUS FROM CHECKLIST_ITENS WHERE BLOCO_ID = :blocoId`,
      { blocoId },
    );
    const concluidoCount = items.filter((item) => ["CONCLUIDO", "NAO_APLICAVEL"].includes(String(item.STATUS))).length;
    const progresso = items.length === 0 ? 0 : Number(((concluidoCount / items.length) * 100).toFixed(2));
    await execDml(
      `UPDATE CHECKLIST_BLOCOS
          SET PROGRESSO = :progresso,
              TOTAL_ITENS = :totalItens,
              UPDATED_AT = SYSTIMESTAMP
        WHERE ID = :id`,
      { id: blocoId, progresso, totalItens: items.length },
    );
  }

  return { status: summary.statusGeral, progresso: summary.progresso };
}

export const inventarioRepository = {
  async listLojas(): Promise<any[]> {
    if (!isOracleEnabled()) return db.inventarioLojas;
    const rows = await queryRows<any>(`SELECT ID, CODIGO, NOME, REGIONAL, GERENTE, SUPERVISOR FROM LOJAS_INVENTARIO WHERE ATIVO = 1 ORDER BY CODIGO`);
    return rows.map((row) => ({
      id: String(row.ID),
      codigo: String(row.CODIGO),
      nome: String(row.NOME),
      regional: String(row.REGIONAL ?? ""),
      gerente: String(row.GERENTE ?? ""),
      supervisor: String(row.SUPERVISOR ?? ""),
    }));
  },

  async listDepartamentos(): Promise<any[]> {
    if (!isOracleEnabled()) return db.inventarioDepartamentos;
    const rows = await queryRows<any>(`SELECT ID, CODIGO, NOME FROM DEPARTAMENTOS_INVENTARIO WHERE ATIVO = 1 ORDER BY CODIGO`);
    return rows.map((row) => ({
      id: String(row.ID),
      codigo: String(row.CODIGO),
      nome: String(row.NOME),
    }));
  },

  async listFrequencias(): Promise<any[]> {
    if (!isOracleEnabled()) return db.inventarioFrequencias;
    const rows = await queryRows<any>(
      `SELECT
        f.ID,
        f.LOJA_ID,
        l.NOME AS LOJA_NOME,
        l.REGIONAL,
        l.GERENTE,
        l.SUPERVISOR,
        f.DEPARTAMENTO_ID,
        d.NOME AS DEPARTAMENTO_NOME,
        f.FREQUENCIA,
        f.ATIVO,
        TO_CHAR(f.PROXIMA_EXECUCAO, 'YYYY-MM-DD') AS PROXIMA_EXECUCAO,
        f.RESPONSAVEL_PADRAO
      FROM FREQUENCIA_CONFIGS f
      JOIN LOJAS_INVENTARIO l ON l.ID = f.LOJA_ID
      JOIN DEPARTAMENTOS_INVENTARIO d ON d.ID = f.DEPARTAMENTO_ID
      ORDER BY l.CODIGO, d.CODIGO`,
    );
    return rows.map((row) => ({
      id: String(row.ID),
      lojaId: String(row.LOJA_ID),
      lojaNome: String(row.LOJA_NOME),
      regional: String(row.REGIONAL ?? ""),
      gerente: String(row.GERENTE ?? ""),
      supervisor: String(row.SUPERVISOR ?? ""),
      departamentoId: String(row.DEPARTAMENTO_ID),
      departamentoNome: String(row.DEPARTAMENTO_NOME),
      frequencia: String(row.FREQUENCIA),
      ativo: Number(row.ATIVO ?? 0) === 1,
      proximaExecucao: normalizeDate(String(row.PROXIMA_EXECUCAO)) ?? "",
      responsavelPadrao: String(row.RESPONSAVEL_PADRAO ?? ""),
    }));
  },

  async listTarefas(): Promise<any[]> {
    if (!isOracleEnabled()) return db.inventarioTarefas;
    const rows = await queryRows<any>(
      `SELECT
        t.ID,
        TO_CHAR(t.DATA_REFERENCIA, 'YYYY-MM-DD') AS DATA_REFERENCIA,
        t.LOJA_ID,
        l.NOME AS LOJA_NOME,
        l.REGIONAL,
        l.GERENTE,
        l.SUPERVISOR,
        t.DEPARTAMENTO_ID,
        d.NOME AS DEPARTAMENTO_NOME,
        t.FREQUENCIA,
        t.RESPONSAVEL,
        t.STATUS,
        t.CONTAGEM_ID
      FROM TAREFAS_INVENTARIO t
      JOIN LOJAS_INVENTARIO l ON l.ID = t.LOJA_ID
      JOIN DEPARTAMENTOS_INVENTARIO d ON d.ID = t.DEPARTAMENTO_ID
      ORDER BY t.DATA_REFERENCIA DESC, l.CODIGO`,
    );
    return rows.map((row) => ({
      id: String(row.ID),
      data: normalizeDate(String(row.DATA_REFERENCIA)) ?? "",
      lojaId: String(row.LOJA_ID),
      lojaNome: String(row.LOJA_NOME),
      regional: String(row.REGIONAL ?? ""),
      gerente: String(row.GERENTE ?? ""),
      supervisor: String(row.SUPERVISOR ?? ""),
      departamentoId: String(row.DEPARTAMENTO_ID),
      departamentoNome: String(row.DEPARTAMENTO_NOME),
      frequencia: String(row.FREQUENCIA),
      responsavel: String(row.RESPONSAVEL ?? ""),
      status: String(row.STATUS) as InventoryStatus,
      contagemId: row.CONTAGEM_ID ? String(row.CONTAGEM_ID) : undefined,
    }));
  },

  async listContagens(): Promise<any[]> {
    if (!isOracleEnabled()) {
      return (db.inventarioContagens as any[]).map((contagem) => ({
        ...contagem,
        itens: listContagemItemsFallback(contagem),
      }));
    }

    const rows = await queryRows<any>(
      `SELECT
        c.ID,
        c.NUMERO,
        c.TAREFA_ID,
        TO_CHAR(c.DATA_CONTAGEM, 'YYYY-MM-DD') AS DATA_CONTAGEM,
        c.LOJA_ID,
        c.DEPARTAMENTO_ID,
        c.FREQUENCIA,
        c.RESPONSAVEL,
        c.STATUS,
        c.ITENS_CONTADOS,
        c.ITENS_DIVERGENTES,
        c.ACURACIDADE,
        c.CONSENSO_STATUS,
        c.RISCO_DIVERGENCIA,
        c.RECONTAGEM,
        c.RECONTAGEM_ORIGEM,
        c.INICIADO_EM,
        c.CONCLUIDO_EM,
        c.VALIDADO_EM,
        c.VALIDADO_POR,
        c.ESCALADO_SUPERVISOR,
        l.NOME AS LOJA_NOME,
        l.REGIONAL,
        l.GERENTE,
        l.SUPERVISOR,
        d.NOME AS DEPARTAMENTO_NOME
      FROM CONTAGENS c
      JOIN LOJAS_INVENTARIO l ON l.ID = c.LOJA_ID
      JOIN DEPARTAMENTOS_INVENTARIO d ON d.ID = c.DEPARTAMENTO_ID
      ORDER BY c.DATA_CONTAGEM DESC, c.NUMERO DESC`,
    );

    const itemsByContagem = new Map<string, any[]>();
    for (const row of rows) {
      const id = String(row.ID);
      if (!itemsByContagem.has(id)) {
        itemsByContagem.set(id, await listContagemItemsOracle(id));
      }
    }

    return rows.map((row) => mapContagemRow(row, itemsByContagem.get(String(row.ID)) ?? []));
  },

  async getContagemById(id: string): Promise<any | null> {
    if (!isOracleEnabled()) {
      const contagem = (db.inventarioContagens as any[]).find((item) => item.id === id);
      if (!contagem) return null;
      return { ...contagem, itens: listContagemItemsFallback(contagem) };
    }
    return loadContagemOracle(id);
  },

  async createContagem(input: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any> {
    if (!isOracleEnabled()) {
      const rec = {
        ...input,
        id: nextId("CNT", db.inventarioContagens.length),
        numero: input.numero || nextId("CNT", db.inventarioContagens.length),
        status: input.status || "NAO_INICIADO",
        itensContados: input.itensContados ?? 0,
        itensDivergentes: input.itensDivergentes ?? 0,
        acuracidade: input.acuracidade ?? 0,
        itens: input.itens ?? [],
      };
      (db.inventarioContagens as any[]).push(rec);
      await writeAuditEvent({
        modulo: "INVENTARIO",
        acao: "CRIAR",
        entidade: "CONTAGEM",
        entidadeId: rec.id,
        usuarioId: actor?.userId,
        usuarioNome: actor?.userName,
        perfil: actor?.profile,
        detalhe: "Contagem criada em fallback in-memory.",
        payload: rec,
      });
      return rec;
    }

    const id = String(input.id ?? randomUUID());
    const numero = String(input.numero ?? `CNT-${new Date().getFullYear()}-${id.slice(0, 8)}`);
    const status = String(input.status ?? "NAO_INICIADO") as InventoryStatus;
    const data = toOracleDateLiteral(input.data) ?? new Date().toISOString().slice(0, 10);
    const lojaId = String(input.lojaId);
    const departamentoId = String(input.departamentoId);
    const tarefaId = input.tarefaId ? String(input.tarefaId) : null;
    const frequencia = String(input.frequencia ?? "DIARIA");
    const responsavel = input.responsavel ? String(input.responsavel) : null;
    const itens = Array.isArray(input.itens) ? input.itens : [];

    await execDml(
      `INSERT INTO CONTAGENS (
        ID, NUMERO, TAREFA_ID, DATA_CONTAGEM, LOJA_ID, DEPARTAMENTO_ID, FREQUENCIA, RESPONSAVEL,
        STATUS, ITENS_CONTADOS, ITENS_DIVERGENTES, ACURACIDADE, CONSENSO_STATUS, RISCO_DIVERGENCIA,
        CREATED_BY, UPDATED_BY
      ) VALUES (
        :id, :numero, :tarefaId, TO_DATE(:dataContagem, 'YYYY-MM-DD'), :lojaId, :departamentoId, :frequencia, :responsavel,
        :status, 0, 0, 0, 'NAO_APLICAVEL', 'sem_contagem', :createdBy, :updatedBy
      )`,
      {
        id,
        numero,
        tarefaId,
        dataContagem: data,
        lojaId,
        departamentoId,
        frequencia,
        responsavel,
        status,
        createdBy: actor?.userName ?? "system",
        updatedBy: actor?.userName ?? "system",
      },
    );

    let ordem = 1;
    for (const item of itens) {
      await execDml(
        `INSERT INTO ITENS_CONTAGEM (
          ID, CONTAGEM_ID, ORDEM_ITEM, CODIGO_ITEM, CODIGO_BARRAS, DESCRICAO, ESTOQUE_SISTEMA
        ) VALUES (
          :id, :contagemId, :ordemItem, :codigoItem, :codigoBarras, :descricao, :estoqueSistema
        )`,
        {
          id: String(item.id ?? randomUUID()),
          contagemId: id,
          ordemItem: ordem,
          codigoItem: String(item.codigoItem ?? ""),
          codigoBarras: String(item.codigoBarras ?? ""),
          descricao: String(item.descricao ?? `Item ${ordem}`),
          estoqueSistema: asNumber(item.estoqueSistema, 0),
        },
      );
      ordem += 1;
    }

    const created = await this.getContagemById(id);
    await writeAuditEvent({
      modulo: "INVENTARIO",
      acao: "CRIAR",
      entidade: "CONTAGEM",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: "Contagem criada no banco.",
      payload: created,
    });
    return created;
  },

  async updateContagem(id: string, input: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any | null> {
    if (!isOracleEnabled()) {
      const idx = (db.inventarioContagens as any[]).findIndex((item) => item.id === id);
      if (idx < 0) return null;
      (db.inventarioContagens as any[])[idx] = { ...(db.inventarioContagens as any[])[idx], ...input };
      await writeAuditEvent({
        modulo: "INVENTARIO",
        acao: "ATUALIZAR",
        entidade: "CONTAGEM",
        entidadeId: id,
        usuarioId: actor?.userId,
        usuarioNome: actor?.userName,
        perfil: actor?.profile,
        detalhe: "Contagem atualizada em fallback in-memory.",
        payload: input,
      });
      return (db.inventarioContagens as any[])[idx];
    }

    const current = await this.getContagemById(id);
    if (!current) return null;

    const merged = {
      ...current,
      ...input,
    };

    await execDml(
      `UPDATE CONTAGENS
         SET STATUS = :status,
             RESPONSAVEL = :responsavel,
             ITENS_CONTADOS = :itensContados,
             ITENS_DIVERGENTES = :itensDivergentes,
             ACURACIDADE = :acuracidade,
             CONSENSO_STATUS = :consensoStatus,
             RISCO_DIVERGENCIA = :risco,
             RECONTAGEM = :recontagem,
             RECONTAGEM_ORIGEM = :recontagemOrigem,
             INICIADO_EM = TO_TIMESTAMP(:iniciadoEm, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3TZH:TZM'),
             CONCLUIDO_EM = TO_TIMESTAMP(:concluidoEm, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3TZH:TZM'),
             UPDATED_BY = :updatedBy,
             UPDATED_AT = SYSTIMESTAMP
       WHERE ID = :id`,
      {
        id,
        status: String(merged.status ?? current.status),
        responsavel: merged.responsavel ?? null,
        itensContados: asNumber(merged.itensContados, current.itensContados),
        itensDivergentes: asNumber(merged.itensDivergentes, current.itensDivergentes),
        acuracidade: asNumber(merged.acuracidade, current.acuracidade),
        consensoStatus: merged.consenso?.status ?? current.consenso?.status ?? "NAO_APLICAVEL",
        risco: merged.riscoDivergencia ?? calculateRiskLevel(asNumber(merged.acuracidade, current.acuracidade)),
        recontagem: merged.recontagem ? 1 : 0,
        recontagemOrigem: merged.recontagemOrigem ?? null,
        iniciadoEm: merged.iniciadoEm ?? null,
        concluidoEm: merged.concluidoEm ?? null,
        updatedBy: actor?.userName ?? "system",
      },
    );

    if (Array.isArray(input.itens)) {
      for (const item of input.itens) {
        const qtd1 = item.contagens?.primeira ?? item.qtdContagem1 ?? null;
        const qtd2 = item.contagens?.segunda ?? item.qtdContagem2 ?? null;
        const qtd3 = item.contagens?.terceira ?? item.qtdContagem3 ?? null;
        const consenso = deriveConsensusStatus(
          qtd1 == null ? null : asNumber(qtd1),
          qtd2 == null ? null : asNumber(qtd2),
          qtd3 == null ? null : asNumber(qtd3),
        );
        const estoqueSistema = asNumber(item.estoqueSistema, 0);
        const diferenca = consenso.consenso == null ? null : consenso.consenso - estoqueSistema;

        await execDml(
          `UPDATE ITENS_CONTAGEM
              SET QTD_CONTAGEM_1 = :qtd1,
                  QTD_CONTAGEM_2 = :qtd2,
                  QTD_CONTAGEM_3 = :qtd3,
                  QTD_CONSENSO = :qtdConsenso,
                  DIFERENCA = :diferenca,
                  STATUS_CONSENSO = :statusConsenso,
                  ESCALADO_SUPERVISOR = :escalado,
                  MOTIVO_DIVERGENCIA = :motivo,
                  OBSERVACAO = :observacao,
                  UPDATED_AT = SYSTIMESTAMP
            WHERE ID = :id
              AND CONTAGEM_ID = :contagemId`,
          {
            id: String(item.id),
            contagemId: id,
            qtd1: qtd1 == null ? null : asNumber(qtd1),
            qtd2: qtd2 == null ? null : asNumber(qtd2),
            qtd3: qtd3 == null ? null : asNumber(qtd3),
            qtdConsenso: consenso.consenso,
            diferenca,
            statusConsenso: consenso.status,
            escalado: consenso.escalado ? 1 : 0,
            motivo: item.motivoDivergencia ?? (consenso.escalado ? "Sem consenso automatico em 3 contagens." : null),
            observacao: item.observacao ?? null,
          },
        );
      }
    }

    const rows = await queryRows<any>(
      `SELECT
        QTD_CONSENSO,
        ESTOQUE_SISTEMA,
        STATUS_CONSENSO,
        ESCALADO_SUPERVISOR
      FROM ITENS_CONTAGEM
      WHERE CONTAGEM_ID = :contagemId`,
      { contagemId: id },
    );

    const recalc = recalculateContagemFromItens(rows);
    await execDml(
      `UPDATE CONTAGENS
          SET ITENS_CONTADOS = :itensContados,
              ITENS_DIVERGENTES = :itensDivergentes,
              ACURACIDADE = :acuracidade,
              CONSENSO_STATUS = :consensoStatus,
              ESCALADO_SUPERVISOR = :escalado,
              RISCO_DIVERGENCIA = :risco
        WHERE ID = :id`,
      {
        id,
        itensContados: recalc.itensContados,
        itensDivergentes: recalc.itensDivergentes,
        acuracidade: recalc.acuracidade,
        consensoStatus: recalc.consensoStatus,
        escalado: recalc.escalado,
        risco: recalc.risco,
      },
    );

    await this.upsertDivergenciaDiaria(id);
    const updated = await this.getContagemById(id);
    await writeAuditEvent({
      modulo: "INVENTARIO",
      acao: "ATUALIZAR",
      entidade: "CONTAGEM",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: "Contagem atualizada com recalc de consenso e acuracidade.",
      payload: { input, recalc },
    });
    return updated;
  },

  async validarContagem(id: string, validadoPor: string, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any | null> {
    const current = await this.getContagemById(id);
    if (!current) return null;
    const updated = await this.updateContagem(
      id,
      {
        status: "VALIDADO",
        validadoPor,
        validadoEm: nowIso(),
      },
      actor,
    );
    if (!isOracleEnabled()) {
      const idx = (db.inventarioContagens as any[]).findIndex((item) => item.id === id);
      if (idx >= 0) {
        (db.inventarioContagens as any[])[idx] = {
          ...(db.inventarioContagens as any[])[idx],
          status: "VALIDADO",
          validadoPor,
          validadoEm: nowIso(),
        };
      }
    } else {
      await execDml(
        `UPDATE CONTAGENS
            SET STATUS = 'VALIDADO',
                VALIDADO_POR = :validadoPor,
                VALIDADO_EM = SYSTIMESTAMP,
                UPDATED_BY = :updatedBy,
                UPDATED_AT = SYSTIMESTAMP
          WHERE ID = :id`,
        { id, validadoPor, updatedBy: actor?.userName ?? "system" },
      );
    }

    await writeAuditEvent({
      modulo: "INVENTARIO",
      acao: "VALIDAR",
      entidade: "CONTAGEM",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: `Contagem validada por ${validadoPor}.`,
    });
    return updated ?? this.getContagemById(id);
  },

  async solicitarRecontagem(id: string, solicitadoPor: string, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any | null> {
    const current = await this.getContagemById(id);
    if (!current) return null;
    const updated = await this.updateContagem(
      id,
      {
        status: "RECONTAGEM",
        recontagem: true,
        recontagemOrigem: current.recontagemOrigem || current.id,
      },
      actor,
    );
    await writeAuditEvent({
      modulo: "INVENTARIO",
      acao: "RECONTAGEM",
      entidade: "CONTAGEM",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: `Recontagem solicitada por ${solicitadoPor}.`,
    });
    return updated;
  },

  async upsertDivergenciaDiaria(contagemId: string): Promise<void> {
    if (!isOracleEnabled()) return;
    const contagem = await this.getContagemById(contagemId);
    if (!contagem) return;

    const existing = await queryOne<any>(`SELECT ID FROM DIVERGENCIAS_DIARIAS WHERE CONTAGEM_ID = :contagemId`, { contagemId });
    const id = existing?.ID ? String(existing.ID) : randomUUID();
    const nivel = calculateRiskLevel(asNumber(contagem.acuracidade, 0));

    if (existing?.ID) {
      await execDml(
        `UPDATE DIVERGENCIAS_DIARIAS
            SET DATA_REFERENCIA = TO_DATE(:dataRef, 'YYYY-MM-DD'),
                LOJA_ID = :lojaId,
                DEPARTAMENTO_ID = :departamentoId,
                ITENS_CONTADOS = :itensContados,
                ITENS_DIVERGENTES = :itensDivergentes,
                ACURACIDADE = :acuracidade,
                NIVEL = :nivel,
                STATUS_CONTAGEM = :statusContagem,
                SUPERVISOR = :supervisor
          WHERE ID = :id`,
        {
          id,
          dataRef: contagem.data,
          lojaId: contagem.lojaId,
          departamentoId: contagem.departamentoId,
          itensContados: contagem.itensContados,
          itensDivergentes: contagem.itensDivergentes,
          acuracidade: contagem.acuracidade,
          nivel,
          statusContagem: contagem.status,
          supervisor: contagem.supervisor ?? null,
        },
      );
      return;
    }

    await execDml(
      `INSERT INTO DIVERGENCIAS_DIARIAS (
        ID, DATA_REFERENCIA, CONTAGEM_ID, LOJA_ID, DEPARTAMENTO_ID, ITENS_CONTADOS,
        ITENS_DIVERGENTES, ACURACIDADE, NIVEL, STATUS_CONTAGEM, SUPERVISOR
      ) VALUES (
        :id, TO_DATE(:dataRef, 'YYYY-MM-DD'), :contagemId, :lojaId, :departamentoId, :itensContados,
        :itensDivergentes, :acuracidade, :nivel, :statusContagem, :supervisor
      )`,
      {
        id,
        dataRef: contagem.data,
        contagemId,
        lojaId: contagem.lojaId,
        departamentoId: contagem.departamentoId,
        itensContados: contagem.itensContados,
        itensDivergentes: contagem.itensDivergentes,
        acuracidade: contagem.acuracidade,
        nivel,
        statusContagem: contagem.status,
        supervisor: contagem.supervisor ?? null,
      },
    );
  },

  async listDivergencias(): Promise<any[]> {
    if (!isOracleEnabled()) return db.inventarioDivergencias;
    const rows = await queryRows<any>(
      `SELECT
        TO_CHAR(d.DATA_REFERENCIA, 'YYYY-MM-DD') AS DATA_REFERENCIA,
        d.LOJA_ID,
        l.NOME AS LOJA_NOME,
        l.SUPERVISOR,
        dep.NOME AS DEPARTAMENTO_NOME,
        d.ITENS_CONTADOS,
        d.ITENS_DIVERGENTES,
        d.ACURACIDADE,
        d.STATUS_CONTAGEM,
        d.CONTAGEM_ID,
        d.NIVEL
      FROM DIVERGENCIAS_DIARIAS d
      JOIN LOJAS_INVENTARIO l ON l.ID = d.LOJA_ID
      JOIN DEPARTAMENTOS_INVENTARIO dep ON dep.ID = d.DEPARTAMENTO_ID
      ORDER BY d.DATA_REFERENCIA DESC`,
    );
    return rows.map((row) => ({
      data: normalizeDate(String(row.DATA_REFERENCIA)) ?? "",
      lojaId: String(row.LOJA_ID),
      lojaNome: String(row.LOJA_NOME),
      supervisor: String(row.SUPERVISOR ?? ""),
      departamento: String(row.DEPARTAMENTO_NOME),
      frequencia: "DIARIA",
      itensContados: asNumber(row.ITENS_CONTADOS),
      itensDivergentes: asNumber(row.ITENS_DIVERGENTES),
      acuracidade: asNumber(row.ACURACIDADE),
      status: String(row.STATUS_CONTAGEM) as InventoryStatus,
      contagemId: String(row.CONTAGEM_ID),
      nivel: String(row.NIVEL),
    }));
  },

  async getDashboard(): Promise<any> {
    const contagens = await this.listContagens();
    const concluidas = contagens.filter((c) => ["CONCLUIDO", "VALIDADO"].includes(c.status));
    const acuracidadeMedia = concluidas.length > 0
      ? Number((concluidas.reduce((sum, c) => sum + asNumber(c.acuracidade), 0) / concluidas.length).toFixed(2))
      : 0;

    return {
      totalContagens: contagens.length,
      contagensConcluidas: concluidas.length,
      contagensPendentes: contagens.filter((c) => ["NAO_INICIADO", "EM_ANDAMENTO", "RECONTAGEM"].includes(c.status)).length,
      acuracidadeMedia,
      lojasComDivergenciaAlta: contagens.filter((c) => calculateRiskLevel(asNumber(c.acuracidade)) === "alta").length,
      totalItensContados: concluidas.reduce((sum, c) => sum + asNumber(c.itensContados), 0),
      totalItensDivergentes: concluidas.reduce((sum, c) => sum + asNumber(c.itensDivergentes), 0),
    };
  },

  async listChecklists(): Promise<any[]> {
    if (!isOracleEnabled()) {
      return ensureFallbackChecklists();
    }

    const rows = await queryRows<any>(
      `SELECT ID
       FROM CHECKLISTS_PRE_INVENTARIO
       ORDER BY DATA_PREVISTA_INVENTARIO DESC, ID`,
    );
    const result: any[] = [];
    for (const row of rows) {
      const checklist = await loadChecklistByIdOracle(String(row.ID));
      if (checklist) result.push(checklist);
    }
    return result;
  },

  async getChecklistById(id: string): Promise<any | null> {
    if (!isOracleEnabled()) {
      const checklist = ensureFallbackChecklists().find((item) => item.id === id);
      if (!checklist) return null;
      return {
        ...checklist,
        blocos: checklist.blocos.map((bloco: any) => ({
          ...bloco,
          itens: bloco.itens.map((item: any) => mapChecklistItemFallback(item)),
        })),
      };
    }
    return loadChecklistByIdOracle(id);
  },

  async createChecklist(payload: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any> {
    const id = String(payload?.id ?? randomUUID());
    const nome = String(payload?.nome ?? "Checklist Pre-Inventario");
    const unidade = String(payload?.unidade ?? "MAO");
    const tipoInventario = String(payload?.tipoInventario ?? payload?.tipo ?? "Inventario Geral");
    const dataPrevistaInventario = normalizeDate(String(payload?.dataPrevistaInventario ?? payload?.dataPrevista ?? new Date().toISOString().slice(0, 10))) ?? new Date().toISOString().slice(0, 10);
    const responsavelGeral = String(payload?.responsavelGeral ?? payload?.responsavel ?? actor?.userName ?? "Responsavel");
    const observacoes = payload?.observacoes ? String(payload.observacoes) : null;
    const criadoPor = actor?.userName ?? String(payload?.criadoPor ?? "system");

    if (!isOracleEnabled()) {
      const list = ensureFallbackChecklists();
      const novo = {
        id,
        nome,
        unidade,
        tipoInventario,
        dataPrevistaInventario,
        responsavelGeral,
        observacoes: observacoes ?? undefined,
        statusGeral: "ABERTO" as ChecklistStatusGeral,
        criadoPor,
        criadoEm: nowIso(),
        blocos: CHECKLIST_PRE_INVENTARIO_TEMPLATE.map((bloco) => ({
          id: `${id}-${bloco.codigo}`,
          ordem: bloco.ordem,
          nome: bloco.nome,
          itens: bloco.itens.map((item, idx) => ({
            id: `${id}-${bloco.codigo}-I${String(idx + 1).padStart(2, "0")}`,
            blocoId: `${id}-${bloco.codigo}`,
            descricao: item.descricao,
            status: "PENDENTE" as ChecklistStatus,
            responsavel: responsavelGeral,
            data: dataPrevistaInventario,
            setor: "Operacao",
            criticidade: item.criticidade,
            nc: false,
            planoAcao: undefined,
            observacao: undefined,
            evidencia: undefined,
            evidencias: [],
            historico: [
              {
                id: randomUUID(),
                data: nowIso(),
                usuario: criadoPor,
                acao: "CRIACAO",
                detalhe: "Item criado automaticamente no checklist.",
              },
            ],
          })),
        })),
      };
      list.unshift(novo);
      await writeAuditEvent({
        modulo: "CHECKLIST_PRE_INVENTARIO",
        acao: "CRIAR",
        entidade: "CHECKLIST",
        entidadeId: id,
        usuarioId: actor?.userId,
        usuarioNome: actor?.userName,
        perfil: actor?.profile,
        detalhe: "Checklist criado no fallback in-memory.",
      });
      return novo;
    }

    await execDml(
      `INSERT INTO CHECKLISTS_PRE_INVENTARIO (
        ID, NOME, UNIDADE, DATA_PREVISTA_INVENTARIO, TIPO_INVENTARIO, RESPONSAVEL_GERAL,
        STATUS_GERAL, OBSERVACOES, PROGRESSO_GERAL, BLOQUEAR_CONCLUSAO_POR_NC, MODELO_ID, CRIADO_POR, UPDATED_BY
      ) VALUES (
        :id, :nome, :unidade, TO_DATE(:dataPrevista, 'YYYY-MM-DD'), :tipoInventario, :responsavelGeral,
        'ABERTO', :observacoes, 0, 1, 'CKLMODEL-001', :criadoPor, :updatedBy
      )`,
      {
        id,
        nome,
        unidade,
        dataPrevista: dataPrevistaInventario,
        tipoInventario,
        responsavelGeral,
        observacoes,
        criadoPor,
        updatedBy: criadoPor,
      },
    );

    for (const bloco of CHECKLIST_PRE_INVENTARIO_TEMPLATE) {
      const blocoId = `${id}-${bloco.codigo}`;
      await execDml(
        `INSERT INTO CHECKLIST_BLOCOS (ID, CHECKLIST_ID, CODIGO, ORDEM, NOME, PROGRESSO, TOTAL_ITENS)
         VALUES (:id, :checklistId, :codigo, :ordem, :nome, 0, :totalItens)`,
        {
          id: blocoId,
          checklistId: id,
          codigo: bloco.codigo,
          ordem: bloco.ordem,
          nome: bloco.nome,
          totalItens: bloco.itens.length,
        },
      );

      let ordem = 1;
      for (const item of bloco.itens) {
        const itemId = `${blocoId}-I${String(ordem).padStart(2, "0")}`;
        await execDml(
          `INSERT INTO CHECKLIST_ITENS (
            ID, CHECKLIST_ID, BLOCO_ID, CODIGO, ORDEM, DESCRICAO, STATUS, RESPONSAVEL, DATA_REFERENCIA, SETOR, CRITICIDADE, NC_ABERTA, ULTIMA_ALTERACAO_POR
          ) VALUES (
            :id, :checklistId, :blocoId, :codigo, :ordem, :descricao, 'PENDENTE', :responsavel, TO_DATE(:dataRef, 'YYYY-MM-DD'), :setor, :criticidade, 0, :usuario
          )`,
          {
            id: itemId,
            checklistId: id,
            blocoId,
            codigo: `${bloco.codigo}-${String(ordem).padStart(2, "0")}`,
            ordem,
            descricao: item.descricao,
            responsavel: responsavelGeral,
            dataRef: dataPrevistaInventario,
            setor: "Operacao",
            criticidade: item.criticidade,
            usuario: criadoPor,
          },
        );
        await execDml(
          `INSERT INTO CHECKLIST_ITENS_HISTORICO (ID, CHECKLIST_ID, ITEM_ID, ACAO, DETALHE, USUARIO, VALOR_NOVO)
           VALUES (:id, :checklistId, :itemId, 'CRIACAO', 'Item criado automaticamente no checklist.', :usuario, :valorNovo)`,
          {
            id: randomUUID(),
            checklistId: id,
            itemId,
            usuario: criadoPor,
            valorNovo: JSON.stringify({ status: "PENDENTE" }),
          },
        );
        ordem += 1;
      }
    }

    await writeAuditEvent({
      modulo: "CHECKLIST_PRE_INVENTARIO",
      acao: "CRIAR",
      entidade: "CHECKLIST",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: "Checklist criado com 10 blocos e 47 itens.",
    });
    return loadChecklistByIdOracle(id);
  },

  async updateChecklist(id: string, payload: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any | null> {
    if (!isOracleEnabled()) {
      const list = ensureFallbackChecklists();
      const idx = list.findIndex((item) => item.id === id);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...payload };
      return list[idx];
    }

    const current = await loadChecklistByIdOracle(id);
    if (!current) return null;

    await execDml(
      `UPDATE CHECKLISTS_PRE_INVENTARIO
          SET NOME = :nome,
              UNIDADE = :unidade,
              DATA_PREVISTA_INVENTARIO = TO_DATE(:dataPrevista, 'YYYY-MM-DD'),
              TIPO_INVENTARIO = :tipoInventario,
              RESPONSAVEL_GERAL = :responsavelGeral,
              STATUS_GERAL = :statusGeral,
              OBSERVACOES = :observacoes,
              BLOQUEAR_CONCLUSAO_POR_NC = :bloqueioNc,
              UPDATED_AT = SYSTIMESTAMP,
              UPDATED_BY = :updatedBy
        WHERE ID = :id`,
      {
        id,
        nome: payload.nome ?? current.nome,
        unidade: payload.unidade ?? current.unidade,
        dataPrevista: normalizeDate(String(payload.dataPrevistaInventario ?? current.dataPrevistaInventario)) ?? current.dataPrevistaInventario,
        tipoInventario: payload.tipoInventario ?? current.tipoInventario,
        responsavelGeral: payload.responsavelGeral ?? current.responsavelGeral,
        statusGeral: payload.statusGeral ?? current.statusGeral,
        observacoes: payload.observacoes ?? current.observacoes ?? null,
        bloqueioNc: payload.bloquearConclusaoPorNc === false ? 0 : 1,
        updatedBy: actor?.userName ?? "system",
      },
    );

    if (payload.statusGeral !== "CANCELADO") {
      await recalcChecklistStatusOracle(id);
    }
    return loadChecklistByIdOracle(id);
  },

  async deleteChecklist(id: string, actor?: { userId?: string; userName?: string; profile?: string }): Promise<boolean> {
    if (!isOracleEnabled()) {
      const list = ensureFallbackChecklists();
      const idx = list.findIndex((item) => item.id === id);
      if (idx < 0) return false;
      list.splice(idx, 1);
      return true;
    }

    const exists = await queryOne<any>(`SELECT ID FROM CHECKLISTS_PRE_INVENTARIO WHERE ID = :id`, { id });
    if (!exists) return false;

    await execDml(`DELETE FROM CHECKLIST_ITENS_HISTORICO WHERE CHECKLIST_ID = :id`, { id });
    await execDml(`DELETE FROM CHECKLIST_ITENS_EVIDENCIAS WHERE CHECKLIST_ID = :id`, { id });
    await execDml(`DELETE FROM CHECKLIST_ITENS WHERE CHECKLIST_ID = :id`, { id });
    await execDml(`DELETE FROM CHECKLIST_BLOCOS WHERE CHECKLIST_ID = :id`, { id });
    await execDml(`DELETE FROM CHECKLISTS_PRE_INVENTARIO WHERE ID = :id`, { id });

    await writeAuditEvent({
      modulo: "CHECKLIST_PRE_INVENTARIO",
      acao: "EXCLUIR",
      entidade: "CHECKLIST",
      entidadeId: id,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: "Checklist removido.",
    });

    return true;
  },

  async updateChecklistItem(checklistId: string, itemId: string, payload: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any | null> {
    if (!isOracleEnabled()) {
      const checklist = ensureFallbackChecklists().find((item) => item.id === checklistId);
      if (!checklist) return null;
      const item = checklist.blocos.flatMap((bloco: any) => bloco.itens).find((it: any) => it.id === itemId);
      if (!item) return null;
      const previous = { ...item };
      Object.assign(item, payload);
      item.historico = [
        {
          id: randomUUID(),
          data: nowIso(),
          usuario: actor?.userName ?? "system",
          acao: "ATUALIZACAO",
          detalhe: "Item atualizado.",
        },
        ...(item.historico ?? []),
      ];
      const summary = calculateChecklistSummary(
        checklist.blocos.flatMap((bloco: any) => bloco.itens).map((it: any) => ({ status: it.status as ChecklistStatus, ncAberta: !!it.nc })),
        true,
      );
      checklist.statusGeral = summary.statusGeral;
      await writeAuditEvent({
        modulo: "CHECKLIST_PRE_INVENTARIO",
        acao: "ATUALIZAR_ITEM",
        entidade: "CHECKLIST_ITEM",
        entidadeId: itemId,
        usuarioId: actor?.userId,
        usuarioNome: actor?.userName,
        perfil: actor?.profile,
        detalhe: "Item atualizado em fallback in-memory.",
        payload: { previous, current: item },
      });
      return mapChecklistItemFallback(item);
    }

    const current = await queryOne<any>(
      `SELECT
        ID,
        STATUS,
        RESPONSAVEL,
        TO_CHAR(DATA_REFERENCIA, 'YYYY-MM-DD') AS DATA_REFERENCIA,
        SETOR,
        CRITICIDADE,
        NC_ABERTA,
        PLANO_ACAO,
        OBSERVACAO,
        EVIDENCIA_RESUMO
       FROM CHECKLIST_ITENS
       WHERE CHECKLIST_ID = :checklistId
         AND ID = :itemId`,
      { checklistId, itemId },
    );
    if (!current) return null;

    const merged = {
      status: (payload.status ?? current.STATUS) as ChecklistStatus,
      responsavel: payload.responsavel ?? current.RESPONSAVEL ?? null,
      dataReferencia: normalizeDate(String(payload.data ?? current.DATA_REFERENCIA)) ?? normalizeDate(String(current.DATA_REFERENCIA)),
      setor: payload.setor ?? current.SETOR ?? null,
      criticidade: (payload.criticidade ?? current.CRITICIDADE) as ChecklistCriticidade,
      ncAberta: payload.nc == null ? Number(current.NC_ABERTA ?? 0) === 1 : !!payload.nc,
      planoAcao: payload.planoAcao ?? current.PLANO_ACAO ?? null,
      observacao: payload.observacao ?? current.OBSERVACAO ?? null,
      evidenciaResumo: payload.evidencia ?? payload.evidenciaResumo ?? current.EVIDENCIA_RESUMO ?? null,
    };

    await execDml(
      `UPDATE CHECKLIST_ITENS
          SET STATUS = :status,
              RESPONSAVEL = :responsavel,
              DATA_REFERENCIA = TO_DATE(:dataReferencia, 'YYYY-MM-DD'),
              SETOR = :setor,
              CRITICIDADE = :criticidade,
              NC_ABERTA = :ncAberta,
              PLANO_ACAO = :planoAcao,
              OBSERVACAO = :observacao,
              EVIDENCIA_RESUMO = :evidenciaResumo,
              ULTIMA_ALTERACAO_EM = SYSTIMESTAMP,
              ULTIMA_ALTERACAO_POR = :usuario,
              UPDATED_AT = SYSTIMESTAMP
        WHERE ID = :itemId
          AND CHECKLIST_ID = :checklistId`,
      {
        checklistId,
        itemId,
        status: merged.status,
        responsavel: merged.responsavel,
        dataReferencia: merged.dataReferencia,
        setor: merged.setor,
        criticidade: merged.criticidade,
        ncAberta: merged.ncAberta ? 1 : 0,
        planoAcao: merged.planoAcao,
        observacao: merged.observacao,
        evidenciaResumo: merged.evidenciaResumo,
        usuario: actor?.userName ?? "system",
      },
    );

    await execDml(
      `INSERT INTO CHECKLIST_ITENS_HISTORICO (
        ID, CHECKLIST_ID, ITEM_ID, ACAO, DETALHE, USUARIO, VALOR_ANTERIOR, VALOR_NOVO
      ) VALUES (
        :id, :checklistId, :itemId, :acao, :detalhe, :usuario, :valorAnterior, :valorNovo
      )`,
      {
        id: randomUUID(),
        checklistId,
        itemId,
        acao: "ATUALIZACAO",
        detalhe: "Item atualizado via API.",
        usuario: actor?.userName ?? "system",
        valorAnterior: JSON.stringify({
          status: current.STATUS,
          responsavel: current.RESPONSAVEL,
          data: current.DATA_REFERENCIA,
          setor: current.SETOR,
          criticidade: current.CRITICIDADE,
          nc: Number(current.NC_ABERTA ?? 0) === 1,
          planoAcao: current.PLANO_ACAO,
          observacao: current.OBSERVACAO,
          evidencia: current.EVIDENCIA_RESUMO,
        }),
        valorNovo: JSON.stringify(merged),
      },
    );

    await recalcChecklistStatusOracle(checklistId);
    await writeAuditEvent({
      modulo: "CHECKLIST_PRE_INVENTARIO",
      acao: "ATUALIZAR_ITEM",
      entidade: "CHECKLIST_ITEM",
      entidadeId: itemId,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: "Item de checklist atualizado.",
      payload: merged,
    });

    const checklist = await loadChecklistByIdOracle(checklistId);
    if (!checklist) return null;
    const item = checklist.blocos.flatMap((bloco: any) => bloco.itens).find((it: any) => it.id === itemId);
    return item ?? null;
  },

  async listChecklistItemHistorico(checklistId: string, itemId: string): Promise<any[]> {
    if (!isOracleEnabled()) {
      const checklist = ensureFallbackChecklists().find((item) => item.id === checklistId);
      const item = checklist?.blocos.flatMap((bloco: any) => bloco.itens).find((it: any) => it.id === itemId);
      return item?.historico ?? [];
    }

    const rows = await queryRows<any>(
      `SELECT ID, ACAO, DETALHE, USUARIO, DATA_EVENTO, VALOR_ANTERIOR, VALOR_NOVO
       FROM CHECKLIST_ITENS_HISTORICO
       WHERE CHECKLIST_ID = :checklistId
         AND ITEM_ID = :itemId
       ORDER BY DATA_EVENTO DESC`,
      { checklistId, itemId },
    );
    return rows.map((row) => ({
      id: String(row.ID),
      data: normalizeTimestamp(String(row.DATA_EVENTO)) ?? String(row.DATA_EVENTO),
      usuario: String(row.USUARIO ?? "system"),
      acao: String(row.ACAO ?? ""),
      detalhe: String(row.DETALHE ?? ""),
      valorAnterior: row.VALOR_ANTERIOR ? String(row.VALOR_ANTERIOR) : undefined,
      valorNovo: row.VALOR_NOVO ? String(row.VALOR_NOVO) : undefined,
    }));
  },

  async addChecklistItemEvidence(checklistId: string, itemId: string, payload: any, actor?: { userId?: string; userName?: string; profile?: string }): Promise<any> {
    const nomeArquivo = String(payload.nomeArquivo ?? payload.nome ?? payload.fileName ?? `evidencia-${itemId}.txt`);
    const caminho = String(payload.caminho ?? payload.path ?? payload.storageKey ?? "");
    const mimeType = payload.mimeType ? String(payload.mimeType) : "application/octet-stream";
    const tamanho = asNumber(payload.tamanho ?? payload.size ?? 0, 0);
    const descricao = payload.descricao ? String(payload.descricao) : null;

    if (!isOracleEnabled()) {
      const checklist = ensureFallbackChecklists().find((item) => item.id === checklistId);
      if (!checklist) throw new Error("Checklist nao encontrado.");
      const item = checklist.blocos.flatMap((bloco: any) => bloco.itens).find((it: any) => it.id === itemId);
      if (!item) throw new Error("Item nao encontrado.");
      item.evidencias = [nomeArquivo, ...(item.evidencias ?? [])];
      item.evidencia = nomeArquivo;
      return { id: randomUUID(), nomeArquivo, caminho, mimeType, tamanho, descricao };
    }

    const anexoId = randomUUID();
    await execDml(
      `INSERT INTO SGQ_ANEXOS (
        ID, MODULO, ORIGEM_ENTIDADE, ORIGEM_ID, NOME_ORIGINAL, NOME_ARMAZENADO, STORAGE_KEY, MIME_TYPE, TAMANHO_BYTES, USUARIO_UPLOAD
      ) VALUES (
        :id, 'CHECKLIST_PRE_INVENTARIO', 'CHECKLIST_ITEM', :origemId, :nomeOriginal, :nomeArmazenado, :storageKey, :mimeType, :tamanhoBytes, :usuarioUpload
      )`,
      {
        id: anexoId,
        origemId: itemId,
        nomeOriginal: nomeArquivo,
        nomeArmazenado: nomeArquivo,
        storageKey: caminho || `checklist/${checklistId}/${itemId}/${nomeArquivo}`,
        mimeType,
        tamanhoBytes: tamanho,
        usuarioUpload: actor?.userName ?? "system",
      },
    );

    const evidenciaId = randomUUID();
    await execDml(
      `INSERT INTO CHECKLIST_ITENS_EVIDENCIAS (
        ID, CHECKLIST_ID, ITEM_ID, ANEXO_ID, NOME_ARQUIVO, CAMINHO, MIME_TYPE, TAMANHO_BYTES, DESCRICAO, CRIADO_POR
      ) VALUES (
        :id, :checklistId, :itemId, :anexoId, :nomeArquivo, :caminho, :mimeType, :tamanhoBytes, :descricao, :criadoPor
      )`,
      {
        id: evidenciaId,
        checklistId,
        itemId,
        anexoId,
        nomeArquivo,
        caminho: caminho || null,
        mimeType,
        tamanhoBytes: tamanho,
        descricao,
        criadoPor: actor?.userName ?? "system",
      },
    );

    await execDml(
      `UPDATE CHECKLIST_ITENS
          SET EVIDENCIA_RESUMO = :evidenciaResumo,
              UPDATED_AT = SYSTIMESTAMP,
              ULTIMA_ALTERACAO_EM = SYSTIMESTAMP,
              ULTIMA_ALTERACAO_POR = :usuario
        WHERE CHECKLIST_ID = :checklistId
          AND ID = :itemId`,
      {
        checklistId,
        itemId,
        evidenciaResumo: nomeArquivo,
        usuario: actor?.userName ?? "system",
      },
    );

    await execDml(
      `INSERT INTO CHECKLIST_ITENS_HISTORICO (
        ID, CHECKLIST_ID, ITEM_ID, ACAO, DETALHE, USUARIO, VALOR_NOVO
      ) VALUES (
        :id, :checklistId, :itemId, 'EVIDENCIA', :detalhe, :usuario, :valorNovo
      )`,
      {
        id: randomUUID(),
        checklistId,
        itemId,
        detalhe: `Evidencia anexada: ${nomeArquivo}`,
        usuario: actor?.userName ?? "system",
        valorNovo: JSON.stringify({ anexoId, nomeArquivo, caminho, mimeType, tamanho }),
      },
    );

    await writeAuditEvent({
      modulo: "CHECKLIST_PRE_INVENTARIO",
      acao: "UPLOAD_EVIDENCIA",
      entidade: "CHECKLIST_ITEM",
      entidadeId: itemId,
      usuarioId: actor?.userId,
      usuarioNome: actor?.userName,
      perfil: actor?.profile,
      detalhe: `Evidencia anexada: ${nomeArquivo}.`,
    });

    return {
      id: evidenciaId,
      anexoId,
      nomeArquivo,
      caminho,
      mimeType,
      tamanho,
      descricao: descricao ?? undefined,
    };
  },

  async getChecklistDashboard(): Promise<any> {
    const checklists = await this.listChecklists();
    const allItems = checklists.flatMap((checklist) =>
      checklist.blocos.flatMap((bloco: any) => bloco.itens.map((item: any) => ({
        ...item,
        checklistId: checklist.id,
        checklistNome: checklist.nome,
      }))),
    );
    const total = allItems.length;
    const concluidos = allItems.filter((item) => item.status === "CONCLUIDO").length;
    const pendentes = allItems.filter((item) => item.status === "PENDENTE").length;
    const emAndamento = allItems.filter((item) => item.status === "EM_ANDAMENTO").length;
    const criticos = allItems.filter((item) => item.criticidade === "ALTA" && item.status !== "CONCLUIDO").length;
    const ncs = allItems.filter((item) => !!item.nc).length;
    const semResponsavel = allItems.filter((item) => !item.responsavel).length;
    const semEvidencia = allItems.filter((item) => !item.evidencia && (!Array.isArray(item.evidencias) || item.evidencias.length === 0)).length;
    const progresso = total > 0 ? Number(((concluidos / total) * 100).toFixed(2)) : 0;

    return {
      totalChecklists: checklists.length,
      totalItens: total,
      concluidos,
      pendentes,
      emAndamento,
      criticos,
      ncs,
      semResponsavel,
      semEvidencia,
      progresso,
      bloqueadosPorNc: checklists.filter((checklist) => checklist.statusGeral !== "CONCLUIDO"
        && checklist.blocos.some((bloco: any) => bloco.itens.some((item: any) => !!item.nc))).length,
    };
  },
};
