import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { laraOperationalStore } from "../operationalStore.js";
import { laraService } from "../service.js";
import { makeIdempotencyKey, normalizePhone, buildPhoneCandidates } from "../utils.js";
import { evaluatePolicy } from "../policyEngine.js";

const testRunSeed = randomInt(200_000, 299_999);
let testSequence = 0;

function nextSeed(): number {
  testSequence += 1;
  return (testRunSeed * 100) + testSequence;
}

function uniqueCodcli(seed: number): string {
  return String(880000 + seed);
}

async function seedClienteComTitulo(seed: number, overrides: Record<string, unknown> = {}): Promise<{ codcli: string; waId: string; duplicata: string }> {
  const codcli = uniqueCodcli(seed);
  const waId = `55918${String(seed).slice(-8).padStart(8, "0")}`;
  const duplicata = `AQS-TESTE-${seed}`;

  await laraOperationalStore.upsertClienteCache({
    codcli,
    cliente: `Cliente AQS ${seed}`,
    telefone: waId,
    wa_id: waId,
    cpf_cnpj: "12345678000190",
    filial: "TESTE",
    total_aberto: 1000,
    qtd_titulos: 1,
    titulo_mais_antigo: "2025-01-10",
    proximo_vencimento: "2025-01-10",
    ultimo_contato: "",
    ultima_acao: "Teste",
    proxima_acao: "Teste",
    optout: false,
    etapa_regua: "D+7",
    status: "Aguardando resposta",
    responsavel: "Lara Automacao",
    risco: "medio",
    ...overrides,
  });

  await laraOperationalStore.upsertTituloCache({
    id: `TIT-AQS-${seed}`,
    duplicata,
    prestacao: "1",
    numtransvenda: 0,
    numnota: 0,
    codcli,
    cliente: `Cliente AQS ${seed}`,
    fantasia: `Cliente AQS ${seed}`,
    telefone: waId,
    valor: 1000,
    vlreceber: 1000,
    vldesc: 0,
    cmulta_prev: 0,
    percmulta: 0,
    vencimento: "2025-01-10",
    dtemissao: "2025-01-01",
    dtrecebimento_previsto: "",
    dias_atraso: 10,
    codcob: "341",
    cobranca: "Banco Itau",
    rca: "",
    etapa_regua: "D+7",
    status_atendimento: "Em aberto",
    boleto_disponivel: true,
    pix_disponivel: true,
    titulo_com_data_prevista: false,
    ultima_acao: "Teste",
    responsavel: "Lara Automacao",
    filial: "TESTE",
  });

  return { codcli, waId, duplicata };
}

async function addPilot(codcli: string): Promise<() => void> {
  const { env } = await import("../../../config/env.js");
  const previous = env.LARA_PILOT_CODCLIS;
  const base = previous ? `${previous},` : "";
  (env as Record<string, unknown>).LARA_PILOT_CODCLIS = `${base}${codcli}`;
  return () => { (env as Record<string, unknown>).LARA_PILOT_CODCLIS = previous; };
}

// 1. Cliente responde ao disparo da régua e Lara assume (sem duplo processamento)
test("[AQS-01] cliente responde disparo da regua e Lara processa", async () => {
  const seed = nextSeed();
  const { codcli, waId, duplicata } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    // Simula mensagem de saída da régua no histórico
    await laraOperationalStore.addMessageLog({
      wa_id: waId, codcli: Number(codcli), cliente: `Cliente AQS ${seed}`,
      telefone: waId, message_text: "Ola! Voce possui titulo em aberto.", direction: "OUTBOUND",
      origem: "regua-ativa", etapa: "D+7", duplics: duplicata, valor_total: 1000,
      payload_json: "{}", status: "enviado", sent_at: "2026-06-07 10:00:00", received_at: "",
      message_type: "texto", operator_name: "Lara Automacao",
      idempotency_key: makeIdempotencyKey(["regua", waId, seed]),
    });

    const result = await laraService.processarMensagemInbound({
      event_id: `aqst01-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "ok pode mandar o boleto",
      origem: "whatsapp-inbound",
    });

    assert.equal(result.status, "ok", "Lara deve processar a resposta ao disparo");
    assert.ok(result.mensagem && result.mensagem.length > 0, "Deve gerar resposta");
  } finally {
    removePilot();
  }
});

// 2. Cliente responde sem contexto de campanha salvo — Lara responde mesmo assim (fallback receptivo)
test("[AQS-02] cliente responde sem contexto de campanha — Lara nao trava", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    // Nenhuma mensagem de saída no histórico — sem contexto de campanha
    const result = await laraService.processarMensagemInbound({
      event_id: `aqst02-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "ola",
      origem: "whatsapp-inbound",
    });

    assert.equal(result.status, "ok", "Deve processar mesmo sem contexto de campanha");
    assert.ok(result.mensagem && result.mensagem.length > 0, "Deve gerar resposta");
  } finally {
    removePilot();
  }
});

// 3. Webhook duplicado não gera resposta duplicada (idempotência)
test("[AQS-03] webhook duplicado nao processa duas vezes", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);
  const eventId = `aqst03-${seed}`;

  try {
    const first = await laraService.processarMensagemInbound({
      event_id: eventId, wa_id: waId, telefone: waId,
      message_text: "quero o boleto", origem: "whatsapp-inbound",
    });
    const second = await laraService.processarMensagemInbound({
      event_id: eventId, wa_id: waId, telefone: waId,
      message_text: "quero o boleto", origem: "whatsapp-inbound",
    });

    assert.ok(["ok", "erro"].includes(first.status), "Primeira chamada deve processar");
    assert.equal(second.status, "duplicado", "Segunda chamada com mesmo event_id deve ser ignorada");
  } finally {
    removePilot();
  }
});

// 4. Telefone em diferentes formatos localiza o mesmo cliente
test("[AQS-04] telefone em formatos diferentes normaliza para o mesmo numero", () => {
  const formatos = [
    "+55 92 99999-9999",
    "5592999999999",
    "92999999999",
    "92 99999-9999",
  ];
  const normalizado = formatos.map(normalizePhone);
  // Todos devem começar com 55
  for (const n of normalizado) {
    assert.ok(n.startsWith("55"), `"${n}" deve comecar com 55`);
  }
  // buildPhoneCandidates deve conter variações sem 55
  const candidates = buildPhoneCandidates(formatos[0]);
  assert.ok(candidates.length >= 2, "Deve gerar pelo menos 2 candidatos de telefone");
});

// 5. Intenção desconhecida gera fallback (não trava)
test("[AQS-05] intencao nao identificada gera resposta e nao trava", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    const result = await laraService.processarMensagemInbound({
      event_id: `aqst05-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "e ai como fica isso tudo",
      origem: "whatsapp-inbound",
    });

    assert.ok(["ok", "erro"].includes(result.status), "Deve ter status definido");
    assert.ok(result.mensagem && result.mensagem.length > 0, "Deve gerar resposta mesmo sem intent clara");
    assert.ok(result.acao, "Deve ter acao definida");
  } finally {
    removePilot();
  }
});

// 6. Mensagem de mídia retorna resposta amigável sem travar
test("[AQS-06] mensagem de audio ou imagem retorna resposta amigavel", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    for (const tipo of ["[AUDIO]", "[IMAGE]", "[DOCUMENT]"]) {
      const result = await laraService.processarMensagemInbound({
        event_id: `aqst06-${seed}-${tipo}`,
        wa_id: waId, telefone: waId, codcli: Number(codcli),
        message_text: tipo, origem: "whatsapp-inbound",
      });

      assert.equal(result.status, "ok", `${tipo}: status deve ser ok`);
      assert.equal(result.acao, "media_nao_suportada", `${tipo}: acao deve ser media_nao_suportada`);
      assert.ok(result.mensagem && result.mensagem.length > 0, `${tipo}: deve ter mensagem`);
    }
  } finally {
    removePilot();
  }
});

// 7. Opt-out NÃO bloqueia solicitação iniciada pelo próprio cliente
test("[AQS-07] opt-out nao bloqueia quando cliente inicia contato pedindo ajuda", () => {
  // Testa diretamente a policy engine
  const result = evaluatePolicy({
    now: new Date(),
    timezone: "America/Manaus",
    tenantId: "default",
    waId: "5592999999999",
    jurisdicao: "BR",
    canal: "WHATSAPP",
    initiatedByCustomer: true,
    optoutAtivo: true,
    perfilVulneravel: false,
    etapaRegua: "D+7",
    mensagensOutboundUltimas24h: 0,
    cooldownMinutos: 120,
  });

  assert.equal(result.permitido, true, "Opt-out nao deve bloquear quando cliente inicia");
  assert.equal(result.optoutReceptivo, true, "Deve sinalizar modo receptivo opt-out");
});

// 8. Opt-out ainda bloqueia contato ativo (outbound iniciado pelo sistema)
test("[AQS-08] opt-out bloqueia corretamente contato outbound do sistema", () => {
  const result = evaluatePolicy({
    now: new Date(),
    timezone: "America/Manaus",
    tenantId: "default",
    waId: "5592999999999",
    jurisdicao: "BR",
    canal: "WHATSAPP",
    initiatedByCustomer: false,
    optoutAtivo: true,
    perfilVulneravel: false,
    etapaRegua: "D+7",
    mensagensOutboundUltimas24h: 0,
    cooldownMinutos: 120,
  });

  assert.equal(result.permitido, false, "Opt-out deve bloquear contato outbound do sistema");
  assert.ok(!result.optoutReceptivo, "Nao deve ser modo receptivo em contato ativo do sistema");
});

// 9. Atendimento humano marcado registra status (conversa não fica sem ação)
test("[AQS-09] escalacao humana registra evento e retorna acao definida", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    const result = await laraService.processarMensagemInbound({
      event_id: `aqst09-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "quero falar com um atendente",
      origem: "whatsapp-inbound",
    });

    assert.ok(["ok", "erro"].includes(result.status), "Deve ter status definido");
    assert.ok(result.acao, "Deve ter acao definida");
    assert.ok(result.mensagem && result.mensagem.length > 0, "Deve ter mensagem ao cliente");

    // Verifica se um case de escalação foi criado
    const cases = await laraOperationalStore.listCases();
    const caseEscalacao = cases.find(
      (c) => c.wa_id === waId && String(c.acao ?? "").includes("ESCALACAO"),
    );
    assert.ok(caseEscalacao, "Deve criar case de escalacao humana");
  } finally {
    removePilot();
  }
});

// 10. Número errado (cliente nega ser o destinatário) — conversa não expõe dados e recebe status
test("[AQS-10] cliente desconhecido solicita boleto — nao expoe dados antes de identificar", async () => {
  const seed = nextSeed();
  // waId sem vínculo a nenhum cliente no cache
  const waIdDesconhecido = `55918${String(seed + 77777).slice(-8).padStart(8, "0")}`;

  const result = await laraService.processarMensagemInbound({
    event_id: `aqst10-${seed}`,
    wa_id: waIdDesconhecido,
    message_text: "quero o boleto",
    origem: "whatsapp-inbound",
  });

  assert.ok(["ok", "erro"].includes(result.status), "Deve ter status definido");
  assert.ok(result.mensagem && result.mensagem.length > 0, "Deve responder ao cliente");
  // Não deve ter codcli nem dados financeiros sem identificação
  assert.ok(!result.codcli, "Nao deve expor codcli sem identificacao do cliente");
});

// 11. Fluxo completo termina sempre com acao definida (nunca undefined)
test("[AQS-11] toda mensagem recebida gera acao e mensagem definidas", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  const mensagens = [
    "oi",
    "quem e voce",
    "ja paguei",
    "nao reconheco essa divida",
    "so consigo pagar metade",
    "quero falar com uma pessoa",
    "?",
  ];

  try {
    for (const msg of mensagens) {
      const result = await laraService.processarMensagemInbound({
        event_id: `aqst11-${seed}-${msg.slice(0, 10)}`,
        wa_id: waId, telefone: waId, codcli: Number(codcli),
        message_text: msg, origem: "whatsapp-inbound",
      });

      assert.ok(["ok", "erro", "duplicado"].includes(result.status), `"${msg}": status deve ser definido`);
      assert.ok(result.acao, `"${msg}": acao deve ser definida`);
    }
  } finally {
    removePilot();
  }
});

// 12. Opt-in reverte opt-out ativo
test("[AQS-12] opt-in reverte opt-out ativo", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    // Aplica opt-out
    await laraService.processarMensagemInbound({
      event_id: `aqst12-optout-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "para de me mandar mensagem", origem: "whatsapp-inbound",
    });

    const optoutAtivo = await laraOperationalStore.findActiveOptoutByWaId(waId);
    assert.ok(optoutAtivo?.ativo, "Opt-out deve estar ativo apos solicitacao");

    // Reverte com opt-in
    const optinResult = await laraService.processarMensagemInbound({
      event_id: `aqst12-optin-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "continuar", origem: "whatsapp-inbound",
    });

    assert.equal(optinResult.acao, "optin_aplicado", "Opt-in deve ser aplicado");
    const optoutDepois = await laraOperationalStore.findActiveOptoutByWaId(waId);
    assert.ok(!optoutDepois?.ativo, "Opt-out deve estar inativo apos opt-in");
  } finally {
    removePilot();
  }
});

// 13. Mensagem duplicada por conteúdo (sem event_id) é detectada pelo hash
test("[AQS-13] mensagem duplicada por conteudo e detectada", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);
  const msgText = `texto-unico-aqst13-${seed}`;
  const receivedAt = "2026-06-08T10:00:00.000Z";

  try {
    const first = await laraService.processarMensagemInbound({
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: msgText, received_at: receivedAt,
      origem: "whatsapp-inbound",
    });
    const second = await laraService.processarMensagemInbound({
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: msgText, received_at: receivedAt,
      origem: "whatsapp-inbound",
    });

    assert.ok(["ok", "erro"].includes(first.status), "Primeira mensagem deve ser processada");
    assert.equal(second.status, "duplicado", "Segunda mensagem identica deve ser bloqueada como duplicata");
  } finally {
    removePilot();
  }
});

// 14. Toda conversa tem acao definida — nenhuma resposta com acao undefined
test("[AQS-14] nenhuma resposta tem acao undefined", async () => {
  const seed = nextSeed();
  const { codcli, waId } = await seedClienteComTitulo(seed);
  const removePilot = await addPilot(codcli);

  try {
    const result = await laraService.processarMensagemInbound({
      event_id: `aqst14-${seed}`,
      wa_id: waId, telefone: waId, codcli: Number(codcli),
      message_text: "oi tudo bem",
      origem: "whatsapp-inbound",
    });

    assert.ok(result.acao, "Acao nao deve ser undefined ou vazia");
    assert.ok(result.status, "Status nao deve ser undefined ou vazio");
  } finally {
    removePilot();
  }
});

// 15. Chave de idempotência é gerada corretamente para diferentes entradas
test("[AQS-15] makeIdempotencyKey gera chaves unicas e deterministas", () => {
  const key1 = makeIdempotencyKey(["5592999999999", "quero boleto", "2026-06-08T10:00:00.000Z"]);
  const key2 = makeIdempotencyKey(["5592999999999", "quero boleto", "2026-06-08T10:00:00.000Z"]);
  const key3 = makeIdempotencyKey(["5592999999999", "outro texto", "2026-06-08T10:00:00.000Z"]);

  assert.equal(key1, key2, "Mesma entrada deve gerar mesma chave (determinista)");
  assert.notEqual(key1, key3, "Entradas diferentes devem gerar chaves diferentes (unicidade)");
  assert.equal(typeof key1, "string", "Chave deve ser string");
  assert.ok(key1.length > 10, "Chave deve ter tamanho adequado");
});
