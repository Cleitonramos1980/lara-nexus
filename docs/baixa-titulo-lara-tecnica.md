# Especificacao tecnica - baixa de titulo Lara/Oracle/WinThor

Janela de referencia: 2026-04-10 a 2026-04-25.

## Status da auditoria

Encontrado no projeto:

- consulta de titulos em aberto na PCPREST;
- script de analise de procedure `PRC_BAIXA_TITULO`;
- endpoints Lara para pagamentos boleto/PIX/promessa;
- logs de integracao e idempotencia para webhooks;
- geracao/regeneracao de boleto WinThor com transacao e lock.

Nao encontrado:

- rotina Lara de baixa apos confirmacao;
- uso de `codbanco = 1007`;
- contrato de payload de baixa;
- retorno padronizado para n8n;
- package/procedure PL/SQL de baixa Lara homologada;
- fluxo n8n especifico de baixa.

## Payload de entrada

Arquivo exemplo: `contracts/lara-payment-confirmation-input.example.json`.

Campos obrigatorios sugeridos:

- `event_id`
- `idempotency_key`
- `payment_confirmed`
- `confirmed_by`
- `confirmation_source`
- `confirmed_at`
- `payment_method`
- `amount_paid`
- `currency`
- `codbanco`
- `candidate_title`
- `evidence`

`codbanco` deve ser sempre `1007`.

## Estrategia de matching

O matching deve ser deterministico e bloqueante:

1. Validar confirmacao positiva da Lara.
2. Validar dados minimos.
3. Validar idempotency key do evento.
4. Localizar titulo candidato na PCPREST por identificadores disponiveis.
5. Se nenhum titulo for encontrado, retornar `ERR_TITLE_NOT_FOUND`.
6. Se mais de um titulo for encontrado, retornar `ERR_MULTIPLE_TITLES_FOUND`.
7. Validar cliente, status, cancelamento, baixa anterior e valor.
8. Bloquear linha/registro com estrategia homologada.
9. Chamar rotina oficial de baixa.
10. Registrar auditoria e retorno padronizado.

## Idempotencia

Deve existir controle por:

- evento de pagamento (`event_id`);
- idempotency key calculada;
- titulo candidato;
- `txid` quando existir;
- comprovante/evidencia quando existir.

Regras:

- mesmo evento ja processado com sucesso retorna `OK_ALREADY_PROCESSED`;
- evento duplicado ainda em processamento retorna `ERR_DUPLICATE_EVENT` ou estado de lock;
- reprocessamento idempotente nao deve executar nova baixa.

## Auditoria e logs

Tabelas conceituais sugeridas:

- `LARA_PAYMENT_EVENT_IDEMPOTENCY`: controla evento, status, hash do payload e resultado.
- `LARA_SETTLEMENT_AUDIT_LOG`: registra decisao Lara, matching, retorno Oracle, codigos e evidencias.

Essas tabelas sao auxiliares do Lara. Elas nao substituem logs oficiais do WinThor.

## Retorno padronizado para n8n

Arquivo exemplo: `contracts/lara-settlement-response.example.json`.

Campos esperados:

- `success`
- `payment_confirmed`
- `title_found`
- `multiple_titles_found`
- `title_already_settled`
- `title_cancelled`
- `amount_match`
- `idempotent_replay`
- `settlement_executed`
- `codbanco_used`
- `process_status`
- `process_code`
- `message`
- `technical_details`

## Codigos esperados

- `OK_SETTLEMENT_DONE`
- `OK_ALREADY_PROCESSED`
- `ERR_TITLE_NOT_FOUND`
- `ERR_MULTIPLE_TITLES_FOUND`
- `ERR_TITLE_ALREADY_SETTLED`
- `ERR_TITLE_CANCELLED`
- `ERR_PAYMENT_MISMATCH`
- `ERR_MISSING_REQUIRED_DATA`
- `ERR_CONFIRMATION_NOT_VALID`
- `ERR_DUPLICATE_EVENT`
- `ERR_CONCURRENCY_CONFLICT`
- `ERR_DB_WRITE_FAILURE`

## Concorrencia

Riscos:

- dois webhooks processarem o mesmo pagamento;
- dois pagamentos tentarem baixar o mesmo titulo;
- timeout no n8n apos baixa bem-sucedida;
- falha de rede durante commit.

Mitigacoes:

- idempotency key unica;
- lock transacional NOWAIT ou equivalente homologado;
- commit unico na rotina Oracle;
- retorno consultavel por idempotency key;
- log antes/depois da tentativa.

## Risco de update direto

Nao foi implementado UPDATE direto em PCPREST. Qualquer baixa real deve usar:

- rotina oficial WinThor;
- procedure ja homologada pelo ambiente;
- ou package novo validado com DBA/financeiro.

## Dependencias de schema real

Pendencias obrigatorias:

- confirmar campos reais da PCPREST usados para titulo, baixa, cancelamento e banco;
- confirmar procedure oficial de baixa e seus parametros;
- confirmar como `codbanco = 1007` deve ser aplicado;
- confirmar logs oficiais requeridos pelo WinThor;
- confirmar comportamento em pagamento parcial, desconto, juros e multa;
- validar credenciais Oracle e permissoes de execucao.

## Referencia real validada no Oracle (titulo 1322007)

Em 2026-04-26 foi executado diagnostico read-only no schema `U_CC4UJM_WI` para o
titulo `1322007` (referencia informada pelo usuario). Evidencias geradas:

- `docs/oracle/referencia-baixa-titulo-1322007.md`
- `docs/oracle/referencia-baixa-titulo-1322007.json`

Resumo confirmado:

- 1 registro em `PCPREST` para `DUPLIC=1322007`, `PREST=Z`;
- `CODBANCO=1007` e `CODBANCOBAIXA=1007`;
- `DTPAG` e `DTBAIXA` preenchidos (`2026-04-15T16:00:00.000Z`);
- 1 movimento relacionado em `PCMOVCR` com:
  - `HISTORICO = BAIXA PIX DUP 1322007-Z`
  - `NUMDOC = 1322007Z-b9b82b`
  - `CODBANCO = 1007`
  - `CONCILIACAO = OK`
- 0 linhas em `PCLOGPREST` para a chave (`CODCLI`,`DUPLIC`,`PREST`) consultada.

Esse caso passa a ser baseline tecnico para homologacao da baixa com confirmacao da
Lara, mantendo as regras de idempotencia, conciliacao e uso obrigatorio de banco
`1007`.
