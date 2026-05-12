# Playbook operacional - baixa apos pagamento PIX (Lara + n8n + Oracle/WinThor)

Data base: 2026-04-26.

## 1) Objetivo

Salvar o processo operacional padrao para baixa de titulo apos pagamento PIX,
usando Lara como confirmador de pagamento, n8n como orquestrador e Oracle/WinThor
como camada oficial de baixa.

Este playbook deve ser usado como referencia unica para evolucao e operacao.

## 2) Baseline real validada

Caso de referencia confirmado no Oracle: titulo `1322007`.

Evidencias:

- `docs/oracle/referencia-baixa-titulo-1322007.md`
- `docs/oracle/referencia-baixa-titulo-1322007.json`

Resumo validado:

- `PCPREST`: 1 linha (`DUPLIC=1322007`, `PREST=Z`, `CODBANCO=1007`, `CODBANCOBAIXA=1007`);
- `DTPAG` e `DTBAIXA` preenchidos;
- `PCMOVCR`: 1 movimento com `HISTORICO=BAIXA PIX DUP 1322007-Z`,
  `NUMDOC=1322007Z-b9b82b`, `CONCILIACAO=OK`, `CODBANCO=1007`;
- `PCLOGPREST`: sem linha para a chave consultada.

Conclusao de baseline:

- baixa PIX valida deve refletir em `PCPREST` e `PCMOVCR`;
- `codbanco=1007` e obrigatorio no processo alvo.

## 3) Entradas minimas obrigatorias

Payload de entrada padrao:

- `docs/contracts/lara-payment-confirmation-input.example.json`

Campos criticos:

- `event_id`
- `idempotency_key`
- `payment_confirmed=true`
- `payment_method=PIX`
- `txid` e/ou `end_to_end_id`
- `amount_paid`
- `codbanco=1007`
- dados de identificacao do titulo (`codcli`, `duplicata/prest` ou correlatos)

## 4) Saida padrao obrigatoria

Payload de retorno padrao:

- `docs/contracts/lara-settlement-response.example.json`

Campos minimos para n8n:

- `success`
- `settlement_executed`
- `codbanco_used`
- `process_status`
- `process_code`
- `message`
- `technical_details`

## 5) Fluxo operacional (passo a passo)

1. Receber webhook/evento PIX no n8n.
2. Validar segredo/autenticacao do webhook (sem bypass).
3. Normalizar payload (`txid`, `end_to_end_id`, valor, horario, tenant, event_id).
4. Enviar para Lara validar confirmacao de pagamento.
5. Lara validar idempotencia inicial por `event_id/idempotency_key`.
6. Lara localizar titulo alvo na `PCPREST` com estrategia deterministica.
7. Bloquear processo em caso de ambiguidade, divergencia de valor ou titulo inelegivel.
8. Executar rotina oficial de baixa no Oracle/WinThor (sem update direto ad-hoc).
9. Validar efeito pos-baixa:
   - `PCPREST` com baixa aplicada;
   - `PCMOVCR` com movimento coerente e conciliacao.
10. Registrar auditoria tecnica e funcional.
11. Retornar status padronizado ao n8n.
12. n8n tratar sucesso, duplicidade e erro com logs persistentes.

## 6) Regras obrigatorias de seguranca e negocio

1. Nunca baixar sem `payment_confirmed=true`.
2. Nunca baixar o mesmo evento duas vezes (idempotencia).
3. Nunca baixar o mesmo titulo duas vezes.
4. Nunca baixar com identificacao ambigua.
5. Nunca baixar com divergencia de valor sem regra formal aprovada.
6. Nunca usar update direto em tabela financeira sem estrategia homologada.
7. Sempre usar `codbanco=1007` no processo de baixa PIX.
8. Sempre manter trilha de auditoria e correlacao (`event_id`, `txid`, `end_to_end_id`).

## 7) Validacoes funcionais minimas antes da baixa

- titulo encontrado unicamente;
- cliente correto;
- titulo elegivel;
- titulo nao cancelado;
- titulo nao baixado;
- valor compativel;
- evento nao processado anteriormente;
- confirmacao valida da Lara;
- lock transacional aplicado.

## 8) Verificacoes pos-baixa (check rapido)

- `PCPREST`: baixa/pagamento refletidos;
- `PCMOVCR`: movimento de baixa com historico coerente;
- retorno para n8n com `process_code` correto;
- idempotencia registrada para replays futuros.

## 9) Consultas de diagnostico (read-only)

Observacao: adaptar filtros conforme identificador real do evento.

```sql
-- 1) titulo na PCPREST
SELECT
  p.CODCLI, p.DUPLIC, p.PREST, p.NUMTRANS, p.NUMTRANSVENDA,
  p.CODBANCO, p.CODBANCOBAIXA, p.DTPAG, p.DTBAIXA,
  p.VALOR, p.VPAGO, p.CODCOB, p.CODCOBORIG, p.STATUS
FROM U_CC4UJM_WI.PCPREST p
WHERE TRIM(TO_CHAR(p.DUPLIC)) = :titulo;
```

```sql
-- 2) movimento relacionado na PCMOVCR
SELECT
  m.NUMTRANS, m.CODCLI, m.CODFILIAL, m.VALOR, m.CODBANCO,
  m.CONCILIACAO, m.HISTORICO, m.NUMDOC, m.DATACOMPLETA, m.DATA
FROM U_CC4UJM_WI.PCMOVCR m
WHERE m.CODCLI = :codcli
  AND UPPER(NVL(m.HISTORICO, '')) LIKE :historico_like
ORDER BY m.DATACOMPLETA DESC;
```

## 10) Automacao reutilizavel ja salva no projeto

Script para gerar referencia tecnica por titulo:

- `backend/scripts/referencia-baixa-titulo.ts`

Comando:

```powershell
& 'C:\Users\cleit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  node_modules\tsx\dist\cli.mjs scripts\referencia-baixa-titulo.ts 1322007
```

Saidas geradas:

- `docs/oracle/referencia-baixa-titulo-<titulo>.md`
- `docs/oracle/referencia-baixa-titulo-<titulo>.json`

## 11) Pendencias para producao

- validar endpoint produtivo fixo (sem tunnel temporario);
- validar segredo real do webhook PIX;
- validar API key real (sem placeholder);
- validar rotina oficial de baixa homologada com DBA/Financeiro;
- validar observabilidade/alerta operacional em falhas.

