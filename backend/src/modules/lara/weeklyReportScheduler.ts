/**
 * weeklyReportScheduler — Relatório semanal de KPIs via WhatsApp toda segunda-feira 8h.
 *
 * Calcula e envia para os contatos administrativos:
 *   - Total de contatos realizados na semana
 *   - Total de cobranças geradas e valor total
 *   - Taxa de resposta dos clientes
 *   - Pagamentos confirmados e valor recuperado
 *   - Escalações para humano
 *   - Opt-outs
 */

import { laraOperationalStore } from "./operationalStore.js";
import { laraService } from "./service.js";
import { enviarAlertaParaTodos } from "./laraAlerts.js";

const TICK_MS = 60 * 60 * 1000; // verifica a cada hora

function getLocalParts(tz: string): { diaSemana: number; hora: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = new Map(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayStr = parts.get("weekday") ?? "Mon"; // Mon=segunda
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    diaSemana: weekdays.indexOf(weekdayStr),
    hora: Number(parts.get("hour") ?? "0"),
  };
}

// Chave para evitar envio duplicado na mesma semana
let _ultimaSemanEnviada = "";

function getISOWeekKey(tz: string): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = new Map(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dateStr = `${parts.get("year") ?? ""}-${parts.get("month") ?? ""}-${parts.get("day") ?? ""}`;
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay()); // retrocede para domingo
  return `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + d.getDay()) / 7)).padStart(2, "0")}`;
}

async function buildRelatorio(tz: string): Promise<string> {
  const agora = new Date();
  const semanaAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: tz });

  let totalContatos = 0;
  let totalRespostas = 0;
  let totalEscalacoes = 0;
  let totalOptouts = 0;
  let totalPagamentos = 0;
  let valorRecuperado = 0;

  try {
    const [logsRegua, logsBaixa, conversas, optouts] = await Promise.all([
      laraOperationalStore.listIntegrationLogs("regua-scheduler", 2000).catch(() => []),
      laraOperationalStore.listIntegrationLogs("pix-baixa-scheduler", 500).catch(() => []),
      laraService.listConversas({}).catch(() => []),
      laraOperationalStore.listOptouts().catch(() => []),
    ]);

    totalContatos = logsRegua.filter((l) => {
      const ts = new Date(String(l.created_at ?? "")).getTime();
      return ts >= semanaAtras.getTime();
    }).length;

    const logsEscalacao = await laraOperationalStore.listCases().catch(() => []);
    totalEscalacoes = logsEscalacao.filter((c) => {
      const ts = new Date(String(c.data_hora ?? "")).getTime();
      return ts >= semanaAtras.getTime() && String(c.acao ?? "").toUpperCase() === "ESCALACAO_HUMANA";
    }).length;

    const logsBaixaRecentes = logsBaixa.filter((l) => {
      const ts = new Date(String(l.created_at ?? "")).getTime();
      return ts >= semanaAtras.getTime();
    });
    totalPagamentos = logsBaixaRecentes.length;

    valorRecuperado = logsBaixaRecentes.reduce((acc, l) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(String(l.response_json ?? "{}")); } catch { /* ok */ }
      const val = Number(parsed["valor"] ?? 0);
      return acc + (Number.isFinite(val) ? val : 0);
    }, 0);

    const conversasRecentes = conversas.filter((c) => {
      const ts = new Date(String(c.ultima_interacao ?? "")).getTime();
      return ts >= semanaAtras.getTime();
    });
    totalRespostas = conversasRecentes.filter((c) => c.total_mensagens > 1).length;

    totalOptouts = optouts.filter((o) => {
      if (!o.ativo) return false;
      const ts = new Date(String(o.data_criacao ?? "")).getTime();
      return ts >= semanaAtras.getTime();
    }).length;
  } catch {
    // dados parciais são aceitáveis
  }

  const taxaResposta = totalContatos > 0
    ? ((totalRespostas / totalContatos) * 100).toFixed(1)
    : "0.0";

  const valorFmt = valorRecuperado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    `Relatorio semanal Lara\n` +
    `Periodo: ${fmtDate(semanaAtras)} a ${fmtDate(agora)}\n\n` +
    `Contatos realizados: ${totalContatos}\n` +
    `Respostas recebidas: ${totalRespostas} (${taxaResposta}%)\n` +
    `Pagamentos confirmados: ${totalPagamentos}\n` +
    `Valor recuperado: ${valorFmt}\n` +
    `Escalacoes para humano: ${totalEscalacoes}\n` +
    `Opt-outs na semana: ${totalOptouts}\n\n` +
    `Acesse o painel em /lara para mais detalhes.`
  );
}

async function tick(): Promise<void> {
  const tz = String(
    await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_TIMEZONE").catch(() => null) ?? "America/Manaus",
  );
  const { diaSemana, hora } = getLocalParts(tz);

  // Segunda-feira (1) às 8h
  if (diaSemana !== 1 || hora !== 8) return;

  const weekKey = getISOWeekKey(tz);
  if (_ultimaSemanEnviada === weekKey) return;
  _ultimaSemanEnviada = weekKey;

  const relatorio = await buildRelatorio(tz);
  await enviarAlertaParaTodos(relatorio, "relatorio-semanal", 100).catch(() => {});
}

export function startWeeklyReportScheduler(): () => void {
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
