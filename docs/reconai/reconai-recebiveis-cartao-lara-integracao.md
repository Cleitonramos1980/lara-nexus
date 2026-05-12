# RECONAI no Lara - Recebiveis Cartao WinThor

Origem: modulo `quality-navigator` (importado em 2026-04-26).

## Objetivo

Consolidar no projeto Lara o estudo de recebiveis de cartao baseado nas tabelas
WinThor:

- `PCCOB`
- `PCPEDC`
- `PCPEDI`
- `PCFILIAL`
- `PCPLPAG`

## Artefatos trazidos para este projeto

- Estudo funcional/tecnico:
  - `docs/reconai/reconai-recebiveis-cartao-winthor.md`
- SQL base de apoio:
  - `backend/scripts/sql/recebiveis_cartao_winthor.sql`

## Resumo tecnico para a Lara

1. Relacionamentos de negocio validados:
   - `PCPEDC.NUMPED = PCPEDI.NUMPED`
   - `PCPEDC.CODCOB = PCCOB.CODCOB`
   - `PCPEDC.CODFILIAL = PCFILIAL.CODIGO`
   - `PCPEDC.CODPLPAG = PCPLPAG.CODPLPAG`
2. Filtro principal para venda faturada:
   - `PCPEDC.POSICAO = 'F'` com item faturado em `PCPEDI.POSICAO = 'F'`.
3. Base de agenda prevista:
   - configuracoes por cobranca/plano e geracao idempotente por parcela.
4. Inconsistencias criticas:
   - venda faturada sem agenda;
   - agenda para pedido nao faturado;
   - divergencia cabecalho x itens;
   - cobranca/plano sem configuracao ativa.

## Como usar no fluxo Lara

- Usar esse estudo como entrada para criar/validar endpoints Lara de conciliacao de
  recebiveis de cartao.
- Reutilizar as consultas do SQL importado como camada de diagnostico (read-only)
  antes de qualquer automacao de escrita.
- Manter idempotencia e trilha de auditoria para geracao de agenda e reconciliacao.

## Pendencias para evolucao

- Definir se os endpoints de recebiveis cartao serao incorporados no backend Lara
  atual ou mantidos como modulo externo.
- Homologar regras de escrita em estruturas auxiliares no ambiente Oracle alvo.
- Definir monitoramento operacional (erros, atrasos, divergencias por filial e por
  cobranca).

