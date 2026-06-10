/**
 * slaAlertScheduler — SLA de atendimento humano com 3 níveis de escalação.
 *
 * Verifica a cada 5 minutos os casos ESCALACAO_HUMANA abertos:
 *   Nível 1: Alerta para contatos configurados (feito na criação do caso por laraAlerts)
 *   Nível 2: Após LARA_SLA_NIVEL1_MIN minutos → alerta supervisor + avisa o cliente
 *   Nível 3: Após LARA_SLA_NIVEL2_MIN minutos → alerta gerente a cada LARA_SLA_GERENTE_REPEAT_MIN minutos até assumir
 *
 * Regras:
 *   - Fora do horário comercial: não envia alertas de escalação (pausa clock SLA)
 *   - Caso assumido (status = 'assumido' ou 'resolvido'): para os alertas
 */

import { laraOperationalStore } from "./operationalStore.js";

const TICK_MS = 5 * 60 * 1000; // 5 minutos

type SlaConfig = {
  nivel1Min: number;
  nivel2Min: number;
  gerenteRepeatMin: number;
  supervisorNumero: string;
  supervisorNome: string;
  gerenteNumero: string;
  gerenteNome: string;
  horarioInicioH: number;
  horarioFimH: number;
  timeZone: string;
};

async function loadSlaConfig(): Promise<SlaConfig> {
  const cfgs = await laraOperationalStore.listConfiguracoes().catch(() => [] as { chave: string; valor: string }[]);
  const m = new Map(cfgs.map((c) => [String(c.chave).toUpperCase(), String(c.valor ?? "").trim()]));
  return {
    nivel1Min: Math.max(5, Number(m.get("LARA_SLA_NIVEL1_MIN") ?? 30)),
    nivel2Min: Math.max(10, Number(m.get("LARA_SLA_NIVEL2_MIN") ?? 60)),
    gerenteRepeatMin: Math.max(10, Number(m.get("LARA_SLA_GERENTE_REPEAT_MIN") ?? 15)),
    supervisorNumero: m.get("LARA_SLA_SUPERVISOR_NUMERO") ?? "",
    supervisorNome: m.get("LARA_SLA_SUPERVISOR_NOME") ?? "Supervisor",
    gerenteNumero: m.get("LARA_SLA_GERENTE_NUMERO") ?? "",
    gerenteNome: m.get("LARA_SLA_GERENTE_NOME") ?? "Gerente",
    horarioInicioH: Math.max(0, Number(m.get("LARA_HORARIO_COMERCIAL_INICIO") ?? 8)),
    horarioFimH: Math.min(23, Number(m.get("LARA_HORARIO_COMERCIAL_FIM") ?? 18)),
    timeZone: m.get("LARA_SYNC_DAILY_TIMEZONE") ?? "America/Manaus",
  };
}

function getLocalHour(tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false });
  return Number(fmt.formatToParts(new Date()).find((p) => p.type === "hour")?.value ?? "0");
}

function isHorarioComercial(config: SlaConfig): boolean {
  const h = getLocalHour(config.timeZone);
  return h >= config.horarioInicioH && h < config.horarioFimH;
}

async function jaFezAcao(key: string): Promise<boolean> {
  try {
    const existing = await laraOperationalStore.findIntegrationByIdempotency(key);
    return Boolean(existing);
  } catch {
    return false;
  }
}

async function registrarAcao(key: string, caseId: string, nivel: string): Promise<void> {
  await laraOperationalStore.addIntegrationLog({
    integracao: "sla-alert-scheduler",
    tipo: `escalacao-${nivel}`,
    request_json: { case_id: caseId },
    response_json: { nivel },
    status_operacao: "processado",
    idempotency_key: key,
  }).catch(() => {});
}

async function enviarParaNumero(numero: string, mensagem: string): Promise<void> {
  if (!numero) return;
  try {
    const { sendText, isUazapiConfigured } = await import("./uazapiService.js");
    if (isUazapiConfigured()) await sendText(numero, mensagem);
  } catch {
    // nao critico
  }
}

async function notificarClienteNivel2(waId: string): Promise<void> {
  if (!waId) return;
  await enviarParaNumero(
    waId,
    "Seu atendimento esta sendo redirecionado para um de nossos atendentes. Em breve voce sera atendido. Agradecemos a paciencia!",
  );
}

async function tick(): Promise<void> {
  const config = await loadSlaConfig();

  // Fora do horário comercial: não processa escalações
  if (!isHorarioComercial(config)) return;

  const cases = await laraOperationalStore.listCases().catch(() => []);
  const agora = Date.now();

  const casosAbertos = cases.filter((c) => {
    const status = String(c.status ?? "").toLowerCase();
    return (
      String(c.acao ?? "").toUpperCase() === "ESCALACAO_HUMANA" &&
      status !== "resolvido" &&
      status !== "assumido" &&
      status !== "fechado"
    );
  });

  for (const caso of casosAbertos) {
    const criadoEm = new Date(String(caso.data_hora ?? "")).getTime();
    if (!Number.isFinite(criadoEm)) continue;
    const minutosAberto = (agora - criadoEm) / 60_000;

    // ── Nível 2: Supervisor ─────────────────────────────────────────────────
    if (minutosAberto >= config.nivel1Min && config.supervisorNumero) {
      const keyN2 = `sla-nivel2:${caso.id}`;
      if (!(await jaFezAcao(keyN2))) {
        const msg =
          `Alerta SLA - Nivel 2\n\n` +
          `Atendimento aguardando ha ${Math.round(minutosAberto)} minutos sem ser assumido.\n` +
          `Cliente: ${caso.cliente || "N/A"}${caso.codcli ? ` (cod. ${caso.codcli})` : ""}\n` +
          `WhatsApp: ${caso.wa_id || "N/A"}\n\n` +
          `Por favor assuma o atendimento no painel /lara/atendimento-humano.`;
        await enviarParaNumero(config.supervisorNumero, msg);
        await registrarAcao(keyN2, caso.id, "supervisor");

        // Avisa o cliente
        await notificarClienteNivel2(caso.wa_id);
      }
    }

    // ── Nível 3: Gerente (repete a cada gerenteRepeatMin) ──────────────────
    if (minutosAberto >= config.nivel2Min && config.gerenteNumero) {
      // Calcula quantas repetições já foram enviadas
      const reps = Math.floor((minutosAberto - config.nivel2Min) / config.gerenteRepeatMin);
      const keyN3 = `sla-nivel3:${caso.id}:${reps}`;
      if (!(await jaFezAcao(keyN3))) {
        const msg =
          `URGENTE - SLA Nivel 3${reps > 0 ? ` (repeticao ${reps + 1})` : ""}\n\n` +
          `Atendimento NAO ASSUMIDO ha ${Math.round(minutosAberto)} minutos!\n` +
          `Cliente: ${caso.cliente || "N/A"}${caso.codcli ? ` (cod. ${caso.codcli})` : ""}\n` +
          `WhatsApp: ${caso.wa_id || "N/A"}\n\n` +
          `Acao imediata necessaria. Acesse /lara/atendimento-humano.`;
        await enviarParaNumero(config.gerenteNumero, msg);
        await registrarAcao(keyN3, caso.id, `gerente-rep${reps}`);
      }
    }
  }
}

export function startSlaAlertScheduler(): () => void {
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
