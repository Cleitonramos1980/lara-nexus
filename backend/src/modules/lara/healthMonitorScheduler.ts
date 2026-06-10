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

const TICK_MS = 5 * 60 * 1000; // 5 minutos

type HealthStatus = {
  oracle: "ok" | "falha" | "desabilitado";
  uazapi: "ok" | "falha" | "desabilitado";
  ultimaVerificacao: string;
};

let _ultimoStatus: HealthStatus | null = null;
let _alertaEnviado = false;
// Rastreia a última vez que o alerta de repetição foi enviado ao TI
let _ultimoAlertaTiMs = 0;

async function getTiConfig(): Promise<{ numero: string; nome: string; repeatMin: number }> {
  const [numero, nome, repeatMin] = await Promise.all([
    laraOperationalStore.getConfiguracao("LARA_TI_NUMERO").catch(() => null),
    laraOperationalStore.getConfiguracao("LARA_TI_NOME").catch(() => null),
    laraOperationalStore.getConfiguracao("LARA_TI_REPEAT_MIN").catch(() => null),
  ]);
  return {
    numero: String(numero ?? "").trim(),
    nome: String(nome ?? "TI").trim() || "TI",
    repeatMin: Math.max(5, Number(repeatMin ?? 10)),
  };
}

async function enviarAlertaTi(mensagem: string, repeatMin: number): Promise<void> {
  const agora = Date.now();
  if (agora - _ultimoAlertaTiMs < repeatMin * 60 * 1000) return;
  const { numero } = await getTiConfig();
  if (!numero) return;
  try {
    const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
    if (isUazapiConfigured()) {
      _ultimoAlertaTiMs = agora;
      await sendText(numero, mensagem);
    }
  } catch {
    // nao critico
  }
}

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

  const tiConfig = await getTiConfig();

  // Recuperação — sistema voltou ao normal
  if (!hasFalha && _alertaEnviado) {
    _alertaEnviado = false;
    _ultimoAlertaTiMs = 0;
    const msgRecuperado = `Lara - Sistema recuperado\n\nTodos os servicos voltaram ao normal.\nOracle: ${oracle} | uazapi: ${uazapi}\nHora: ${agora}`;
    if (tiConfig.numero) {
      await enviarAlertaTi(msgRecuperado, 0).catch(() => {}); // 0 = sem cooldown na recuperação
    }
  }

  // Falha detectada — somente TI recebe, repetindo a cada repeatMin
  if (hasFalha) {
    if (!_alertaEnviado) _alertaEnviado = true;
    const detalhes: string[] = [];
    if (oracle === "falha") detalhes.push("Oracle/WinThor: FALHA na conexao");
    if (uazapi === "falha") detalhes.push("uazapi/WhatsApp: instancia desconectada");
    const msgFalha =
      `ALERTA - Falha de sistema Lara\n\n${detalhes.join("\n")}\nHora: ${agora}\n\nVerifique o servidor e a conexao com os servicos.`;
    if (tiConfig.numero) {
      await enviarAlertaTi(msgFalha, tiConfig.repeatMin).catch(() => {});
    }
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
