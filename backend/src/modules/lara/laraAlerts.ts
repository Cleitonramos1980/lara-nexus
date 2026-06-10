/**
 * laraAlerts — Alertas operacionais via WhatsApp para contatos administrativos.
 *
 * Envia mensagens para ate 3 contatos configurados em /lara/configuracoes quando:
 *   - Nova escalacao humana criada (AGUARDANDO_HUMANO)
 *   - Sync diario falha por N tentativas consecutivas
 *
 * Contatos configurados via chaves:
 *   LARA_ALERT_CONTATO_1_NOME / LARA_ALERT_CONTATO_1_NUMERO
 *   LARA_ALERT_CONTATO_2_NOME / LARA_ALERT_CONTATO_2_NUMERO
 *   LARA_ALERT_CONTATO_3_NOME / LARA_ALERT_CONTATO_3_NUMERO
 *
 * Fallback: se nao houver contatos no banco, usa LARA_ALERT_WHATSAPP_NUMBER do .env.
 * Canal: uazapi se configurado, senao Meta Cloud API, senao apenas loga.
 */

import { env } from "../../config/env.js";
import { saudacaoHoraria } from "./utils.js";
import { laraOperationalStore } from "./operationalStore.js";

// Cooldown por tipo de alerta + numero: evita spam
const _lastSent = new Map<string, number>();

function cooldownOk(key: string, minutos: number): boolean {
  const last = _lastSent.get(key) ?? 0;
  return Date.now() - last >= minutos * 60 * 1000;
}

function markSent(key: string): void {
  _lastSent.set(key, Date.now());
}

type AlertContato = { nome: string; numero: string };

async function listarContatosAlerta(): Promise<AlertContato[]> {
  const contatos: AlertContato[] = [];
  for (let i = 1; i <= 3; i++) {
    const nome = String((await laraOperationalStore.getConfiguracao(`LARA_ALERT_CONTATO_${i}_NOME`)) ?? "").trim();
    const numero = String((await laraOperationalStore.getConfiguracao(`LARA_ALERT_CONTATO_${i}_NUMERO`)) ?? "").trim();
    if (numero) contatos.push({ nome: nome || `Contato ${i}`, numero });
  }
  // Fallback para env var se nenhum contato configurado no banco
  if (contatos.length === 0) {
    const fallback = String(env.LARA_ALERT_WHATSAPP_NUMBER ?? "").trim();
    if (fallback) contatos.push({ nome: "Admin", numero: fallback });
  }
  return contatos;
}

async function enviarAlertaParaNumero(numero: string, mensagem: string): Promise<void> {
  try {
    const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
    const { sendTextMessage, isWhatsAppConfigured } = await import("./whatsappTemplateManager.js");

    if (isUazapiConfigured()) {
      await sendText(numero, mensagem);
    } else if (isWhatsAppConfigured()) {
      await sendTextMessage(numero, mensagem);
    } else {
      console.warn("[laraAlerts] Nenhum canal configurado. Alerta:", mensagem.slice(0, 80));
    }
  } catch (err) {
    console.error("[laraAlerts] Falha ao enviar alerta para", numero, "-", String(err));
  }
}

async function enviarAlerta(mensagem: string, cooldownKey: string, cooldownMin: number): Promise<void> {
  const contatos = await listarContatosAlerta();
  for (const contato of contatos) {
    const key = `${cooldownKey}:${contato.numero}`;
    if (!cooldownOk(key, cooldownMin)) continue;
    markSent(key);
    await enviarAlertaParaNumero(contato.numero, mensagem);
  }
}

export async function enviarAlertaParaTodos(mensagem: string, cooldownKey: string, cooldownMin: number): Promise<void> {
  await enviarAlerta(mensagem, cooldownKey, cooldownMin);
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

  await enviarAlerta(mensagem, `humano:${input.waId}`, cooldownMin);
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

  const ultimoSucessoLabel = _syncUltimoSucesso
    ? `Ultimo sucesso: ${_syncUltimoSucesso}`
    : "Nenhum sucesso registrado nesta sessao";

  const mensagem =
    `Alerta Lara - Falha no sync diario\n\n` +
    `O sync com o WinThor/Oracle falhou ${_syncFalhasConsecutivas} vezes consecutivas.\n` +
    `${ultimoSucessoLabel}\n\n` +
    `Erro: ${erro.slice(0, 200)}\n\n` +
    `Os dados da Lara podem estar desatualizados. Verifique a conexao com o Oracle.`;

  await enviarAlerta(mensagem, "sync:falha", 60);
}
