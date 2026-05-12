import { sendTextMessage } from "./src/modules/lara/whatsappTemplateManager.js";

try {
  const result = await sendTextMessage("5592842250505", "Boa tarde! Este e um teste de conectividade da Lara. Pode ignorar.");
  console.log("SUCESSO:", JSON.stringify(result));
} catch (err) {
  console.error("ERRO:", err.message);
  if (err.cause) console.error("CAUSA:", JSON.stringify(err.cause));
}
