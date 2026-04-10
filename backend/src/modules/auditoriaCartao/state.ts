import { nextId, db } from "../../repositories/dataStore.js";
import {
  divergenciasStore,
  logsStore,
  regrasStore,
  ajustesStore,
  type AuditoriaCartaoRegra,
  type AuditoriaCartaoDivergencia,
} from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function currentUser(req: unknown): string {
  const request = req as { authUser?: { nome?: string } };
  return request.authUser?.nome || "system";
}

export function normalizeComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ensureConfiguracao(usuario = "system"): AuditoriaCartaoRegra {
  const regras = regrasStore();
  if (regras.length > 0) return regras[0];

  const nova: AuditoriaCartaoRegra = {
    id: "ACR-001",
    toleranciaValor: 0.5,
    janelaHorarioMinutos: 30,
    prioridadeChaves: ["NSU_CV", "AUTORIZACAO", "TID", "NUMERO_PEDIDO", "VALOR_BRUTO", "DATA_VENDA", "CODFILIAL"],
    pesosChaves: {
      NSU_CV: 40,
      AUTORIZACAO: 35,
      TID: 35,
      NUMERO_PEDIDO: 28,
      VALOR_BRUTO: 32,
      DATA_VENDA: 20,
      HORA_VENDA: 8,
      CODFILIAL: 12,
      PARCELAS: 9,
      BANDEIRA: 4,
      MODALIDADE: 4,
    },
    regrasPorOperadora: {
      REDE: {
        usarValorAtualizado: true,
      },
    },
    mapeamentoEstabelecimentoFilial: [],
    regraParceladoVista: "PADRAO",
    tratamentoCancelamento: "SEPARAR",
    tratamentoChargeback: "SEPARAR",
    atualizadoEm: nowIso(),
    atualizadoPor: usuario,
  };

  regras.push(nova);
  return nova;
}

export function addLog(importacaoId: string, etapa: string, mensagem: string, criadoPor: string, payloadResumo?: Record<string, unknown>): void {
  logsStore().unshift({
    id: nextId("ACL", logsStore().length),
    importacaoId,
    etapa,
    mensagem,
    payloadResumo,
    criadoEm: nowIso(),
    criadoPor,
  });
}

export function removeResultadosImportacao(importacaoId: string): void {
  db.auditoriaCartaoMatches = (db.auditoriaCartaoMatches as any[]).filter((item) => item.importacaoId !== importacaoId);
  db.auditoriaCartaoDivergencias = divergenciasStore().filter((item) => item.importacaoId !== importacaoId);
}

export function registrarAjuste(
  importacaoId: string,
  divergenciaId: string,
  acao: string,
  valorAnterior: string,
  valorNovo: string,
  observacao: string,
  usuario: string,
): void {
  ajustesStore().unshift({
    id: nextId("ACJ", ajustesStore().length),
    importacaoId,
    divergenciaId,
    acao,
    valorAnterior,
    valorNovo,
    observacao,
    usuario,
    criadoEm: nowIso(),
  });
}

export function makeDivergencia(
  partial: Omit<AuditoriaCartaoDivergencia, "id" | "criadoEm" | "atualizadoEm" | "atualizadoPor">,
  usuario: string,
): AuditoriaCartaoDivergencia {
  const now = nowIso();
  return {
    ...partial,
    id: nextId("ACD", divergenciasStore().length),
    criadoEm: now,
    atualizadoEm: now,
    atualizadoPor: usuario,
  };
}
