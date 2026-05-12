# Documento funcional - baixa de titulo apos confirmacao da Lara

Janela de referencia: 2026-04-10 a 2026-04-25.

## Visao geral

A baixa de titulo deve ocorrer somente depois de confirmacao positiva da Lara baseada em evidencia valida de pagamento. A PCPREST deve ser tratada como base principal de consulta do processo, mas a baixa real deve seguir a rotina oficial e homologada do ambiente WinThor/Oracle.

## Papel da Lara

A Lara nao deve baixar titulo por inferencia de conversa. O papel da Lara e:

- receber ou consultar evidencia de pagamento;
- avaliar se a confirmacao e valida;
- preservar a evidencia e o payload;
- produzir decisao `payment_confirmed = true` somente quando a regra formal for atendida;
- bloquear casos ambiguos, duplicados, divergentes ou sem dados suficientes;
- enviar ao n8n/Oracle um payload rastreavel.

## Momento da confirmacao

A confirmacao positiva exige:

- evento de pagamento ou evidencia valida;
- identificador suficiente para correlacao;
- valor compativel com o titulo ou regra formal de divergencia;
- titulo candidato sem ambiguidade;
- idempotency key nao processada;
- trilha de auditoria completa.

## Papel da PCPREST

A PCPREST e a base principal de consulta e validacao do titulo. A auditoria encontrou uso real da PCPREST para titulos abertos e estudo de baixa, mas nao encontrou rotina de baixa Lara homologada.

Regras:

- nao assumir UPDATE direto na PCPREST;
- nao inventar nomes de colunas nao confirmados;
- usar identificadores neutros ate validacao do schema;
- validar campos reais do ambiente antes de executar baixa.

## Regras de negocio obrigatorias

1. Nunca baixar titulo sem confirmacao positiva da Lara.
2. Nunca baixar o mesmo titulo duas vezes.
3. Nunca processar o mesmo evento de pagamento duas vezes.
4. Nunca baixar titulo com ambiguidade de identificacao.
5. Nunca baixar titulo com divergencia relevante de valor sem regra formal.
6. Nunca assumir UPDATE direto em tabela financeira do WinThor sem estrategia oficial.
7. Usar obrigatoriamente `codbanco = 1007` na rotina de baixa.
8. Garantir seguranca contra concorrencia, duplicidade e reprocessamento.

## Validacoes funcionais

- titulo encontrado;
- cliente correto;
- titulo elegivel;
- titulo nao cancelado;
- titulo nao baixado;
- valor compativel;
- evento de pagamento ainda nao processado;
- confirmacao valida da Lara;
- ausencia de ambiguidade;
- integridade transacional.

## Estrategia de localizacao do titulo

O matching pode considerar, conforme disponibilidade real:

- `codcli`;
- `numprest` ou identificador equivalente;
- `codcob`;
- valor;
- data;
- numero do documento;
- nosso numero;
- `txid`;
- comprovante;
- outro identificador de conciliacao.

Quando o nome exato do campo PCPREST nao estiver validado, a especificacao tecnica deve usar nomenclatura neutra.

## Papel do n8n

O n8n deve orquestrar:

- recepcao do evento confirmado;
- chamada da Lara para validacao/confirmacao;
- montagem do payload da rotina Oracle/WinThor;
- chamada da rotina homologada;
- tratamento de sucesso, recusa, duplicidade e erro;
- notificacao/log operacional.

## Papel do Oracle/WinThor

O Oracle/WinThor deve:

- validar titulo em transacao;
- bloquear concorrencia;
- aplicar idempotencia;
- registrar auditoria;
- chamar rotina oficial de baixa ou procedure homologada;
- retornar codigo padronizado para n8n.

## Casos de bloqueio

- `ERR_CONFIRMATION_NOT_VALID`
- `ERR_MISSING_REQUIRED_DATA`
- `ERR_TITLE_NOT_FOUND`
- `ERR_MULTIPLE_TITLES_FOUND`
- `ERR_TITLE_ALREADY_SETTLED`
- `ERR_TITLE_CANCELLED`
- `ERR_PAYMENT_MISMATCH`
- `ERR_DUPLICATE_EVENT`
- `ERR_CONCURRENCY_CONFLICT`
- `ERR_DB_WRITE_FAILURE`
