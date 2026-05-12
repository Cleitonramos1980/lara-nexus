# Checklist de homologacao - Lara baixa de titulo

## Ambiente e schema

- [ ] Schema real WinThor validado com DBA.
- [ ] Campos reais da PCPREST confirmados para titulo, status, cancelamento, baixa, valor e banco.
- [ ] Procedure oficial de baixa identificada e homologada.
- [ ] Estrategia para `codbanco = 1007` validada.
- [ ] Credenciais Oracle com permissoes minimas configuradas.
- [ ] Ambiente de homologacao separado de producao.

## WhatsApp e Lara

- [ ] Fluxo WhatsApp -> Lara validado.
- [ ] POST para Lara validado.
- [ ] Espera/polling validado.
- [ ] Busca da resposta validada.
- [ ] Retorno ao WhatsApp validado.
- [ ] Logs e correlation id validados.

## PIX, conciliacao e multipag

- [ ] Contrato real do webhook bancario definido.
- [ ] `txid` gerado e persistido de forma rastreavel.
- [ ] Evento com TXID presente testado.
- [ ] Evento sem identificador suficiente bloqueado.
- [ ] Valor divergente bloqueado ou tratado por regra formal.
- [ ] Evento duplicado tratado por idempotencia.
- [ ] Conciliacao inconclusiva gera revisao humana.
- [ ] Lote multipag com multiplos pagamentos testado item a item.

## Baixa de titulo

- [ ] Pagamento correto e titulo elegivel baixa com sucesso.
- [ ] Titulo ja baixado retorna `ERR_TITLE_ALREADY_SETTLED` ou `OK_ALREADY_PROCESSED` conforme caso.
- [ ] Titulo cancelado retorna `ERR_TITLE_CANCELLED`.
- [ ] Pagamento duplicado nao baixa duas vezes.
- [ ] Webhook repetido retorna replay idempotente.
- [ ] Valor divergente retorna `ERR_PAYMENT_MISMATCH`.
- [ ] Multiplos titulos encontrados retorna `ERR_MULTIPLE_TITLES_FOUND`.
- [ ] Titulo nao encontrado retorna `ERR_TITLE_NOT_FOUND`.
- [ ] Erro tecnico Oracle retorna `ERR_DB_WRITE_FAILURE`.
- [ ] Concorrencia simultanea retorna `ERR_CONCURRENCY_CONFLICT` ou replay seguro.
- [ ] Confirmacao insuficiente da Lara retorna `ERR_CONFIRMATION_NOT_VALID`.

## Retorno ao n8n

- [ ] `success` validado.
- [ ] `payment_confirmed` validado.
- [ ] `settlement_executed` validado.
- [ ] `codbanco_used = 1007` validado.
- [ ] `process_code` mapeado em todos os cenarios.
- [ ] `technical_details` preserva idempotencia, rotina e evidencia.
