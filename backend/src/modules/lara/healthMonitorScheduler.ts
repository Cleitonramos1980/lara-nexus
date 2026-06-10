/**
 * healthMonitorScheduler — Verifica saúde do sistema a cada 5 minutos.
 *
 * Checa:
 *   - Conexão Oracle (se habilitado)
 *   - Conexão uazapi (instância conectada)
 *   - Processo backend vivo (auto-verificação)
 *
 * Envia alerta WhatsApp para os contatos administrativos quando detecta falha.
 * Envia alerta de recuperação quando o sistema volta ao normal.
 */

import { isOracleEnabled } from "../../db/oracle.js";
import { laraOperationalStore } from "./operationalStore.js";
import { enviarAlertaParaTodos } from "./laraAlerts.js";

const TICK_MS = 5 * 60 * 1000; // 5 minutos

type HealthStatus = {
  oracle: "ok" | "falha" | "desabilitado";
  uazapi: "ok" | "falha" | "desabilitado";
  ultimaVerificacao: string;
};

let _ultimoStatus: HealthStatus | null = null;
let _alertaEnviado = false;

async function verificarOracle(): Promise<"ok" | "falha" | "desabilitado"> {
  if (!isOracleEnabled()) return "desabilitado";
  try {
    await laraOperationalStore.getConfiguracao("LARA_HEALTH_PING");
    return "ok";
  } catch {
    return "falha";
  }
}

async function verificarUazapi(): Promise<"ok" | "falha" | "desabilitado"> {
  try {
    const { isUazapiConfigured, getInstanceStatus } = await import("./uazapiService.js");
    if (!isUazapiConfigured()) return "desabilitado";
    const status = await getInstanceStatus();
    return status.status === "connected" ? "ok" : "falha";
  } catch {
    return "falha";
  }
}

async function tick(): Promise<void> {
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Manaus" });

  const [oracle, uazapi] = await Promise.all([
    verificarOracle(),
    verificarUazapi(),
  ]);

  const status: HealthStatus = { oracle, uazapi, ultimaVerificacao: agora };
  const hasFalha = oracle === "falha" || uazapi === "falha";

  // Recuperação — sistema voltou ao normal
  if (!hasFalha && _alertaEnviado) {
    _alertaEnviado = false;
    await enviarAlertaParaTodos(
      `Lara - Sistema recuperado\n\nTodos os servicos voltaram ao normal.\nOracle: ${oracle} | uazapi: ${uazapi}\nHora: ${agora}`,
      "health:recuperado",
      30,
    ).catch(() => {});
  }

  // Falha detectada — envia alerta (com cooldown de 10 min para nao spammar)
  if (hasFalha && !_alertaEnviado) {
    _alertaEnviado = true;
    const detalhes: string[] = [];
    if (oracle === "falha") detalhes.push("Oracle/WinThor: FALHA na conexao");
    if (uazapi === "falha") detalhes.push("uazapi/WhatsApp: instancia desconectada");

    await enviarAlertaParaTodos(
      `Alerta Lara - Falha de sistema\n\n${detalhes.join("\n")}\nHora: ${agora}\n\nVerifique o servidor e a conexao com os servicos.`,
      "health:falha",
      10,
    ).catch(() => {});
  }

  _ultimoStatus = status;
}

export function getHealthStatus(): HealthStatus | null {
  return _ultimoStatus;
}

export function startHealthMonitorScheduler(): () => void {
  void tick(); // primeira verificação imediata
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  return () => clearInterval(timer);
}
