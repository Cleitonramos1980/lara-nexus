import { getCurrentUserPerfil, type LaraUserPerfil } from "@/contexts/AuthContext";

export type LaraAction =
  | "VISUALIZAR"
  | "CRIAR"
  | "EDITAR"
  | "EXCLUIR"
  | "ATIVAR"
  | "INATIVAR"
  | "DUPLICAR"
  | "TESTAR_REGRA"
  | "EXPORTAR"
  | "VER_LOGS"
  | "ALTERAR_DESCONTO"
  | "ALTERAR_PARCELAMENTO"
  | "ALTERAR_ALCADA"
  | "ALTERAR_VALIDADE"
  | "SALVAR_PARAMETROS"
  | "AUDITAR";

// Rotinas acessíveis por perfil
const ROTINAS_POR_PERFIL: Record<LaraUserPerfil, string[]> = {
  ADMIN: [
    "LARA_DASHBOARD", "LARA_DASHBOARD_PREDITIVO",
    "LARA_ATENDIMENTOS", "LARA_CONVERSAS",
    "LARA_CLIENTES", "LARA_TITULOS",
    "LARA_REGUA_ATIVA", "LARA_REGUA_CONFIG",
    "LARA_CASES", "LARA_OPTOUT", "LARA_LOGS",
    "LARA_MONITORAMENTO", "LARA_CONFIGURACOES",
    "LARA_NEGOCIACAO", "LARA_PROMESSAS",
    "LARA_FEEDBACK", "LARA_PORTAL",
  ],
  FINANCEIRO: [
    "LARA_DASHBOARD", "LARA_DASHBOARD_PREDITIVO",
    "LARA_ATENDIMENTOS", "LARA_CLIENTES", "LARA_TITULOS",
    "LARA_CASES", "LARA_PROMESSAS",
    "LARA_NEGOCIACAO", "LARA_OPTOUT", "LARA_LOGS",
    "LARA_FEEDBACK",
  ],
  OPERACIONAL: [
    "LARA_DASHBOARD",
    "LARA_ATENDIMENTOS", "LARA_CONVERSAS",
    "LARA_CLIENTES", "LARA_CASES",
    "LARA_OPTOUT", "LARA_LOGS",
  ],
  CONSULTA: [
    "LARA_DASHBOARD",
    "LARA_CLIENTES", "LARA_TITULOS",
    "LARA_LOGS",
  ],
  MEDICO_TRABALHO: ["LARA_DASHBOARD"],
  SESMT: ["LARA_DASHBOARD"],
  DIRETOR_EXECUTIVO_SST: ["LARA_DASHBOARD"],
};

// Ações permitidas por perfil
const ACOES_POR_PERFIL: Record<LaraUserPerfil, LaraAction[]> = {
  ADMIN: [
    "VISUALIZAR", "CRIAR", "EDITAR", "EXCLUIR", "ATIVAR", "INATIVAR",
    "DUPLICAR", "TESTAR_REGRA", "EXPORTAR", "VER_LOGS",
    "ALTERAR_DESCONTO", "ALTERAR_PARCELAMENTO", "ALTERAR_ALCADA",
    "ALTERAR_VALIDADE", "SALVAR_PARAMETROS", "AUDITAR",
  ],
  FINANCEIRO: [
    "VISUALIZAR", "CRIAR", "EDITAR", "ATIVAR", "INATIVAR",
    "TESTAR_REGRA", "EXPORTAR", "VER_LOGS",
    "ALTERAR_DESCONTO", "ALTERAR_PARCELAMENTO",
    "ALTERAR_VALIDADE", "SALVAR_PARAMETROS",
  ],
  OPERACIONAL: [
    "VISUALIZAR", "CRIAR", "EDITAR",
    "ATIVAR", "INATIVAR", "VER_LOGS",
  ],
  CONSULTA: ["VISUALIZAR"],
  MEDICO_TRABALHO: ["VISUALIZAR"],
  SESMT: ["VISUALIZAR"],
  DIRETOR_EXECUTIVO_SST: ["VISUALIZAR", "EXPORTAR", "AUDITAR"],
};

export function canAccess(rotina: string): boolean {
  const perfil = getCurrentUserPerfil();
  return ROTINAS_POR_PERFIL[perfil]?.includes(rotina) ?? false;
}

export function canAction(rotina: string, action: LaraAction): boolean {
  if (!canAccess(rotina)) return false;
  const perfil = getCurrentUserPerfil();
  return ACOES_POR_PERFIL[perfil]?.includes(action) ?? false;
}
