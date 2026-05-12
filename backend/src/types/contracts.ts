export type Planta = "MAO" | "BEL" | "AGR";
export type Perfil =
  | "ADMIN"
  | "SAC"
  | "QUALIDADE"
  | "AUDITOR"
  | "ASSISTENCIA"
  | "TECNICO"
  | "ALMOX"
  | "DIRETORIA"
  | "VALIDACAO"
  | "CORPORATIVO_SST"
  | "SESMT"
  | "TECNICO_SEGURANCA"
  | "ENFERMAGEM_TRABALHO"
  | "MEDICO_TRABALHO"
  | "RH"
  | "GESTOR_UNIDADE"
  | "LEITOR_RESTRITO"
  | "GESTOR_CONTRATOS"
  | "TERCEIRO_CONSULTA_LIMITADA"
  | "LIDER_OPERACIONAL"
  | "RH_OCUPACIONAL"
  | "COMITE_SST"
  | "DIRETOR_EXECUTIVO_SST";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
}

export interface AuditLogEntry {
  id: string;
  data: string;
  usuario: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  detalhes: string;
}

export interface Parametro {
  chave: string;
  valor: string;
  descricao: string;
}

export interface SACAtendimento {
  id: string;
  codcli: string;
  clienteNome: string;
  cgcent: string;
  telefone: string;
  canal: string;
  tipoContato: string;
  descricao: string;
  plantaResp: Planta;
  numPedido?: string;
  numNfVenda?: string;
  codprod?: string;
  produtoRelacionado?: string;
  status: string;
  abertoAt: string;
  atualizadoAt: string;
  encerradoAt?: string;
  timeline: SACTimeline[];
  anexos?: SACAtendimentoAnexo[];
}

export interface SACTimeline {
  id: string;
  data: string;
  usuario: string;
  acao: string;
  descricao: string;
}

export interface SACAtendimentoAnexo {
  id: string;
  atendimentoId: string;
  nomeArquivo: string;
  mimeType: string;
  tamanho: number;
  caminho: string;
  criadoAt: string;
}

export interface ItemSACReq {
  codmat: string;
  descricaoMaterial: string;
  un: string;
  qtdSolicitada: number;
  qtdAtendida?: number;
  situacao?: string;
  observacao?: string;
  observacaoAtendente?: string;
}

export interface SACRequisicao {
  id: string;
  atendimentoId?: string;
  codcli: string;
  clienteNome: string;
  cgcent: string;
  numPedido?: string;
  numNfVenda?: string;
  codprod?: string;
  produtoRelacionado?: string;
  plantaCd: Planta;
  motivo: string;
  prioridade: string;
  observacoes: string;
  status: string;
  criadoAt: string;
  atualizadoAt: string;
  atendidoAt?: string;
  atendidoPor?: string;
  observacoesAtendimento?: string;
  itens: ItemSACReq[];
}

export interface GarantiaCaso {
  id: string;
  codcli: string;
  clienteNome: string;
  numPedido: string;
  numNfVenda: string;
  numNfTroca?: string;
  codprod?: string;
  defeito: string;
  descricao?: string;
  plantaResp: Planta;
  status: string;
  custoEstimado?: number;
  obs?: string;
  abertoAt: string;
  encerradoAt?: string;
}

export interface NCRegistro {
  id: string;
  codcli?: string;
  clienteNome?: string;
  numPedido?: string;
  numNf?: string;
  codprod?: string;
  motivoId: string;
  tipoNc: string;
  gravidade: string;
  descricao: string;
  causaRaiz?: string;
  planoAcao?: string;
  responsavel: string;
  prazo: string;
  status: string;
  planta: Planta;
  abertoAt: string;
  encerradoAt?: string;
  origem?: string;
  origemId?: string;
}

export interface Capa {
  id: string;
  origemTipo: string;
  origemId: string;
  descricaoProblema: string;
  causaRaiz?: string;
  planoAcao?: string;
  criterioEficacia?: string;
  responsavel: string;
  dataInicio: string;
  dataPrazo: string;
  dataConclusao?: string;
  status: string;
}

export interface AudExec {
  id: string;
  tplId?: string;
  tplNome: string;
  tipoAuditoria?: string;
  planta: Planta;
  local: string;
  auditor: string;
  escopo?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
}

export interface DocumentoQualidade {
  id: string;
  codigo: string;
  titulo: string;
  tipo: string;
  status: string;
  versaoAtual: string;
  responsavel: string;
  setor: string;
  validadeAt?: string;
  aprovadoPor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TreinamentoQualidade {
  id: string;
  titulo: string;
  tipo: string;
  cargoAlvo: string;
  instrutor: string;
  cargaHoraria: number;
  status: string;
  dataPlanejada: string;
  dataRealizacao?: string;
  validadeMeses?: number;
  observacoes?: string;
}

export interface TreinamentoParticipante {
  id: string;
  treinamentoId: string;
  colaborador: string;
  cargo: string;
  resultado: string;
  status: string;
  concluidoAt?: string;
}

export interface MudancaQualidade {
  id: string;
  titulo: string;
  descricao: string;
  tipo: string;
  area: string;
  solicitante: string;
  risco: string;
  status: string;
  dataSolicitacao: string;
  dataImplementacao?: string;
  aprovador?: string;
  planoValidacao?: string;
}

export interface FornecedorQualidade {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  status: string;
  score: number;
  ultimaAvaliacaoAt?: string;
  responsavel?: string;
}

export interface ScarFornecedor {
  id: string;
  fornecedorId: string;
  titulo: string;
  descricao: string;
  status: string;
  gravidade: string;
  responsavel: string;
  prazo: string;
  dataAbertura: string;
  dataFechamento?: string;
  acaoCorretiva?: string;
}

export interface InstrumentoMetrologia {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  fabricante?: string;
  numeroSerie?: string;
  planta: Planta;
  local: string;
  statusCalibracao: "CALIBRADO" | "VENCIDO" | "EM_CALIBRACAO" | string;
  ultimaCalibracaoAt?: string;
  proximaCalibracaoAt: string;
  incerteza?: number;
  responsavel: string;
}

export interface EstudoMsa {
  id: string;
  instrumentoId: string;
  caracteristica: string;
  metodo: string;
  rrPercent: number;
  ndc: number;
  resultado: "APROVADO" | "CONDICIONAL" | "REPROVADO" | string;
  estudadoAt: string;
  responsavel: string;
  observacoes?: string;
}

export interface IndicadorIndustrial {
  id: string;
  data: string;
  planta: Planta;
  linha: string;
  oee: number;
  fpy: number;
  scrapRate: number;
  reworkRate: number;
  mtbfHoras: number;
  mttrHoras: number;
  paradasNaoPlanejadas?: number;
  fonte?: string;
}

export interface RegraRiscoSla {
  id: string;
  origemTipo: "SAC" | "NC" | "CAPA" | string;
  criticidade: "BAIXA" | "MEDIA" | "ALTA" | "CRITICA" | string;
  pontuacaoMin: number;
  pontuacaoMax: number;
  slaHoras: number;
  resposta: string;
}

export interface AvaliacaoRiscoSla {
  id: string;
  origemTipo: "SAC" | "NC" | "CAPA" | string;
  origemId: string;
  criticidade: "BAIXA" | "MEDIA" | "ALTA" | "CRITICA" | string;
  impacto: number;
  recorrencia: number;
  detectabilidade: number;
  pontuacao: number;
  slaHoras: number;
  statusSla: "NO_PRAZO" | "ALERTA" | "ATRASO" | string;
  limiteAt: string;
  criadoAt: string;
  justificativa?: string;
}

export interface AuditoriaCamada {
  id: string;
  camada: "L1" | "L2" | "L3" | "LPA" | string;
  planta: Planta;
  area: string;
  processo: string;
  auditor: string;
  frequencia: string;
  status: "PLANEJADA" | "EM_EXECUCAO" | "CONCLUIDA" | "ATRASADA" | string;
  proximaExecucaoAt: string;
  ultimaExecucaoAt?: string;
  score?: number;
  achados?: string;
}

export interface GateFornecedor {
  id: string;
  fornecedorId: string;
  coreTool: "APQP" | "PPAP" | "FMEA" | "MSA" | "SPC" | string;
  status: "PENDENTE" | "APROVADO" | "REPROVADO" | "EM_ANALISE" | string;
  evidencia?: string;
  validadoPor?: string;
  validadoAt?: string;
  observacoes?: string;
}

export interface IsoReadinessItem {
  id: string;
  clausula: string;
  titulo: string;
  status: "NAO_INICIADO" | "EM_ANDAMENTO" | "ATENDIDO" | "RISCO" | string;
  responsavel: string;
  prazo: string;
  evidencia?: string;
  ultimaRevisaoAt?: string;
  risco: "BAIXO" | "MEDIO" | "ALTO" | "CRITICO" | string;
}

export interface OsAssistencia {
  id: string;
  origemTipo: string;
  origemId?: string;
  codcli: string;
  clienteNome: string;
  numPedido?: string;
  nfVenda?: string;
  codprod?: string;
  planta: Planta;
  tipoOs: string;
  status: string;
  prioridade: string;
  tecnicoResponsavel: string;
  descricaoProblema: string;
  laudoInspecao?: string;
  decisaoTecnica?: string;
  dataAbertura: string;
  dataPrevista: string;
  dataConclusao?: string;
  recebimentoConfirmado?: boolean;
  relatorioReparo?: string;
  validacaoAprovada?: boolean;
  mensagemEncerramento?: string;
}

export interface ItemReqAssist {
  codMaterial: string;
  descricao: string;
  un: string;
  qtdSolicitada: number;
  qtdAtendida?: number;
  qtdRecebida?: number;
  situacao?: string;
  observacao?: string;
  observacaoAtendente?: string;
}

export interface ReqMaterial {
  id: string;
  osId: string;
  cdResponsavel: Planta;
  plantaDestino: Planta;
  status: string;
  prioridade?: string;
  observacao?: string;
  criadoAt: string;
  atualizadoAt: string;
  itens: ItemReqAssist[];
}

export interface ConsumoPeca {
  id: string;
  osId: string;
  reqId?: string;
  codMaterial: string;
  descricao: string;
  un: string;
  qtdConsumida: number;
  tecnico: string;
  dataConsumo: string;
  observacao?: string;
}

export interface OSTransitionLog {
  id: string;
  osId: string;
  oldStatus: string;
  newStatus: string;
  usuario: string;
  perfil: string;
  papel: string;
  planta: string;
  timestamp: string;
  motivo?: string;
  detalhes?: string;
}

export interface UxMetricEntry {
  id: string;
  type: "PAGE_VIEW" | "ACTION" | "ERROR" | "SCREEN_TIME";
  screen: string;
  action?: string;
  success?: boolean;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
