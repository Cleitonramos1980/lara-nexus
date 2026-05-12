# RECONAI - Recebiveis Cartao WinThor (PCCOB/PCPEDC/PCPEDI/PCFILIAL/PCPLPAG)

## 1) Mapeamento tecnico (schema real validado)

Inspecao executada em `2026-04-26` no schema `U_CC4UJM_WI` (Oracle `CC4UJM_204716_W_high.paas.oracle.com`).

### Tabelas encontradas
- `PCCOB` (111 colunas)
- `PCPEDC` (522 colunas)
- `PCPEDI` (471 colunas)
- `PCFILIAL` (468 colunas)
- `PCPLPAG` (72 colunas)

Tabela `PEPEDI` **nao existe** no schema atual (`ORA-00942`).

### Campos principais validados

#### PCCOB
- `CODCOB` (PK)
- `COBRANCA`
- `CARTAO`
- `CODOPERADORACARTAO`
- `TIPOOPERACAOTEF`
- `TIPOPAGTOECF`
- `CODBANDEIRA`, `BANDEIRACARTAO`
- `DTCADASTRO`, `DTULTALTER`

Substituicao relevante:
- Campo de status ativo/inativo nao existe. A ativacao operacional foi modelada em `RC_CFG_COBRANCA_CARTAO.ATIVO`.

#### PCPEDC (cabecalho pedido)
- `NUMPED` (PK)
- `CODFILIAL`
- `CODCLI`
- `DATA`, `DTFAT`
- `POSICAO`
- `VLTOTAL`
- `CODCOB`
- `CODPLPAG`
- `NUMNOTA`
- `NSU`, `CODAUTORIZACAO`
- `QTPARCELAS`, `PRAZO1..PRAZO12`

#### PCPEDI (itens pedido)
- PK composta: `NUMPED`, `CODPROD`, `NUMSEQ`
- `QT`, `PVENDA`
- `POSICAO`
- `CODPLPAG`, `PRAZOMEDIO`

Substituicoes relevantes:
- `CODFILIAL` nao existe em PCPEDI -> usar `PCPEDC.CODFILIAL`.
- `CODCOB` nao existe em PCPEDI -> usar `PCPEDC.CODCOB`.
- `NUMNOTA` nao existe em PCPEDI -> usar `PCPEDC.NUMNOTA`.

#### PCFILIAL
- `CODIGO` (PK)
- `RAZAOSOCIAL`, `FANTASIA`
- `CGC`
- `CIDADE`, `UF`
- `DTCADASTRO`, `DTULTALTER`

Substituicao relevante:
- campo de ativo/inativo nao encontrado.

#### PCPLPAG
- `CODPLPAG` (PK)
- `DESCRICAO`
- `STATUS`
- `NUMDIAS`
- `NUMPARCELAS`
- `NUMDIASCARTAO`, `NUMDIASCARENCIA`, `DIASCARENCIA`, `DIAFIXO`
- `PRAZO1..PRAZO12`
- `CODCOB`, `CODFILIAL`

## 2) Relacionamentos usados no modulo

- `PCPEDC.NUMPED = PCPEDI.NUMPED`
- `PCPEDC.CODCOB = PCCOB.CODCOB`
- `PCPEDC.CODFILIAL = PCFILIAL.CODIGO`
- `PCPEDC.CODPLPAG = PCPLPAG.CODPLPAG`

Observacao: o schema nao possui FKs declaradas nessas tabelas; joins sao de regra de negocio.

## 3) Base SQL de vendas faturadas (view)

Criada/atualizada automaticamente:
- `VW_VENDAS_CARTAO_FATURADAS`

Regras:
- considera pedidos com `PCPEDC.POSICAO = 'F'`
- exige existencia de item faturado (`PCPEDI.POSICAO = 'F'`)
- calcula divergencia cabecalho x itens por tolerancia (`0.01`)

## 4) Estruturas auxiliares criadas

- `RC_CFG_COBRANCA_CARTAO`
  - mapeia `CODCOB` que entra no modulo de cartao
  - permite tipo, ativo/inativo, taxa e dias default
- `RC_CFG_PLPAG_CARTAO`
  - regra complementar de parcelamento/prazo por `CODPLPAG`
- `RC_RECEBIVEL_CARTAO_PREV`
  - agenda prevista por parcela
  - status inicial `PREVISTO`
  - origem `VENDA_ERP`
  - chave de nao duplicidade em (`NUMPED`,`CODFILIAL`,`CODCOB`,`PARCELA`)

## 5) Rotina de geracao da agenda

Endpoint:
- `POST /api/winthor/cartao/recebiveis/gerar`

Fluxo:
1. busca vendas faturadas no periodo;
2. filtra somente `CODCOB` ativos em `RC_CFG_COBRANCA_CARTAO`;
3. resolve parcelas por prioridade:
   - `PRAZO1..PRAZO12` do pedido;
   - `PRAZO1..PRAZO12` do plano;
   - configuracao complementar `RC_CFG_PLPAG_CARTAO`;
   - fallback com `NUMDIAS/NUMDIASCARTAO`;
4. distribui valor em parcelas com arredondamento;
5. calcula taxa/liquido previsto por parcela;
6. faz `MERGE` em `RC_RECEBIVEL_CARTAO_PREV` (idempotente).

## 6) Queries de inconsistencias

Endpoint:
- `GET /api/winthor/cartao/inconsistencias`

Entregas de confronto:
- pedidos faturados cartao sem agenda prevista;
- pedidos nao faturados indevidamente presentes na agenda;
- divergencia cabecalho (`PCPEDC.VLTOTAL`) vs soma de itens (`PCPEDI.QT*PVENDA`);
- `CODCOB` de cartao usado em venda sem configuracao ativa;
- `CODPLPAG` usado em venda de cartao sem regra ativa;
- vendas vs recebiveis previstos por:
  - filial
  - cobranca (`CODCOB`)
  - plano (`CODPLPAG`)

## 7) Endpoints novos

- `GET /api/winthor/cartao/schema`
- `GET /api/winthor/cartao/vendas-faturadas`
- `GET /api/winthor/cartao/config/cobrancas`
- `POST /api/winthor/cartao/config/cobrancas/bootstrap`
- `PUT /api/winthor/cartao/config/cobrancas/:codcob`
- `GET /api/winthor/cartao/config/planos`
- `POST /api/winthor/cartao/config/planos/bootstrap`
- `PUT /api/winthor/cartao/config/planos/:codplpag`
- `POST /api/winthor/cartao/recebiveis/gerar`
- `GET /api/winthor/cartao/recebiveis`
- `GET /api/winthor/cartao/inconsistencias`

## 8) Testes recomendados (criterios de aceite)

Executar no minimo:
1. venda cartao credito a vista;
2. venda cartao debito;
3. venda cartao parcelado;
4. pedido faturado (`POSICAO='F'`);
5. pedido nao faturado (nao deve entrar);
6. divergencia cabecalho x itens;
7. plano sem regra ativa;
8. `CODCOB` sem configuracao ativa.

## 9) Evidencia de dados reais (amostra do schema)

- `PCPEDC.POSICAO='F'`: 233.977 pedidos
- `PCPEDI.POSICAO='F'`: 382.614 itens
- `PCCOB.CARTAO='S'`: 14 codigos
- `PCPLPAG.STATUS='A'`: 20 planos
- `PEPEDI`: inexistente no schema atual

