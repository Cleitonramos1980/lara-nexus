/**
 * laraAlerts — Alertas operacionais via WhatsApp para numero administrativo.
 *
 * Envia mensagens para LARA_ALERT_WHATSAPP_NUMBER quando:
 *   - Nova escalacao humana criada (AGUARDANDO_HUMANO)
 *   - Sync diario falha por N tentativas consecutivas
 *
 * Usa uazapi se configurado, senao Meta Cloud API, senao apenas loga.
 */

import { env } from "../../config/env.js";
import { saudacaoHoraria } from "./utils.js";

// Cooldown por tipo de alerta: evita spam no mesmo numero
const _lastSent = new Map<string, number>();

function cooldownOk(key: string, minutos: number): boolean {
  const last = _lastSent.get(key) ?? 0;
  const elapsed = Date.now() - last;
  return elapsed >= minutos * 60 * 1000;
}

function markSent(key: string): void {
  _lastSent.set(key, Date.now());
}

async function enviarAlerta(mensagem: string): Promise<void> {
  const numero = String(env.LARA_ALERT_WHATSAPP_NUMBER ?? "").trim();
  if (!numero) return;

  try {
    const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
    const { sendTextMessage, isWhatsAppConfigured } = await import("./whatsappTemplateManager.js");

    if (isUazapiConfigured()) {
      await sendText(numero, mensagem);
    } else if (isWhatsAppConfigured()) {
      await sendTextMessage(numero, mensagem);
    } else {
      console.warn("[laraAlerts] Nenhum canal configurado para envio de alerta. Mensagem:", mensagem);
    }
  } catch (err) {
    console.error("[laraAlerts] Falha ao enviar alerta WhatsApp:", String(err));
  }
}

// ---------------------------------------------------------------------------
// ALERTA 1: Nova escalacao humana
// ---------------------------------------------------------------------------

export async function alertarEscalacaoHumana(input: {
  waId: string;
  nomeCliente?: string;
  codcli?: string | number;
  prioridade?: string;
  motivo?: string;
}): Promise<void> {
  const cooldownMin = Number(env.LARA_ALERT_HUMANO_COOLDOWN_MIN ?? 10);
  const cooldownKey = `humano:${input.waId}`;

  if (!cooldownOk(cooldownKey, cooldownMin)) return;

  const saudacao = saudacaoHoraria();
  const prioridadeLabel = input.prioridade === "critica" ? " [URGENTE]" : input.prioridade === "alta" ? " [ALTA]" : "";
  const nomeLabel = input.nomeCliente ? ` - ${input.nomeCliente}` : "";
  const codcliLabel = input.codcli ? ` (cod. ${input.codcli})` : "";
  const motivoLabel = input.motivo ? `\nMotivo: ${input.motivo.slice(0, 120)}` : "";

  const mensagem =
    `${saudacao}! Alerta Lara${prioridadeLabel}\n\n` +
    `Novo atendimento aguardando humano:\n` +
    `Cliente${nomeLabel}${codcliLabel}\n` +
    `Numero: ${input.waId}` +
    motivoLabel +
    `\n\nAcesse o painel em /lara/atendimento-humano para assumir.`;

  markSent(cooldownKey);
  await enviarAlerta(mensagem);
}

// ---------------------------------------------------------------------------
// ALERTA 2: Falha consecutiva no sync diario
// ---------------------------------------------------------------------------

let _syncFalhasConsecutivas = 0;
let _syncUltimoSucesso: string | null = null;

export function registrarSyncSucesso(): void {
  _syncFalhasConsecutivas = 0;
  _syncUltimoSucesso = new Date().toLocaleString("pt-BR", { timeZone: "America/Manaus" });
}

export async function registrarSyncFalha(erro: string): Promise<void> {
  _syncFalhasConsecutivas += 1;
  const maxFalhas = Number(env.LARA_ALERT_SYNC_FALHAS_MAX ?? 2);

  if (_syncFalhasConsecutivas < maxFalhas) return;

  const cooldownKey = `sync:falha`;
  if (!cooldownOk(cooldownKey, 60)) return; // maximo 1 alerta por hora

  const ultimoSucessoLabel = _syncUltimoSucesso
    ? `Ultimo sucesso: ${_syncUltimoSucesso}`
    : "Nenhum sucesso registrado nesta sessao";

  const mensagem =
    `Alerta Lara - Falha no sync diario\n\n` +
    `O sync com o WinThor/Oracle falhou ${_syncFalhasConsecutivas} vezes consecutivas.\n` +
    `${ultimoSucessoLabel}\n\n` +
    `Erro: ${erro.slice(0, 200)}\n\n` +
    `Os dados da Lara podem estar desatualizados. Verifique a conexao com o Oracle.`;

  markSent(cooldownKey);
  await enviarAlerta(mensagem);
}
