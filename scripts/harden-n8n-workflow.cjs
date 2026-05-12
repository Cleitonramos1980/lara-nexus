const fs = require("fs");

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error("Uso: node harden-n8n-workflow.cjs <input.json> <output.json>");
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const byName = new Map(data.nodes.map((node) => [node.name, node]));

const setHttpNode = (name, endpoint, includeTenantHeader = true) => {
  const node = byName.get(name);
  if (!node) return;
  node.parameters.url = `={{($env.LARA_BASE_URL || "http://localhost:3333") + "${endpoint}"}}`;
  node.parameters.sendHeaders = true;
  node.parameters.headerParameters = {
    parameters: [
      { name: "Content-Type", value: "application/json" },
      ...(includeTenantHeader ? [{ name: "x-lara-tenant-id", value: '={{$env.LARA_TENANT_ID || "default"}}' }] : []),
      { name: "x-lara-api-key", value: '={{$env.LARA_API_KEY || ""}}' },
    ],
  };
};

setHttpNode("Envia para Sistema Lara", "/api/lara/orquestracao/mensagens", true);
setHttpNode("Buscar Resposta Lara", "/api/lara/orquestracao/respostas", true);
setHttpNode("Enviar Webhook para Lara", "/api/lara/bradesco/pix/webhook", false);
setHttpNode("Reconciliar TXID na Lara", "/api/lara/bradesco/pix/reconciliar", false);

const prepMsg = byName.get("Prepara Mensagem WhatsApp");
if (prepMsg?.parameters?.assignments?.assignments) {
  const target = prepMsg.parameters.assignments.assignments.find((item) => item.name === "message");
  if (target) {
    target.value = '={{ $json.response || $json.laraResponse?.mensagem || "No momento nao consegui concluir sua solicitacao. Vou encaminhar para atendimento especializado." }}';
  }
}

const validateSecret = byName.get("Validar Segredo Webhook");
if (validateSecret?.parameters?.conditions?.conditions?.[0]) {
  validateSecret.parameters.conditions.conditions[0].leftValue =
    '={{ Boolean($json.webhook_secret) && $json.webhook_secret === ($env.BRADESCO_PIX_WEBHOOK_SECRET || "") }}';
  validateSecret.parameters.conditions.conditions[0].operator = {
    type: "boolean",
    operation: "true",
    singleValue: true,
  };
}

const waitNode = byName.get("Aguardar Processamento");
if (waitNode?.parameters) {
  waitNode.parameters.amount = 20;
  waitNode.parameters.unit = "seconds";
}

const timeoutNode = byName.get("Log Timeout");
if (timeoutNode) timeoutNode.disabled = false;

if (data.connections?.["Verificar Status Resposta"]?.main) {
  const main = data.connections["Verificar Status Resposta"].main;
  while (main.length < 4) main.push([]);
  main[3] = [{ node: "Log Timeout", type: "main", index: 0 }];
}

if (data.connections?.["Log Timeout"]?.main) {
  data.connections["Log Timeout"].main[0] = [{ node: "Notifica Timeout Cliente", type: "main", index: 0 }];
}

const pollNode = byName.get("Controle de Polling");
if (pollNode?.parameters) {
  pollNode.parameters.batchSize = 1;
}

if (!Array.isArray(data.tags)) data.tags = [];
for (const tag of ["lara", "whatsapp", "pix", "hardened"]) {
  if (!data.tags.includes(tag)) data.tags.push(tag);
}

data.name = "WhatsApp to Lara System Message Orchestration ok (Hardened Local)";
data.active = true;
data.meta = {
  ...(data.meta || {}),
  hardened_by_codex: true,
  hardened_at: new Date().toISOString(),
};

fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(outputPath);
