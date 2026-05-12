# Fluxo funcional WhatsApp <-> Lara

Janela de referencia: 2026-04-10 a 2026-04-25.

## Objetivo

Padronizar o fluxo operacional entre WhatsApp, n8n e Sistema Lara, separando explicitamente entrada, envio para Lara, espera, busca da resposta e retorno ao WhatsApp.

## Evidencia encontrada

Foram encontrados workflows n8n em `docs/n8n` e na raiz do projeto:

- `n8n-cloud-2.13.3-lara-whatsapp-single-callback.json`
- `n8n-cloud-2.13.3-lara-whatsapp-uazapi-single-webhook.json`
- `lara-whatsapp-single-callback.json`
- `lara-whatsapp-uazapi-single-webhook.json`

Esses workflows ja recebem callbacks, normalizam mensagens, fazem POST para `/api/lara/webhooks/whatsapp-inbound` e enviam retorno ao WhatsApp/ Uazapi. A lacuna encontrada e que o fluxo atual trata a resposta como imediata: nao ha etapa dedicada de espera/polling nem etapa separada de busca posterior da resposta.

## Fluxo alvo normalizado

1. Recebe mensagem do WhatsApp para enviar Para o Sistema Lara
   - Recebe o webhook do provedor WhatsApp.
   - Atua como porta de entrada do fluxo.
   - Preserva `event_id`, telefone, `wa_id`, payload bruto e timestamp.

2. Envia mensagens para o sistema Lara
   - Envia a mensagem ao Sistema Lara via HTTP Request POST.
   - Endpoint esperado: `/api/lara/webhooks/whatsapp-inbound`.
   - Deve enviar `event_id`, `wa_id`, `telefone`, `message_text`, `tenant_id`, `canal`, `received_at` e `payload`.

3. Sistema / Aplicativo Lara
   - Processa a mensagem.
   - Identifica cliente/titulos quando possivel.
   - Decide resposta, acao, compliance e necessidade de atendimento humano.
   - Registra logs, mensagens e idempotencia.

4. Aguardar Resposta do Sistema Lara
   - Implementa espera curta ou polling.
   - Evita acoplar o envio ao retorno imediato.
   - Deve prever timeout e limite de tentativas.

5. Buscar mensagem no sistema Lara
   - Consulta a resposta final em endpoint de conversa ou endpoint especifico de resposta.
   - Endpoint disponivel hoje: `GET /api/lara/conversas/:waId`.
   - Pendencia tecnica: criar endpoint dedicado de polling se o modelo assincrono for exigido em producao.

6. Receber mensagem do Sistema Lara para enviar no WhatsApp
   - Extrai a ultima mensagem outbound pendente/enviavel.
   - Monta payload do canal final.
   - Encaminha ao WhatsApp pelo provedor configurado.

## Entradas

Payload minimo vindo do WhatsApp:

```json
{
  "event_id": "wamid.exemplo",
  "wa_id": "5599999999999",
  "telefone": "5599999999999",
  "message_text": "quero meu boleto",
  "tenant_id": "default",
  "canal": "WHATSAPP",
  "received_at": "2026-04-25T10:00:00.000Z",
  "payload": {
    "provider": "meta|uazapi",
    "raw_message": {}
  }
}
```

## Saidas

Payload minimo para envio ao WhatsApp:

```json
{
  "to": "5599999999999",
  "text": "Mensagem final gerada pela Lara",
  "provider": "meta",
  "lara_event_id": "wamid.exemplo",
  "correlation_id": "id tecnico da execucao"
}
```

## Tratamento de falhas

- Falha no POST para Lara: registrar erro de integracao e nao enviar resposta automatica falsa.
- Timeout de espera: registrar case ou log operacional com status `LARA_RESPONSE_TIMEOUT`.
- Resposta nao encontrada: nao enviar mensagem vazia; abrir pendencia de acompanhamento.
- Falha no envio ao WhatsApp: registrar retorno do provedor e manter possibilidade de reprocessamento.
- Webhook repetido: usar `event_id` como idempotency key.

## Artefato criado

O workflow reconstruido esta em `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-polling-reconstruido.json`.
