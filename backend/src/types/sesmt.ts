export type SesmtVisibility = "STANDARD" | "SENSITIVE_HEALTH";

export interface SesmtModuleDefinition {
  key: string;
  path: string;
  groupKey: string;
  groupLabel: string;
  label: string;
  description: string;
  collectionKey: string;
  visibility: SesmtVisibility;
  defaultNr?: string;
}

export interface SesmtAttachment {
  id: string;
  nomeArquivo: string;
  mimeType: string;
  tamanho: number;
  caminho: string;
  criadoAt: string;
  criadoPor: string;
}

export interface SesmtEvidence {
  id: string;
  descricao: string;
  tipo: string;
  data: string;
  responsavel: string;
  anexoId?: string;
  criadoAt: string;
  criadoPor: string;
}

export interface SesmtHistoryEntry {
  id: string;
  data: string;
  usuario: string;
  acao: string;
  descricao: string;
}

export interface SesmtRecord {
  id: string;
  moduleKey: string;
  titulo: string;
  descricao: string;
  unidade: string;
  status: string;
  responsavel: string;
  criticidade: "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";
  nr?: string;
  periodoInicio?: string;
  periodoFim?: string;
  setor?: string;
  funcao?: string;
  investimento?: number;
  custo?: number;
  riscoInerente?: number;
  riscoResidual?: number;
  vencimentoAt?: string;
  dadosSaudeSensiveis?: boolean;
  dadosEspecificos?: Record<string, string | number | boolean | null>;
  tags: string[];
  anexos: SesmtAttachment[];
  evidencias: SesmtEvidence[];
  historico: SesmtHistoryEntry[];
  origemVinculada: Array<{ tipo: string; id: string }>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface SesmtRecordListResult {
  page: number;
  limit: number;
  total: number;
  items: SesmtRecord[];
}

export interface SesmtFavoritePreset {
  moduleKey: string;
  userId: string;
  presetKey: string | null;
  status?: string;
  criticidade?: string;
  unidade?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  specificFilters?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

