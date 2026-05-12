import test from "node:test";
import assert from "node:assert/strict";
import { detectIntent, normalizePhone, normalizeWaId, extractPromessaDate } from "../utils.js";

test("normaliza telefone e wa_id para padrão com DDI", () => {
  assert.equal(normalizePhone("(92) 99812-3456"), "5592998123456");
  assert.equal(normalizeWaId("5592998123456"), "5592998123456");
  assert.equal(normalizePhone("92998123456"), "5592998123456");
});

test("detecta intenções de boleto, pix, humano e opt-out", () => {
  assert.equal(detectIntent("pode enviar o boleto?"), "solicitar_boleto");
  assert.equal(detectIntent("manda o pix copia e cola"), "solicitar_pix");
  assert.equal(detectIntent("quero falar com humano"), "falar_humano");
  assert.equal(detectIntent("pare de mandar mensagem"), "optout");
});

test("extrai data de promessa de pagamento", () => {
  const parsed = extractPromessaDate("vou pagar dia 25");
  assert.ok(parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed));
});
