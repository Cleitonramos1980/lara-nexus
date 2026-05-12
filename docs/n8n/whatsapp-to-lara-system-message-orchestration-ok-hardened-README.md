# WhatsApp to Lara Orchestration (Hardened Local)

Arquivo:

- `docs/n8n/whatsapp-to-lara-system-message-orchestration-ok-hardened.json`

Origem:

- baseado no workflow enviado em `C:\Users\cleit\Downloads\WhatsApp to Lara System Message Orchestration ok.json`

## Ajustes aplicados automaticamente

1. `active` alterado para `true`.
2. URLs `trycloudflare.com` trocadas por variavel:
   - `{{$env.LARA_BASE_URL || "http://localhost:3333"}}`
3. Header `x-lara-api-key` adicionado nas chamadas Lara.
4. `PREENCHER_LARA_API_KEY` removido.
5. Validacao de segredo PIX corrigida para:
   - `webhook_secret === $env.BRADESCO_PIX_WEBHOOK_SECRET`
6. `Log Timeout` habilitado (`disabled: false`).
7. Fallback de resposta WhatsApp ajustado para texto seguro (sem falso sucesso).
8. Tempo de espera reduzido para 20s.

## Variaveis esperadas no n8n

- `LARA_BASE_URL` (ex.: `http://localhost:3333`)
- `LARA_API_KEY`
- `LARA_TENANT_ID` (ex.: `default`)
- `BRADESCO_PIX_WEBHOOK_SECRET`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TOKEN`

## Pendencias externas (nao resolvidas por codigo local)

- credenciais reais do WhatsApp Cloud API no n8n;
- webhook Meta/WhatsApp apontando para o n8n correto;
- segredo do webhook Bradesco preenchido no n8n;
- endpoints externos produtivos (quando nao usar localhost).

## Script de hardening

- `scripts/harden-n8n-workflow.cjs`
- uso:
  - `node scripts/harden-n8n-workflow.cjs <input.json> <output.json>`
