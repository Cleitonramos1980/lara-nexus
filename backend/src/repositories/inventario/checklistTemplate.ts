export type ChecklistTemplateCriticidade = "ALTA" | "MEDIA" | "BAIXA";

export interface ChecklistTemplateItem {
  descricao: string;
  criticidade: ChecklistTemplateCriticidade;
}

export interface ChecklistTemplateBlock {
  codigo: string;
  ordem: number;
  nome: string;
  itens: ChecklistTemplateItem[];
}

export const CHECKLIST_PRE_INVENTARIO_TEMPLATE: ChecklistTemplateBlock[] = [
  {
    codigo: "B01",
    ordem: 1,
    nome: "Planejamento do Inventario",
    itens: [
      { descricao: "Definir data e horario do inventario", criticidade: "ALTA" },
      { descricao: "Definir tipo de inventario", criticidade: "ALTA" },
      { descricao: "Nomear responsavel geral", criticidade: "ALTA" },
      { descricao: "Definir equipe e treinar", criticidade: "ALTA" },
      { descricao: "Definir areas/setores", criticidade: "MEDIA" },
      { descricao: "Elaborar cronograma", criticidade: "MEDIA" },
    ],
  },
  {
    codigo: "B02",
    ordem: 2,
    nome: "Organizacao do Estoque",
    itens: [
      { descricao: "Estoque limpo e organizado", criticidade: "ALTA" },
      { descricao: "Enderecamento atualizado", criticidade: "ALTA" },
      { descricao: "Separacao por tipo de material", criticidade: "MEDIA" },
      { descricao: "Materiais identificados", criticidade: "MEDIA" },
      { descricao: "Segregar avariados/obsoletos/caixas secas", criticidade: "ALTA" },
      { descricao: "Eliminar materiais fora do lugar", criticidade: "MEDIA" },
    ],
  },
  {
    codigo: "B03",
    ordem: 3,
    nome: "Bloqueio de Movimentacoes",
    itens: [
      { descricao: "Definir corte de movimentacao", criticidade: "ALTA" },
      { descricao: "Bloquear sistema", criticidade: "ALTA" },
      { descricao: "Suspender recebimento", criticidade: "ALTA" },
      { descricao: "Suspender expedicao", criticidade: "ALTA" },
      { descricao: "Validar pedidos em aberto", criticidade: "MEDIA" },
      { descricao: "Comunicar areas", criticidade: "MEDIA" },
      { descricao: "Garantir ausencia de movimentacao", criticidade: "ALTA" },
    ],
  },
  {
    codigo: "B04",
    ordem: 4,
    nome: "Conciliacao Sistemica",
    itens: [
      { descricao: "Atualizar entradas", criticidade: "ALTA" },
      { descricao: "Atualizar saidas", criticidade: "ALTA" },
      { descricao: "Baixar OPs", criticidade: "MEDIA" },
      { descricao: "Conferir saldo", criticidade: "ALTA" },
      { descricao: "Validar WIP", criticidade: "MEDIA" },
    ],
  },
  {
    codigo: "B05",
    ordem: 5,
    nome: "Identificacao e Controle",
    itens: [
      { descricao: "Gerar etiquetas", criticidade: "MEDIA" },
      { descricao: "Definir metodo de contagem", criticidade: "ALTA" },
      { descricao: "Disponibilizar materiais", criticidade: "MEDIA" },
      { descricao: "Definir responsaveis", criticidade: "ALTA" },
    ],
  },
  {
    codigo: "B06",
    ordem: 6,
    nome: "Tratamento de Excecoes",
    itens: [
      { descricao: "Separar materiais de terceiros", criticidade: "MEDIA" },
      { descricao: "Identificar quarentena", criticidade: "ALTA" },
      { descricao: "Isolar devolucoes", criticidade: "MEDIA" },
      { descricao: "Identificar sem cadastro", criticidade: "BAIXA" },
    ],
  },
  {
    codigo: "B07",
    ordem: 7,
    nome: "Comunicacao",
    itens: [
      { descricao: "Comunicar inventario", criticidade: "MEDIA" },
      { descricao: "Alinhar lideres", criticidade: "MEDIA" },
      { descricao: "Orientar bloqueios", criticidade: "ALTA" },
    ],
  },
  {
    codigo: "B08",
    ordem: 8,
    nome: "Infraestrutura",
    itens: [
      { descricao: "Verificar iluminacao", criticidade: "MEDIA" },
      { descricao: "Disponibilizar equipamentos", criticidade: "ALTA" },
      { descricao: "EPIs disponiveis", criticidade: "MEDIA" },
      { descricao: "Suporte TI", criticidade: "ALTA" },
    ],
  },
  {
    codigo: "B09",
    ordem: 9,
    nome: "Teste",
    itens: [
      { descricao: "Realizar piloto", criticidade: "ALTA" },
      { descricao: "Validar metodo", criticidade: "ALTA" },
    ],
  },
  {
    codigo: "B10",
    ordem: 10,
    nome: "Validacao",
    itens: [
      { descricao: "Aprovacao final", criticidade: "ALTA" },
      { descricao: "Equipe posicionada", criticidade: "MEDIA" },
    ],
  },
];

export function countChecklistTemplateItems(): number {
  return CHECKLIST_PRE_INVENTARIO_TEMPLATE.reduce((total, bloco) => total + bloco.itens.length, 0);
}

