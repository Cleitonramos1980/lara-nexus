import test from "node:test";
import assert from "node:assert/strict";
import {
  listClientesQuerySchema,
  listConversasQuerySchema,
  listLogsQuerySchema,
  webhookWhatsappInboundSchema,
  winthorBoletoConsultaBodySchema,
  winthorBoletoGerarBodySchema,
  winthorProrrogarTituloBodySchema,
} from "../schemas.js";

test("contrato de query aceita filiais em CSV", () => {
  const parsed = listClientesQuerySchema.parse({
    search: "ana",
    filiais: "1, 2,3",
    page_size: "50",
  });

  assert.deepEqual(parsed.filiais, ["1", "2", "3"]);
  assert.equal(parsed.page_size, 50);
});

test("contrato de query aplica regra nenhuma filial = todas", () => {
  const parsed = listConversasQuerySchema.parse({
    search: "cliente",
  });
  assert.equal(parsed.filiais, undefined);
});

test("contrato de logs suporta cursor e filtro de filial", () => {
  const parsed = listLogsQuerySchema.parse({
    filiais: "10,20",
    cursor: "abc123",
    page_size: "100",
  });

  assert.deepEqual(parsed.filiais, ["10", "20"]);
  assert.equal(parsed.cursor, "abc123");
  assert.equal(parsed.page_size, 100);
});

test("contrato inbound aceita tenant, jurisdicao e canal", () => {
  const parsed = webhookWhatsappInboundSchema.parse({
    event_id: "evt-1",
    wa_id: "5591999999999",
    telefone: "5591999999999",
    message_text: "quero boleto",
    tenant_id: "tenant-a",
    jurisdicao: "BR",
    canal: "WHATSAPP",
  });

  assert.equal(parsed.tenant_id, "tenant-a");
  assert.equal(parsed.jurisdicao, "BR");
  assert.equal(parsed.canal, "WHATSAPP");
});

test("contrato winthor consulta aceita lookup por duplicata + prestacao", () => {
  const parsed = winthorBoletoConsultaBodySchema.parse({
    duplicata: "100200",
    prestacao: "1",
    codfilial: "10",
  });

  assert.equal(parsed.duplicata, "100200");
  assert.equal(parsed.prestacao, "1");
  assert.equal(parsed.codfilial, "10");
});

test("contrato winthor consulta aceita lookup por cgcent e nome", () => {
  const parsed = winthorBoletoConsultaBodySchema.parse({
    cgcent: "12.345.678/0001-90",
    fantasia: "Mercadinho Central",
    cliente: "Comercial Central LTDA",
  });

  assert.equal(parsed.cgcent, "12.345.678/0001-90");
  assert.equal(parsed.fantasia, "Mercadinho Central");
  assert.equal(parsed.cliente, "Comercial Central LTDA");
});

test("contrato winthor gerar aplica defaults e lookup", () => {
  const parsed = winthorBoletoGerarBodySchema.parse({
    numtransvenda: "123456",
  });

  assert.equal(parsed.numtransvenda, 123456);
  assert.equal(parsed.primeira_impressao, true);
  assert.equal(parsed.force_regenerate, false);
  assert.equal(parsed.origem, "n8n");
  assert.equal(parsed.solicitante, "Lara N8N");
});

test("contrato winthor prorrogar exige nova_data_vencimento em formato ISO date", () => {
  const parsed = winthorProrrogarTituloBodySchema.parse({
    codcli: "1001",
    nova_data_vencimento: "2026-05-15",
  });

  assert.equal(parsed.codcli, 1001);
  assert.equal(parsed.nova_data_vencimento, "2026-05-15");
  assert.equal(parsed.codfunc, 270);
  assert.equal(parsed.tenant_id, "default");
});
