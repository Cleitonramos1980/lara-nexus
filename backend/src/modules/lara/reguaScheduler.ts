/**
 * Lara — Scheduler Autônomo da Régua de Cobrança
 *
 * Timing inteligente: cada cliente recebe sua mensagem em um horário diferente
 * entre 8h e 12h, sem padrão óbvio. O horário é determinístico por cliente/dia
 * (hash de codcli + data) mas aprendemos o melhor horário de resposta de cada
 * cliente ao longo do tempo para otimizar.
 */

import { laraService } from "./service.js";
import { laraOperationalStore } from "./operationalStore.js";
import { dateToIsoDate, dateToIsoDateTime, makeIdempotencyKey } from "./utils.js";
import { isWhatsAppConfigured } from "./whatsappTemplateManager.js";
import { isUazapiConfigured } from "./uazapiService.js";
import { getPilotCodclis } from "../../config/env.js";

type LoggerLike = {
  info?:  (p: Record<string, unknown>, msg?: string) => void;
  warn?:  (p: Record<string, unknown>, msg?: string) => void;
  error?: (p: Record<string, unknown>, msg?: string) => void;
};

type ReguaSettings = {
  enabled:  boolean;
  timeZone: string;
  delayMs:  number; // pausa entre envios (ms) — evita throttle da Meta
  etapas:   Set<string>;
};

// Janela de supressão por etapa: não reenvia para o mesmo cliente na mesma etapa
// enquanto não expirar o período (evita spam em caso de reexecução no mesmo dia).
const SUPRESSAO_DIAS: Record<string, number> = {
  "D-3":  1,
  "D0":   1,
  "D+3":  6,
  "D+7":  6,
  "D+15": 13,
  "D+30": 28,
};

const TICK_MS           = 60_000;
const RETRY_AFTER_MS    = 15 * 60 * 1000;
const ETAPAS_DEFAULT    = new Set(["D-3", "D0", "D+3", "D+7", "D+15", "D+30"]);

// Janela de disparo: 8h00 até 11h59 (não disparar depois das 12h)
const DISPATCH_HOUR_MIN = 8;
const DISPATCH_HOUR_MAX = 11; // inclusive

/**
 * Gera um hash numérico simples a partir de uma string (djb2).
 * Determinístico: mesma entrada → mesmo resultado sempre.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // mantém unsigned 32-bit
  }
  return h;
}

/**
 * Calcula horário alvo de disparo para um cliente específico nesta data.
 * Usa hash(codcli + dateKey) para ser: determinístico, sem padrão óbvio entre clientes,
 * diferente a cada dia para o mesmo cliente.
 *
 * Se houver histórico de respostas do cliente, prioriza o horário em que ele costuma responder.
 */
function calcClienteDispatchHour(codcli: string | number, dateKey: string, learnedHour?: number): number {
  if (learnedHour !== undefined && learnedHour >= DISPATCH_HOUR_MIN && learnedHour <= DISPATCH_HOUR_MAX) {
    return learnedHour;
  }
  const range = DISPATCH_HOUR_MAX - DISPATCH_HOUR_MIN + 1; // 4 horas (8,9,10,11)
  const seed = hashString(`${codcli}:${dateKey}`);
  return DISPATCH_HOUR_MIN + (seed % range);
}

function calcClienteDispatchMinute(codcli: string | number, dateKey: string): number {
  // Minuto entre 0 e 59, também sem padrão
  const seed = hashString(`${codcli}:${dateKey}:min`);
  return seed % 60;
}

/**
 * Aprende o horário preferido de resposta do cliente baseado no histórico de mensagens INBOUND.
 * Retorna a moda do horário de respostas anteriores (em horas), ou undefined se sem histórico.
 */
/** Extrai a hora local (no fuso timeZone) de um timestamp ISO. */
function extractLocalHour(isoTs: string, timeZone: string): number {
  const d = new Date(isoTs);
  if (!Number.isFinite(d.getTime())) return -1;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(d);
    return Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  } catch {
    return -1;
  }
}

async function getClienteLearnedHour(codcli: number, timeZone: string): Promise<number | undefined> {
  try {
    const msgs = await laraOperationalStore.listMessagesByCodcli(codcli);
    // Considera apenas os últimos 90 dias para não arrastar histórico antigo
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const inboundHours = msgs
      .filter((m) => {
        if (String(m.direction).toUpperCase() !== "INBOUND" || !m.received_at) return false;
        const ts = new Date(String(m.received_at)).getTime();
        return Number.isFinite(ts) && ts >= ninetyDaysAgo;
      })
      .map((m) => extractLocalHour(String(m.received_at), timeZone))
      .filter((h) => h >= DISPATCH_HOUR_MIN && h <= DISPATCH_HOUR_MAX + 4);

    if (inboundHours.length < 2) return undefined;

    const freq = new Map<number, number>();
    for (const h of inboundHours) {
      freq.set(h, (freq.get(h) ?? 0) + 1);
    }
    let bestHour = -1;
    let bestCount = 0;
    for (const [h, count] of freq) {
      if (count > bestCount) { bestHour = h; bestCount = count; }
    }
    if (bestHour < DISPATCH_HOUR_MIN || bestHour > DISPATCH_HOUR_MAX) return undefined;
    return bestHour;
  } catch {
    return undefined;
  }
}

function parseBool(v: string | null | undefined, fallback: boolean): boolean {
  if (!v) return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "sim", "yes", "on"].includes(s)) return true;
  if (["0", "false", "nao", "no", "off"].includes(s)) return false;
  return fallback;
}

function parseInt2(v: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getDateParts(now: Date, tz: string): { hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = new Map(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    hour:    Number(parts.get("hour")   ?? "0"),
    minute:  Number(parts.get("minute") ?? "0"),
    dateKey: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
  };
}

async function loadSettings(): Promise<ReguaSettings> {
  const cfgs = await laraOperationalStore.listConfiguracoes().catch(() => [] as { chave: string; valor: string }[]);
  const m = new Map(cfgs.map((c) => [String(c.chave).toUpperCase(), String(c.valor)]));

  const etapasRaw = m.get("LARA_REGUA_ETAPAS");
  const etapas = etapasRaw
    ? new Set(etapasRaw.split(",").map((e) => e.trim()).filter(Boolean))
    : ETAPAS_DEFAULT;

  return {
    enabled:  parseBool(m.get("LARA_REGUA_ATIVO"), true),
    timeZone: m.get("LARA_SYNC_DAILY_TIMEZONE") ?? "America/Sao_Paulo",
    delayMs:  parseInt2(m.get("LARA_REGUA_DELAY_MS"), 200, 0, 5000),
    etapas,
  };
}

/** Chave de supressão: impede reenvio para o mesmo cliente/etapa dentro da janela configurada. */
function supressaoKey(codcli: string | number, etapa: string): string {
  const diasJanela = SUPRESSAO_DIAS[etapa] ?? 6;
  const msJanela   = diasJanela * 24 * 60 * 60 * 1000;
  const janela     = Math.floor(Date.now() / msJanela);
  return makeIdempotencyKey(["regua-scheduler", String(codcli), etapa, String(janela)]);
}

/**
 * Processa os clientes cujo horário alvo foi atingido neste tick.
 * Cada cliente tem um horário único (hash + aprendizado), então o scheduler
 * roda o dia inteiro e vai disparando à medida que o horário de cada um chega.
 */
/**
 * Cache de learned hours por dia: evita N queries Oracle por tick.
 * Chave: `${dateKey}` → Map<codcli, hour | undefined>
 * Preenchido uma única vez no início de cada dia.
 */
const _learnedHourCache = new Map<string, Map<number, number | undefined>>();

async function getLearnedHourCached(codcli: number, dateKey: string, timeZone: string): Promise<number | undefined> {
  let dayCache = _learnedHourCache.get(dateKey);
  if (!dayCache) {
    // Primeiro acesso do dia: limpa dias anteriores e inicializa
    _learnedHourCache.clear();
    dayCache = new Map<number, number | undefined>();
    _learnedHourCache.set(dateKey, dayCache);
  }
  if (dayCache.has(codcli)) return dayCache.get(codcli);
  const h = await getClienteLearnedHour(codcli, timeZone);
  dayCache.set(codcli, h);
  return h;
}

async function executarReguaTick(
  currentHour: number,
  currentMinute: number,
  dateKey: string,
  settings: ReguaSettings,
  logger?: LoggerLike,
): Promise<{ enviado: number; pulado: number; optout: number; semWa: number; erros: number }> {
  const etapasAtivas = settings.etapas;
  const todosClientes = await laraService.listClientes({});

  const pilotCodclis = getPilotCodclis();
  const clientes = pilotCodclis.size > 0
    ? todosClientes.filter((c) => pilotCodclis.has(Number(c.codcli)))
    : todosClientes;

  if (pilotCodclis.size > 0) {
    logger?.info?.({
      modulo: "regua-scheduler",
      pilot_codclis: Array.from(pilotCodclis),
      total_clientes: todosClientes.length,
      clientes_autorizados: clientes.length,
    }, "[PILOTO] Régua restrita — apenas codclis autorizados serão processados");
  }

  let enviado = 0;
  let pulado  = 0;
  let optout  = 0;
  let semWa   = 0;
  let erros   = 0;

  const MAX_TITULOS_POR_CLIENTE = await laraOperationalStore
    .getConfiguracao("LARA_REGUA_MAX_TITULOS")
    .then((v) => Math.max(1, Math.min(500, Number(v ?? 20))))
    .catch(() => 20);

  for (const cliente of clientes) {
    if (!etapasAtivas.has(cliente.etapa_regua)) { pulado++; continue; }
    if (cliente.optout) { optout++; continue; }
    if (!cliente.wa_id && !cliente.telefone) { semWa++; continue; }
    if ((cliente.qtd_titulos ?? 0) > MAX_TITULOS_POR_CLIENTE) { pulado++; continue; }

    // Supressão: já enviado nesta janela?
    const key = supressaoKey(cliente.codcli, cliente.etapa_regua);
    const jaEnviado = await laraOperationalStore.findIntegrationByIdempotency(key).catch(() => null);
    if (jaEnviado) { pulado++; continue; }

    // Timing inteligente: learned hour cacheado por dia (1 query por cliente por DIA, não por tick)
    const codcliNum = Number(cliente.codcli);
    const learnedHour = await getLearnedHourCached(codcliNum, dateKey, settings.timeZone);
    const targetHour   = calcClienteDispatchHour(cliente.codcli, dateKey, learnedHour);
    const targetMinute = calcClienteDispatchMinute(cliente.codcli, dateKey);

    // Só dispara se o horário deste cliente foi atingido
    const clienteReady = currentHour > targetHour
      || (currentHour === targetHour && currentMinute >= targetMinute);
    if (!clienteReady) { pulado++; continue; }

    try {
      const result = await laraService.dispararReguaClienteConsolidado({ codcli: codcliNum });

      if (result.status === "ok") {
        enviado++;
        await laraOperationalStore.addIntegrationLog({
          integracao:      "regua-scheduler",
          tipo:            "disparo-regua",
          request_json:    { codcli: cliente.codcli, etapa: result.etapa, wa_id: result.wa_id, target_hour: targetHour, target_minute: targetMinute, learned_hour: learnedHour },
          response_json:   { wamid: result.wamid, titulos_count: result.titulos_count, mensagem: result.mensagem?.slice(0, 200) },
          status_operacao: "enviado",
          idempotency_key: key,
        });
      } else if (result.status === "optout") {
        optout++;
      } else if (result.status === "sem_wa_id") {
        semWa++;
      } else {
        pulado++;
      }
    } catch (err) {
      erros++;
      logger?.error?.({
        modulo: "regua-scheduler",
        codcli: cliente.codcli,
        etapa:  cliente.etapa_regua,
        erro:   String(err),
      }, "Erro ao disparar regua para cliente");
    }

    if (settings.delayMs > 0) {
      await new Promise((r) => setTimeout(r, settings.delayMs));
    }
  }

  return { enviado, pulado, optout, semWa, erros };
}

export function startLaraReguaScheduler(logger?: LoggerLike): () => void {
  let stopped      = false;
  let running      = false;
  let retryAfterMs = 0;
  // Rastreia o último dateKey processado: reseta a cada dia para permitir novo ciclo
  let lastTickDateKey = "";
  // Acumuladores do dia para o sumário
  let diaEnviado = 0;
  let diaPulado  = 0;
  let diaOptout  = 0;
  let diaSemWa   = 0;
  let diaErros   = 0;

  const runTick = async (reason: "startup" | "timer"): Promise<void> => {
    if (stopped || running) return;
    if (Date.now() < retryAfterMs) return;

    let settings: ReguaSettings;
    try {
      settings = await loadSettings();
    } catch {
      return;
    }

    if (!settings.enabled) return;
    if (!isUazapiConfigured() && !isWhatsAppConfigured()) return;

    let parts: ReturnType<typeof getDateParts>;
    try {
      parts = getDateParts(new Date(), settings.timeZone);
    } catch {
      parts = getDateParts(new Date(), "UTC");
    }

    // Janela de execução: só entre DISPATCH_HOUR_MIN e DISPATCH_HOUR_MAX+1
    if (parts.hour < DISPATCH_HOUR_MIN || parts.hour > DISPATCH_HOUR_MAX) return;

    // Novo dia: salva sumário do dia anterior (sem exceção de "primeiro dia") e reseta acumuladores
    if (parts.dateKey !== lastTickDateKey) {
      // Persiste o sumário sempre que havia atividade — inclusive no primeiro dia (lastTickDateKey = "")
      if (diaEnviado > 0 || diaErros > 0) {
        await laraOperationalStore.addReguaExecucao({
          etapa:            Array.from(settings.etapas).join(","),
          // elegivel = apenas clientes que efetivamente chegaram ao step de decisão
          elegivel:         diaEnviado + diaOptout + diaSemWa + diaErros,
          disparada:        diaEnviado,
          respondida:       0,
          convertida:       0,
          erro:             diaErros,
          bloqueado_optout: diaOptout,
          valor_impactado:  0,
          status:           diaErros > 0 ? "concluido_com_erros" : "concluido",
          detalhes_json:    { pulado: diaPulado, sem_wa: diaSemWa, timing: "inteligente_8_12h", date: lastTickDateKey || parts.dateKey },
        }).catch(() => {});
      }
      lastTickDateKey = parts.dateKey;
      diaEnviado = 0; diaPulado = 0; diaOptout = 0; diaSemWa = 0; diaErros = 0;
    }

    running = true;
    try {
      const result = await executarReguaTick(
        parts.hour, parts.minute, parts.dateKey, settings, logger,
      );
      diaEnviado += result.enviado;
      diaPulado  += result.pulado;
      diaOptout  += result.optout;
      diaSemWa   += result.semWa;
      diaErros   += result.erros;

      if (result.enviado > 0) {
        logger?.info?.({
          modulo:   "regua-scheduler",
          tick:     `${parts.hour}:${String(parts.minute).padStart(2, "0")}`,
          enviado:  result.enviado,
          pulado:   result.pulado,
          optout:   result.optout,
          dia_total: diaEnviado,
        }, "Regua tick: mensagens disparadas");
      }
      retryAfterMs = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      retryAfterMs = Date.now() + RETRY_AFTER_MS;
      logger?.error?.({ modulo: "regua-scheduler", erro: msg }, "Falha no tick da regua de cobranca");
    } finally {
      running = false;
    }
  };

  void runTick("startup");
  const timer = setInterval(() => void runTick("timer"), TICK_MS);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
