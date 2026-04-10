import test from "node:test";
import assert from "node:assert/strict";
import { laraOperationalStore } from "../operationalStore.js";
import { laraService } from "../service.js";
import { makeIdempotencyKey } from "../utils.js";

function uniqueCodcli(seed: number): string {
  return String(990000 + seed);
}

async function seedClienteComTitulo(seed: number): Promise<{ codcli: string; waId: string; duplicata: string }> {
  const codcli = uniqueCodcli(seed);
  const waId = `55919999${String(seed).padStart(4, "0")}`;
  const duplicata = `NF-TESTE-${seed}`;

  await laraOperationalStore.upsertClienteCache({
    codcli,
    cliente: `Cliente Teste ${seed}`,
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
    responsavel: "Lara Automação",
    risco: "medio",
  });

  await laraOperationalStore.upsertTituloCache({
    id: `TIT-TESTE-${seed}`,
    duplicata,
    prestacao: "1",
    codcli,
    cliente: `Cliente Teste ${seed}`,
    telefone: waId,
    valor: 1000,
    vencimento: "2025-01-10",
    dias_atraso: 10,
    etapa_regua: "D+7",
    status_atendimento: "Em aberto",
    boleto_disponivel: true,
    pix_disponivel: true,
    ultima_acao: "Teste",
    responsavel: "Lara Automação",
    filial: "TESTE",
  });

  return { codcli, waId, duplicata };
}

test("processa opt-out com idempotência por event_id", async () => {
  const seed = Date.now() % 100000;
  const { waId } = await seedClienteComTitulo(seed);
  const eventId = `evt-optout-${seed}`;

  const first = await laraService.processarMensagemInbound({
    event_id: eventId,
    wa_id: waId,
    telefone: waId,
    message_text: "pare de me enviar mensagem",
    origem: "teste",
  });

  assert.equal(first.status, "ok");
  assert.equal(first.acao, "optout_aplicado");

  const second = await laraService.processarMensagemInbound({
    event_id: eventId,
    wa_id: waId,
    telefone: waId,
    message_text: "pare de me enviar mensagem",
    origem: "teste",
  });

  assert.equal(second.status, "duplicado");
});

test("usa contexto recente para enviar boleto sem pedir identificação", async () => {
  const seed = (Date.now() % 100000) + 1;
  const { codcli, waId, duplicata } = await seedClienteComTitulo(seed);

  await laraOperationalStore.addMessageLog({
    wa_id: waId,
    codcli: Number(codcli),
    cliente: `Cliente Teste ${seed}`,
    telefone: waId,
    message_text: "Mensagem ativa com contexto",
    direction: "OUTBOUND",
    origem: "regua-ativa",
    etapa: "D+7",
    duplics: duplicata,
    valor_total: 1000,
    payload_json: JSON.stringify({ message_type: "texto" }),
    status: "enviado",
    sent_at: "2026-04-05 10:00:00",
    received_at: "",
    message_type: "texto",
    operator_name: "Lara",
    idempotency_key: makeIdempotencyKey(["ctx", waId, seed]),
  });

  const result = await laraService.processarMensagemInbound({
    event_id: `evt-contexto-${seed}`,
    wa_id: waId,
    telefone: waId,
    message_text: "ok pode mandar",
    origem: "teste",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.acao, "enviar_boleto");
});

test("registra promessa de pagamento a partir da mensagem", async () => {
  const seed = (Date.now() % 100000) + 2;
  const { codcli, waId } = await seedClienteComTitulo(seed);

  const result = await laraService.processarMensagemInbound({
    event_id: `evt-promessa-${seed}`,
    wa_id: waId,
    telefone: waId,
    codcli: Number(codcli),
    message_text: "vou pagar dia 25",
    origem: "teste",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.acao, "registrar_promessa");
});
