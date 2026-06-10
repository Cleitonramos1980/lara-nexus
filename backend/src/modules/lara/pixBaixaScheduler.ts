/**
 * pixBaixaScheduler — Detecta títulos já pagos no Oracle e faz baixa automática.
 *
 * A cada 10 minutos:
 *   1. Lista cobranças PIX não pagas em LARA_PIX_COBRANCAS
 *   2. Para cada uma, verifica se PCPREST já está baixado
 *   3. Se pago, marca PAGO=1 e envia confirmação ao cliente
 */

import { isOracleEnabled } from "../../db/oracle.js";
import {
  listPixCobrancasPendentes,
  marcarPixCobrancaPago,
  verificarTituloPagoPcprest,
} from "./oracleRepository.js";
import { laraOperationalStore } from "./operationalStore.js";
import { getPilotCodclis } from "../../config/env.js";

const TICK_MS = 10 * 60 * 1000; // 10 minutos

async function enviarConfirmacaoPagamento(waId: string, valor: number): Promise<void> {
  if (!waId) return;
  try {
    const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
    if (!isUazapiConfigured()) return;
    const valorFmt = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await sendText(
      waId,
      `Seu pagamento de ${valorFmt} foi confirmado com sucesso!\n\nObrigado por regularizar sua situacao. Estamos a disposicao.`,
    );
  } catch {
    // nao crítico
  }
}

async function tick(): Promise<void> {
  if (!isOracleEnabled()) return;

  const pilotCodclis = getPilotCodclis();
  const pendentes = await listPixCobrancasPendentes(50).catch(() => []);
  if (!pendentes.length) return;

  for (const pix of pendentes) {
    if (pilotCodclis.size > 0 && !pilotCodclis.has(pix.codcli)) continue;

    const { pago, dtpag } = await verificarTituloPagoPcprest(pix.duplicata, pix.prestacao);
    if (!pago) continue;

    const dtPagFinal = dtpag ?? new Date();
    await marcarPixCobrancaPago(pix.txid, dtPagFinal).catch(() => {});

    // Recuperar wa_id do cliente para enviar confirmação
    const msgs = await laraOperationalStore.listMessagesByCodcli(pix.codcli, { maxRows: 1 }).catch(() => []);
    const waId = String(msgs[0]?.wa_id ?? "").trim();
    if (waId) await enviarConfirmacaoPagamento(waId, pix.valor);

    await laraOperationalStore.addIntegrationLog({
      integracao: "pix-baixa-scheduler",
      tipo: "baixa-automatica",
      request_json: { txid: pix.txid, codcli: pix.codcli, duplicata: pix.duplicata },
      response_json: { dtpag: dtPagFinal.toISOString(), wa_id: waId },
      status_operacao: "processado",
      idempotency_key: `pix-baixa:${pix.txid}`,
    }).catch(() => {});
  }
}

export function startPixBaixaScheduler(): () => void {
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
