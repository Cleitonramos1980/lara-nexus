# Auditoria e reconstrucao - Lara Agente de Cobranca

Janela principal: 2026-04-10 a 2026-04-25.

## 1. Resumo executivo

Foi realizada auditoria local no projeto Lara Agente de Cobranca para validar evidencias sobre WhatsApp/n8n, PIX, conciliacao, multipag e baixa de titulo Oracle/WinThor com PCPREST.

Resultado geral:

- WhatsApp/n8n: PARCIAL. Existem workflows e endpoints, mas o fluxo encontrado trabalha com resposta imediata, sem etapa explicita de espera/polling e busca separada.
- PIX: PARCIAL. Existe envio/configuracao de PIX, mas nao existe TXID, evento bancario ou conciliacao PIX.
- Conciliacao bancaria: PARCIAL. Existe conciliacao em modulo de auditoria de cartao, mas nao aplicada ao fluxo PIX/Lara/baixa.
- Multipag: AUSENTE. Nao foram encontradas referencias a multipag/lote financeiro do Lara.
- Baixa PCPREST apos confirmacao Lara: PARCIAL. Existem scripts de analise/consulta PCPREST e integracoes WinThor de boleto/prorrogacao, mas nao existe rotina de baixa confirmada pela Lara, nem `codbanco = 1007`.

Foram criados documentos, contratos, workflows conceituais/importaveis e esqueleto PL/SQL para deixar o projeto pronto para continuidade, sem fingir integracao real inexistente.

## 2. Itens dos ultimos 15 dias identificados

1. Refinamento do fluxo WhatsApp <-> Lara com envio, espera, busca e retorno.
2. Estudo/base de PIX, TXID, conciliacao bancaria e multipag.
3. Especificacao de baixa de titulo Oracle/WinThor apos confirmacao positiva da Lara.
4. Uso da PCPREST como base principal de consulta.
5. Obrigatoriedade de `codbanco = 1007`.
6. Idempotencia, auditoria, concorrencia, duplicidade e retorno padronizado para n8n.

## 3. Evidencias encontradas no projeto

### WhatsApp/n8n

Arquivos encontrados:

- `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-single-callback.json`
- `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-uazapi-single-webhook.json`
- `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-inbound.json`
- `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-status.json`
- `lara-whatsapp-single-callback.json`
- `lara-whatsapp-uazapi-single-webhook.json`

Evidencia tecnica:

- webhook de callback WhatsApp/Uazapi;
- normalizacao de payload;
- POST para `/api/lara/webhooks/whatsapp-inbound`;
- POST para `/api/lara/webhooks/whatsapp-status`;
- envio de resposta ao WhatsApp/Graph ou Uazapi;
- validacoes de importacao em `docs/n8n/validation-report-*.txt`.

Lacuna:

- nao havia node separado de espera/polling;
- nao havia node separado de busca posterior da resposta;
- nomes dos nodes nao batiam com a memoria funcional de 2026-04-10.

Classificacao: PARCIAL.

### Backend Lara

Arquivos encontrados:

- `backend/src/routes/lara.ts`
- `backend/src/modules/lara/service.ts`
- `backend/src/modules/lara/schemas.ts`
- `backend/src/modules/lara/oracleRepository.ts`
- `backend/migrations/20260406_lara_schema.sql`

Evidencia tecnica:

- `POST /api/lara/webhooks/whatsapp-inbound`;
- `POST /api/lara/webhooks/whatsapp-status`;
- `GET /api/lara/conversas/:waId`;
- `POST /api/lara/pagamentos/boleto`;
- `POST /api/lara/pagamentos/pix`;
- `POST /api/lara/pagamentos/promessa`;
- logs de integracao e idempotencia para webhooks;
- cache de clientes/titulos Lara.

Classificacao: PARCIAL para fluxo assincrono; COMPLETO para base operacional atual de mensagens.

### PIX

Arquivos encontrados:

- `src/pages/lara/LaraConfiguracoes.tsx`
- `src/pages/lara/LaraTitulos.tsx`
- `src/pages/lara/LaraConversas.tsx`
- `src/services/laraApi.ts`
- `backend/src/routes/lara.ts`
- `backend/src/modules/lara/service.ts`
- `backend/migrations/20260406_lara_schema.sql`

Evidencia tecnica:

- chave PIX configuravel;
- endpoint de envio de PIX;
- acao de UI para enviar PIX;
- mensagem de conversa com tipo `pix`;
- configuracao `LARA_PIX_CHAVE`.

Lacuna:

- nao havia `txid`;
- nao havia webhook bancario;
- nao havia conciliacao PIX;
- nao havia contrato de evento financeiro.

Classificacao: PARCIAL.

### Conciliacao

Arquivos encontrados:

- `backend/src/modules/auditoriaCartao/*`
- `backend/src/routes/auditoriaCartao.ts`
- `backend/scripts/test-auditoria-cartao-*.ts`

Evidencia tecnica:

- conciliacao de auditoria de cartao;
- statuses como conciliado, divergente, duplicidade e pendente;
- testes de matching.

Lacuna:

- nao estava ligada ao fluxo PIX/Lara/baixa;
- nao havia trilha de conciliacao bancaria por evento PIX/TXID.

Classificacao: PARCIAL.

### Multipag

Evidencia encontrada: nenhuma referencia objetiva a multipag, pagamento em lote ou lote financeiro do Lara.

Classificacao: AUSENTE.

### PCPREST, WinThor e baixa

Arquivos encontrados:

- `backend/scripts/analise-baixa-pcprest.ts`
- `backend/scripts/consulta-pcprest-abertos.ts`
- `backend/src/modules/lara/oracleRepository.ts`
- `backend/src/routes/lara.ts`

Evidencia tecnica:

- script para analisar procedure `PRC_BAIXA_TITULO`;
- consulta de titulos em aberto na PCPREST;
- uso de PCPREST para sincronizar titulos abertos;
- geracao/regeneracao de boleto WinThor;
- prorrogacao de titulo WinThor com transacao e lock.

Lacuna:

- nao existe rotina de baixa Lara apos confirmacao positiva;
- nao existe `codbanco = 1007`;
- nao existe contrato de payload de baixa;
- nao existe retorno padronizado para n8n;
- nao existe package/procedure Lara homologada;
- nao existe workflow n8n especifico de baixa confirmada.

Classificacao: PARCIAL.

## 4. Itens ausentes

- Documento funcional do fluxo WhatsApp <-> Lara com espera/busca.
- Workflow n8n com nomes exatamente alinhados ao fluxo de 2026-04-10.
- Documento tecnico de PIX/TXID/conciliacao/multipag.
- Contrato de evento financeiro de confirmacao.
- Contrato de retorno de baixa.
- Documento funcional de baixa de titulo.
- Documento tecnico de baixa de titulo.
- Prompt tecnico definitivo de continuidade.
- Esqueleto PL/SQL seguro sem UPDATE direto em PCPREST.
- Fluxo n8n conceitual de baixa apos confirmacao.
- Checklist de homologacao e cenarios de teste.

## 5. Itens criados

- `docs/README.md`
- `docs/whatsapp-lara-fluxo-funcional.md`
- `docs/pagamentos-pix-conciliacao-multipag.md`
- `docs/baixa-titulo-lara-funcional.md`
- `docs/baixa-titulo-lara-tecnica.md`
- `docs/contracts/lara-payment-confirmation-input.example.json`
- `docs/contracts/lara-settlement-response.example.json`
- `docs/oracle/lara_baixa_titulo_pkg_skeleton.sql`
- `docs/n8n/n8n-cloud-2.13.3-lara-whatsapp-polling-reconstruido.json`
- `docs/n8n/lara-whatsapp-polling-reconstruido-README.md`
- `docs/n8n/lara-baixa-titulo-pos-confirmacao-conceitual.json`
- `docs/prompts/prompt-tecnico-baixa-titulo-lara.md`
- `docs/homologacao-lara-baixa-titulo-checklist.md`

## 6. Itens ajustados

Nao houve alteracao em codigo de producao ou workflows existentes para evitar regressao operacional. A normalizacao foi feita por novos artefatos paralelos e por um indice documental.

Ajustes logicos realizados:

- nomenclatura normalizada dos nodes no novo workflow WhatsApp;
- separacao explicita entre envio, espera, busca e resposta;
- criacao de retorno padronizado para n8n;
- fixacao documental de `codbanco = 1007`;
- formalizacao de riscos e pendencias.

## 7. Arquivos modificados ou criados

Criados:

- todos os arquivos listados na secao 5.

Modificados:

- nenhum arquivo preexistente de codigo/producao.

## 8. Riscos e dependencias

- Schema real da PCPREST ainda precisa ser validado.
- Procedure oficial/homologada de baixa precisa ser confirmada.
- Nao ha credencial Oracle real registrada para homologar a baixa.
- Nao ha endpoint bancario PIX real.
- Nao ha contrato real de webhook bancario.
- Endpoint `/api/lara/winthor/baixa-titulo/confirmada` ainda nao existe; ele foi modelado no workflow conceitual como ponto futuro.
- `codbanco = 1007` foi documentado e colocado nos contratos, mas nao pode ser validado em baixa real sem rotina homologada.
- Multipag ainda e arquitetura conceitual.

## 9. Recomendacoes

1. Homologar schema PCPREST e rotina oficial de baixa com DBA/financeiro.
2. Criar endpoint backend dedicado para baixa confirmada somente depois da definicao da rotina Oracle.
3. Criar endpoint de polling/resposta do Lara caso o modelo assincrono seja obrigatorio.
4. Definir provedor bancario e contrato real de PIX/TXID.
5. Implementar tabela auxiliar de idempotencia e auditoria para eventos financeiros.
6. Testar todos os cenarios do checklist antes de producao.
7. Manter workflows antigos ate o novo fluxo ser importado e validado no n8n.

## 10. Diferenca entre o que foi discutido e o que existe de fato

Discutido e agora documentado:

- fluxo WhatsApp com espera e busca separadas;
- arquitetura PIX/TXID/conciliacao/multipag;
- baixa de titulo apos confirmacao positiva;
- `codbanco = 1007`;
- idempotencia e retorno padronizado.

Existia de fato antes desta auditoria:

- backend Lara operacional;
- workflows WhatsApp/Uazapi com POST para Lara e envio de resposta imediata;
- endpoints de boleto, PIX e promessa;
- logs/idempotencia para webhooks;
- scripts de consulta/analise PCPREST;
- integracoes WinThor para boleto/prorrogacao.

Nao existia de fato antes desta auditoria:

- workflow com espera/polling e busca separada;
- TXID/conciliacao PIX/multipag;
- contrato de evento financeiro;
- contrato de retorno de baixa;
- baixa Lara confirmada;
- uso de `codbanco = 1007`;
- PL/SQL Lara de baixa;
- workflow n8n de baixa confirmada;
- checklist formal de homologacao.
