import { queryOne } from "../../repositories/baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import type {
  LaraAtendimento,
  LaraCaseItem,
  LaraCliente,
  LaraComplianceAuditItem,
  LaraConversa,
  LaraJurisdicao,
  LaraLogItem,
  LaraMensagem,
  LaraNegociacaoItem,
  LaraNextAction,
  LaraOptoutItem,
  LaraPagedResult,
  LaraReguaEtapa,
  LaraReguaExecucao,
  LaraReguaTemplate,
  LaraTitulo,
  LaraWebhookResponse,
  LaraWinthorBoleto,
} from "./types.js";
import {
  consultarBoletoWinthor,
  findClientByDocument,
  findClientsByPhone,
  gerarOuRegenerarBoletoWinthor,
  getClientByCodcli,
  getOpenSummaryByCodcli,
  listFiliaisFromOracle,
  listOpenTitlesFromOracle,
  prorrogarTituloWinthor,
} from "./oracleRepository.js";
import { laraOperationalStore } from "./operationalStore.js";
import { paginateRows } from "./pagination.js";
import { classifyIntentWithAiFallback, getIntentClassifierHealthSnapshot } from "./nluClassifier.js";
import { chooseNextBestAction } from "./nextBestAction.js";
import { evaluatePolicy } from "./policyEngine.js";
import {
  dateToIsoDate,
  dateToIsoDateTime,
  extractDocumentFromText,
  extractPromessaDate,
  inferEtapaRegua,
  inferRisk,
  makeIdempotencyKey,
  normalizePhone,
  normalizeWaId,
  roundMoney,
  safeText,
  toNumber,
} from "./utils.js";

type SyncResult = {
  totalTitulos: number;
  totalClientes: number;
  codcliAfetados: string[];
  titulosRemovidos?: number;
  clientesRemovidos?: number;
  sincronizadoEm?: string;
};

type MensagemContexto = {
  codcli?: number;
  etapa?: string;
  duplicatas?: string[];
  valor_total?: number;
  created_at?: string;
};

type LaraSyncStatus = {
  configuracao: {
    ativo: boolean;
    hora: number;
    minuto: number;
    timezone: string;
    limit: number;
    includeDesd: boolean;
    startupRun: boolean;
  };
  ultima_execucao: null | {
    status: string;
    data_hora: string;
    total_titulos?: number;
    total_clientes?: number;
    titulos_removidos?: number;
    clientes_removidos?: number;
    erro?: string;
  };
};

function parseDuplicatas(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[;,|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeTituloId(codcli: number, duplicata: string, prestacao: string): string {
  const normalizedDuplicata = duplicata.replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
  const normalizedPrestacao = prestacao.replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
  return `TIT-${codcli}-${normalizedDuplicata}-${normalizedPrestacao}`;
}

function mapOracleStatusToAtendimento(rawStatus: string | null | undefined): string {
  const normalized = String(rawStatus ?? "").trim().toUpperCase();
  if (!normalized) return "Em aberto";
  if (["A", "ABERTO", "EM_ABERTO", "EM ABERTO"].includes(normalized)) return "Em aberto";
  if (["P", "PARCIAL"].includes(normalized)) return "Pagamento parcial";
  if (["B", "BLOQUEADO"].includes(normalized)) return "Bloqueado";
  return String(rawStatus ?? "").trim();
}

function toAtendimento(conversa: LaraConversa, titulos: LaraTitulo[], optoutAtivo: boolean): LaraAtendimento {
  const clienteTitulos = titulos.filter((item) => item.codcli === conversa.codcli);
  return {
    id: conversa.id,
    codcli: conversa.codcli,
    cliente: conversa.cliente,
    telefone: conversa.telefone,
    wa_id: conversa.wa_id,
    status: conversa.status,
    origem: conversa.origem,
    ultima_mensagem: conversa.mensagens[conversa.mensagens.length - 1]?.texto ?? "",
    ultima_interacao: conversa.ultima_interacao,
    etapa: conversa.etapa,
    qtd_titulos: clienteTitulos.length,
    boleto_enviado: conversa.mensagens.some((msg) => msg.tipo === "boleto"),
    promessa: false,
    optout: optoutAtivo,
  };
}

function buildLinhaDigitavel(duplicata: string, valor: number): string {
  const base = `${duplicata.replace(/\D+/g, "").slice(0, 11)}${Math.round(valor * 100)}`.padEnd(32, "0");
  return `${base.slice(0, 5)}.${base.slice(5, 10)} ${base.slice(10, 15)}.${base.slice(15, 21)} ${base.slice(21, 26)}.${base.slice(26, 32)} 1 ${base.slice(0, 14)}`;
}

function parseBooleanConfig(value: string | null | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumberConfig(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.trunc(parsed);
  return Math.max(min, Math.min(max, integer));
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // noop
  }
  return {};
}

function normalizeFilial(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function sortFiliais(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const aIsNumeric = /^\d+$/.test(a);
    const bIsNumeric = /^\d+$/.test(b);
    if (aIsNumeric && bIsNumeric) return Number(a) - Number(b);
    if (aIsNumeric) return -1;
    if (bIsNumeric) return 1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
  });
}

function normalizeFiliaisFilter(input: { filial?: string; filiais?: string[] }): Set<string> | null {
  const set = new Set<string>();
  const single = normalizeFilial(input.filial);
  if (single) set.add(single.toLowerCase());
  for (const item of input.filiais ?? []) {
    const normalized = normalizeFilial(item);
    if (normalized) set.add(normalized.toLowerCase());
  }
  return set.size ? set : null;
}

function matchesFilialFilter(filial: string, filterSet: Set<string> | null): boolean {
  if (!filterSet) return true;
  return filterSet.has(normalizeFilial(filial).toLowerCase());
}

function detectPerfilVulneravel(messageText: string, cliente: LaraCliente | null): boolean {
  const text = safeText(messageText).toLowerCase();
  const vulnerableKeywords = [
    "desempregado",
    "doenca",
    "hospital",
    "falencia",
    "superendivid",
    "nao consigo pagar",
    "sem renda",
  ];
  if (vulnerableKeywords.some((term) => text.includes(term))) return true;
  return cliente?.risco === "critico" && cliente?.etapa_regua === "D+30";
}

function mapOrigemToCanal(origem: string): "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO" {
  const normalized = String(origem ?? "").trim().toLowerCase();
  if (normalized.includes("whatsapp")) return "WHATSAPP";
  if (normalized.includes("sms")) return "SMS";
  if (normalized.includes("email")) return "EMAIL";
  if (normalized.includes("voice") || normalized.includes("telefone")) return "VOICE";
  return "OUTRO";
}

function formatDateTimeForIsoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateToIsoDate(value);
}

export class LaraService {
  private cacheWarmed = false;

  private async getClassifierMetrics(limit = 5000): Promise<{
    total_classificacoes: number;
    openai_usado: number;
    fallback_local: number;
    circuito_aberto_eventos: number;
    acuracia_estimada_media: number;
    intents: Array<{
      intent: string;
      total: number;
      confianca_media: number;
      acuracia_estimada: number;
      taxa_openai: number;
      taxa_fallback_local: number;
      taxa_escalacao_humana: number;
    }>;
  }> {
    const audits = await laraOperationalStore.listComplianceAudits(limit);
    const metricsMap = new Map<string, {
      total: number;
      confiancaSum: number;
      openaiUsado: number;
      fallbackLocal: number;
      escaladoHumano: number;
      circuitoAbertoEventos: number;
    }>();

    let totalClassificacoes = 0;
    let openAiUsado = 0;
    let fallbackLocal = 0;
    let circuitoAbertoEventos = 0;
    let confiancaGlobalSum = 0;
    let escaladoGlobal = 0;

    for (const audit of audits) {
      const intent = String(audit.intencao || "neutro").trim() || "neutro";
      const confidence = Math.max(0, Math.min(1, toNumber(audit.score_confianca)));
      const details = (audit.detalhes ?? {}) as Record<string, unknown>;
      const method = String(details.classifier_method ?? "").toLowerCase();
      const usedOpenAi = details.classifier_used_openai === true || method === "openai";
      const attemptedOpenAi = details.classifier_attempted_openai === true || usedOpenAi;
      const isFallbackLocal = attemptedOpenAi && !usedOpenAi;
      const fallbackReason = String(details.classifier_fallback_reason ?? "").toLowerCase();
      const circuitOpenEvent = fallbackReason.includes("circuit");
      const escaladoHumano = String(audit.acao ?? "").toLowerCase() === "escalar_humano";

      const bucket = metricsMap.get(intent) ?? {
        total: 0,
        confiancaSum: 0,
        openaiUsado: 0,
        fallbackLocal: 0,
        escaladoHumano: 0,
        circuitoAbertoEventos: 0,
      };
      bucket.total += 1;
      bucket.confiancaSum += confidence;
      if (usedOpenAi) bucket.openaiUsado += 1;
      if (isFallbackLocal) bucket.fallbackLocal += 1;
      if (escaladoHumano) bucket.escaladoHumano += 1;
      if (circuitOpenEvent) bucket.circuitoAbertoEventos += 1;
      metricsMap.set(intent, bucket);

      totalClassificacoes += 1;
      confiancaGlobalSum += confidence;
      if (usedOpenAi) openAiUsado += 1;
      if (isFallbackLocal) fallbackLocal += 1;
      if (circuitOpenEvent) circuitoAbertoEventos += 1;
      if (escaladoHumano) escaladoGlobal += 1;
    }

    const intents = Array.from(metricsMap.entries())
      .map(([intent, data]) => {
        const confidenceMedia = data.total > 0 ? data.confiancaSum / data.total : 0;
        const fallbackRate = data.total > 0 ? data.fallbackLocal / data.total : 0;
        const escalacaoRate = data.total > 0 ? data.escaladoHumano / data.total : 0;
        const confidencePct = confidenceMedia * 100;
        const acuraciaEstimada = roundMoney(
          Math.max(
            0,
            Math.min(100, confidencePct * (1 - fallbackRate * 0.2) * (1 - escalacaoRate * 0.15)),
          ),
        );
        return {
          intent,
          total: data.total,
          confianca_media: roundMoney(confidencePct),
          acuracia_estimada: acuraciaEstimada,
          taxa_openai: roundMoney(data.total > 0 ? (data.openaiUsado / data.total) * 100 : 0),
          taxa_fallback_local: roundMoney(data.total > 0 ? (data.fallbackLocal / data.total) * 100 : 0),
          taxa_escalacao_humana: roundMoney(data.total > 0 ? (data.escaladoHumano / data.total) * 100 : 0),
        };
      })
      .sort((a, b) => b.total - a.total);

    const fallbackRateGlobal = totalClassificacoes > 0 ? fallbackLocal / totalClassificacoes : 0;
    const escalacaoRateGlobal = totalClassificacoes > 0 ? escaladoGlobal / totalClassificacoes : 0;
    const confidenceGlobalPct = totalClassificacoes > 0 ? (confiancaGlobalSum / totalClassificacoes) * 100 : 0;
    const acuraciaEstimadaMedia = roundMoney(
      Math.max(
        0,
        Math.min(100, confidenceGlobalPct * (1 - fallbackRateGlobal * 0.2) * (1 - escalacaoRateGlobal * 0.15)),
      ),
    );

    return {
      total_classificacoes: totalClassificacoes,
      openai_usado: openAiUsado,
      fallback_local: fallbackLocal,
      circuito_aberto_eventos: circuitoAbertoEventos,
      acuracia_estimada_media: acuraciaEstimadaMedia,
      intents,
    };
  }

  private async getDefaultSyncLimit(): Promise<number> {
    const configuredLimit = await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT");
    return parseNumberConfig(configuredLimit, 30000, 100, 100000);
  }

  private async ensureWarmCache(): Promise<void> {
    if (this.cacheWarmed) return;
    const clientes = await laraOperationalStore.listClientesCache();
    if (clientes.length === 0 && isOracleEnabled()) {
      const limit = Math.min(await this.getDefaultSyncLimit(), 5000);
      await this.recarregarTitulosOracle({ limit, includeDesd: false });
    }
    this.cacheWarmed = true;
  }

  async recarregarTitulosOracle(input: { codcli?: number; limit?: number; includeDesd?: boolean }): Promise<SyncResult> {
    const isFullSync = input.codcli === undefined;
    const syncMarkerTs = "1900-01-01 00:00:00.000";
    const configuredLimit = input.limit !== undefined
      ? String(input.limit)
      : await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT");
    const effectiveLimit = parseNumberConfig(configuredLimit, 30000, 100, 100000);
    const pageSize = Math.max(100, Math.min(1000, effectiveLimit));

    if (isFullSync) {
      await laraOperationalStore.markCacheForFullSync(syncMarkerTs);
    }

    const clientes = new Map<string, LaraCliente>();
    const maxDiasPorCliente = new Map<string, number>();
    const codcliSet = new Set<string>();
    const touchedTitleIds = new Set<string>();
    const hoje = dateToIsoDate(new Date());
    let totalTitulosProcessados = 0;

    while (totalTitulosProcessados < effectiveLimit) {
      const remaining = effectiveLimit - totalTitulosProcessados;
      const currentPageLimit = Math.min(pageSize, remaining);
      const rows = await listOpenTitlesFromOracle({
        codcli: input.codcli,
        includeDesd: input.includeDesd,
        limit: currentPageLimit,
        offset: totalTitulosProcessados,
      });
      if (!rows.length) break;

      const titulosLote: LaraTitulo[] = [];
      for (const row of rows) {
        const codcli = Number(row.CODCLI);
        if (!Number.isFinite(codcli)) continue;

        const codcliKey = String(codcli);
        codcliSet.add(codcliKey);

        const vencimento = dateToIsoDate(row.DTVENC);
        const diasAtraso = Number(row.DIAS_ATRASO ?? 0);
        const etapa = inferEtapaRegua(diasAtraso);
        const nomeCliente = safeText(row.CLIENTE) || `Cliente ${codcli}`;
        const telefone = safeText(row.TELEFONE);
        const documento = safeText(row.DOCUMENTO);
        const filial = safeText(row.FILIAL);
        const totalAbertoAtual = roundMoney(toNumber(row.SALDO_ABERTO));

        const currentMaxDias = Math.max(diasAtraso, maxDiasPorCliente.get(codcliKey) ?? 0);
        maxDiasPorCliente.set(codcliKey, currentMaxDias);

        const existingCliente = clientes.get(codcliKey);
        const riscoLinha = inferRisk(currentMaxDias, totalAbertoAtual);

        if (!existingCliente) {
          clientes.set(codcliKey, {
            codcli: codcliKey,
            cliente: nomeCliente,
            telefone,
            wa_id: normalizeWaId(telefone),
            cpf_cnpj: documento,
            filial,
            total_aberto: totalAbertoAtual,
            qtd_titulos: 1,
            titulo_mais_antigo: vencimento,
            proximo_vencimento: vencimento && vencimento >= hoje ? vencimento : "",
            ultimo_contato: "",
            ultima_acao: "Sincronizado Oracle",
            proxima_acao: "Aguardar contato",
            optout: false,
            etapa_regua: etapa,
            status: "Em aberto",
            responsavel: "Lara Automacao",
            risco: riscoLinha,
          });
        } else {
          existingCliente.total_aberto = roundMoney(existingCliente.total_aberto + totalAbertoAtual);
          existingCliente.qtd_titulos += 1;

          if (!existingCliente.telefone && telefone) {
            existingCliente.telefone = telefone;
            existingCliente.wa_id = normalizeWaId(telefone);
          }
          if (!existingCliente.cpf_cnpj && documento) {
            existingCliente.cpf_cnpj = documento;
          }
          if (!existingCliente.filial && filial) {
            existingCliente.filial = filial;
          }

          if (!existingCliente.titulo_mais_antigo || (vencimento && vencimento < existingCliente.titulo_mais_antigo)) {
            existingCliente.titulo_mais_antigo = vencimento;
          }
          if (
            vencimento
            && vencimento >= hoje
            && (!existingCliente.proximo_vencimento || vencimento < existingCliente.proximo_vencimento)
          ) {
            existingCliente.proximo_vencimento = vencimento;
          }

          existingCliente.risco = inferRisk(currentMaxDias, existingCliente.total_aberto);
          existingCliente.etapa_regua = inferEtapaRegua(currentMaxDias);
        }

        const statusAtendimento = mapOracleStatusToAtendimento(row.STATUS_TITULO);
        const titulo: LaraTitulo = {
          id: makeTituloId(codcli, String(row.DUPLICATA ?? ""), String(row.PRESTACAO ?? "")),
          duplicata: String(row.DUPLICATA ?? "").trim(),
          prestacao: String(row.PRESTACAO ?? "").trim(),
          codcli: codcliKey,
          cliente: nomeCliente,
          telefone,
          valor: roundMoney(toNumber(row.SALDO_ABERTO)),
          vencimento,
          dias_atraso: diasAtraso,
          etapa_regua: etapa,
          status_atendimento: statusAtendimento,
          boleto_disponivel: true,
          pix_disponivel: true,
          ultima_acao: `Sincronizado Oracle (${statusAtendimento})`,
          responsavel: "Lara Automacao",
          filial,
        };

        touchedTitleIds.add(titulo.id);
        titulosLote.push(titulo);
      }

      if (titulosLote.length > 0) {
        await laraOperationalStore.upsertTitulosCacheBatch(titulosLote);
      }

      totalTitulosProcessados += rows.length;
      if (rows.length < currentPageLimit) break;
    }

    const optoutsAtivos = await laraOperationalStore.listOptouts();
    const optoutByWa = new Set(
      optoutsAtivos
        .filter((item) => item.ativo)
        .map((item) => normalizeWaId(item.wa_id)),
    );

    const clientesArray = Array.from(clientes.values());
    for (const cliente of clientesArray) {
      const waIdCliente = normalizeWaId(cliente.wa_id);
      cliente.optout = Boolean(waIdCliente && optoutByWa.has(waIdCliente));
      if (cliente.optout) {
        cliente.status = "Opt-out ativo";
      }
      if (!cliente.proximo_vencimento && cliente.titulo_mais_antigo && cliente.titulo_mais_antigo >= hoje) {
        cliente.proximo_vencimento = cliente.titulo_mais_antigo;
      }
    }
    if (clientesArray.length > 0) {
      await laraOperationalStore.upsertClientesCacheBatch(clientesArray);
    }

    let titulosRemovidos = 0;
    let clientesRemovidos = 0;
    let carregamentoTruncadoPorLimite = false;
    if (isFullSync && totalTitulosProcessados >= effectiveLimit) {
      const probeRows = await listOpenTitlesFromOracle({
        includeDesd: input.includeDesd,
        limit: 1,
        offset: totalTitulosProcessados,
      });
      carregamentoTruncadoPorLimite = probeRows.length > 0;
    }

    if (isFullSync && !carregamentoTruncadoPorLimite) {
      const cleanup = await laraOperationalStore.pruneCacheAfterFullSync(
        syncMarkerTs,
        Array.from(touchedTitleIds),
        Array.from(codcliSet),
      );
      titulosRemovidos = cleanup.titulosRemovidos;
      clientesRemovidos = cleanup.clientesRemovidos;
    }

    return {
      totalTitulos: totalTitulosProcessados,
      totalClientes: clientes.size,
      codcliAfetados: Array.from(codcliSet),
      titulosRemovidos,
      clientesRemovidos,
      sincronizadoEm: dateToIsoDateTime(new Date()),
    };
  }

  async listClientes(filters: {
    search?: string;
    filial?: string;
    filiais?: string[];
    risco?: string;
    optout?: boolean;
    limit?: number;
  }): Promise<LaraCliente[]> {
    await this.ensureWarmCache();
    const clientes = await laraOperationalStore.listClientesCache();
    const optouts = await laraOperationalStore.listOptouts();
    const optByCodcli = new Map(optouts.filter((item) => item.ativo).map((item) => [item.codcli, item]));

    let rows = clientes.map((cliente) => {
      const opt = optByCodcli.get(cliente.codcli);
      return {
        ...cliente,
        optout: Boolean(opt),
        status: opt ? "Opt-out ativo" : cliente.status,
      };
    });

    if (filters.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.telefone.includes(search)
        || item.wa_id.includes(search),
      );
    }
    const filiaisSet = normalizeFiliaisFilter({ filial: filters.filial, filiais: filters.filiais });
    rows = rows.filter((item) => matchesFilialFilter(item.filial, filiaisSet));
    if (filters.risco) {
      rows = rows.filter((item) => item.risco === filters.risco);
    }
    if (filters.optout !== undefined) {
      rows = rows.filter((item) => item.optout === filters.optout);
    }
    rows = rows.sort((a, b) => b.total_aberto - a.total_aberto);
    if (filters.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listClientesPaged(filters: {
    search?: string;
    filial?: string;
    filiais?: string[];
    risco?: string;
    optout?: boolean;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraCliente>> {
    const rows = await this.listClientes({
      search: filters.search,
      filial: filters.filial,
      filiais: filters.filiais,
      risco: filters.risco,
      optout: filters.optout,
    });

    const sorted = [...rows].sort((a, b) => {
      if (b.total_aberto !== a.total_aberto) return b.total_aberto - a.total_aberto;
      return a.codcli.localeCompare(b.codcli);
    });

    return paginateRows(
      sorted,
      filters.page_size,
      filters.cursor,
      (row, cursor) => {
        const cursorTotal = Number(cursor.total_aberto ?? 0);
        const cursorCodcli = String(cursor.codcli ?? "");
        if (row.total_aberto < cursorTotal) return true;
        if (row.total_aberto === cursorTotal && row.codcli > cursorCodcli) return true;
        return false;
      },
      (row) => ({ total_aberto: row.total_aberto, codcli: row.codcli }),
    );
  }

  async getCliente(codcli: number): Promise<LaraCliente | null> {
    await this.ensureWarmCache();
    let cliente = await laraOperationalStore.getClienteCache(codcli);
    if (!cliente && isOracleEnabled()) {
      const base = await getClientByCodcli(codcli);
      if (!base) return null;

      const [summary, titulosAberto] = await Promise.all([
        getOpenSummaryByCodcli(codcli),
        listOpenTitlesFromOracle({ codcli, limit: 5000 }),
      ]);

      const hoje = dateToIsoDate(new Date());
      let tituloMaisAntigo = "";
      let proximoVencimento = "";
      for (const titulo of titulosAberto) {
        const vencimento = dateToIsoDate(titulo.DTVENC);
        if (!vencimento) continue;
        if (!tituloMaisAntigo || vencimento < tituloMaisAntigo) {
          tituloMaisAntigo = vencimento;
        }
        if (vencimento >= hoje && (!proximoVencimento || vencimento < proximoVencimento)) {
          proximoVencimento = vencimento;
        }
      }

      cliente = {
        codcli: String(codcli),
        cliente: base.CLIENTE ?? `Cliente ${codcli}`,
        telefone: base.TELEFONE ?? "",
        wa_id: normalizeWaId(base.TELEFONE ?? ""),
        cpf_cnpj: base.CGCENT ?? "",
        filial: base.CODFILIAL ?? "",
        total_aberto: summary.totalAberto,
        qtd_titulos: summary.qtdTitulos,
        titulo_mais_antigo: tituloMaisAntigo,
        proximo_vencimento: proximoVencimento,
        ultimo_contato: "",
        ultima_acao: "Identificado via Oracle",
        proxima_acao: "Aguardar contato",
        optout: false,
        etapa_regua: inferEtapaRegua(summary.maxDiasAtraso),
        status: "Em aberto",
        responsavel: "Lara Automacao",
        risco: inferRisk(summary.maxDiasAtraso, summary.totalAberto),
      };
      await laraOperationalStore.upsertClienteCache(cliente);
    }
    if (!cliente) return null;
    const optout = await laraOperationalStore.findActiveOptoutByWaId(cliente.wa_id);
    return {
      ...cliente,
      optout: Boolean(optout),
      status: optout ? "Opt-out ativo" : cliente.status,
    };
  }

  async listTitulos(filters: {
    search?: string;
    codcli?: number;
    etapa?: string;
    filial?: string;
    filiais?: string[];
    atrasoMin?: number;
    atrasoMax?: number;
    limit?: number;
  }): Promise<LaraTitulo[]> {
    await this.ensureWarmCache();
    let rows = await laraOperationalStore.listTitulosCache();
    if (filters.codcli) rows = rows.filter((item) => item.codcli === String(filters.codcli));
    if (filters.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.duplicata.toLowerCase().includes(search),
      );
    }
    if (filters.etapa) rows = rows.filter((item) => item.etapa_regua === filters.etapa);
    const filiaisSet = normalizeFiliaisFilter({ filial: filters.filial, filiais: filters.filiais });
    rows = rows.filter((item) => matchesFilialFilter(item.filial, filiaisSet));
    if (filters.atrasoMin !== undefined) rows = rows.filter((item) => item.dias_atraso >= filters.atrasoMin!);
    if (filters.atrasoMax !== undefined) rows = rows.filter((item) => item.dias_atraso <= filters.atrasoMax!);
    rows.sort((a, b) => b.dias_atraso - a.dias_atraso || b.valor - a.valor || a.id.localeCompare(b.id));
    if (filters.limit) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listTitulosPaged(filters: {
    search?: string;
    codcli?: number;
    etapa?: string;
    filial?: string;
    filiais?: string[];
    atrasoMin?: number;
    atrasoMax?: number;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraTitulo>> {
    const rows = await this.listTitulos({
      search: filters.search,
      codcli: filters.codcli,
      etapa: filters.etapa,
      filial: filters.filial,
      filiais: filters.filiais,
      atrasoMin: filters.atrasoMin,
      atrasoMax: filters.atrasoMax,
    });

    return paginateRows(
      rows,
      filters.page_size,
      filters.cursor,
      (row, cursor) => {
        const cursorDias = Number(cursor.dias_atraso ?? 0);
        const cursorValor = Number(cursor.valor ?? 0);
        const cursorId = String(cursor.id ?? "");
        if (row.dias_atraso < cursorDias) return true;
        if (row.dias_atraso > cursorDias) return false;
        if (row.valor < cursorValor) return true;
        if (row.valor > cursorValor) return false;
        return row.id > cursorId;
      },
      (row) => ({ dias_atraso: row.dias_atraso, valor: row.valor, id: row.id }),
    );
  }

  async listFiliais(): Promise<string[]> {
    const filiaisOracle = await listFiliaisFromOracle();
    if (filiaisOracle.length > 0) {
      return filiaisOracle;
    }

    await this.ensureWarmCache();
    const [clientes, titulos] = await Promise.all([
      laraOperationalStore.listClientesCache(),
      laraOperationalStore.listTitulosCache(),
    ]);

    const filiais = new Set<string>();
    for (const cliente of clientes) {
      const filial = normalizeFilial(cliente.filial);
      if (filial) filiais.add(filial);
    }
    for (const titulo of titulos) {
      const filial = normalizeFilial(titulo.filial);
      if (filial) filiais.add(filial);
    }
    return sortFiliais(Array.from(filiais));
  }

  async getTitulo(id: string): Promise<LaraTitulo | null> {
    return laraOperationalStore.getTituloCache(id);
  }

  private async buildConversaFromWaId(waId: string): Promise<LaraConversa | null> {
    const mensagensRows = await laraOperationalStore.listMessagesByWaId(waId);
    if (!mensagensRows.length) return null;
    const mensagens = laraOperationalStore.buildConversationMessages(mensagensRows);
    const ultima = mensagens[mensagens.length - 1];
    const inicio = mensagens[0];
    const lastRow = mensagensRows[mensagensRows.length - 1];
    const codcli = Number(lastRow.codcli ?? 0);
    const cliente = codcli ? await this.getCliente(codcli) : null;
    const statusAtual = cliente?.status || (String(lastRow.status || "").trim() || "Aguardando resposta");
    return {
      id: `conv-${waId}`,
      codcli: codcli ? String(codcli) : "",
      cliente: cliente?.cliente || lastRow.cliente || "Cliente nÃ£o identificado",
      telefone: cliente?.telefone || lastRow.telefone || "",
      wa_id: waId,
      status: statusAtual,
      etapa: cliente?.etapa_regua || (lastRow.etapa || "-"),
      origem: lastRow.origem || "receptivo",
      inicio: dateToIsoDateTime(inicio.data_hora),
      ultima_interacao: dateToIsoDateTime(ultima.data_hora),
      total_mensagens: mensagens.length,
      mensagens,
      encerrada: false,
      responsavel: "Lara AutomaÃ§Ã£o",
    };
  }

  async listConversas(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    limit?: number;
  }): Promise<LaraConversa[]> {
    await this.ensureWarmCache();
    const rows = await laraOperationalStore.listAllMessages(10000);
    const waIds = Array.from(new Set(rows.map((item) => item.wa_id).filter(Boolean)));
    const conversas: LaraConversa[] = [];
    for (const waId of waIds) {
      const conversa = await this.buildConversaFromWaId(waId);
      if (conversa) conversas.push(conversa);
    }
    let rowsFiltered = [...conversas];

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rowsFiltered = rowsFiltered.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.telefone.includes(search)
        || item.wa_id.includes(search),
      );
    }

    if (filters?.canal) {
      const canal = String(filters.canal).trim().toUpperCase();
      rowsFiltered = rowsFiltered.filter((item) => mapOrigemToCanal(item.origem) === canal);
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rowsFiltered = rowsFiltered.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    rowsFiltered.sort((a, b) => b.ultima_interacao.localeCompare(a.ultima_interacao));
    if (filters?.limit && filters.limit > 0) rowsFiltered = rowsFiltered.slice(0, filters.limit);
    return rowsFiltered;
  }

  async listConversasPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraConversa>> {
    const rows = await this.listConversas({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.ultima_interacao ?? "");
        const cursorWa = String(cursor.wa_id ?? "");
        if (row.ultima_interacao < cursorData) return true;
        if (row.ultima_interacao > cursorData) return false;
        return row.wa_id > cursorWa;
      },
      (row) => ({ ultima_interacao: row.ultima_interacao, wa_id: row.wa_id }),
    );
  }

  async getConversa(waId: string): Promise<LaraConversa | null> {
    return this.buildConversaFromWaId(waId);
  }

  async listAtendimentos(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    limit?: number;
  }): Promise<LaraAtendimento[]> {
    const [conversas, titulos, optouts] = await Promise.all([
      this.listConversas({
        search: filters?.search,
        filial: filters?.filial,
        filiais: filters?.filiais,
        canal: filters?.canal,
        limit: filters?.limit,
      }),
      this.listTitulos({}),
      laraOperationalStore.listOptouts(),
    ]);
    const optByWa = new Map(optouts.filter((item) => item.ativo).map((item) => [item.wa_id, true]));
    return conversas.map((conversa) => toAtendimento(conversa, titulos, Boolean(optByWa.get(conversa.wa_id))));
  }

  async listAtendimentosPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraAtendimento>> {
    const rows = await this.listAtendimentos({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.ultima_interacao ?? "");
        const cursorWa = String(cursor.wa_id ?? "");
        if (row.ultima_interacao < cursorData) return true;
        if (row.ultima_interacao > cursorData) return false;
        return row.wa_id > cursorWa;
      },
      (row) => ({ ultima_interacao: row.ultima_interacao, wa_id: row.wa_id }),
    );
  }

  async listCases(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    limit?: number;
  }): Promise<LaraCaseItem[]> {
    let rows = await laraOperationalStore.listCases();
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.acao.toLowerCase().includes(search)
        || item.detalhe.toLowerCase().includes(search),
      );
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listCasesPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraCaseItem>> {
    const rows = await this.listCases({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async listCasesByCodcli(codcli: number): Promise<LaraCaseItem[]> {
    return laraOperationalStore.listCasesByCodcli(codcli);
  }

  async createCase(input: Parameters<typeof laraOperationalStore.createCase>[0]): Promise<LaraCaseItem> {
    return laraOperationalStore.createCase(input);
  }

  async listOptouts(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    limit?: number;
  }): Promise<LaraOptoutItem[]> {
    let rows = await laraOperationalStore.listOptouts();
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search)
        || item.wa_id.includes(search),
      );
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async listOptoutsPaged(filters?: {
    search?: string;
    filial?: string;
    filiais?: string[];
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraOptoutItem>> {
    const rows = await this.listOptouts({
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_atualizacao ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_atualizacao < cursorData) return true;
        if (row.data_atualizacao > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_atualizacao: row.data_atualizacao, id: row.id }),
    );
  }

  async setOptout(input: Parameters<typeof laraOperationalStore.setOptout>[0]): Promise<LaraOptoutItem> {
    return laraOperationalStore.setOptout(input);
  }

  async removeOptout(id: string): Promise<boolean> {
    return laraOperationalStore.disableOptoutById(id);
  }

  async listLogs(filters?: {
    limit?: number;
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
  }): Promise<LaraLogItem[]> {
    let rows = await laraOperationalStore.listLogs(filters?.limit ?? 500);

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      rows = rows.filter((item) =>
        item.tipo.toLowerCase().includes(search)
        || item.mensagem.toLowerCase().includes(search)
        || item.cliente.toLowerCase().includes(search)
        || item.codcli.includes(search),
      );
    }
    if (filters?.canal) {
      const canal = filters.canal.toLowerCase();
      rows = rows.filter((item) => item.origem.toLowerCase().includes(canal));
    }

    const filiaisSet = normalizeFiliaisFilter({ filial: filters?.filial, filiais: filters?.filiais });
    if (filiaisSet) {
      const clientes = await this.listClientes({});
      const filialByCodcli = new Map(clientes.map((item) => [item.codcli, item.filial]));
      rows = rows.filter((item) => matchesFilialFilter(String(filialByCodcli.get(item.codcli) ?? ""), filiaisSet));
    }

    return rows;
  }

  async listLogsPaged(filters?: {
    limit?: number;
    search?: string;
    filial?: string;
    filiais?: string[];
    canal?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraLogItem>> {
    const rows = await this.listLogs({
      limit: filters?.limit ?? 5000,
      search: filters?.search,
      filial: filters?.filial,
      filiais: filters?.filiais,
      canal: filters?.canal,
    });
    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async addComplianceAudit(input: {
    wa_id: string;
    codcli?: number;
    tenant_id: string;
    jurisdicao: LaraJurisdicao;
    canal: string;
    acao: LaraNextAction | "bloqueado_politica";
    intencao: string;
    score_confianca: number;
    permitido: boolean;
    base_legal: string;
    razao_automatizada: string;
    revisao_humana_disponivel: boolean;
    detalhes?: Record<string, unknown>;
  }): Promise<void> {
    await laraOperationalStore.addComplianceAudit({
      wa_id: input.wa_id,
      codcli: input.codcli,
      tenant_id: input.tenant_id,
      jurisdicao: input.jurisdicao,
      canal: input.canal,
      acao: input.acao,
      intencao: input.intencao,
      score_confianca: input.score_confianca,
      permitido: input.permitido,
      base_legal: input.base_legal,
      razao_automatizada: input.razao_automatizada,
      revisao_humana_disponivel: input.revisao_humana_disponivel,
      detalhes_json: input.detalhes,
    });
  }

  async listComplianceAuditPaged(filters?: {
    codcli?: number;
    wa_id?: string;
    tenant_id?: string;
    page_size?: number;
    cursor?: string;
  }): Promise<LaraPagedResult<LaraComplianceAuditItem>> {
    let rows = await laraOperationalStore.listComplianceAudits();
    if (filters?.codcli) rows = rows.filter((item) => item.codcli === String(filters.codcli));
    if (filters?.wa_id) rows = rows.filter((item) => item.wa_id === filters.wa_id);
    if (filters?.tenant_id) rows = rows.filter((item) => item.tenant_id === filters.tenant_id);
    rows.sort((a, b) => b.data_hora.localeCompare(a.data_hora) || a.id.localeCompare(b.id));

    return paginateRows(
      rows,
      filters?.page_size,
      filters?.cursor,
      (row, cursor) => {
        const cursorData = String(cursor.data_hora ?? "");
        const cursorId = String(cursor.id ?? "");
        if (row.data_hora < cursorData) return true;
        if (row.data_hora > cursorData) return false;
        return row.id > cursorId;
      },
      (row) => ({ data_hora: row.data_hora, id: row.id }),
    );
  }

  async listReguaTemplates(): Promise<LaraReguaTemplate[]> {
    return laraOperationalStore.listReguaTemplates();
  }

  async listReguaExecucoes(limit = 200): Promise<LaraReguaExecucao[]> {
    return laraOperationalStore.listReguaExecucoes(limit);
  }

  async listConfiguracoes() {
    return laraOperationalStore.listConfiguracoes();
  }

  async saveReguaConfig(input: {
    templates?: Array<{
      id?: string;
      etapa: string;
      nome_template: string;
      canal: string;
      mensagem_template: string;
      ativo: boolean;
      ordem_execucao: number;
    }>;
    configuracoes?: Array<{
      chave: string;
      valor: string;
      descricao?: string;
    }>;
  }): Promise<void> {
    if (input.templates) {
      await laraOperationalStore.replaceReguaTemplates(input.templates);
    }
    for (const cfg of input.configuracoes ?? []) {
      await laraOperationalStore.upsertConfiguracao(cfg.chave, cfg.valor, cfg.descricao);
    }
  }

  async getStatusSincronizacaoDiaria(): Promise<LaraSyncStatus> {
    const [
      ativoRaw,
      horaRaw,
      minutoRaw,
      timezoneRaw,
      limitRaw,
      includeDesdRaw,
      startupRunRaw,
      lastRun,
    ] = await Promise.all([
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_ATIVO"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_HORA"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_MINUTO"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_TIMEZONE"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_LIMIT"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_INCLUDE_DESD"),
      laraOperationalStore.getConfiguracao("LARA_SYNC_STARTUP_RUN"),
      laraOperationalStore.getLastIntegrationByType("pcprest-sync-diario"),
    ]);

    const configuracao = {
      ativo: parseBooleanConfig(ativoRaw, false),
      hora: parseNumberConfig(horaRaw, 6, 0, 23),
      minuto: parseNumberConfig(minutoRaw, 0, 0, 59),
      timezone: String(timezoneRaw ?? "America/Sao_Paulo"),
      limit: parseNumberConfig(limitRaw, 30000, 100, 100000),
      includeDesd: parseBooleanConfig(includeDesdRaw, false),
      startupRun: parseBooleanConfig(startupRunRaw, true),
    };

    if (!lastRun) {
      return {
        configuracao,
        ultima_execucao: null,
      };
    }

    const response = parseJsonObject(lastRun.response_json);
    const ultima_execucao = {
      status: String(lastRun.status_operacao || "desconhecido"),
      data_hora: dateToIsoDateTime(lastRun.created_at),
      total_titulos: toNumber(response.totalTitulos),
      total_clientes: toNumber(response.totalClientes),
      titulos_removidos: toNumber(response.titulosRemovidos),
      clientes_removidos: toNumber(response.clientesRemovidos),
      erro: String(lastRun.erro_resumo || ""),
    };

    return {
      configuracao,
      ultima_execucao,
    };
  }

  async updateJanelaSincronizacao(input: {
    ativo?: boolean;
    hora?: number;
    minuto?: number;
    timezone?: string;
    limit?: number;
    includeDesd?: boolean;
    startupRun?: boolean;
  }): Promise<LaraSyncStatus> {
    if (input.ativo !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_ATIVO", input.ativo ? "true" : "false");
    }
    if (input.hora !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_HORA", String(input.hora));
    }
    if (input.minuto !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_MINUTO", String(input.minuto));
    }
    if (input.timezone !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_TIMEZONE", String(input.timezone));
    }
    if (input.limit !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_LIMIT", String(input.limit));
    }
    if (input.includeDesd !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_DAILY_INCLUDE_DESD", input.includeDesd ? "true" : "false");
    }
    if (input.startupRun !== undefined) {
      await laraOperationalStore.upsertConfiguracao("LARA_SYNC_STARTUP_RUN", input.startupRun ? "true" : "false");
    }
    return this.getStatusSincronizacaoDiaria();
  }

  async buildReguaAtivaResumo(): Promise<{
    etapas: LaraReguaEtapa[];
    totalElegivel: number;
    totalRespondido: number;
    totalConvertido: number;
    totalErro: number;
  }> {
    const execucoes = await this.listReguaExecucoes(500);
    const aggregate = new Map<string, LaraReguaEtapa>();

    for (const execucao of execucoes) {
      const current = aggregate.get(execucao.etapa) ?? {
        etapa: execucao.etapa,
        elegivel: 0,
        enviado: 0,
        respondido: 0,
        convertido: 0,
        erro: 0,
        bloqueado_optout: 0,
        taxa_resposta: 0,
        taxa_recuperacao: 0,
      };
      current.elegivel += execucao.elegivel;
      current.enviado += execucao.disparada;
      current.respondido += execucao.respondida;
      current.convertido += execucao.convertida;
      current.erro += execucao.erro;
      current.bloqueado_optout += execucao.bloqueado_optout;
      current.taxa_resposta = current.enviado > 0 ? roundMoney((current.respondido / current.enviado) * 100) : 0;
      current.taxa_recuperacao = current.respondido > 0 ? roundMoney((current.convertido / current.respondido) * 100) : 0;
      aggregate.set(execucao.etapa, current);
    }

    const etapas = Array.from(aggregate.values()).sort((a, b) => a.etapa.localeCompare(b.etapa));
    const totalElegivel = etapas.reduce((sum, item) => sum + item.elegivel, 0);
    const totalRespondido = etapas.reduce((sum, item) => sum + item.respondido, 0);
    const totalConvertido = etapas.reduce((sum, item) => sum + item.convertido, 0);
    const totalErro = etapas.reduce((sum, item) => sum + item.erro, 0);

    return {
      etapas,
      totalElegivel,
      totalRespondido,
      totalConvertido,
      totalErro,
    };
  }

  async getDashboard(filters?: { filial?: string; filiais?: string[]; canal?: string }) {
    const [clientes, titulos, logs, reguaResumo, promessasRows, optoutsAtivos, classificador] = await Promise.all([
      this.listClientes({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }),
      this.listTitulos({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }),
      this.listLogs({ limit: 500 }),
      this.buildReguaAtivaResumo(),
      laraOperationalStore.listPromessas(),
      this.listOptouts({
        filial: filters?.filial,
        filiais: filters?.filiais,
      }).then((rows) => rows.filter((item) => item.ativo)),
      this.getClassifierMetrics(3000),
    ]);

    const totalAberto = roundMoney(clientes.reduce((sum, item) => sum + item.total_aberto, 0));
    const clientesAberto = clientes.filter((item) => item.total_aberto > 0).length;
    const boletoEnviados = logs.filter(
      (item) => item.tipo === "Mensagem enviada" && item.mensagem.toLowerCase().includes("boleto"),
    ).length;
    const promessas = promessasRows.length;
    const optouts = optoutsAtivos.length;
    const reguaAtiva = clientes.filter((item) => item.etapa_regua !== "-").length;
    const valorRecuperado = roundMoney(reguaResumo.etapas.reduce((sum, item) => sum + ((item.convertido / 100) * totalAberto), 0));

    const faixaAtraso = [
      { faixa: "0-7 dias", valor: 0 },
      { faixa: "8-30 dias", valor: 0 },
      { faixa: "31-90 dias", valor: 0 },
      { faixa: "91-180 dias", valor: 0 },
      { faixa: "180+ dias", valor: 0 },
    ];
    for (const titulo of titulos) {
      if (titulo.dias_atraso <= 7) faixaAtraso[0].valor += titulo.valor;
      else if (titulo.dias_atraso <= 30) faixaAtraso[1].valor += titulo.valor;
      else if (titulo.dias_atraso <= 90) faixaAtraso[2].valor += titulo.valor;
      else if (titulo.dias_atraso <= 180) faixaAtraso[3].valor += titulo.valor;
      else faixaAtraso[4].valor += titulo.valor;
    }
    for (const item of faixaAtraso) item.valor = roundMoney(item.valor);

    const statusCounter = new Map<string, number>();
    for (const cliente of clientes) {
      statusCounter.set(cliente.status, (statusCounter.get(cliente.status) ?? 0) + 1);
    }

    const statusPie = Array.from(statusCounter.entries()).map(([name, value]) => ({ name, value }));
    const topClientes = [...clientes].sort((a, b) => b.total_aberto - a.total_aberto).slice(0, 5);

    const alertas = logs
      .filter((item) => item.severidade === "erro" || item.severidade === "aviso" || item.severidade === "bloqueado")
      .slice(0, 8)
      .map((item) => ({
        type: item.severidade === "erro" ? "error" : item.severidade === "bloqueado" ? "warning" : "info",
        title: item.tipo,
        description: item.mensagem,
      }));

    return {
      kpis: {
        totalAberto,
        clientesAberto,
        boletoEnviados,
        interacoesHoje: logs.filter((item) => item.data_hora.startsWith(dateToIsoDate(new Date()))).length,
        promessas,
        optouts,
        reguaAtiva,
        taxaResposta: reguaResumo.totalElegivel > 0 ? roundMoney((reguaResumo.totalRespondido / reguaResumo.totalElegivel) * 100) : 0,
        valorRecuperado,
      },
      faixaAtraso,
      statusPie,
      reguaEtapas: reguaResumo.etapas,
      topClientes,
      alertas,
      classificador,
    };
  }

  async getMonitoramentoHealth() {
    const classifierHealth = getIntentClassifierHealthSnapshot();
    const classifierStatus =
      !classifierHealth.enabled
        ? "nao-configurado"
        : !classifierHealth.openai_configured
          ? "degradado"
          : classifierHealth.circuit_state === "closed"
            ? "operacional"
            : "degradado";
    const classifierDetail =
      !classifierHealth.enabled
        ? "Classificador IA desativado por configuracao."
        : !classifierHealth.openai_configured
          ? "OPENAI_API_KEY nao configurada; fallback local ativo."
          : classifierHealth.circuit_state === "open"
            ? `Circuit breaker aberto ate ${classifierHealth.circuit_open_until || "N/A"}.`
            : classifierHealth.circuit_state === "half_open"
              ? "Circuit breaker em half-open (sondagem em andamento)."
              : `Operacional (modelo ${classifierHealth.model}, retry ${classifierHealth.retry_max_attempts}x).`;

    const healthOracle = {
      status: "nao-configurado",
      detalhe: "Oracle nÃ£o configurado",
    };

    if (isOracleEnabled()) {
      try {
        const row = await queryOne<{ STATUS: string }>(`SELECT 'OK' AS STATUS FROM DUAL`);
        healthOracle.status = row?.STATUS === "OK" ? "operacional" : "degradado";
        healthOracle.detalhe = row?.STATUS === "OK" ? "Conectado" : "Resposta inesperada";
      } catch (error) {
        healthOracle.status = "degradado";
        healthOracle.detalhe = error instanceof Error ? error.message : String(error);
      }
    }

    const webhookLimit = Number(await laraOperationalStore.getConfiguracao("RATE_LIMIT_WEBHOOK_POR_MIN") ?? "60");
    return {
      componentes: [
        { label: "Oracle / WinThor", status: healthOracle.status, detail: healthOracle.detalhe },
        { label: "Banco operacional Lara", status: "operacional", detail: "Tabelas LARA_* disponÃ­veis" },
        { label: "Webhooks WhatsApp/n8n", status: "operacional", detail: `Rate limit ${webhookLimit}/min` },
        { label: "Classificador IA (OpenAI+fallback)", status: classifierStatus, detail: classifierDetail },
        { label: "Backend / API", status: "operacional", detail: "Fastify em execuÃ§Ã£o" },
      ],
    };
  }

  async getResumoOperacional() {
    const [logs, conversas, titulos, promessas, optouts, cases, classificador] = await Promise.all([
      this.listLogs({ limit: 1000 }),
      this.listConversas(),
      this.listTitulos({}),
      laraOperationalStore.listPromessas(),
      this.listOptouts(),
      this.listCases(),
      this.getClassifierMetrics(3000),
    ]);

    const syncHoje = logs.some((item) =>
      item.tipo === "pcprest-sync-diario"
      && item.status.toLowerCase() === "sincronizado"
      && item.data_hora.startsWith(dateToIsoDate(new Date())),
    );
    const falhasSyncHoje = logs.filter((item) =>
      item.tipo === "pcprest-sync-diario" && item.status.toLowerCase() === "erro",
    ).length;

    return {
      mensagens_enviadas: logs.filter((item) => item.tipo === "Mensagem enviada").length,
      mensagens_recebidas: logs.filter((item) => item.tipo === "Mensagem recebida").length,
      fila_pendente: conversas.filter((item) => item.status.toLowerCase().includes("aguardando")).length,
      erros_integracao: logs.filter((item) => item.severidade === "erro").length,
      optouts_ativos: optouts.filter((item) => item.ativo).length,
      promessas_registradas: promessas.length,
      casos_escalados: cases.filter((item) => item.acao.includes("ESCAL")).length,
      clientes_risco_critico: (await this.listClientes({})).filter((item) => item.risco === "critico").length,
      valor_total_aberto: roundMoney(titulos.reduce((sum, item) => sum + item.valor, 0)),
      sincronizacao_diaria_ok_hoje: syncHoje ? 1 : 0,
      falhas_sincronizacao_hoje: falhasSyncHoje,
      classificador_total_classificacoes: classificador.total_classificacoes,
      classificador_openai_usado: classificador.openai_usado,
      classificador_fallback_local: classificador.fallback_local,
      classificador_circuito_aberto_eventos: classificador.circuito_aberto_eventos,
      classificador_acuracia_estimada_media: classificador.acuracia_estimada_media,
      classificador_por_intent: classificador.intents,
    };
  }

  private async findRecentContextByWa(waId: string): Promise<MensagemContexto | null> {
    const windowHours = Number(await laraOperationalStore.getConfiguracao("JANELA_CONTEXTO_HORAS") ?? "72");
    const rows = await laraOperationalStore.listMessagesByWaId(waId);
    if (!rows.length) return null;

    const now = Date.now();
    const limitMs = windowHours * 60 * 60 * 1000;
    const outbound = [...rows]
      .reverse()
      .find((item) => String(item.direction).toUpperCase() === "OUTBOUND" && Number(item.codcli ?? 0) > 0);
    if (!outbound) return null;

    const createdAt = new Date(outbound.created_at).getTime();
    if (Number.isFinite(createdAt) && now - createdAt > limitMs) return null;

    return {
      codcli: outbound.codcli ?? undefined,
      etapa: outbound.etapa || undefined,
      duplicatas: parseDuplicatas(outbound.duplics),
      valor_total: toNumber(outbound.valor_total ?? 0),
      created_at: outbound.created_at,
    };
  }

  private async identifyClient(input: {
    waId: string;
    telefone?: string;
    codcli?: number;
    messageText: string;
  }): Promise<{ cliente: LaraCliente | null; contexto: MensagemContexto | null; ambiguidade: boolean }> {
    const contexto = await this.findRecentContextByWa(input.waId);
    if (contexto?.codcli) {
      const clienteContexto = await this.getCliente(contexto.codcli);
      if (clienteContexto) return { cliente: clienteContexto, contexto, ambiguidade: false };
    }

    if (input.codcli) {
      const cliente = await this.getCliente(input.codcli);
      if (cliente) return { cliente, contexto, ambiguidade: false };
    }

    const clientesCache = await this.listClientes({});
    const normalizedWa = normalizeWaId(input.waId);
    const normalizedPhone = normalizePhone(input.telefone ?? input.waId);
    const localMatches = clientesCache.filter((item) =>
      normalizeWaId(item.wa_id) === normalizedWa
      || normalizePhone(item.telefone) === normalizedPhone,
    );
    if (localMatches.length === 1) {
      return { cliente: localMatches[0], contexto, ambiguidade: false };
    }
    if (localMatches.length > 1) {
      return { cliente: null, contexto, ambiguidade: true };
    }

    if (normalizedPhone) {
      const oracleMatches = await findClientsByPhone(normalizedPhone);
      if (oracleMatches.length === 1) {
        const match = oracleMatches[0];
        const cliente = await this.getCliente(Number(match.CODCLI));
        if (cliente) return { cliente, contexto, ambiguidade: false };
      }
      if (oracleMatches.length > 1) {
        return { cliente: null, contexto, ambiguidade: true };
      }
    }

    const doc = extractDocumentFromText(input.messageText);
    if (doc) {
      const byDoc = await findClientByDocument(doc);
      if (byDoc) {
        const cliente = await this.getCliente(Number(byDoc.CODCLI));
        if (cliente) return { cliente, contexto, ambiguidade: false };
      }
    }

    return { cliente: null, contexto, ambiguidade: false };
  }

  private async pickTitulosForContext(codcli: number, contexto: MensagemContexto | null): Promise<LaraTitulo[]> {
    const titulos = await this.listTitulos({ codcli, limit: 2000 });
    if (!contexto?.duplicatas || contexto.duplicatas.length === 0) return titulos;
    const set = new Set(contexto.duplicatas.map((item) => item.toLowerCase()));
    const filtered = titulos.filter((item) => set.has(item.duplicata.toLowerCase()));
    return filtered.length ? filtered : titulos;
  }

  private async gerarPayloadPagamento(tipo: "boleto" | "pix", cliente: LaraCliente, titulos: LaraTitulo[]) {
    const total = roundMoney(titulos.reduce((sum, item) => sum + item.valor, 0));
    const duplicatas = titulos.map((item) => item.duplicata);
    if (tipo === "boleto") {
      const baseUrl = await laraOperationalStore.getConfiguracao("LARA_BASE_BOLETO_URL") ?? "https://pagamentos.exemplo.local/boleto";
      return {
        tipo: "boleto",
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        total,
        duplicatas,
        url_boleto: `${baseUrl}/${cliente.codcli}`,
        linha_digitavel: buildLinhaDigitavel(duplicatas[0] ?? cliente.codcli, total),
      };
    }
    const pixChave = await laraOperationalStore.getConfiguracao("LARA_PIX_CHAVE") ?? "financeiro@empresa.com.br";
    return {
      tipo: "pix",
      codcli: cliente.codcli,
      cliente: cliente.cliente,
      total,
      duplicatas,
      chave_pix: pixChave,
      pix_copia_cola: `00020126580014BR.GOV.BCB.PIX0136${pixChave}520400005303986540${total.toFixed(2)}5802BR5925${cliente.cliente.slice(0, 25)}6009SAO PAULO62190515LARA${cliente.codcli}6304ABCD`,
    };
  }

  async registrarPromessa(input: {
    wa_id?: string;
    codcli: number;
    cliente?: string;
    duplicatas?: string[];
    valor_total?: number;
    data_prometida: string;
    observacao?: string;
    origem: string;
  }) {
    const promessa = await laraOperationalStore.createPromessa({
      wa_id: input.wa_id,
      codcli: input.codcli,
      cliente: input.cliente,
      duplicatas: (input.duplicatas ?? []).join(", "),
      valor_total: input.valor_total,
      data_prometida: input.data_prometida,
      observacao: input.observacao,
      origem: input.origem,
    });
    await this.createCase({
      wa_id: input.wa_id,
      codcli: input.codcli,
      cliente: input.cliente,
      tipo_case: "PROMESSA_PAGAMENTO",
      etapa: "",
      duplicatas: (input.duplicatas ?? []).join(", "),
      valor_total: input.valor_total,
      forma_pagamento: "",
      detalhe: `Promessa registrada para ${input.data_prometida}`,
      origem: input.origem,
      responsavel: "Lara AutomaÃ§Ã£o",
      status: "registrada",
    });
    return promessa;
  }

  async enviarPagamento(
    tipo: "boleto" | "pix",
    input: {
      wa_id?: string;
      codcli: number;
      cliente?: string;
      duplicatas?: string[];
      origem: string;
      solicitante: string;
    },
  ) {
    const cliente = await this.getCliente(input.codcli);
    if (!cliente) {
      throw new Error("Cliente nÃ£o encontrado para envio de pagamento.");
    }
    const optout = await laraOperationalStore.findActiveOptoutByWaId(cliente.wa_id);
    if (optout?.ativo) {
      throw new Error("Cliente com opt-out ativo. Envio bloqueado.");
    }

    const titulos = await this.pickTitulosForContext(
      input.codcli,
      input.duplicatas?.length ? { duplicatas: input.duplicatas } : null,
    );
    const payload = await this.gerarPayloadPagamento(tipo, cliente, titulos);

    const messageText =
      tipo === "boleto"
        ? `Segue o boleto atualizado. Valor total ${payload.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`
        : `Segue PIX copia e cola para pagamento no valor de ${payload.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`;

    await laraOperationalStore.addMessageLog({
      wa_id: cliente.wa_id,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      telefone: cliente.telefone,
      message_text: messageText,
      direction: "OUTBOUND",
      origem: input.origem,
      etapa: cliente.etapa_regua,
      duplics: payload.duplicatas.join(", "),
      valor_total: payload.total,
      payload_json: JSON.stringify(payload),
      status: "enviado",
      sent_at: dateToIsoDateTime(new Date()),
      received_at: "",
      message_type: tipo,
      operator_name: input.solicitante,
      idempotency_key: makeIdempotencyKey([tipo, cliente.codcli, payload.duplicatas.join(","), payload.total]),
    });

    await this.createCase({
      wa_id: cliente.wa_id,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      tipo_case: tipo === "boleto" ? "PAGAMENTO_ENVIADO" : "PIX_ENVIADO",
      etapa: cliente.etapa_regua,
      duplicatas: payload.duplicatas.join(", "),
      valor_total: payload.total,
      forma_pagamento: tipo.toUpperCase(),
      detalhe: `${tipo.toUpperCase()} enviado automaticamente.`,
      origem: input.origem,
      responsavel: input.solicitante,
      status: "concluido",
    });

    return payload;
  }

  async consultarBoletoWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    idempotency_key?: string;
    origem?: string;
  }): Promise<{
    status: "ok" | "nao_encontrado";
    boleto?: LaraWinthorBoleto;
  }> {
    const boleto = await consultarBoletoWinthor(input);
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-boleto-consulta",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
      ]);

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "boleto-consulta",
      request_json: input as unknown as Record<string, unknown>,
      response_json: boleto as unknown as Record<string, unknown> | undefined,
      status_operacao: boleto ? "consultado" : "nao_encontrado",
      idempotency_key: idempotencyKey,
    });

    if (!boleto) return { status: "nao_encontrado" };
    return { status: "ok", boleto };
  }

  async gerarBoletoWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    codbanco?: number;
    numdiasprotesto?: number;
    primeira_impressao?: boolean;
    force_regenerate?: boolean;
    idempotency_key?: string;
    origem?: string;
    solicitante?: string;
    correlation_id?: string;
  }): Promise<{
    status: "ok" | "duplicado";
    boleto: LaraWinthorBoleto;
  }> {
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-boleto-gerar",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
        input.force_regenerate ? "force" : "normal",
      ]);

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate?.response_json) {
      const payload = parseJsonObject(duplicate.response_json);
      if (payload?.boleto && typeof payload.boleto === "object") {
        return {
          status: "duplicado",
          boleto: payload.boleto as unknown as LaraWinthorBoleto,
        };
      }
    }

    const boleto = await gerarOuRegenerarBoletoWinthor({
      codcli: input.codcli,
      duplicata: input.duplicata,
      prestacao: input.prestacao,
      codfilial: input.codfilial,
      numtransvenda: input.numtransvenda,
      cgcent: input.cgcent,
      fantasia: input.fantasia,
      cliente: input.cliente,
      codbanco: input.codbanco,
      numdiasprotesto: input.numdiasprotesto,
      primeiraImpressao: input.primeira_impressao,
      forceRegenerate: input.force_regenerate,
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "boleto-gerar",
      request_json: input as unknown as Record<string, unknown>,
      response_json: { boleto } as Record<string, unknown>,
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    await this.createCase({
      codcli: Number(boleto.codcli),
      cliente: boleto.cliente,
      tipo_case: "BOLETO_GERADO_WINTHOR",
      etapa: "",
      duplicatas: `${boleto.duplicata}/${boleto.prestacao}`,
      valor_total: boleto.valor,
      forma_pagamento: "BOLETO",
      detalhe: `Boleto gerado/regenerado via Winthor para vencimento ${boleto.dtvenc}.`,
      origem: input.origem || "n8n",
      responsavel: input.solicitante || "Lara N8N",
      status: "concluido",
    });

    return {
      status: "ok",
      boleto,
    };
  }

  async prorrogarTituloWinthor(input: {
    codcli?: number;
    duplicata?: string;
    prestacao?: string;
    codfilial?: string;
    numtransvenda?: number;
    cgcent?: string;
    fantasia?: string;
    cliente?: string;
    nova_data_vencimento: string;
    motivo?: string;
    observacao?: string;
    codfunc?: number;
    idempotency_key?: string;
    tenant_id?: string;
    wa_id?: string;
    origem?: string;
    solicitante?: string;
    correlation_id?: string;
  }): Promise<{
    status: "ok" | "duplicado";
    boleto: LaraWinthorBoleto;
    negociacao: LaraNegociacaoItem;
    dtvenc_anterior: string;
    dtvenc_prorrogada: string;
  }> {
    const idempotencyKey = input.idempotency_key
      || makeIdempotencyKey([
        "winthor-prorrogar",
        input.codcli ?? "",
        input.numtransvenda ?? "",
        input.duplicata ?? "",
        input.prestacao ?? "",
        input.cgcent ?? "",
        input.fantasia ?? "",
        input.cliente ?? "",
        input.nova_data_vencimento,
      ]);

    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate?.response_json) {
      const payload = parseJsonObject(duplicate.response_json);
      if (
        payload?.boleto
        && payload?.negociacao
        && typeof payload.boleto === "object"
        && typeof payload.negociacao === "object"
      ) {
        return {
          status: "duplicado",
          boleto: payload.boleto as unknown as LaraWinthorBoleto,
          negociacao: payload.negociacao as unknown as LaraNegociacaoItem,
          dtvenc_anterior: String(payload.dtvenc_anterior ?? ""),
          dtvenc_prorrogada: String(payload.dtvenc_prorrogada ?? ""),
        };
      }
    }

    const prorrogacao = await prorrogarTituloWinthor({
      codcli: input.codcli,
      duplicata: input.duplicata,
      prestacao: input.prestacao,
      codfilial: input.codfilial,
      numtransvenda: input.numtransvenda,
      cgcent: input.cgcent,
      fantasia: input.fantasia,
      cliente: input.cliente,
      novaDataVencimento: input.nova_data_vencimento,
      observacao: input.observacao || input.motivo,
      codfunc: input.codfunc,
      solicitanteRotina: input.solicitante,
    });

    const offsetRaw = await laraOperationalStore.getConfiguracao("LARA_NEGOCIACAO_OFFSET_DIAS");
    const offsetDias = parseNumberConfig(offsetRaw, 3, 0, 30);
    const baseCobranca = new Date(`${formatDateTimeForIsoDate(prorrogacao.dtvenc_prorrogada)}T09:00:00`);
    baseCobranca.setDate(baseCobranca.getDate() - offsetDias);
    const now = new Date();
    const proximaCobranca = baseCobranca.getTime() < now.getTime() ? now : baseCobranca;

    const negociacao = await laraOperationalStore.createNegociacao({
      codcli: Number(prorrogacao.boleto.codcli),
      wa_id: input.wa_id,
      filial: prorrogacao.boleto.codfilial,
      duplicata: prorrogacao.boleto.duplicata,
      prestacao: prorrogacao.boleto.prestacao,
      numtransvenda: prorrogacao.boleto.numtransvenda,
      dtvenc_original: formatDateTimeForIsoDate(prorrogacao.dtvenc_anterior),
      dtvenc_prorrogada: formatDateTimeForIsoDate(prorrogacao.dtvenc_prorrogada),
      valor_original: prorrogacao.boleto.valor,
      valor_negociado: prorrogacao.boleto.valor,
      tipo_negociacao: "PRORROGACAO",
      status_negociacao: "ATIVA",
      proxima_cobranca_em: dateToIsoDateTime(proximaCobranca),
      origem: input.origem || "n8n",
      observacao: input.observacao || input.motivo || "Prorrogacao automatizada",
      idempotency_key: idempotencyKey,
    });

    await this.createCase({
      wa_id: input.wa_id,
      codcli: Number(prorrogacao.boleto.codcli),
      cliente: prorrogacao.boleto.cliente,
      tipo_case: "NEGOCIACAO_PRORROGACAO",
      etapa: "",
      duplicatas: `${prorrogacao.boleto.duplicata}/${prorrogacao.boleto.prestacao}`,
      valor_total: prorrogacao.boleto.valor,
      forma_pagamento: "BOLETO",
      detalhe: `Titulo prorrogado de ${prorrogacao.dtvenc_anterior} para ${prorrogacao.dtvenc_prorrogada}.`,
      origem: input.origem || "n8n",
      responsavel: input.solicitante || "Lara N8N",
      status: "concluido",
    });

    await this.addComplianceAudit({
      wa_id: input.wa_id || "",
      codcli: Number(prorrogacao.boleto.codcli),
      tenant_id: String(input.tenant_id || "default"),
      jurisdicao: "BR",
      canal: "WHATSAPP",
      acao: "negociar",
      intencao: "prorrogacao_titulo",
      score_confianca: 1,
      permitido: true,
      base_legal: "LGPD Art. 7, X + CDC Art. 42 + Lei 14.181/2021",
      razao_automatizada: "Prorrogacao acordada com novo cronograma de cobranca.",
      revisao_humana_disponivel: true,
      detalhes: {
        dtvenc_anterior: prorrogacao.dtvenc_anterior,
        dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
        proxima_cobranca_em: negociacao.proxima_cobranca_em,
      },
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "winthor",
      tipo: "titulo-prorrogar",
      request_json: input as unknown as Record<string, unknown>,
      response_json: {
        boleto: prorrogacao.boleto,
        negociacao,
        dtvenc_anterior: prorrogacao.dtvenc_anterior,
        dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
      },
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return {
      status: "ok",
      boleto: prorrogacao.boleto,
      negociacao,
      dtvenc_anterior: prorrogacao.dtvenc_anterior,
      dtvenc_prorrogada: prorrogacao.dtvenc_prorrogada,
    };
  }

  async processarMensagemInbound(input: {
    event_id?: string;
    wa_id: string;
    telefone?: string;
    codcli?: number;
    message_text: string;
    origem: string;
    tenant_id?: string;
    jurisdicao?: LaraJurisdicao;
    canal?: "WHATSAPP" | "SMS" | "EMAIL" | "VOICE" | "OUTRO";
    received_at?: string;
    operator_name?: string;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  }): Promise<LaraWebhookResponse> {
    const waId = normalizeWaId(input.wa_id);
    const telefone = normalizePhone(input.telefone ?? input.wa_id);
    const messageText = safeText(input.message_text);
    const tenantId = String(input.tenant_id ?? "default").trim() || "default";
    const jurisdicao = input.jurisdicao ?? "BR";
    const canal = input.canal ?? mapOrigemToCanal(input.origem);
    const idempotencyKey = input.event_id || makeIdempotencyKey([waId, messageText, input.received_at ?? ""]);

    const duplicate = await laraOperationalStore.findMessageByIdempotency(idempotencyKey);
    if (duplicate) {
      return {
        status: "duplicado",
        mensagem: "Evento ja processado anteriormente.",
        acao: "ignorar",
        wa_id: waId,
      };
    }

    const nlu = await classifyIntentWithAiFallback(messageText);
    const intent = nlu.intent;
    const timezone = String(await laraOperationalStore.getConfiguracao("LARA_SYNC_DAILY_TIMEZONE") ?? "America/Sao_Paulo");
    const cooldownMin = Number(await laraOperationalStore.getConfiguracao("JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN") ?? "120");

    const writeAudit = async (
      action: LaraNextAction | "bloqueado_politica",
      allowed: boolean,
      reason: string,
      codcli?: number,
      details?: Record<string, unknown>,
    ) => {
      await this.addComplianceAudit({
        wa_id: waId,
        codcli,
        tenant_id: tenantId,
        jurisdicao,
        canal,
        acao: action,
        intencao: intent,
        score_confianca: nlu.confidence,
        permitido: allowed,
        base_legal: allowed
          ? "LGPD Art. 7, X + CDC Art. 42 + Lei 14.181/2021"
          : "Bloqueio preventivo por compliance e direitos do titular",
        razao_automatizada: reason,
        revisao_humana_disponivel: true,
        detalhes: {
          ...(details ?? {}),
          classifier_method: nlu.method,
          classifier_provider: nlu.classifier.provider,
          classifier_model: nlu.classifier.model,
          classifier_attempted_openai: nlu.classifier.attempted_openai,
          classifier_used_openai: nlu.classifier.used_openai,
          classifier_request_id: nlu.classifier.request_id || "",
          classifier_fallback_reason: nlu.classifier.fallback_reason || "",
          classifier_retry_attempts: nlu.classifier.retry_attempts ?? 0,
          classifier_circuit_state: nlu.classifier.circuit_state || "",
        },
      });
    };

    await laraOperationalStore.addIntegrationLog({
      integracao: "whatsapp",
      tipo: "inbound",
      request_json: {
        wa_id: waId,
        telefone,
        message_text: messageText,
        tenant_id: tenantId,
        jurisdicao,
        canal,
      },
      status_operacao: "recebido",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    await laraOperationalStore.addMessageLog({
      wa_id: waId,
      codcli: input.codcli ?? null,
      cliente: "",
      telefone,
      message_text: messageText,
      direction: "INBOUND",
      origem: input.origem,
      etapa: "",
      duplics: "",
      valor_total: 0,
      payload_json: JSON.stringify(input.payload ?? {}),
      status: "recebido",
      sent_at: "",
      received_at: input.received_at ?? dateToIsoDateTime(new Date()),
      message_type: "texto",
      operator_name: input.operator_name ?? "Cliente",
      idempotency_key: idempotencyKey,
    });

    if (nlu.classifier.attempted_openai) {
      await laraOperationalStore.addIntegrationLog({
        integracao: "openai",
        tipo: "intent-classifier",
        request_json: {
          tenant_id: tenantId,
          jurisdicao,
          canal,
          classifier_method: nlu.method,
          provider: nlu.classifier.provider,
          model: nlu.classifier.model,
        },
        response_json: {
          intent: nlu.intent,
          confidence: nlu.confidence,
          used_openai: nlu.classifier.used_openai,
          request_id: nlu.classifier.request_id || "",
        },
        status_operacao: nlu.classifier.used_openai ? "processado" : "fallback_local",
        erro_resumo: nlu.classifier.fallback_reason || "",
        idempotency_key: `${idempotencyKey}:intent-classifier`,
        correlation_id: input.correlation_id,
      });
    }

    if (intent === "optout") {
      await this.setOptout({
        wa_id: waId,
        codcli: input.codcli,
        motivo: "Solicitacao explicita do cliente",
        ativo: true,
        origem: "whatsapp-inbound",
        observacao: messageText,
      });
      await this.createCase({
        wa_id: waId,
        codcli: input.codcli,
        tipo_case: "OPTOUT_SET",
        detalhe: "Cliente solicitou opt-out",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("pausar_contato", false, "Opt-out detectado e bloqueio aplicado.", input.codcli, { flow: "optout" });
      return {
        status: "ok",
        mensagem: "Solicitacao registrada. Nao enviaremos novas mensagens automaticas para este numero.",
        acao: "optout_aplicado",
        wa_id: waId,
        compliance: {
          permitido: false,
          razao: "Opt-out ativo",
          base_legal: "LGPD Art. 18 + CDC Art. 42",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const identificacao = await this.identifyClient({
      waId,
      telefone,
      codcli: input.codcli,
      messageText,
    });

    if (identificacao.ambiguidade) {
      await this.createCase({
        wa_id: waId,
        tipo_case: "ESCALACAO_HUMANA",
        detalhe: "Ambiguidade de identificacao por telefone.",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, "Ambiguidade de identificacao exige revisao humana.", undefined, {
        ambiguidade: true,
        confidence: nlu.confidence,
      });
      return {
        status: "ok",
        mensagem: "Encontrei mais de um cadastro possivel. Vou direcionar para atendimento humano.",
        acao: "escalar_humano",
        wa_id: waId,
        escalado: true,
        compliance: {
          permitido: true,
          razao: "Revisao humana por ambiguidade de identidade",
          base_legal: "Prudencia de decisao automatizada",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (!identificacao.cliente) {
      await this.createCase({
        wa_id: waId,
        tipo_case: "ESCALACAO_HUMANA",
        detalhe: "Cliente nao identificado com confianca.",
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, "Nao foi possivel identificar cliente com seguranca.", undefined, {
        confidence: nlu.confidence,
      });
      return {
        status: "ok",
        mensagem: "Nao consegui identificar o cadastro com seguranca. Vou direcionar para um especialista.",
        acao: "escalar_humano",
        wa_id: waId,
        escalado: true,
        compliance: {
          permitido: true,
          razao: "Identificacao inconclusiva com escalacao assistida",
          base_legal: "Minimizacao de risco de cobranca indevida",
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const cliente = identificacao.cliente;
    const titulos = await this.pickTitulosForContext(Number(cliente.codcli), identificacao.contexto);
    const total = roundMoney(titulos.reduce((sum, item) => sum + item.valor, 0));
    const duplicatas = titulos.map((item) => item.duplicata);
    const outboundOperator = input.operator_name || "Lara Automacao";
    const mensagensHistorico = await laraOperationalStore.listMessagesByWaId(waId);
    const nowTs = Date.now();
    const outbound24h = mensagensHistorico.filter((item) => {
      const direction = String(item.direction ?? "").toUpperCase();
      if (direction !== "OUTBOUND") return false;
      const created = new Date(item.created_at).getTime();
      return Number.isFinite(created) && nowTs - created <= 24 * 60 * 60 * 1000;
    }).length;
    const promisesOpen = (await laraOperationalStore.listPromessas()).filter((item) =>
      String(item.codcli ?? "") === cliente.codcli && String(item.status ?? "").toLowerCase() !== "paga",
    ).length;
    const perfilVulneravel = detectPerfilVulneravel(messageText, cliente);
    const optoutAtivo = await laraOperationalStore.findActiveOptoutByWaId(waId);

    const policy = evaluatePolicy({
      now: new Date(),
      timezone,
      tenantId,
      waId,
      jurisdicao,
      canal,
      initiatedByCustomer: true,
      optoutAtivo: Boolean(optoutAtivo?.ativo),
      perfilVulneravel,
      etapaRegua: cliente.etapa_regua,
      mensagensOutboundUltimas24h: outbound24h,
      cooldownMinutos: Number.isFinite(cooldownMin) ? cooldownMin : 120,
    });

    if (!policy.permitido) {
      await this.createCase({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        tipo_case: "COMPLIANCE_BLOQUEIO",
        etapa: cliente.etapa_regua,
        duplicatas: duplicatas.join(", "),
        valor_total: total,
        detalhe: policy.razao,
        origem: "policy-engine",
        responsavel: "Lara Automacao",
      });
      await writeAudit("bloqueado_politica", false, policy.razao, Number(cliente.codcli), {
        outbound_24h: outbound24h,
        perfil_vulneravel: perfilVulneravel,
      });
      return {
        status: "ok",
        mensagem: "Contato pausado por politica de compliance. Um especialista pode seguir com revisao humana.",
        acao: "pausar_contato",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: false,
          razao: policy.razao,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: policy.revisaoHumanaDisponivel,
          score_confianca: nlu.confidence,
        },
      };
    }

    const shouldSendByContext =
      intent === "confirmacao_contexto"
      && identificacao.contexto
      && Boolean(identificacao.contexto.duplicatas?.length);

    const nbaIntent = shouldSendByContext ? "solicitar_boleto" : intent;
    const nba = chooseNextBestAction({
      intent: nbaIntent,
      confidence: nlu.confidence,
      etapaRegua: cliente.etapa_regua,
      risco: cliente.risco,
      perfilVulneravel,
      policyAllowed: policy.permitido,
      mensagensOutboundUltimas24h: outbound24h,
      promessasEmAberto: promisesOpen,
    });

    if (nba.action === "enviar_boleto") {
      const payload = await this.enviarPagamento("boleto", {
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        duplicatas,
        origem: "whatsapp-inbound",
        solicitante: outboundOperator,
      });
      await writeAudit("enviar_boleto", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
      });
      return {
        status: "ok",
        mensagem: "Boleto enviado com sucesso.",
        acao: "enviar_boleto",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        payload_whatsapp: payload as unknown as Record<string, unknown>,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "enviar_pix") {
      const payload = await this.enviarPagamento("pix", {
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        duplicatas,
        origem: "whatsapp-inbound",
        solicitante: outboundOperator,
      });
      await writeAudit("enviar_pix", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
      });
      return {
        status: "ok",
        mensagem: "PIX enviado com sucesso.",
        acao: "enviar_pix",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        payload_whatsapp: payload as unknown as Record<string, unknown>,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "registrar_promessa") {
      const dataPrometida = extractPromessaDate(messageText) ?? dateToIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
      await this.registrarPromessa({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        duplicatas,
        valor_total: total,
        data_prometida: dataPrometida,
        observacao: messageText,
        origem: "whatsapp-inbound",
      });
      await writeAudit("registrar_promessa", true, nba.reason, Number(cliente.codcli), {
        data_prometida: dataPrometida,
      });
      return {
        status: "ok",
        mensagem: `Promessa registrada para ${dataPrometida}.`,
        acao: "registrar_promessa",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "escalar_humano") {
      await this.createCase({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        tipo_case: "ESCALACAO_HUMANA",
        etapa: cliente.etapa_regua,
        duplicatas: duplicatas.join(", "),
        valor_total: total,
        detalhe: nba.reason,
        origem: "whatsapp-inbound",
        responsavel: "Lara Automacao",
      });
      await writeAudit("escalar_humano", true, nba.reason, Number(cliente.codcli), {
        confidence: nlu.confidence,
        intent,
      });
      return {
        status: "ok",
        mensagem: "Tudo certo. Vou encaminhar para atendimento humano.",
        acao: "escalar_humano",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        escalado: true,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "pausar_contato") {
      await writeAudit("pausar_contato", true, nba.reason, Number(cliente.codcli), {
        outbound_24h: outbound24h,
      });
      return {
        status: "ok",
        mensagem: "Contato pausado temporariamente para evitar excesso de frequencia.",
        acao: "pausar_contato",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    if (nba.action === "negociar") {
      const negotiationMessage = `Podemos montar uma proposta para regularizacao dos titulos em aberto no total de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Deseja seguir com negociacao assistida?`;
      await laraOperationalStore.addMessageLog({
        wa_id: waId,
        codcli: Number(cliente.codcli),
        cliente: cliente.cliente,
        telefone: cliente.telefone,
        message_text: negotiationMessage,
        direction: "OUTBOUND",
        origem: "whatsapp-inbound",
        etapa: cliente.etapa_regua,
        duplics: duplicatas.join(", "),
        valor_total: total,
        payload_json: JSON.stringify({ acao: "negociar" }),
        status: "enviado",
        sent_at: dateToIsoDateTime(new Date()),
        received_at: "",
        message_type: "texto",
        operator_name: outboundOperator,
        idempotency_key: makeIdempotencyKey([waId, "negociar", total, duplicatas.join(",")]),
      });
      await writeAudit("negociar", true, nba.reason, Number(cliente.codcli), { total });
      return {
        status: "ok",
        mensagem: negotiationMessage,
        acao: "negociar",
        wa_id: waId,
        codcli: cliente.codcli,
        cliente: cliente.cliente,
        compliance: {
          permitido: true,
          razao: nba.reason,
          base_legal: policy.baseLegal,
          revisao_humana_disponivel: true,
          score_confianca: nlu.confidence,
        },
      };
    }

    const defaultMessage = `Ola ${cliente.cliente}. Localizei ${titulos.length} titulo(s) em aberto no total de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Deseja boleto ou PIX?`;
    await laraOperationalStore.addMessageLog({
      wa_id: waId,
      codcli: Number(cliente.codcli),
      cliente: cliente.cliente,
      telefone: cliente.telefone,
      message_text: defaultMessage,
      direction: "OUTBOUND",
      origem: "whatsapp-inbound",
      etapa: cliente.etapa_regua,
      duplics: duplicatas.join(", "),
      valor_total: total,
      payload_json: JSON.stringify({ acao: "resposta_padrao" }),
      status: "enviado",
      sent_at: dateToIsoDateTime(new Date()),
      received_at: "",
      message_type: "texto",
      operator_name: outboundOperator,
      idempotency_key: makeIdempotencyKey([waId, "resposta_padrao", total, duplicatas.join(",")]),
    });
    await writeAudit("resposta_padrao", true, nba.reason, Number(cliente.codcli), { confidence: nlu.confidence });

    return {
      status: "ok",
      mensagem: defaultMessage,
      acao: "resposta_padrao",
      wa_id: waId,
      codcli: cliente.codcli,
      cliente: cliente.cliente,
      compliance: {
        permitido: true,
        razao: nba.reason,
        base_legal: policy.baseLegal,
        revisao_humana_disponivel: true,
        score_confianca: nlu.confidence,
      },
    };
  }
  async registrarWebhookStatus(input: {
    event_id?: string;
    message_id?: string;
    wa_id?: string;
    status: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
    correlation_id?: string;
  }) {
    const idempotencyKey = input.event_id || makeIdempotencyKey([input.message_id, input.wa_id, input.status, input.timestamp]);
    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate) {
      return { status: "duplicado", idempotency_key: idempotencyKey };
    }
    await laraOperationalStore.addIntegrationLog({
      integracao: "whatsapp",
      tipo: "status",
      request_json: input.payload ?? {
        message_id: input.message_id,
        wa_id: input.wa_id,
        status: input.status,
        timestamp: input.timestamp,
      },
      status_operacao: "recebido",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });
    return { status: "ok", idempotency_key: idempotencyKey };
  }

  async registrarWebhookReguaResultado(input: {
    event_id?: string;
    etapa: string;
    data_hora_execucao?: string;
    elegivel: number;
    disparada: number;
    respondida: number;
    convertida: number;
    erro: number;
    bloqueado_optout: number;
    valor_impactado: number;
    status: string;
    detalhes_json?: Record<string, unknown>;
    correlation_id?: string;
  }) {
    const idempotencyKey = input.event_id || makeIdempotencyKey([
      input.etapa,
      input.data_hora_execucao,
      input.elegivel,
      input.disparada,
      input.respondida,
      input.convertida,
      input.erro,
    ]);
    const duplicate = await laraOperationalStore.findIntegrationByIdempotency(idempotencyKey);
    if (duplicate) {
      return { status: "duplicado", idempotency_key: idempotencyKey };
    }

    const execucao = await laraOperationalStore.addReguaExecucao({
      etapa: input.etapa,
      data_hora_execucao: input.data_hora_execucao,
      elegivel: input.elegivel,
      disparada: input.disparada,
      respondida: input.respondida,
      convertida: input.convertida,
      erro: input.erro,
      bloqueado_optout: input.bloqueado_optout,
      valor_impactado: input.valor_impactado,
      status: input.status,
      detalhes_json: input.detalhes_json,
    });

    await laraOperationalStore.addIntegrationLog({
      integracao: "n8n",
      tipo: "regua-resultado",
      request_json: input as unknown as Record<string, unknown>,
      response_json: { execucaoId: execucao.id },
      status_operacao: "processado",
      idempotency_key: idempotencyKey,
      correlation_id: input.correlation_id,
    });

    return { status: "ok", idempotency_key: idempotencyKey, execucao };
  }
}

export const laraService = new LaraService();

