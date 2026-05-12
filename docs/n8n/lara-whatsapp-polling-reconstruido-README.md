# Lara WhatsApp Polling Reconstruido

Arquivo:

- `n8n-cloud-2.13.3-lara-whatsapp-polling-reconstruido.json`

Objetivo:

- deixar explicita a sequencia WhatsApp -> POST para Lara -> espera -> busca da resposta -> retorno ao WhatsApp.

Variaveis esperadas no n8n:

- `LARA_BASE_URL`
- `LARA_API_KEY`
- `LARA_TENANT_ID`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Observacoes:

- O backend atual ja possui `POST /api/lara/webhooks/whatsapp-inbound` e `GET /api/lara/conversas/:waId`.
- O fluxo atual do projeto responde de forma imediata; este workflow adiciona a etapa de espera/busca para refletir a decisao funcional de 2026-04-10.
- Se for necessario polling real com multiplas tentativas, criar endpoint dedicado de status/resposta pendente no backend Lara.
- Nao enviar mensagem vazia ao WhatsApp quando a busca nao localizar resposta.
