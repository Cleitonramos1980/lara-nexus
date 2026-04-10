import { db } from "./dataStore.js";
import { SESMT_MODULE_DEFINITIONS } from "./sesmtCatalog.js";

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

function ensureSesmtStore(): any {
  if (!db.sesmt || typeof db.sesmt !== "object") {
    (db as any).sesmt = {};
  }

  const defaults: Record<string, unknown> = {
    unidades: [],
    setores: [],
    cargos: [],
    funcoes: [],
    colaboradores: [],
    profissionaisSesmt: [],
    dimensionamentoSesmt: [],
    requisitosLegais: [],
    atividadesNr: [],
    riscos: [],
    barreiras: [],
    tiposControle: [],
    planosAcao: [],
    laudos: [],
    laudoVinculos: [],
    epi: [],
    epc: [],
    inspecoes: [],
    checklists: [],
    evidencias: [],
    treinamentos: [],
    integracoes: [],
    exames: [],
    fornecedoresLaboratorios: [],
    saudeOcupacional: [],
    ambulatorio: [],
    prontuarios: [],
    atendimentosSaude: [],
    medicamentosVacinas: [],
    acidentes: [],
    cipa: [],
    comunicacoes: [],
    participacoes: [],
    terceirosContratados: [],
    sinalizacoes: [],
    emergencias: [],
    residuos: [],
    obrasPromat: [],
    custos: [],
    indicadores: [],
    dashboardConfigs: [],
    bibliotecaTecnica: [],
    documentosControlados: [],
    notificacoes: [],
    cadastrosAuxiliares: [],
    procedimentos: [],
    ergonomia: [],
    registros: [],
    acessosSensiveis: [],
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in db.sesmt)) {
      (db.sesmt as any)[key] = value;
    }
  }

  return db.sesmt;
}

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildBaseRecord(index: number, moduleKey: string, label: string, unidade: string, nr: string) {
  const createdAt = new Date(Date.now() - index * 86_400_000).toISOString();
  const statusList = ["ABERTO", "EM_ANDAMENTO", "CONCLUIDO", "ATRASADO"] as const;
  const criticidadeList = ["BAIXA", "MEDIA", "ALTA", "CRITICA"] as const;
  const status = statusList[index % statusList.length];
  const criticidade = criticidadeList[index % criticidadeList.length];

  return {
    id: `SES-${moduleKey.slice(0, 3).toUpperCase()}-${pad(index + 1)}`,
    moduleKey,
    titulo: `${label} - Plano ${index + 1}`,
    descricao: `Registro operacional de ${label.toLowerCase()} para acompanhamento de conformidade e eficacia.`,
    unidade,
    status,
    responsavel: ["Ana Souza", "Bruno Lima", "Carla Reis"][index % 3],
    criticidade,
    nr,
    periodoInicio: isoDateOffset(-30),
    periodoFim: isoDateOffset(30 + index),
    setor: ["Producao", "Logistica", "Manutencao", "Qualidade"][index % 4],
    funcao: ["Supervisor", "Tecnico", "Operador", "Analista"][index % 4],
    investimento: 3500 + index * 250,
    custo: 1800 + index * 190,
    riscoInerente: 12 + (index % 8),
    riscoResidual: 6 + (index % 4),
    vencimentoAt: isoDateOffset(15 + index),
    dadosSaudeSensiveis: moduleKey.includes("saude") || moduleKey.includes("exames") || moduleKey.includes("ambulatorio") || moduleKey.includes("medicamentos"),
    tags: [moduleKey, nr, unidade],
    anexos: [],
    evidencias: [
      {
        id: `EVD-${moduleKey.slice(0, 3).toUpperCase()}-${pad(index + 1)}`,
        descricao: "Checklist consolidado anexado e validado pelo responsavel.",
        tipo: "CHECKLIST",
        data: isoDateOffset(-2 - index),
        responsavel: ["Ana Souza", "Bruno Lima", "Carla Reis"][index % 3],
        criadoAt: createdAt,
        criadoPor: "seed",
      },
    ],
    historico: [
      {
        id: `HIS-${moduleKey.slice(0, 3).toUpperCase()}-${pad(index + 1)}`,
        data: createdAt,
        usuario: "seed",
        acao: "CRIADO",
        descricao: "Registro inicial gerado para baseline do modulo SESMT/SST.",
      },
    ],
    origemVinculada: [{ tipo: "NC", id: `NC-${pad((index % 7) + 1)}` }, { tipo: "CAPA", id: `CAPA-${pad((index % 5) + 1)}` }],
    createdAt,
    updatedAt: createdAt,
    createdBy: "seed",
    updatedBy: "seed",
  };
}

export function seedSesmtData(): void {
  const sesmt = ensureSesmtStore();

  if ((sesmt.unidades as any[]).length === 0) {
    sesmt.unidades.push(
      { id: "UNI-MAO", codigo: "MAO", nome: "Manaus", regional: "NORTE" },
      { id: "UNI-BEL", codigo: "BEL", nome: "Belem", regional: "NORTE" },
      { id: "UNI-AGR", codigo: "AGR", nome: "Agrestina", regional: "NORDESTE" },
    );
  }

  if ((sesmt.setores as any[]).length === 0) {
    sesmt.setores.push(
      { id: "SET-001", nome: "Producao", unidade: "MAO" },
      { id: "SET-002", nome: "Expedicao", unidade: "BEL" },
      { id: "SET-003", nome: "Logistica", unidade: "AGR" },
      { id: "SET-004", nome: "Qualidade", unidade: "MAO" },
    );
  }

  if ((sesmt.cargos as any[]).length === 0) {
    sesmt.cargos.push(
      { id: "CAR-001", nome: "Tecnico de Seguranca" },
      { id: "CAR-002", nome: "Enfermeiro do Trabalho" },
      { id: "CAR-003", nome: "Medico do Trabalho" },
      { id: "CAR-004", nome: "Supervisor de Producao" },
    );
  }

  if ((sesmt.funcoes as any[]).length === 0) {
    sesmt.funcoes.push(
      { id: "FUN-001", nome: "Operador de Linha" },
      { id: "FUN-002", nome: "Mecanico" },
      { id: "FUN-003", nome: "Conferente" },
      { id: "FUN-004", nome: "Almoxarife" },
    );
  }

  if ((sesmt.profissionaisSesmt as any[]).length === 0) {
    sesmt.profissionaisSesmt.push(
      { id: "PROF-001", nome: "Ana Souza", registro: "MTE-12345", funcaoLegal: "TECNICO_SEGURANCA", jornada: 44, unidade: "MAO" },
      { id: "PROF-002", nome: "Bruno Lima", registro: "COREN-334455", funcaoLegal: "ENFERMAGEM_TRABALHO", jornada: 40, unidade: "BEL" },
      { id: "PROF-003", nome: "Carla Reis", registro: "CRM-778899", funcaoLegal: "MEDICO_TRABALHO", jornada: 30, unidade: "AGR" },
    );
  }

  if ((sesmt.dimensionamentoSesmt as any[]).length === 0) {
    sesmt.dimensionamentoSesmt.push(
      { id: "DIM-001", unidade: "MAO", grauRisco: 3, efetivo: 480, exigido: 5, existente: 4, memoriaCalculo: "Quadro II NR-04" },
      { id: "DIM-002", unidade: "BEL", grauRisco: 3, efetivo: 330, exigido: 4, existente: 4, memoriaCalculo: "Quadro II NR-04" },
      { id: "DIM-003", unidade: "AGR", grauRisco: 2, efetivo: 210, exigido: 2, existente: 2, memoriaCalculo: "Quadro II NR-04" },
    );
  }

  if ((sesmt.requisitosLegais as any[]).length === 0) {
    sesmt.requisitosLegais.push(
      { id: "LEG-001", norma: "NR-01", requisito: "PGR atualizado", periodicidade: "ANUAL", status: "ATENDIDO", riscoDescumprimento: "ALTO" },
      { id: "LEG-002", norma: "NR-07", requisito: "PCMSO vigente", periodicidade: "ANUAL", status: "ATENDIDO", riscoDescumprimento: "CRITICO" },
      { id: "LEG-003", norma: "NR-23", requisito: "Plano de emergencia revisado", periodicidade: "ANUAL", status: "EM_ANDAMENTO", riscoDescumprimento: "ALTO" },
    );
  }

  if ((sesmt.colaboradores as any[]).length === 0) {
    sesmt.colaboradores.push(
      { id: "COL-001", nome: "Diego Matos", unidade: "MAO", setor: "Producao", funcao: "Operador de Linha" },
      { id: "COL-002", nome: "Elaine Costa", unidade: "BEL", setor: "Logistica", funcao: "Conferente" },
      { id: "COL-003", nome: "Felipe Rocha", unidade: "AGR", setor: "Manutencao", funcao: "Mecanico" },
    );
  }

  if ((sesmt.registros as any[]).length === 0) {
    let idx = 0;
    for (const moduleDef of SESMT_MODULE_DEFINITIONS) {
      const unidade = ["MAO", "BEL", "AGR"][idx % 3];
      const nr = moduleDef.defaultNr ?? `NR-${String((idx % 28) + 1).padStart(2, "0")}`;
      const record = buildBaseRecord(idx, moduleDef.key, moduleDef.label, unidade, nr);
      (sesmt.registros as any[]).push(record);
      if (Array.isArray((sesmt as any)[moduleDef.collectionKey])) {
        (sesmt as any)[moduleDef.collectionKey].push(record);
      }
      idx += 1;
    }
  }

  if ((sesmt.indicadores as any[]).length === 0) {
    sesmt.indicadores.push(
      { id: "IND-001", nome: "Acoes Criticas Abertas", valor: 14, meta: 8, unidade: "CORP", periodo: "2026-03" },
      { id: "IND-002", nome: "Treinamentos Vencendo", valor: 27, meta: 10, unidade: "CORP", periodo: "2026-03" },
      { id: "IND-003", nome: "ASO vencendo", valor: 18, meta: 5, unidade: "CORP", periodo: "2026-03" },
      { id: "IND-004", nome: "Inspecoes atrasadas", valor: 9, meta: 3, unidade: "CORP", periodo: "2026-03" },
    );
  }

  if ((sesmt.documentosControlados as any[]).length === 0) {
    sesmt.documentosControlados.push(
      { id: "DOCSST-001", codigo: "SST-PR-001", titulo: "Procedimento de Bloqueio e Etiquetagem", versao: "4.1", vigenciaAt: isoDateOffset(55), status: "VIGENTE", responsavel: "Ana Souza" },
      { id: "DOCSST-002", codigo: "SST-IT-014", titulo: "Checklist de Inspecao de EPC", versao: "2.0", vigenciaAt: isoDateOffset(20), status: "VIGENTE", responsavel: "Bruno Lima" },
    );
  }

  if ((sesmt.bibliotecaTecnica as any[]).length === 0) {
    sesmt.bibliotecaTecnica.push(
      { id: "BIB-001", titulo: "Guia de avaliacao de risco ocupacional", tema: "Riscos", nr: "NR-01", setor: "Todos" },
      { id: "BIB-002", titulo: "Cartilha de brigada de incendio", tema: "Emergencia", nr: "NR-23", setor: "Operacao" },
    );
  }

  if ((sesmt.custos as any[]).length === 0) {
    sesmt.custos.push(
      { id: "CUS-001", categoria: "EXAMES", unidade: "MAO", valor: 185000, competencia: "2026-03" },
      { id: "CUS-002", categoria: "EPI", unidade: "BEL", valor: 129000, competencia: "2026-03" },
      { id: "CUS-003", categoria: "TREINAMENTO", unidade: "AGR", valor: 76000, competencia: "2026-03" },
    );
  }

  if ((sesmt.cadastrosAuxiliares as any[]).length === 0) {
    sesmt.cadastrosAuxiliares.push(
      { id: "AUX-001", tipo: "CENTRO_CUSTO", codigo: "CC-100", descricao: "Seguranca Industrial" },
      { id: "AUX-002", tipo: "LABORATORIO", codigo: "LAB-PRIME", descricao: "Prime Ocupacional" },
      { id: "AUX-003", tipo: "FORNECEDOR", codigo: "FOR-SST-01", descricao: "Protec Equipamentos" },
    );
  }
}

