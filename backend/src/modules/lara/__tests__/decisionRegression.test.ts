import test from "node:test";
import assert from "node:assert/strict";
import { env } from "../../../config/env.js";
import { evaluatePolicy } from "../policyEngine.js";
import { chooseNextBestAction } from "../nextBestAction.js";
import { classifyIntentWithAiFallback, classifyIntentWithNlu, getIntentClassifierHealthSnapshot } from "../nluClassifier.js";

test("policy permite resposta reativa iniciada pelo cliente fora da janela", () => {
  const result = evaluatePolicy({
    now: new Date("2026-04-10T02:00:00.000Z"),
    timezone: "America/Sao_Paulo",
    tenantId: "default",
    waId: "5591999999999",
    jurisdicao: "BR",
    canal: "WHATSAPP",
    initiatedByCustomer: true,
    optoutAtivo: false,
    perfilVulneravel: false,
    etapaRegua: "D+7",
    mensagensOutboundUltimas24h: 2,
    cooldownMinutos: 120,
  });

  assert.equal(result.permitido, true);
});

test("policy bloqueia contato quando opt-out esta ativo", () => {
  const result = evaluatePolicy({
    now: new Date("2026-04-10T14:00:00.000Z"),
    timezone: "America/Sao_Paulo",
    tenantId: "default",
    waId: "5591999999999",
    jurisdicao: "BR",
    canal: "WHATSAPP",
    initiatedByCustomer: true,
    optoutAtivo: true,
    perfilVulneravel: false,
    etapaRegua: "D+7",
    mensagensOutboundUltimas24h: 0,
    cooldownMinutos: 120,
  });

  assert.equal(result.permitido, false);
  assert.match(result.razao, /opt-out/i);
});

test("next best action escala quando confianca e baixa", () => {
  const result = chooseNextBestAction({
    intent: "solicitar_boleto",
    confidence: 0.3,
    etapaRegua: "D+7",
    risco: "medio",
    perfilVulneravel: false,
    policyAllowed: true,
    mensagensOutboundUltimas24h: 0,
    promessasEmAberto: 0,
  });

  assert.equal(result.action, "escalar_humano");
});

test("next best action envia boleto para intencao explicita", () => {
  const result = chooseNextBestAction({
    intent: "solicitar_boleto",
    confidence: 0.88,
    etapaRegua: "D+3",
    risco: "baixo",
    perfilVulneravel: false,
    policyAllowed: true,
    mensagensOutboundUltimas24h: 0,
    promessasEmAberto: 0,
  });

  assert.equal(result.action, "enviar_boleto");
});

test("nlu classifica solicitacao de boleto", () => {
  const result = classifyIntentWithNlu("Pode me enviar o boleto?");
  assert.equal(result.intent, "solicitar_boleto");
  assert.equal(result.method, "nlu");
  assert.ok(result.confidence >= 0.55);
});

test("nlu usa fallback deterministico quando sem sinal semantico", () => {
  const result = classifyIntentWithNlu("xpto abc 123");
  assert.equal(result.method, "regex-fallback");
});

test("classificador usa OpenAI quando habilitado e retorna intent valida", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = env.OPENAI_API_KEY;
  const previousModel = env.OPENAI_MODEL;
  const previousEnabled = env.LARA_AI_CLASSIFIER_ENABLED;

  (env as any).OPENAI_API_KEY = "test-openai-key";
  (env as any).OPENAI_MODEL = "gpt-5-mini";
  (env as any).LARA_AI_CLASSIFIER_ENABLED = true;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          intent: "solicitar_boleto",
          confidence: 0.93,
          reason: "Pedido explicito de boleto.",
        }),
      }),
      {
        status: 200,
        headers: { "x-request-id": "req_test_123" },
      },
    )) as typeof fetch;

  try {
    const result = await classifyIntentWithAiFallback("Pode me enviar o boleto?");
    assert.equal(result.method, "openai");
    assert.equal(result.intent, "solicitar_boleto");
    assert.ok(result.confidence >= 0.9);
    assert.equal(result.classifier.used_openai, true);
    assert.equal(result.classifier.provider, "openai");
  } finally {
    globalThis.fetch = originalFetch;
    (env as any).OPENAI_API_KEY = previousApiKey;
    (env as any).OPENAI_MODEL = previousModel;
    (env as any).LARA_AI_CLASSIFIER_ENABLED = previousEnabled;
  }
});

test("classificador cai para fallback local quando OpenAI falha", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = env.OPENAI_API_KEY;
  const previousEnabled = env.LARA_AI_CLASSIFIER_ENABLED;

  (env as any).OPENAI_API_KEY = "test-openai-key";
  (env as any).LARA_AI_CLASSIFIER_ENABLED = true;
  globalThis.fetch = (async () => {
    throw new Error("falha simulada openai");
  }) as typeof fetch;

  try {
    const result = await classifyIntentWithAiFallback("Quero falar com atendente");
    assert.equal(result.method, "nlu");
    assert.equal(result.intent, "falar_humano");
    assert.equal(result.classifier.attempted_openai, true);
    assert.equal(result.classifier.used_openai, false);
    assert.match(result.classifier.fallback_reason || "", /falha simulada openai/i);
  } finally {
    globalThis.fetch = originalFetch;
    (env as any).OPENAI_API_KEY = previousApiKey;
    (env as any).LARA_AI_CLASSIFIER_ENABLED = previousEnabled;
  }
});

test("classificador aplica retry com backoff e recupera em tentativa subsequente", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = env.OPENAI_API_KEY;
  const previousEnabled = env.LARA_AI_CLASSIFIER_ENABLED;
  const previousRetryAttempts = env.OPENAI_RETRY_MAX_ATTEMPTS;
  const previousRetryDelay = env.OPENAI_RETRY_BASE_DELAY_MS;
  const previousCbThreshold = env.OPENAI_CB_FAILURE_THRESHOLD;
  const previousCbCooldown = env.OPENAI_CB_COOLDOWN_MS;

  (env as any).OPENAI_API_KEY = "test-openai-key";
  (env as any).LARA_AI_CLASSIFIER_ENABLED = true;
  (env as any).OPENAI_RETRY_MAX_ATTEMPTS = 2;
  (env as any).OPENAI_RETRY_BASE_DELAY_MS = 50;
  (env as any).OPENAI_CB_FAILURE_THRESHOLD = 10;
  (env as any).OPENAI_CB_COOLDOWN_MS = 60000;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: "temporario" }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          intent: "solicitar_pix",
          confidence: 0.9,
          reason: "Pedido de pix.",
        }),
      }),
      { status: 200, headers: { "x-request-id": "req_retry_ok" } },
    );
  }) as typeof fetch;

  try {
    const result = await classifyIntentWithAiFallback("me manda pix");
    assert.equal(result.method, "openai");
    assert.equal(result.intent, "solicitar_pix");
    assert.equal(result.classifier.used_openai, true);
    assert.equal(result.classifier.retry_attempts, 2);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    (env as any).OPENAI_API_KEY = previousApiKey;
    (env as any).LARA_AI_CLASSIFIER_ENABLED = previousEnabled;
    (env as any).OPENAI_RETRY_MAX_ATTEMPTS = previousRetryAttempts;
    (env as any).OPENAI_RETRY_BASE_DELAY_MS = previousRetryDelay;
    (env as any).OPENAI_CB_FAILURE_THRESHOLD = previousCbThreshold;
    (env as any).OPENAI_CB_COOLDOWN_MS = previousCbCooldown;
  }
});

test("classificador abre circuit breaker apos falhas e evita nova chamada OpenAI", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = env.OPENAI_API_KEY;
  const previousEnabled = env.LARA_AI_CLASSIFIER_ENABLED;
  const previousRetryAttempts = env.OPENAI_RETRY_MAX_ATTEMPTS;
  const previousCbThreshold = env.OPENAI_CB_FAILURE_THRESHOLD;
  const previousCbCooldown = env.OPENAI_CB_COOLDOWN_MS;

  (env as any).OPENAI_API_KEY = "test-openai-key";
  (env as any).LARA_AI_CLASSIFIER_ENABLED = true;
  (env as any).OPENAI_RETRY_MAX_ATTEMPTS = 1;
  (env as any).OPENAI_CB_FAILURE_THRESHOLD = 1;
  (env as any).OPENAI_CB_COOLDOWN_MS = 600000;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("falha para abrir circuito");
  }) as typeof fetch;

  try {
    const first = await classifyIntentWithAiFallback("quero atendente");
    assert.equal(first.method, "nlu");
    assert.equal(first.classifier.used_openai, false);
    assert.equal(calls, 1);

    const health = getIntentClassifierHealthSnapshot();
    assert.equal(health.circuit_state, "open");

    const second = await classifyIntentWithAiFallback("quero atendente");
    assert.equal(second.method, "nlu");
    assert.equal(second.classifier.used_openai, false);
    assert.match((second.classifier.fallback_reason || "").toLowerCase(), /circuit breaker openai ativo/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    (env as any).OPENAI_API_KEY = previousApiKey;
    (env as any).LARA_AI_CLASSIFIER_ENABLED = previousEnabled;
    (env as any).OPENAI_RETRY_MAX_ATTEMPTS = previousRetryAttempts;
    (env as any).OPENAI_CB_FAILURE_THRESHOLD = previousCbThreshold;
    (env as any).OPENAI_CB_COOLDOWN_MS = previousCbCooldown;
  }
});
