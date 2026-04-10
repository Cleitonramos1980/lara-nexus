import { db, nextId, appendAudit } from "./dataStore.js";
import type {
  AuditoriaCamada,
  AudExec,
  AvaliacaoRiscoSla,
  Capa,
  ConsumoPeca,
  DocumentoQualidade,
  EstudoMsa,
  FornecedorQualidade,
  GateFornecedor,
  GarantiaCaso,
  IndicadorIndustrial,
  InstrumentoMetrologia,
  IsoReadinessItem,
  MudancaQualidade,
  NCRegistro,
  OsAssistencia,
  OSTransitionLog,
  ReqMaterial,
  RegraRiscoSla,
  SACAtendimentoAnexo,
  SACAtendimento,
  SACRequisicao,
  ScarFornecedor,
  TreinamentoParticipante,
  TreinamentoQualidade,
  Usuario,
  Parametro,
} from "../types/contracts.js";

export const adminRepo = {
  getUsuarios: (): Usuario[] => db.usuarios,
  createUsuario: (payload: Omit<Usuario, "id">): Usuario => {
    const user: Usuario = { ...payload, id: nextId("USR", db.usuarios.length) };
    db.usuarios.push(user);
    appendAudit("CRIAR", "USUARIO", user.id, `Usuário ${user.nome} criado`, "system");
    return user;
  },
  updateUsuario: (id: string, payload: Partial<Usuario>): Usuario | null => {
    const i = db.usuarios.findIndex((u) => u.id === id);
    if (i < 0) return null;
    db.usuarios[i] = { ...db.usuarios[i], ...payload };
    appendAudit("ATUALIZAR", "USUARIO", id, `Usuário atualizado`, "system");
    return db.usuarios[i];
  },
  getPerfis: () => [
    "ADMIN",
    "SAC",
    "QUALIDADE",
    "AUDITOR",
    "ASSISTENCIA",
    "TECNICO",
    "ALMOX",
    "DIRETORIA",
    "VALIDACAO",
    "CORPORATIVO_SST",
    "SESMT",
    "TECNICO_SEGURANCA",
    "ENFERMAGEM_TRABALHO",
    "MEDICO_TRABALHO",
    "RH",
    "GESTOR_UNIDADE",
    "LEITOR_RESTRITO",
    "GESTOR_CONTRATOS",
    "TERCEIRO_CONSULTA_LIMITADA",
    "LIDER_OPERACIONAL",
    "RH_OCUPACIONAL",
    "COMITE_SST",
    "DIRETOR_EXECUTIVO_SST",
  ],
  getAuditLog: () => db.auditLog,
  getParametros: (): Parametro[] => db.parametros,
  updateParametro: (chave: string, valor: string): Parametro | null => {
    const i = db.parametros.findIndex((p) => p.chave === chave);
    if (i < 0) return null;
    db.parametros[i] = { ...db.parametros[i], valor };
    appendAudit("ATUALIZAR", "PARAMETRO", chave, `Parâmetro atualizado`, "system");
    return db.parametros[i];
  },
};

export const sacRepo = {
  list: (): SACAtendimento[] =>
    db.atendimentos.map((atendimento) => ({
      ...atendimento,
      anexos: db.sacAtendimentoAnexos.filter((anexo) => anexo.atendimentoId === atendimento.id),
    })),
  getById: (id: string): SACAtendimento | null => {
    const atendimento = db.atendimentos.find((a) => a.id === id);
    if (!atendimento) return null;
    return {
      ...atendimento,
      anexos: db.sacAtendimentoAnexos.filter((anexo) => anexo.atendimentoId === atendimento.id),
    };
  },
  create: (payload: Omit<SACAtendimento, "id" | "abertoAt" | "atualizadoAt" | "timeline" | "status"> & { status?: string }): SACAtendimento => {
    const rec: SACAtendimento = {
      ...payload,
      id: nextId("SAC", db.atendimentos.length),
      status: payload.status ?? "ABERTO",
      abertoAt: new Date().toISOString().slice(0, 10),
      atualizadoAt: new Date().toISOString().slice(0, 10),
      timeline: [],
      anexos: [],
    };
    db.atendimentos.push(rec);
    appendAudit("CRIAR", "SAC", rec.id, `Atendimento criado`, "system");
    return rec;
  },
  update: (id: string, payload: Partial<SACAtendimento>): SACAtendimento | null => {
    const i = db.atendimentos.findIndex((a) => a.id === id);
    if (i < 0) return null;
    db.atendimentos[i] = { ...db.atendimentos[i], ...payload, atualizadoAt: new Date().toISOString().slice(0, 10) };
    return {
      ...db.atendimentos[i],
      anexos: db.sacAtendimentoAnexos.filter((anexo) => anexo.atendimentoId === db.atendimentos[i].id),
    };
  },
  addAnexos: (
    atendimentoId: string,
    payload: Array<Omit<SACAtendimentoAnexo, "id" | "atendimentoId" | "criadoAt">>,
  ): SACAtendimentoAnexo[] => {
    const atendimento = db.atendimentos.find((a) => a.id === atendimentoId);
    if (!atendimento || payload.length === 0) return [];

    const created = payload.map((anexo) => ({
      ...anexo,
      id: nextId("ANX", db.sacAtendimentoAnexos.length),
      atendimentoId,
      criadoAt: new Date().toISOString(),
    }));

    db.sacAtendimentoAnexos.push(...created);
    appendAudit("CRIAR", "SAC_ANEXO", atendimentoId, `${created.length} anexo(s) vinculado(s)`, "system");
    return created;
  },
  listAnexos: (atendimentoId: string): SACAtendimentoAnexo[] =>
    db.sacAtendimentoAnexos.filter((anexo) => anexo.atendimentoId === atendimentoId),
  dashboard: () => {
    const list = db.atendimentos;
    const group = (key: (r: SACAtendimento) => string) =>
      Object.entries(list.reduce((acc, r) => {
        const k = key(r);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }));

    const byDay = Object.entries(list.reduce((acc, r) => {
      const day = r.abertoAt;
      acc[day] = (acc[day] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    return {
      porStatus: group((r) => r.status),
      porTipo: group((r) => r.tipoContato),
      porPlanta: group((r) => r.plantaResp),
      porDia: byDay,
    };
  },
};

export const sacReqRepo = {
  list: (): SACRequisicao[] => db.requisicoesSac,
  getById: (id: string): SACRequisicao | null => db.requisicoesSac.find((r) => r.id === id) ?? null,
  create: (payload: Omit<SACRequisicao, "id" | "criadoAt" | "atualizadoAt">): SACRequisicao => {
    const rec: SACRequisicao = {
      ...payload,
      id: nextId("REQ", db.requisicoesSac.length),
      criadoAt: new Date().toISOString().slice(0, 10),
      atualizadoAt: new Date().toISOString().slice(0, 10),
    };
    db.requisicoesSac.push(rec);
    appendAudit("CRIAR", "SAC_REQUISICAO", rec.id, `Requisição criada`, "system");
    return rec;
  },
  atender: (id: string, payload: Pick<SACRequisicao, "status" | "itens" | "observacoesAtendimento" | "atendidoPor">): SACRequisicao | null => {
    const i = db.requisicoesSac.findIndex((r) => r.id === id);
    if (i < 0) return null;
    db.requisicoesSac[i] = {
      ...db.requisicoesSac[i],
      ...payload,
      atendidoAt: new Date().toISOString().slice(0, 10),
      atualizadoAt: new Date().toISOString().slice(0, 10),
    };
    return db.requisicoesSac[i];
  },
  dashboard: () => {
    const reqs = db.requisicoesSac;
    return {
      pendentes: reqs.filter((r) => r.status === "PENDENTE").length,
      atendidasMes: reqs.filter((r) => ["ATENDIDA", "PARCIAL"].includes(r.status)).length,
      porPlanta: ["MAO", "BEL", "AGR"].map((name) => ({ name, value: reqs.filter((r) => r.plantaCd === name).length })),
      ultimasPendentes: reqs
        .filter((r) => r.status === "PENDENTE")
        .sort((a, b) => b.criadoAt.localeCompare(a.criadoAt))
        .slice(0, 10),
    };
  },
};

function updateCollection<T extends { id: string }>(arr: T[], id: string, payload: Partial<T>): T | null {
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...payload };
  return arr[i];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function riskScoreFromFactors(impacto: number, recorrencia: number, detectabilidade: number): number {
  return impacto * recorrencia * detectabilidade;
}

function buildSlaStatus(limiteAt: string): "NO_PRAZO" | "ALERTA" | "ATRASO" {
  const limit = new Date(limiteAt).getTime();
  const nowMs = Date.now();
  if (nowMs > limit) return "ATRASO";
  const hoursRemaining = (limit - nowMs) / (1000 * 60 * 60);
  if (hoursRemaining <= 6) return "ALERTA";
  return "NO_PRAZO";
}

export const qualidadeRepo = {
  listGarantias: (): GarantiaCaso[] => db.garantias,
  createGarantia: (payload: Omit<GarantiaCaso, "id" | "abertoAt">): GarantiaCaso => {
    const rec: GarantiaCaso = { ...payload, id: nextId("GAR", db.garantias.length), abertoAt: new Date().toISOString().slice(0, 10) };
    db.garantias.push(rec);
    return rec;
  },
  updateGarantia: (id: string, payload: Partial<GarantiaCaso>) => updateCollection(db.garantias, id, payload),

  listNcs: (): NCRegistro[] => db.ncs,
  createNc: (payload: Omit<NCRegistro, "id" | "abertoAt">): NCRegistro => {
    const rec: NCRegistro = { ...payload, id: nextId("NC", db.ncs.length), abertoAt: new Date().toISOString().slice(0, 10) };
    db.ncs.push(rec);
    return rec;
  },
  updateNc: (id: string, payload: Partial<NCRegistro>) => updateCollection(db.ncs, id, payload),

  listCapas: (): Capa[] => db.capas,
  createCapa: (payload: Omit<Capa, "id">): Capa => {
    const rec: Capa = { ...payload, id: nextId("CAPA", db.capas.length) };
    db.capas.push(rec);
    return rec;
  },

  dashboard: () => ({
    garantiaRate: db.garantias.length ? Number(((db.garantias.filter((g) => g.status !== "ENCERRADO").length / db.garantias.length) * 100).toFixed(2)) : 0,
    totalGarantias: db.garantias.length,
    totalNCs: db.ncs.length,
    avgResolutionDays: 12,
    topDefeitos: Object.entries(db.garantias.reduce((acc, g) => {
      acc[g.defeito] = (acc[g.defeito] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
    ncByGravidade: Object.entries(db.ncs.reduce((acc, n) => {
      acc[n.gravidade] = (acc[n.gravidade] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
    garantiasByMonth: [],
    ncByCategoria: Object.entries(db.ncs.reduce((acc, n) => {
      acc[n.tipoNc] = (acc[n.tipoNc] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
  }),
};

export const governancaQualidadeRepo = {
  listDocumentos: (): DocumentoQualidade[] => db.documentosQualidade,
  createDocumento: (
    payload: Omit<DocumentoQualidade, "id" | "createdAt" | "updatedAt">,
  ): DocumentoQualidade => {
    const rec: DocumentoQualidade = {
      ...payload,
      id: nextId("DOC", db.documentosQualidade.length),
      createdAt: today(),
      updatedAt: today(),
    };
    db.documentosQualidade.push(rec);
    appendAudit("CRIAR", "DOC_QUALIDADE", rec.id, `Documento ${rec.codigo} criado`, "system");
    return rec;
  },
  updateDocumento: (id: string, payload: Partial<DocumentoQualidade>): DocumentoQualidade | null => {
    const rec = updateCollection(db.documentosQualidade, id, {
      ...payload,
      updatedAt: today(),
    } as Partial<DocumentoQualidade>);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "DOC_QUALIDADE", id, "Documento atualizado", "system");
    return rec;
  },

  listTreinamentos: (): TreinamentoQualidade[] => db.treinamentosQualidade,
  createTreinamento: (
    payload: Omit<TreinamentoQualidade, "id">,
  ): TreinamentoQualidade => {
    const rec: TreinamentoQualidade = {
      ...payload,
      id: nextId("TRN", db.treinamentosQualidade.length),
    };
    db.treinamentosQualidade.push(rec);
    appendAudit("CRIAR", "TREINAMENTO", rec.id, "Treinamento criado", "system");
    return rec;
  },
  updateTreinamento: (id: string, payload: Partial<TreinamentoQualidade>): TreinamentoQualidade | null => {
    const rec = updateCollection(db.treinamentosQualidade, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "TREINAMENTO", id, "Treinamento atualizado", "system");
    return rec;
  },

  listParticipantes: (treinamentoId?: string): TreinamentoParticipante[] =>
    treinamentoId
      ? db.treinamentoParticipantes.filter((p) => p.treinamentoId === treinamentoId)
      : db.treinamentoParticipantes,
  addParticipante: (
    payload: Omit<TreinamentoParticipante, "id">,
  ): TreinamentoParticipante => {
    const rec: TreinamentoParticipante = {
      ...payload,
      id: nextId("TPA", db.treinamentoParticipantes.length),
    };
    db.treinamentoParticipantes.push(rec);
    appendAudit("CRIAR", "TREINAMENTO_PARTICIPANTE", rec.id, "Participante vinculado", "system");
    return rec;
  },
  updateParticipante: (
    id: string,
    payload: Partial<TreinamentoParticipante>,
  ): TreinamentoParticipante | null => {
    const rec = updateCollection(db.treinamentoParticipantes, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "TREINAMENTO_PARTICIPANTE", id, "Participante atualizado", "system");
    return rec;
  },

  listMudancas: (): MudancaQualidade[] => db.mudancasQualidade,
  createMudanca: (payload: Omit<MudancaQualidade, "id">): MudancaQualidade => {
    const rec: MudancaQualidade = {
      ...payload,
      id: nextId("MOC", db.mudancasQualidade.length),
    };
    db.mudancasQualidade.push(rec);
    appendAudit("CRIAR", "MUDANCA_QUALIDADE", rec.id, "Mudanca registrada", "system");
    return rec;
  },
  updateMudanca: (id: string, payload: Partial<MudancaQualidade>): MudancaQualidade | null => {
    const rec = updateCollection(db.mudancasQualidade, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "MUDANCA_QUALIDADE", id, "Mudanca atualizada", "system");
    return rec;
  },

  listFornecedores: (): FornecedorQualidade[] => db.fornecedoresQualidade,
  createFornecedor: (payload: Omit<FornecedorQualidade, "id">): FornecedorQualidade => {
    const rec: FornecedorQualidade = {
      ...payload,
      id: nextId("FOR", db.fornecedoresQualidade.length),
    };
    db.fornecedoresQualidade.push(rec);
    appendAudit("CRIAR", "FORNECEDOR_QUALIDADE", rec.id, "Fornecedor cadastrado", "system");
    return rec;
  },
  updateFornecedor: (id: string, payload: Partial<FornecedorQualidade>): FornecedorQualidade | null => {
    const rec = updateCollection(db.fornecedoresQualidade, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "FORNECEDOR_QUALIDADE", id, "Fornecedor atualizado", "system");
    return rec;
  },

  listScars: (fornecedorId?: string): ScarFornecedor[] =>
    fornecedorId
      ? db.scarsFornecedores.filter((s) => s.fornecedorId === fornecedorId)
      : db.scarsFornecedores,
  createScar: (payload: Omit<ScarFornecedor, "id">): ScarFornecedor => {
    const rec: ScarFornecedor = {
      ...payload,
      id: nextId("SCAR", db.scarsFornecedores.length),
    };
    db.scarsFornecedores.push(rec);
    appendAudit("CRIAR", "SCAR", rec.id, "SCAR criada", "system");
    return rec;
  },
  updateScar: (id: string, payload: Partial<ScarFornecedor>): ScarFornecedor | null => {
    const rec = updateCollection(db.scarsFornecedores, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "SCAR", id, "SCAR atualizada", "system");
    return rec;
  },

  listInstrumentosMetrologia: (): InstrumentoMetrologia[] => db.metrologiaInstrumentos,
  createInstrumentoMetrologia: (
    payload: Omit<InstrumentoMetrologia, "id">,
  ): InstrumentoMetrologia => {
    const rec: InstrumentoMetrologia = {
      ...payload,
      id: nextId("INS", db.metrologiaInstrumentos.length),
    };
    db.metrologiaInstrumentos.push(rec);
    appendAudit("CRIAR", "METROLOGIA_INSTRUMENTO", rec.id, "Instrumento cadastrado", "system");
    return rec;
  },
  updateInstrumentoMetrologia: (
    id: string,
    payload: Partial<InstrumentoMetrologia>,
  ): InstrumentoMetrologia | null => {
    const rec = updateCollection(db.metrologiaInstrumentos, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "METROLOGIA_INSTRUMENTO", id, "Instrumento atualizado", "system");
    return rec;
  },

  listEstudosMsa: (instrumentoId?: string): EstudoMsa[] =>
    instrumentoId
      ? db.metrologiaMsa.filter((m) => m.instrumentoId === instrumentoId)
      : db.metrologiaMsa,
  createEstudoMsa: (payload: Omit<EstudoMsa, "id">): EstudoMsa => {
    const rec: EstudoMsa = {
      ...payload,
      id: nextId("MSA", db.metrologiaMsa.length),
    };
    db.metrologiaMsa.push(rec);
    appendAudit("CRIAR", "MSA_ESTUDO", rec.id, "Estudo MSA registrado", "system");
    return rec;
  },
  updateEstudoMsa: (id: string, payload: Partial<EstudoMsa>): EstudoMsa | null => {
    const rec = updateCollection(db.metrologiaMsa, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "MSA_ESTUDO", id, "Estudo MSA atualizado", "system");
    return rec;
  },

  listIndicadoresIndustriais: (filters?: { planta?: string; linha?: string }): IndicadorIndustrial[] => {
    return db.indicadoresIndustriais.filter((item) => {
      if (filters?.planta && item.planta !== filters.planta) return false;
      if (filters?.linha && item.linha !== filters.linha) return false;
      return true;
    });
  },
  createIndicadorIndustrial: (payload: Omit<IndicadorIndustrial, "id">): IndicadorIndustrial => {
    const rec: IndicadorIndustrial = {
      ...payload,
      id: nextId("KPI", db.indicadoresIndustriais.length),
    };
    db.indicadoresIndustriais.push(rec);
    appendAudit("CRIAR", "KPI_INDUSTRIAL", rec.id, "Indicador industrial registrado", "system");
    return rec;
  },
  updateIndicadorIndustrial: (
    id: string,
    payload: Partial<IndicadorIndustrial>,
  ): IndicadorIndustrial | null => {
    const rec = updateCollection(db.indicadoresIndustriais, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "KPI_INDUSTRIAL", id, "Indicador industrial atualizado", "system");
    return rec;
  },
  resumoIndicadoresIndustriais: (filters?: { planta?: string; linha?: string }) => {
    const list = governancaQualidadeRepo.listIndicadoresIndustriais(filters);
    const empty = {
      count: 0,
      oeeMedio: 0,
      fpyMedio: 0,
      scrapMedio: 0,
      reworkMedio: 0,
      mtbfMedio: 0,
      mttrMedio: 0,
    };
    if (list.length === 0) return empty;

    const sum = list.reduce(
      (acc, item) => {
        acc.oee += item.oee;
        acc.fpy += item.fpy;
        acc.scrap += item.scrapRate;
        acc.rework += item.reworkRate;
        acc.mtbf += item.mtbfHoras;
        acc.mttr += item.mttrHoras;
        return acc;
      },
      { oee: 0, fpy: 0, scrap: 0, rework: 0, mtbf: 0, mttr: 0 },
    );

    return {
      count: list.length,
      oeeMedio: Number((sum.oee / list.length).toFixed(2)),
      fpyMedio: Number((sum.fpy / list.length).toFixed(2)),
      scrapMedio: Number((sum.scrap / list.length).toFixed(2)),
      reworkMedio: Number((sum.rework / list.length).toFixed(2)),
      mtbfMedio: Number((sum.mtbf / list.length).toFixed(2)),
      mttrMedio: Number((sum.mttr / list.length).toFixed(2)),
    };
  },

  listRegrasRiscoSla: (origemTipo?: string): RegraRiscoSla[] =>
    origemTipo
      ? db.regrasRiscoSla.filter((rule) => rule.origemTipo === origemTipo)
      : db.regrasRiscoSla,
  createRegraRiscoSla: (payload: Omit<RegraRiscoSla, "id">): RegraRiscoSla => {
    const rec: RegraRiscoSla = {
      ...payload,
      id: nextId("RISK", db.regrasRiscoSla.length),
    };
    db.regrasRiscoSla.push(rec);
    appendAudit("CRIAR", "RISCO_SLA_REGRA", rec.id, "Regra de risco/SLA criada", "system");
    return rec;
  },
  updateRegraRiscoSla: (id: string, payload: Partial<RegraRiscoSla>): RegraRiscoSla | null => {
    const rec = updateCollection(db.regrasRiscoSla, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "RISCO_SLA_REGRA", id, "Regra de risco/SLA atualizada", "system");
    return rec;
  },
  listAvaliacoesRiscoSla: (origemTipo?: string): AvaliacaoRiscoSla[] =>
    origemTipo
      ? db.avaliacoesRiscoSla.filter((item) => item.origemTipo === origemTipo)
      : db.avaliacoesRiscoSla,
  createAvaliacaoRiscoSla: (
    payload: Omit<AvaliacaoRiscoSla, "id" | "pontuacao" | "slaHoras" | "statusSla" | "limiteAt" | "criadoAt">,
  ): AvaliacaoRiscoSla => {
    const pontuacao = riskScoreFromFactors(payload.impacto, payload.recorrencia, payload.detectabilidade);
    const sortedRules = governancaQualidadeRepo
      .listRegrasRiscoSla(payload.origemTipo)
      .sort((a, b) => b.pontuacaoMin - a.pontuacaoMin);
    const matchedRule = sortedRules.find((rule) => pontuacao >= rule.pontuacaoMin && pontuacao <= rule.pontuacaoMax)
      ?? sortedRules[0];
    const slaHoras = matchedRule?.slaHoras ?? 24;
    const limiteAt = new Date(Date.now() + slaHoras * 60 * 60 * 1000).toISOString();

    const rec: AvaliacaoRiscoSla = {
      ...payload,
      id: nextId("RSLA", db.avaliacoesRiscoSla.length),
      pontuacao,
      slaHoras,
      limiteAt,
      criadoAt: new Date().toISOString(),
      statusSla: buildSlaStatus(limiteAt),
    };
    db.avaliacoesRiscoSla.push(rec);
    appendAudit("CRIAR", "RISCO_SLA_AVALIACAO", rec.id, "Avaliacao de risco/SLA criada", "system");
    return rec;
  },
  refreshAvaliacoesRiscoSlaStatus: (): AvaliacaoRiscoSla[] => {
    db.avaliacoesRiscoSla = db.avaliacoesRiscoSla.map((item) => ({
      ...item,
      statusSla: buildSlaStatus(item.limiteAt),
    }));
    return db.avaliacoesRiscoSla;
  },

  listAuditoriasCamadas: (): AuditoriaCamada[] => db.auditoriasCamadas,
  createAuditoriaCamada: (payload: Omit<AuditoriaCamada, "id">): AuditoriaCamada => {
    const rec: AuditoriaCamada = {
      ...payload,
      id: nextId("LPA", db.auditoriasCamadas.length),
    };
    db.auditoriasCamadas.push(rec);
    appendAudit("CRIAR", "AUDITORIA_CAMADA", rec.id, "Auditoria em camada criada", "system");
    return rec;
  },
  updateAuditoriaCamada: (id: string, payload: Partial<AuditoriaCamada>): AuditoriaCamada | null => {
    const rec = updateCollection(db.auditoriasCamadas, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "AUDITORIA_CAMADA", id, "Auditoria em camada atualizada", "system");
    return rec;
  },

  listGatesFornecedores: (fornecedorId?: string): GateFornecedor[] =>
    fornecedorId
      ? db.gatesFornecedores.filter((item) => item.fornecedorId === fornecedorId)
      : db.gatesFornecedores,
  createGateFornecedor: (payload: Omit<GateFornecedor, "id">): GateFornecedor => {
    const rec: GateFornecedor = {
      ...payload,
      id: nextId("GATE", db.gatesFornecedores.length),
    };
    db.gatesFornecedores.push(rec);
    appendAudit("CRIAR", "FORNECEDOR_GATE", rec.id, "Gate de fornecedor criado", "system");
    return rec;
  },
  updateGateFornecedor: (id: string, payload: Partial<GateFornecedor>): GateFornecedor | null => {
    const rec = updateCollection(db.gatesFornecedores, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "FORNECEDOR_GATE", id, "Gate de fornecedor atualizado", "system");
    return rec;
  },

  listIsoReadiness: (): IsoReadinessItem[] => db.isoReadiness,
  createIsoReadiness: (payload: Omit<IsoReadinessItem, "id">): IsoReadinessItem => {
    const rec: IsoReadinessItem = {
      ...payload,
      id: nextId("ISO", db.isoReadiness.length),
    };
    db.isoReadiness.push(rec);
    appendAudit("CRIAR", "ISO_READINESS", rec.id, "Item de readiness ISO criado", "system");
    return rec;
  },
  updateIsoReadiness: (id: string, payload: Partial<IsoReadinessItem>): IsoReadinessItem | null => {
    const rec = updateCollection(db.isoReadiness, id, payload);
    if (!rec) return null;
    appendAudit("ATUALIZAR", "ISO_READINESS", id, "Item de readiness ISO atualizado", "system");
    return rec;
  },
  resumoIsoReadiness: () => {
    const total = db.isoReadiness.length;
    const atendidos = db.isoReadiness.filter((item) => item.status === "ATENDIDO").length;
    const riscoAlto = db.isoReadiness.filter((item) => ["ALTO", "CRITICO"].includes(item.risco)).length;
    return {
      total,
      atendidos,
      pendentes: Math.max(total - atendidos, 0),
      riscoAlto,
      percentualAtendimento: total > 0 ? Number(((atendidos / total) * 100).toFixed(2)) : 0,
    };
  },
};

export const auditoriaRepo = {
  list: (): AudExec[] => db.auditorias,
  create: (payload: Omit<AudExec, "id">): AudExec => {
    const rec: AudExec = { ...payload, id: nextId("AUD", db.auditorias.length) };
    db.auditorias.push(rec);
    return rec;
  },
  templates: () => db.auditoriaTemplates,
  templateItems: (tplId: string) => db.auditoriaTemplateItems[tplId] ?? [],
};

export const assistRepo = {
  listOS: (): OsAssistencia[] => db.osAssistencia,
  getOS: (id: string): OsAssistencia | null => db.osAssistencia.find((o) => o.id === id) ?? null,
  createOS: (payload: Omit<OsAssistencia, "id">): OsAssistencia => {
    const rec: OsAssistencia = { ...payload, id: nextId("OS", db.osAssistencia.length) };
    db.osAssistencia.push(rec);
    return rec;
  },
  updateStatusOS: (id: string, status: string): OsAssistencia | null => updateCollection(db.osAssistencia, id, { status } as Partial<OsAssistencia>),

  listReq: (): ReqMaterial[] => db.reqMaterial,
  getReq: (id: string): ReqMaterial | null => db.reqMaterial.find((r) => r.id === id) ?? null,
  createReq: (payload: Omit<ReqMaterial, "id">): ReqMaterial => {
    const rec: ReqMaterial = { ...payload, id: nextId("RA", db.reqMaterial.length) };
    db.reqMaterial.push(rec);
    return rec;
  },
  updateReqStatus: (id: string, payload: Partial<ReqMaterial>): ReqMaterial | null => updateCollection(db.reqMaterial, id, payload),

  listConsumo: (): ConsumoPeca[] => db.consumoPeca,
  listConsumoByOS: (osId: string): ConsumoPeca[] => db.consumoPeca.filter((c) => c.osId === osId),
  createConsumo: (payload: Omit<ConsumoPeca, "id">): ConsumoPeca => {
    const rec: ConsumoPeca = { ...payload, id: nextId("CON", db.consumoPeca.length) };
    db.consumoPeca.push(rec);
    return rec;
  },

  listTransitionByOS: (osId: string): OSTransitionLog[] => db.osTransitionLog.filter((l) => l.osId === osId).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  listTransitionAll: (): OSTransitionLog[] => db.osTransitionLog.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  appendTransition: (payload: Omit<OSTransitionLog, "id" | "timestamp"> & { timestamp?: string }): OSTransitionLog => {
    const rec: OSTransitionLog = {
      ...payload,
      id: nextId("TRN", db.osTransitionLog.length),
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };
    db.osTransitionLog.unshift(rec);
    return rec;
  },

  dashboard: () => {
    const osList = db.osAssistencia;
    const reqList = db.reqMaterial;
    return {
      osAbertas: osList.filter((o) => !["CONCLUIDA", "ENCERRADA", "CANCELADA"].includes(o.status)).length,
      osConcluidas: osList.filter((o) => ["CONCLUIDA", "ENCERRADA"].includes(o.status)).length,
      osCanceladas: osList.filter((o) => o.status === "CANCELADA").length,
      reqPendentes: reqList.filter((r) => ["PENDENTE", "EM_SEPARACAO", "EM_TRANSFERENCIA"].includes(r.status)).length,
      reqAtendidas: reqList.filter((r) => r.status === "ATENDIDA").length,
      consumoTotal: db.consumoPeca.length,
      osPorStatus: osList.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      osPorPlanta: osList.reduce((acc, o) => {
        acc[o.planta] = (acc[o.planta] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  },
};
