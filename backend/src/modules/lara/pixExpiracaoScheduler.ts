/**
 * pixExpiracaoScheduler — Detecta cobranças PIX expiradas e reenvia automaticamente.
 *
 * A cada 15 minutos:
 *   1. Lista cobranças PIX não pagas criadas há mais de N horas (BRADESCO_PIX_EXPIRACAO_SEGUNDOS)
 *   2. Marca como expiradas e gera novo PIX para o cliente
 */

import { isOracleEnabled } from "../../db/oracle.js";
import {
  listPixCobrancasExpiradas,
  marcarPixCobrancaExpirada,
} from "./oracleRepository.js";
import { laraOperationalStore } from "./operationalStore.js";
import { laraService } from "./service.js";
import { getPilotCodclis } from "../../config/env.js";

const TICK_MS = 15 * 60 * 1000; // 15 minutos
const EXPIRACAO_PADRAO_HORAS = 24;

// Evita reprocessar o mesmo TXID na mesma sessão
const _processados = new Set<string>();

async function getExpiracaoHoras(): Promise<number> {
  try {
    const seg = Number(
      (await laraOperationalStore.getConfiguracao("BRADESCO_PIX_EXPIRACAO_SEGUNDOS")) ?? 86400,
    );
    return Math.max(1, Math.ceil(seg / 3600));
  } catch {
    return EXPIRACAO_PADRAO_HORAS;
  }
}

async function tick(): Promise<void> {
  if (!isOracleEnabled()) return;

  const pilotCodclis = getPilotCodclis();
  const expiracaoHoras = await getExpiracaoHoras();
  const expirados = await listPixCobrancasExpiradas(expiracaoHoras, 20).catch(() => []);
  if (!expirados.length) return;

  for (const pix of expirados) {
    if (_processados.has(pix.txid)) continue;
    if (pilotCodclis.size > 0 && !pilotCodclis.has(pix.codcli)) continue;

    // Garante que só reenvia uma vez mesmo após restart do servidor
    const jaReenviado = await laraOperationalStore
      .findIntegrationByIdempotency(`pix-expiracao:${pix.txid}`)
      .catch(() => null);
    if (jaReenviado) {
      _processados.add(pix.txid); // sincroniza memória
      continue;
    }

    _processados.add(pix.txid);

    try {
      await marcarPixCobrancaExpirada(pix.txid);

      const novoPix = await laraService.gerarNovoPixParaCliente(pix.codcli);
      if (!novoPix) continue;

      const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
      if (!isUazapiConfigured()) continue;

      const valorFmt = novoPix.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const validadeLabel = novoPix.expiracaoHoras === 24
        ? "valido por 24 horas"
        : `valido por ${novoPix.expiracaoHoras} horas`;
      await sendText(
        novoPix.waId,
        `Seu PIX anterior expirou. Segue novo PIX copia e cola para pagamento no valor de ${valorFmt}. O codigo e ${validadeLabel}:`,
      );
      await new Promise<void>((r) => setTimeout(r, 800));
      await sendText(novoPix.waId, novoPix.pixCode);

      await laraOperationalStore.addIntegrationLog({
        integracao: "pix-expiracao-scheduler",
        tipo: "reenvio-pix-expirado",
        request_json: { txid_antigo: pix.txid, codcli: pix.codcli },
        response_json: { wa_id: novoPix.waId, novo_pix_gerado: true },
        status_operacao: "processado",
        idempotency_key: `pix-expiracao:${pix.txid}`,
      }).catch(() => {});
    } catch {
      _processados.delete(pix.txid); // permite retentar
    }
  }
}

export function startPixExpiracaoScheduler(): () => void {
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
