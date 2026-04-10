import type { SesmtModuleDefinition } from "../types/sesmt.js";

const GROUPS = {
  "visao-executiva": "Visao Executiva",
  "riscos-e-controles": "Riscos e Controles",
  operacao: "Operacao",
  "pessoas-e-saude": "Pessoas e Saude",
  "estrutura-e-ambiente": "Estrutura e Ambiente",
  "governanca-e-conformidade": "Governanca e Conformidade",
} as const;

function moduleDef(input: Omit<SesmtModuleDefinition, "groupLabel" | "visibility"> & { visibility?: SesmtModuleDefinition["visibility"] }): SesmtModuleDefinition {
  return {
    ...input,
    groupLabel: GROUPS[input.groupKey as keyof typeof GROUPS],
    visibility: input.visibility ?? "STANDARD",
  };
}

export const SESMT_MODULE_DEFINITIONS: SesmtModuleDefinition[] = [
  moduleDef({
    key: "atividades-por-nr",
    path: "/sesmt/riscos-e-controles/atividades-por-nr",
    groupKey: "riscos-e-controles",
    label: "Atividades por NR",
    description: "Matriz de atividades obrigatorias por NR, periodicidade e evidencias.",
    collectionKey: "atividadesNr",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "riscos-barreiras-e-controles",
    path: "/sesmt/riscos-e-controles/riscos-barreiras-e-controles",
    groupKey: "riscos-e-controles",
    label: "Riscos, Barreiras e Controles",
    description: "Gestao de perigos, barreiras, risco inerente e risco residual.",
    collectionKey: "riscos",
    defaultNr: "NR-09",
  }),
  moduleDef({
    key: "efetividade-dos-controles",
    path: "/sesmt/riscos-e-controles/efetividade-dos-controles",
    groupKey: "riscos-e-controles",
    label: "Efetividade dos Controles",
    description: "Analise de hierarquia de controles e maturidade por unidade.",
    collectionKey: "tiposControle",
    defaultNr: "NR-12",
  }),
  moduleDef({
    key: "plano-de-acao-x-risco",
    path: "/sesmt/riscos-e-controles/plano-de-acao-x-risco",
    groupKey: "riscos-e-controles",
    label: "Plano de Acao x Risco",
    description: "Vinculo de acoes com risco residual, responsavel e reavaliacao.",
    collectionKey: "planosAcao",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "laudos-e-vinculos",
    path: "/sesmt/riscos-e-controles/laudos-e-vinculos",
    groupKey: "riscos-e-controles",
    label: "Laudos e Vinculos",
    description: "Controle de laudos com vinculos por unidade, funcao e colaborador.",
    collectionKey: "laudos",
    defaultNr: "NR-15",
  }),

  moduleDef({
    key: "epi",
    path: "/sesmt/operacao/epi",
    groupKey: "operacao",
    label: "EPI",
    description: "Cadastro mestre de EPI com cautelas, devolucoes e substituicoes.",
    collectionKey: "epi",
    defaultNr: "NR-06",
  }),
  moduleDef({
    key: "epc",
    path: "/sesmt/operacao/epc",
    groupKey: "operacao",
    label: "EPC",
    description: "Inventario de EPC com manutencao preventiva e corretiva.",
    collectionKey: "epc",
    defaultNr: "NR-18",
  }),
  moduleDef({
    key: "inspecoes-e-visitas",
    path: "/sesmt/operacao/inspecoes-e-visitas",
    groupKey: "operacao",
    label: "Inspecoes e Visitas",
    description: "Agenda de inspecoes, achados, reincidencia e tratativas.",
    collectionKey: "inspecoes",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "procedimentos-apr-pt-os",
    path: "/sesmt/operacao/procedimentos-apr-pt-os",
    groupKey: "operacao",
    label: "Procedimentos / APR / PT / OS",
    description: "Gestao de procedimentos operacionais e permissao de trabalho.",
    collectionKey: "procedimentos",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "comunicacao-de-sst",
    path: "/sesmt/operacao/comunicacao-de-sst",
    groupKey: "operacao",
    label: "Comunicacao de SST",
    description: "Campanhas, DDS/DSS, CIPAT/SIPAT e aceite de comunicados criticos.",
    collectionKey: "comunicacoes",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "participacao-do-trabalhador",
    path: "/sesmt/operacao/participacao-do-trabalhador",
    groupKey: "operacao",
    label: "Participacao do Trabalhador",
    description: "Registro de quase acidente, condicao insegura e percepcao de risco.",
    collectionKey: "participacoes",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "cipa",
    path: "/sesmt/operacao/cipa",
    groupKey: "operacao",
    label: "CIPA",
    description: "Mandatos, atas, reunioes, recomendacoes e plano de acao da CIPA.",
    collectionKey: "cipa",
    defaultNr: "NR-05",
  }),

  moduleDef({
    key: "treinamentos-e-integracao",
    path: "/sesmt/pessoas-e-saude/treinamentos-e-integracao",
    groupKey: "pessoas-e-saude",
    label: "Treinamentos e Integracao",
    description: "Catalogo de treinamentos por risco, funcao e unidade.",
    collectionKey: "treinamentos",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "saude-ocupacional",
    path: "/sesmt/pessoas-e-saude/saude-ocupacional",
    groupKey: "pessoas-e-saude",
    label: "Saude Ocupacional",
    description: "Gestao de ASO, PCMSO, PPP, LTCAT e monitoramentos.",
    collectionKey: "saudeOcupacional",
    visibility: "SENSITIVE_HEALTH",
    defaultNr: "NR-07",
  }),
  moduleDef({
    key: "exames",
    path: "/sesmt/pessoas-e-saude/exames",
    groupKey: "pessoas-e-saude",
    label: "Exames",
    description: "Programacao, convocacao, emissao, resultado e custo de exames.",
    collectionKey: "exames",
    visibility: "SENSITIVE_HEALTH",
    defaultNr: "NR-07",
  }),
  moduleDef({
    key: "ambulatorio-prontuario",
    path: "/sesmt/pessoas-e-saude/ambulatorio-prontuario",
    groupKey: "pessoas-e-saude",
    label: "Ambulatorio / Prontuario",
    description: "Agenda medica, historico clinico e prontuario ocupacional.",
    collectionKey: "ambulatorio",
    visibility: "SENSITIVE_HEALTH",
    defaultNr: "NR-07",
  }),
  moduleDef({
    key: "medicamentos-vacinas",
    path: "/sesmt/pessoas-e-saude/medicamentos-vacinas",
    groupKey: "pessoas-e-saude",
    label: "Medicamentos / Vacinas",
    description: "Estoque, dispensacao, campanhas e cobertura vacinal.",
    collectionKey: "medicamentosVacinas",
    visibility: "SENSITIVE_HEALTH",
    defaultNr: "NR-07",
  }),
  moduleDef({
    key: "ergonomia-nr-17",
    path: "/sesmt/pessoas-e-saude/ergonomia-nr-17",
    groupKey: "pessoas-e-saude",
    label: "Ergonomia / NR-17",
    description: "AET/AEP, riscos biomecanicos e recomendacoes ergonomicas.",
    collectionKey: "ergonomia",
    defaultNr: "NR-17",
  }),

  moduleDef({
    key: "sinalizacao-nr-26",
    path: "/sesmt/estrutura-e-ambiente/sinalizacao-nr-26",
    groupKey: "estrutura-e-ambiente",
    label: "Sinalizacao / NR-26",
    description: "Cadastro, implantacao, vistoria e reposicao de sinalizacao.",
    collectionKey: "sinalizacoes",
    defaultNr: "NR-26",
  }),
  moduleDef({
    key: "emergencia-e-incendio",
    path: "/sesmt/estrutura-e-ambiente/emergencia-e-incendio",
    groupKey: "estrutura-e-ambiente",
    label: "Emergencia e Incendio",
    description: "Extintores, hidrantes, brigada, simulados e abandono de area.",
    collectionKey: "emergencias",
    defaultNr: "NR-23",
  }),
  moduleDef({
    key: "residuos",
    path: "/sesmt/estrutura-e-ambiente/residuos",
    groupKey: "estrutura-e-ambiente",
    label: "Residuos",
    description: "Classificacao, armazenamento, evidencia e indicadores de residuos.",
    collectionKey: "residuos",
    defaultNr: "NR-25",
  }),
  moduleDef({
    key: "obras-promat",
    path: "/sesmt/estrutura-e-ambiente/obras-promat",
    groupKey: "estrutura-e-ambiente",
    label: "Obras / PROMAT",
    description: "Fases de obra, APR/PT, frentes de servico e pendencias.",
    collectionKey: "obrasPromat",
    defaultNr: "NR-18",
  }),

  moduleDef({
    key: "documentos-controlados",
    path: "/sesmt/governanca-e-conformidade/documentos-controlados",
    groupKey: "governanca-e-conformidade",
    label: "Documentos Controlados",
    description: "Modelos, vigencia, versionamento e aprovacao de documentos SST.",
    collectionKey: "documentosControlados",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "biblioteca-tecnica",
    path: "/sesmt/governanca-e-conformidade/biblioteca-tecnica",
    groupKey: "governanca-e-conformidade",
    label: "Biblioteca Tecnica",
    description: "Manuais, cartilhas e normas tecnicas por tema e risco.",
    collectionKey: "bibliotecaTecnica",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "notificacoes-e-respostas",
    path: "/sesmt/governanca-e-conformidade/notificacoes-e-respostas",
    groupKey: "governanca-e-conformidade",
    label: "Notificacoes e Respostas",
    description: "Gestao de notificacoes, exigencias, prazos e evidencias.",
    collectionKey: "notificacoes",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "terceiros-e-contratados",
    path: "/sesmt/governanca-e-conformidade/terceiros-e-contratados",
    groupKey: "governanca-e-conformidade",
    label: "Terceiros e Contratados",
    description: "Controle de empresas contratadas, documentos e integracoes.",
    collectionKey: "terceirosContratados",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "requisitos-legais",
    path: "/sesmt/governanca-e-conformidade/requisitos-legais",
    groupKey: "governanca-e-conformidade",
    label: "Requisitos Legais",
    description: "Matriz legal com aplicabilidade, evidencias e risco de descumprimento.",
    collectionKey: "requisitosLegais",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "sesmt-legal-dimensionamento",
    path: "/sesmt/governanca-e-conformidade/sesmt-legal-dimensionamento",
    groupKey: "governanca-e-conformidade",
    label: "SESMT Legal / Dimensionamento",
    description: "Dimensionamento exigido x existente e memoria de calculo.",
    collectionKey: "dimensionamentoSesmt",
    defaultNr: "NR-04",
  }),
  moduleDef({
    key: "custos-sesmt",
    path: "/sesmt/governanca-e-conformidade/custos-sesmt",
    groupKey: "governanca-e-conformidade",
    label: "Custos SESMT",
    description: "Custos por unidade, programa e evento de SST.",
    collectionKey: "custos",
    defaultNr: "NR-01",
  }),
  moduleDef({
    key: "cadastros-auxiliares",
    path: "/sesmt/governanca-e-conformidade/cadastros-auxiliares",
    groupKey: "governanca-e-conformidade",
    label: "Cadastros Auxiliares",
    description: "Base de unidades, setores, funcoes, prestadores e laboratorios.",
    collectionKey: "cadastrosAuxiliares",
    defaultNr: "NR-01",
  }),
];

export const SESMT_EXECUTIVE_VIEWS = [
  { key: "painel-mestre", label: "Painel Mestre SESMT" },
  { key: "indice-maturidade", label: "Indice de Maturidade SST" },
  { key: "painel-preditivo", label: "Painel Preditivo" },
  { key: "indicadores", label: "Indicadores" },
  { key: "gerencial-ocupacional", label: "Gerencial Ocupacional", visibility: "SENSITIVE_HEALTH" as const },
];

export const SESMT_MENU_TREE = [
  {
    key: "visao-executiva",
    label: "Visao Executiva",
    children: [
      { key: "painel-mestre", label: "Painel Mestre SESMT", path: "/sesmt/visao-executiva/painel-mestre" },
      { key: "indice-maturidade", label: "Indice de Maturidade SST", path: "/sesmt/visao-executiva/indice-maturidade" },
      { key: "painel-preditivo", label: "Painel Preditivo", path: "/sesmt/visao-executiva/painel-preditivo" },
      { key: "indicadores", label: "Indicadores", path: "/sesmt/visao-executiva/indicadores" },
      { key: "gerencial-ocupacional", label: "Gerencial Ocupacional", path: "/sesmt/visao-executiva/gerencial-ocupacional" },
    ],
  },
  {
    key: "riscos-e-controles",
    label: "Riscos e Controles",
    children: SESMT_MODULE_DEFINITIONS
      .filter((item) => item.groupKey === "riscos-e-controles")
      .map((item) => ({ key: item.key, label: item.label, path: item.path })),
  },
  {
    key: "operacao",
    label: "Operacao",
    children: SESMT_MODULE_DEFINITIONS
      .filter((item) => item.groupKey === "operacao")
      .map((item) => ({ key: item.key, label: item.label, path: item.path })),
  },
  {
    key: "pessoas-e-saude",
    label: "Pessoas e Saude",
    children: SESMT_MODULE_DEFINITIONS
      .filter((item) => item.groupKey === "pessoas-e-saude")
      .map((item) => ({ key: item.key, label: item.label, path: item.path })),
  },
  {
    key: "estrutura-e-ambiente",
    label: "Estrutura e Ambiente",
    children: SESMT_MODULE_DEFINITIONS
      .filter((item) => item.groupKey === "estrutura-e-ambiente")
      .map((item) => ({ key: item.key, label: item.label, path: item.path })),
  },
  {
    key: "governanca-e-conformidade",
    label: "Governanca e Conformidade",
    children: SESMT_MODULE_DEFINITIONS
      .filter((item) => item.groupKey === "governanca-e-conformidade")
      .map((item) => ({ key: item.key, label: item.label, path: item.path })),
  },
];

export function getSesmtModuleDefinition(moduleKey: string): SesmtModuleDefinition | null {
  return SESMT_MODULE_DEFINITIONS.find((item) => item.key === moduleKey) ?? null;
}

