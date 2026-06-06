# RELATÓRIO DE INTEGRAÇÕES — SISTEMA LARA

**Data:** 2026-06-02

---

## 1. ORACLE / WINTHOR

### Status: ✅ BEM IMPLEMENTADO

**Tabelas consultadas:**
| Tabela | Uso |
|---|---|
| PCCLIENT | Busca de cliente por telefone, CPF/CNPJ, CODCLI |
| PCPREST | Consulta de títulos em aberto (VALOR, DTVENC, DTPAG, CODCOB) |
| PCFILIAL | Lista de filiais disponíveis |

**Campos críticos validados:**
- CODCLI, DUPLICATA, PRESTACAO, VALOR, DTVENC, DTPAG, VPAGO
- CODCOB (filtro whitelist: `341`, `756`, `BK`)
- CODCOB bypass: `skipCodcobFilter: true` para exceções
- NOSSONUMBCO, CODBARRA, LINHADIG (boleto)
- DIAS_ATRASO calculado via Oracle SYSDATE
- NVL() para tratar nulls em todos os campos numéricos
- TRIM() em campos VARCHAR para evitar erros de comparação

**Segurança:**
- ✅ Bind parameters em TODAS as queries (`:codcli`, `:duplic`, etc.)
- ✅ Sem concatenação de SQL com input do usuário
- ✅ `FETCH FIRST N ROWS ONLY` para limitar resultados
- ✅ Pool de conexão gerenciado (ORACLE_POOL_MIN/MAX)
- ✅ Retry automático em falha de conexão

**Tabelas auxiliares Lara no Oracle (16 tabelas):**
LARA_CLIENTES_CACHE, LARA_TITULOS_CACHE, LARA_COB_MSG_LOG, LARA_CASES, LARA_PROMESSAS_PAGAMENTO, LARA_NEGOCIACOES, LARA_OPTOUT, LARA_REGUA_TEMPLATES, LARA_REGUA_EXECUCOES, LARA_INTEGRACOES_LOG, LARA_CONFIGURACOES, LARA_POLITICAS_NEGOCIACAO, LARA_FEEDBACK_INTERACOES, LARA_PORTAL_TOKENS, LARA_PIX_COBRANCAS, + tabela não listada (pendente)

**Problemas identificados:**
- ⚠️ CODCOB whitelist `('341','756','BK')` — verificar se lista está atualizada com todos os códigos válidos em produção
- ⚠️ `listTitulos` com `limit: 5000` pode ser pesado para clientes com muitos títulos

---

## 2. WHATSAPP (Meta Cloud API v22.0)

### Status: ❌ CONTA DEATIVADA (externo)

**Configuração:**
- WABA_ID: 1190731249535160
- Phone Number ID: 767718899756375
- API Version: v22.0
- Número: +55 92 8422-5050

**Templates (10 aprovados — todos UTILITY):**
| Template | Parâmetros | Status |
|---|---|---|
| lara_pix_disponivel | cliente, titulo, valor, horas | APPROVED |
| lara_vencimento_d3 | cliente, titulo, valor, data_vencimento | APPROVED |
| lara_aviso_vencimento_d0 | cliente, titulo, valor | APPROVED |
| lara_cobranca_d3 | cliente, titulo, valor | APPROVED |
| lara_cobranca_d7 | cliente, valor_total | APPROVED |
| lara_cobranca_d15 | cliente, valor_total | APPROVED |
| lara_cobranca_d30 | cliente, valor_total | APPROVED |
| lara_pix_confirmado | cliente, valor, titulo | APPROVED |
| lara_promessa_confirmada | cliente, valor, data | APPROVED |
| lara_boleto_gerado | cliente, titulo, valor, vencimento, linha_digitavel | APPROVED |

**Funcionalidades implementadas:**
- ✅ Envio de templates (enviarTemplateEtapa)
- ✅ Envio de mensagens de texto livre (sendTextMessage — reativo)
- ✅ Dedup guard 10 min por número+template (in-memory)
- ✅ Retry com backoff (3 tentativas, delay 500ms × attempt)
- ✅ Split de mensagem longa em 2 partes (texto + código PIX)
- ✅ Webhook Meta GET (challenge-response)
- ✅ Webhook Meta POST (processa inbound + status de entrega)
- ✅ Suporte a tipos: text, interactive, image, document, audio, location
- ✅ ACOES_SEM_REPLY para ações que não devem gerar resposta automática

**Problemas:**
- ❌ Conta DEACTIVATED por Meta (name_status: DECLINED + violação de política)
- ❌ Quality score UNKNOWN em todos os templates (nunca entregues)
- ⚠️ WHATSAPP_APP_SECRET não configurado — webhook sem validação HMAC
- ⚠️ Dedup in-memory reseta no restart do servidor

---

## 3. N8N

### Status: ⚠️ DOCUMENTADO, NÃO EMBARCADO

Os workflows n8n estão documentados em `docs/n8n/` como JSONs exportados, mas o n8n roda como instância cloud externa.

**Workflows documentados:**
| Arquivo | Propósito |
|---|---|
| n8n-cloud-2.13.3-lara-whatsapp-all-3-workflows.json | Bundle dos 3 workflows |
| n8n-cloud-2.13.3-lara-whatsapp-inbound.json | Processamento de mensagens inbound |
| n8n-cloud-2.13.3-lara-whatsapp-polling-reconstruido.json | Polling de mensagens |
| n8n-cloud-2.13.3-lara-whatsapp-single-callback.json | Callback único |
| n8n-cloud-2.13.3-lara-whatsapp-status.json | Status de mensagens |
| whatsapp-to-lara-system-message-orchestration-ok-hardened.json | Orquestração principal |

**Integração n8n ↔ Backend Lara:**
- n8n usa `POST /api/lara/atendimentos/processar-mensagem` para inbound
- n8n usa `POST /api/lara/orquestracao/mensagens` para fluxo assíncrono
- Backend expõe `GET /api/lara/orquestracao/respostas` para polling

**Problemas:**
- ⚠️ Workflows n8n não têm versão no código — dependem de instância cloud externa
- ⚠️ Sem documentação de variáveis de ambiente n8n necessárias
- ⚠️ Endpoint `/api/lara/atendimentos/processar-mensagem` sem autenticação (coberto por BUG-001)

---

## 4. BOLETO (WINTHOR)

### Status: ✅ IMPLEMENTADO

**Funcionalidades:**
- `consultarBoletoWinthor` — consulta dados do boleto (NOSSONUMBCO, CODBARRA, LINHADIG)
- `gerarOuRegenerarBoletoWinthor` — gera ou regenera boleto via Oracle
- `prorrogarTituloWinthor` — prorroga vencimento do título

**Campos validados:**
- CODCOB, CODBANCOCM, NUMDIASPRAZOPROTESTO
- NOSSONUMBCO, CODBARRA, LINHADIG (linha digitável)
- VALOR, DTVENC

**Endpoints expostos:**
- `POST /api/lara/winthor/boleto/consultar`
- `POST /api/lara/winthor/boleto/gerar`
- `POST /api/lara/winthor/titulo/prorrogar`

**Observações:**
- ⚠️ Geração de boleto real depende de Oracle em produção — não testável em sandbox
- ✅ Idempotência via `correlation_id` no gerarBoletoWinthor

---

## 5. PIX (BRADESCO)

### Status: ✅ IMPLEMENTADO (mTLS configurado)

**Configuração:**
- Modo: producao
- Chave PIX: financeiro2@rodriguescolchoes.com.br
- Client ID/Secret: configurados
- mTLS: certificados configurados (`./certs/bradesco-cert.pem`, `bradesco-key.pem`, `bradesco.pfx`)
- Passphrase: configurada
- Expiração QR: 86400s (24h)
- Timeout: 15000ms

**Funcionalidades:**
- ✅ Geração de PIX QR dinâmico via API Bradesco
- ✅ Confirmação de pagamento via webhook Bradesco
- ✅ Reconciliação de PIX
- ✅ Validação de assinatura com `BRADESCO_PIX_WEBHOOK_SECRET`
- ✅ Baixa automática de título após confirmação PIX (`LARA_PIX_AUTO_BAIXA_HABILITADO`)
- ✅ Fallback interno para PIX sem Bradesco (quando `LARA_PIX_BRADESCO_ENABLED=false`)

**Proteção de duplicidade:**
- ✅ `UX_LARA_PIX_TXID_DUP` — índice único em (TXID, DUPLICATA)
- ✅ Guard contra PIX R$0 no promiseFollowupScheduler

**BolePix (Bradesco):**
- Configurado mas `LARA_BOLEPIX_BRADESCO_ENABLED=false` (aguardando certificado ICP-Brasil)
- API implementada: gerar, alterar, consultar, listar, baixar, webhook

---

## 6. HISTÓRICO / WEBHOOKS

### Status: ✅ BEM IMPLEMENTADO

**Webhooks expostos:**
| Webhook | Auth | Rate Limit |
|---|---|---|
| POST /api/lara/webhook/meta | HMAC (inativo, sem APP_SECRET) | ✅ por waId |
| POST /api/lara/webhooks/whatsapp-inbound | Nenhuma | ✅ por waId/tenantId |
| POST /api/lara/webhooks/whatsapp-status | Nenhuma | ✅ por waId |
| POST /api/lara/webhooks/regua-resultado | Nenhuma | ✅ por IP |
| POST /api/lara/bradesco/pix/webhook | ✅ Secret header | ✅ por IP |
| POST /api/lara/bradesco/bolepix/webhook/pagamento | Nenhuma | ✅ por IP |

**Histórico registrado:**
- LARA_COB_MSG_LOG — todas as mensagens inbound/outbound
- LARA_CASES — cases e escalações
- LARA_PROMESSAS_PAGAMENTO — promessas registradas
- LARA_NEGOCIACOES — negociações com status
- LARA_OPTOUT — registros de opt-out
- LARA_REGUA_EXECUCOES — disparos da régua
- LARA_INTEGRACOES_LOG — todas as chamadas externas
- LARA_FEEDBACK_INTERACOES — feedback de cada interação

**Problemas:**
- ⚠️ Webhooks whatsapp-inbound e regua-resultado sem validação de assinatura
- ⚠️ Histórico de alterações de políticas de negociação não implementado
