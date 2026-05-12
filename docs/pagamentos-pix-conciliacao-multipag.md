# Base tecnica - PIX, TXID, conciliacao bancaria e multipag

Janela de referencia: 2026-04-10 a 2026-04-25.

## Contexto

O projeto Lara ja possui acoes de envio de PIX e boleto no frontend/backend. A auditoria encontrou configuracao de chave PIX, endpoint `/api/lara/pagamentos/pix` e mensagens de envio de PIX. Nao foi encontrada base tecnica para recebimento de evento bancario PIX, TXID, conciliacao bancaria do pagamento, multipag ou baixa automatica ligada a evento financeiro.

Este documento cria a base conceitual minima para evolucao segura, sem declarar integracao bancaria real.

## PIX

O PIX deve ser tratado como evento financeiro externo que pode confirmar um pagamento, mas nunca deve provocar baixa sozinho sem validacao.

Campos conceituais recomendados:

- `payment_event_id`: identificador unico do evento recebido.
- `provider`: banco, PSP, gateway ou conciliador.
- `txid`: identificador rastreavel do PIX.
- `end_to_end_id`: identificador interbancario quando disponivel.
- `amount_paid`: valor recebido.
- `paid_at`: data/hora do pagamento.
- `payer_document_hint`: documento parcial/informado, quando permitido.
- `evidence_url` ou `evidence_hash`: referencia ao comprovante/evidencia.
- `raw_payload`: payload bruto preservado para auditoria.

## TXID

O `txid` deve ser uma chave de rastreabilidade, nao uma prova isolada.

Uso esperado:

- correlacionar cobranca gerada pela Lara com evento bancario recebido;
- ajudar a localizar titulo ou lote de titulos;
- compor idempotency key junto com provedor e valor;
- permitir auditoria posterior;
- reduzir ambiguidade em caso de multiplos titulos do mesmo cliente.

Pendencia tecnica: validar padrao real de TXID do banco/gateway e garantir que a geracao do PIX preserve vinculo com `codcli`, titulo e origem.

## Conciliacao bancaria

A conciliacao deve comparar evento externo com obrigacao interna antes de qualquer baixa.

Validacoes minimas:

- evento financeiro unico e nao processado;
- identificador suficiente para localizar cliente/titulo;
- valor recebido compativel com valor esperado;
- titulo elegivel e nao baixado;
- ausencia de ambiguidade;
- evidencia preservada;
- decisao da Lara marcada como confirmacao positiva.

Estados sugeridos:

- `MATCH_EXATO`
- `MATCH_PARCIAL`
- `MATCH_AMBIGUO`
- `VALOR_DIVERGENTE`
- `EVENTO_DUPLICADO`
- `SEM_IDENTIFICADOR_SUFICIENTE`
- `PENDENTE_REVISAO`

## Multipag

Multipag deve ser tratado como lote ou grupo de pagamentos, sem assumir baixa individual automatica.

Cenarios previstos:

- um evento liquida um titulo;
- um evento liquida varios titulos;
- varios eventos liquidam um titulo;
- varios eventos liquidam varios titulos;
- lote contem itens validos, ambiguos e divergentes.

Regras conceituais:

- cada item do lote deve possuir idempotency key propria;
- o lote deve possuir idempotency key global;
- uma falha individual nao deve mascarar sucesso/falha dos demais itens;
- baixa em lote exige retorno item a item;
- divergencia de valor deve bloquear baixa do item afetado ate regra formal.

## Possiveis payloads futuros

```json
{
  "payment_event_id": "bank-event-001",
  "provider": "banco-ou-gateway",
  "payment_method": "PIX",
  "txid": "LARA-CLIENTE-TITULO-001",
  "amount_paid": 123.45,
  "currency": "BRL",
  "paid_at": "2026-04-25T12:00:00.000Z",
  "candidate_title": {
    "codcli": 123,
    "numprest": "referencia neutra",
    "codcob": "referencia neutra",
    "document_number": "referencia neutra"
  },
  "evidence": {
    "type": "bank_webhook",
    "hash": "sha256:..."
  }
}
```

## Riscos

- TXID ausente ou reaproveitado.
- Valor divergente por juros, desconto, tarifa ou pagamento parcial.
- Pagamento de terceiro sem identificador suficiente.
- Webhook bancario repetido.
- Lote multipag parcialmente valido.
- Provedor sem garantia de entrega ordenada.
- Baixa indevida por matching fraco.

## Limitacoes atuais

- Nao ha endpoint bancario PIX real no projeto.
- Nao ha contrato real de webhook bancario.
- Nao ha conciliacao PIX implementada.
- Nao ha multipag implementado.
- Nao ha validacao contra extrato bancario real.

## Proximos passos

1. Definir banco/gateway/PSP e contrato real de webhook.
2. Definir regra de TXID na geracao de cobrancas.
3. Criar endpoint de recepcao de eventos financeiros.
4. Criar tabela de eventos de pagamento e tabela de idempotencia.
5. Homologar conciliacao com dados reais.
6. Somente depois integrar baixa WinThor.

## Estudo aplicado - Bradesco Pix Recebimento

Base estudada em 2026-04-26 a partir da documentacao operacional enviada para o projeto.

### Recursos relevantes para a Lara

- Cob imediata: `POST /v2/cob` e `PUT /v2/cob/{txid}` para QR Code dinamico com expiracao.
- Cob com vencimento: `PUT /v2/cobv/{txid}` para QR Code com data futura, juros, multa e desconto.
- Cob estatica: `POST /v1/cobe` para QR Code reutilizavel, com conciliacao mais simples.
- Pix recebidos: `GET /v2/pix/{e2eid}` e `GET /v2/pix` para consulta e conciliacao.
- Notificacao/Webhook: recurso para receber confirmacao ativa quando o Pix for pago.
- Locations: `POST /v2/loc`, `GET /v2/loc` e `DELETE /v2/loc/{id}/txid` para controlar payloads reutilizaveis.

### Ambientes e requisitos

- Sandbox: `https://openapisandbox.prebanco.com.br`.
- Producao: `https://qrpix.bradesco.com.br`.
- O webhook exige certificado mTLS.
- A empresa precisa ser PJ correntista, ter contrato assinado e autenticacao valida.
- A integracao real depende de certificado, credenciais e chaves Bradesco que ainda nao estao no projeto.

### TXID e conciliacao

O `txid` e o identificador principal para conciliar QR Codes dinamicos. Para cobrancas imediatas e com vencimento, a documentacao informa formato alfanumerico de 26 a 35 caracteres, unico por CPF/CNPJ do recebedor.

Campos minimos para a Lara receber do fluxo Pix:

```json
{
  "event_id": "bradesco-pix-event-id",
  "provider": "BRADESCO_PIX",
  "txid": "TXID_ALFANUMERICO_26_35",
  "endToEndId": "E2EID",
  "valor": "123.45",
  "horario": "2026-04-26T10:00:00Z",
  "raw": {}
}
```

### Regras adotadas no projeto

- Webhook sem TXID deve retornar `invalid_payload`.
- Webhook repetido deve ser idempotente por `tenant_id + event_id + txid + endToEndId`.
- Se a PCPREST nao tiver campo homologado de TXID, a Lara deve retornar reconciliacao pendente.
- Se houver mais de um titulo candidato, a baixa deve ser bloqueada.
- Se houver divergencia de valor, a baixa deve ser bloqueada.
- Nenhuma baixa WinThor deve ser feita apenas pela chegada do webhook Bradesco; a rotina oficial precisa ser homologada.

### Pendencias tecnicas Bradesco

- Definir autenticacao OAuth/certificado conforme manual do desenvolvedor Bradesco.
- Receber e instalar certificado mTLS do webhook.
- Configurar `BRADESCO_PIX_WEBHOOK_SECRET` ou mecanismo equivalente validado no n8n.
- Configurar `LARA_API_KEY` fora do workflow, usando credencial/variavel segura.
- Definir se o TXID sera gravado em PCPREST, tabela auxiliar Lara ou contrato de conciliacao separado.
- Homologar consulta de Pix recebido por `e2eid` antes de permitir baixa.

## Implementacao atual na Lara (2026-04-28)

O endpoint `POST /api/lara/pagamentos/pix` passou a suportar geracao oficial de cobranca Bradesco (`PUT /v2/cob/{txid}`) com OAuth `client_credentials`, mantendo fallback local controlado.

Configuracoes novas:

- `LARA_PIX_BRADESCO_ENABLED` (`true/false`)
- `LARA_PIX_BRADESCO_FAILFAST` (`true/false`)
- `BRADESCO_PIX_AMBIENTE` (`sandbox` ou `producao`)
- `BRADESCO_PIX_BASE_URL`
- `BRADESCO_PIX_TOKEN_URL`
- `BRADESCO_PIX_SCOPE` (opcional)
- `BRADESCO_PIX_TIMEOUT_MS`
- `BRADESCO_PIX_EXPIRACAO_SEGUNDOS`

Comportamento:

1. Se `LARA_PIX_BRADESCO_ENABLED=false`, usa payload PIX interno atual.
2. Se `LARA_PIX_BRADESCO_ENABLED=true`, tenta token OAuth + criacao de cobranca.
3. Em falha:
   - com `LARA_PIX_BRADESCO_FAILFAST=true`: retorna erro e nao gera fallback.
   - com `LARA_PIX_BRADESCO_FAILFAST=false`: registra log e usa fallback local.

Observacao importante:

- A baixa financeira em PCPREST/PCMOVCR continua condicionada a rotina homologada de conciliacao e baixa.
- Esta etapa de geracao de cobranca nao executa baixa automatica no WinThor.
