# CHECKLIST FUNCIONAL — SISTEMA LARA

**Data:** 2026-06-02

Legenda: ✅ OK | ❌ Falhou | ⚠️ Parcial | 🔲 Não testado

---

## BUILD E QUALIDADE DE CÓDIGO

| # | Item | Status | Observação |
|---|---|---|---|
| 1 | npm run build (frontend) | ✅ OK | 6.08s, 2574 módulos |
| 2 | npm run lint | ⚠️ Parcial | 0 erros, 13 warnings |
| 3 | TypeScript frontend (tsc --noEmit) | ✅ OK | 0 erros |
| 4 | TypeScript backend (tsc --noEmit) | ✅ OK | 0 erros |
| 5 | Testes frontend (vitest) | ⚠️ Parcial | 1/1 — apenas 1 teste trivial |
| 6 | Testes backend (test:lara) | ✅ OK | 24/24 passando |
| 7 | Testes E2E (Playwright) | 🔲 Não testado | Configurado, sem testes implementados |
| 8 | Dependências vulneráveis | 🔲 Não testado | npm audit não executado |
| 9 | Bundle size aceitável | ❌ Falhou | 1,014KB — acima do limite de 500KB |

---

## FRONTEND — ESTRUTURA E NAVEGAÇÃO

| # | Item | Status | Observação |
|---|---|---|---|
| 10 | App.tsx sem erros de importação | ✅ OK | |
| 11 | 19 rotas registradas | ✅ OK | |
| 12 | Redirecionamento / → /lara/dashboard | ✅ OK | |
| 13 | Rota 404 (NotFound) | ✅ OK | |
| 14 | LaraLayout envolvendo todas as páginas | ✅ OK | |
| 15 | LaraSidebar presente | ✅ OK | |
| 16 | LaraFiliaisProvider global | ✅ OK | |
| 17 | React Query configurado | ✅ OK | |
| 18 | Toasters configurados (Sonner + Radix) | ✅ OK | |

---

## COMPONENTES GLOBAIS LARA

| # | Item | Status | Observação |
|---|---|---|---|
| 19 | LaraLayout | ✅ OK | |
| 20 | LaraPageContainer | ✅ OK | |
| 21 | PageHeader | ✅ OK | |
| 22 | CardKPI | ✅ OK | |
| 23 | EmptyState | ✅ OK | |
| 24 | StatusBadge | ✅ OK | |
| 25 | TableSkeleton | ✅ OK | |
| 26 | LaraPermissionGate / DisabledTooltip | ✅ OK | UI implementada |
| 27 | LaraRestrictedState | ✅ OK | |
| 28 | LaraSensitiveText | ✅ OK | |
| 29 | sensitive.ts (maskSensitiveText) | ✅ OK | Mascara CPF/CNPJ/email/telefone |
| 30 | formatters.ts | ✅ OK | formatMoneyBRL, formatPercentBR, etc. |
| 31 | permissions.ts (canAccess/canAction) | ❌ FALHOU | Sempre retorna true — RBAC não implementado |

---

## ROTA CRÍTICA /lara/negociacao

| # | Item | Status | Observação |
|---|---|---|---|
| 32 | Página abre sem erro | ✅ OK | LaraNegociacaoConfig.tsx |
| 33 | Layout padrão Lara | ✅ OK | LaraLayout + LaraPageContainer |
| 34 | PageHeader com título e ações | ✅ OK | |
| 35 | KPIs (4 cards) | ✅ OK | Políticas, Desconto, Parcelamento, Entrada |
| 36 | Loading state (skeleton) | ✅ OK | TableSkeleton |
| 37 | Error state (alert destrutivo) | ✅ OK | Alert variant="destructive" |
| 38 | Empty state ao não editar | ✅ OK | EmptyState "Selecione uma etapa" |
| 39 | Tabela de políticas por etapa | ✅ OK | 6 etapas (D-3 a D+30) |
| 40 | Formulário de edição | ✅ OK | Desconto, entrada, parcelas, status |
| 41 | Confirmação antes de salvar | ✅ OK | AlertDialog com diff de campos |
| 42 | Tab Descontos | ✅ OK | Cards por etapa com barra visual |
| 43 | Tab Parcelamento | ✅ OK | Cards por etapa |
| 44 | Tab Alçadas | ⚠️ Parcial | EmptyState — não implementado |
| 45 | Tab Simulador | ✅ OK | Funcional via API /negociacao/simular |
| 46 | Tab Histórico | ⚠️ Parcial | EmptyState — sem API específica |
| 47 | Campos desabilitados sem permissão | ⚠️ Parcial | UI ok, mas canAction sempre true |
| 48 | Botão "Salvar" bloqueado sem permissão | ⚠️ Parcial | UI existe, lógica sempre true |
| 49 | Responsividade (grid adaptável) | ✅ OK | 2xl:grid-cols, sm:flex-row |
| 50 | Alerta "Rotina financeira sensível" | ✅ OK | Sempre visível |

---

## FLUXO DE COBRANÇA (BACKEND)

| # | Item | Status | Observação |
|---|---|---|---|
| 51 | Identificação de cliente por telefone | ✅ OK | findClientsByPhone com TELCOB |
| 52 | Consulta de títulos por CODCLI | ✅ OK | listOpenTitlesFromOracle |
| 53 | Filtro CODCOB whitelist | ✅ OK | ('341','756','BK'), bypass com flag |
| 54 | Cálculo de dias de atraso | ✅ OK | DIAS_ATRASO via Oracle SYSDATE |
| 55 | Inferência de etapa da régua | ✅ OK | inferEtapaRegua em utils.ts |
| 56 | Classificação de intenção NLU | ✅ OK | 24 testes passando |
| 57 | Circuit breaker OpenAI | ✅ OK | Testado — fallback após 5 falhas |
| 58 | Envio de template WhatsApp | ⚠️ Parcial | Funcional, conta DEACTIVATED |
| 59 | Dedup de template (10 min) | ✅ OK | In-memory por to:templateName |
| 60 | Verificação de opt-out antes de cobrar | ✅ OK | Testado em processarMensagemInbound |
| 61 | Registro de promessa de pagamento | ✅ OK | Testado em test:lara |
| 62 | Geração de PIX (Bradesco) | ✅ OK | mTLS configurado |
| 63 | Geração de boleto (WinThor) | ✅ OK | gerarOuRegenerarBoletoWinthor |
| 64 | Idempotência por event_id | ✅ OK | Testado em test:lara |
| 65 | Rate limit em webhooks | ✅ OK | 60 req/min por padrão |
| 66 | Retry com backoff (WhatsApp) | ✅ OK | sendWithRetry — 3 tentativas |
| 67 | Registro de histórico de mensagem | ✅ OK | LARA_COB_MSG_LOG |
| 68 | Registro de cases/escalações | ✅ OK | LARA_CASES |
| 69 | Registro de log de integração | ✅ OK | LARA_INTEGRACOES_LOG |

---

## ORACLE / WINTHOR

| # | Item | Status | Observação |
|---|---|---|---|
| 70 | Bind parameters em todas as queries | ✅ OK | :codcli, :duplic, etc. |
| 71 | Sem SQL injection detectado | ✅ OK | |
| 72 | Tratamento de null / valores vazios | ✅ OK | NVL, TRIM, toNumber() |
| 73 | Paginação (FETCH FIRST N ROWS) | ✅ OK | |
| 74 | Pool de conexão Oracle | ✅ OK | ORACLE_POOL_MIN/MAX configurável |
| 75 | Retry em falha Oracle | ✅ OK | withOracleConnection com retry |
| 76 | Tabelas auxiliares criadas automaticamente | ✅ OK | ensureLaraTables() |
| 77 | Índices criados automaticamente | ✅ OK | 35 índices definidos |
| 78 | CODCOB whitelist configurável | ✅ OK | |
| 79 | skipCodcobFilter para exceções | ✅ OK | |

---

## SEGURANÇA

| # | Item | Status | Observação |
|---|---|---|---|
| 80 | JWT obrigatório para rotas gerais | ✅ OK | preHandler verifica Bearer |
| 81 | JWT obrigatório para rotas /api/lara/ | ❌ FALHOU | publicPathPrefixes inclui /api/lara/ |
| 82 | LARA_API_KEY (opcional) configurada | ❌ FALHOU | Não configurada em .env de produção |
| 83 | HMAC Meta webhook | ⚠️ Parcial | Código OK, WHATSAPP_APP_SECRET ausente |
| 84 | CORS configurado | ⚠️ Parcial | origin: true — muito permissivo |
| 85 | Rate limit webhooks | ✅ OK | |
| 86 | Validação de input (Zod) | ✅ OK | Todos os endpoints |
| 87 | CPF/CNPJ mascarado | ✅ OK | sensitive.ts + prompt |
| 88 | Tokens/senhas não expostos em logs | ✅ OK | maskSensitiveText implementado |
| 89 | JWT_SECRET_KEY com validação de força | ✅ OK | Rejeita valores fracos |
| 90 | AUTH_STATIC_PASSWORD com validação | ✅ OK | Mín. 8 chars, rejeita fracos |
| 91 | Admin endpoints protegidos | ❌ FALHOU | inject/delete/sync sem auth |
| 92 | Webhook Bradesco PIX com secret | ✅ OK | validateBradescoPixSecret |
| 93 | RBAC frontend | ❌ FALHOU | canAccess/canAction sempre true |

---

## LGPD

| # | Item | Status | Observação |
|---|---|---|---|
| 94 | CPF/CNPJ mascarado no frontend | ✅ OK | LaraSensitiveText |
| 95 | CPF/CNPJ mascarado nas mensagens WA | ✅ OK | Prompt compliance |
| 96 | Opt-out implementado | ✅ OK | LARA_OPTOUT + verificação antes de cobrar |
| 97 | Opt-out respeitado na régua | ✅ OK | Testado |
| 98 | Dados financeiros sem exposição indevida | ✅ OK | |
| 99 | Logs sem dados sensíveis | ✅ OK | |
| 100 | Histórico preservado | ✅ OK | 8 tabelas de log |

---

## HISTÓRICO / AUDITORIA

| # | Item | Status | Observação |
|---|---|---|---|
| 101 | Log de mensagem inbound | ✅ OK | LARA_COB_MSG_LOG (direction=inbound) |
| 102 | Log de mensagem outbound | ✅ OK | LARA_COB_MSG_LOG (direction=outbound) |
| 103 | Log de cases | ✅ OK | LARA_CASES |
| 104 | Log de promessas | ✅ OK | LARA_PROMESSAS_PAGAMENTO |
| 105 | Log de negociações | ✅ OK | LARA_NEGOCIACOES |
| 106 | Log de opt-out | ✅ OK | LARA_OPTOUT |
| 107 | Log de execuções da régua | ✅ OK | LARA_REGUA_EXECUCOES |
| 108 | Log de integrações | ✅ OK | LARA_INTEGRACOES_LOG |
| 109 | Log de feedback de interações | ✅ OK | LARA_FEEDBACK_INTERACOES |
| 110 | Correlation ID em todas as requests | ✅ OK | x-request-id / correlationId |
| 111 | Idempotência por event_id | ✅ OK | |
| 112 | Auditoria de compliance | ✅ OK | /api/lara/compliance/auditoria |
| 113 | Histórico de negociação pesquisável | ⚠️ Parcial | API existe, UI da tela /negociacao sem acesso |

---

## PERFORMANCE

| # | Item | Status | Observação |
|---|---|---|---|
| 114 | Bundle frontend < 500KB | ❌ Falhou | 1,014KB |
| 115 | Paginação nas listagens Oracle | ✅ OK | FETCH FIRST N ROWS ONLY |
| 116 | Paginação nas listagens frontend | ⚠️ Parcial | cursor/page_size nos endpoints, UI usa limit |
| 117 | Limit razoável em listTitulos | ⚠️ Parcial | limit:5000 por cliente |
| 118 | Timeout configurado | ✅ OK | OPENAI_TIMEOUT_MS, BRADESCO_PIX_TIMEOUT_MS |
| 119 | Pool Oracle configurável | ✅ OK | |
| 120 | Cache de rate limit em memória | ✅ OK | Limpo por janela de 1 min |
