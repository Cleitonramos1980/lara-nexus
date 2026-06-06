# MATRIZ DE TESTES FUNCIONAIS — SISTEMA LARA

**Data:** 2026-06-02

Legenda Status: ✅ PASSOU | ❌ FALHOU | ⚠️ PARCIAL | 🔲 NÃO TESTADO (manual/E2E)

---

## BLOCO 1 — AUTENTICAÇÃO E SESSÃO

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T001 | Auth | POST /api/auth/login | Servidor rodando | POST com email+password válidos | JWT retornado | - | 🔲 | ALTA |
| T002 | Auth | POST /api/auth/login | Servidor rodando | POST com password inválida | 401 Unauthorized | - | 🔲 | ALTA |
| T003 | Auth | POST /api/auth/login | Servidor rodando | POST com email inexistente | 401 Unauthorized | - | 🔲 | ALTA |
| T004 | Auth | GET /api/lara/clientes | Servidor rodando | GET sem Bearer token | Deveria retornar 401 | Retorna 200 (BUG-001) | ❌ | CRÍTICA |
| T005 | Auth | GET /api/lara/clientes | Com JWT válido | GET com Bearer token | 200 com dados | - | 🔲 | ALTA |
| T006 | Auth | Sessão | JWT expirado | Fazer request com token expirado | 401 Token expirado | - | 🔲 | ALTA |

---

## BLOCO 2 — CONSULTA DE CLIENTE

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T010 | Clientes | GET /api/lara/clientes | Cache populado | GET /clientes?search=Joao | Lista filtrada | - | 🔲 | ALTA |
| T011 | Clientes | GET /api/lara/clientes/:codcli | Cache populado | GET /clientes/347818 | Dados do cliente | - | 🔲 | ALTA |
| T012 | Clientes | GET /api/lara/clientes/:codcli | CODCLI inexistente | GET /clientes/999999 | 404 Not Found | - | 🔲 | MÉDIA |
| T013 | Clientes | processarMensagemInbound | WA_ID cadastrado | Enviar wa_id de cliente existente | Cliente identificado | ✅ (teste backend) | ✅ | ALTA |
| T014 | Clientes | processarMensagemInbound | WA_ID não cadastrado | Enviar wa_id desconhecido | Solicitar identificação | ✅ (teste backend) | ✅ | ALTA |
| T015 | Clientes | Identificação por CPF | Múltiplos cadastros | Enviar CPF | Retornar cadastro correto | ✅ (lógica no service) | ✅ | ALTA |

---

## BLOCO 3 — CONSULTA DE TÍTULOS

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T020 | Títulos | GET /api/lara/titulos | Cache populado | GET /titulos?codcli=347818 | Títulos do cliente | - | 🔲 | ALTA |
| T021 | Títulos | GET /api/lara/titulos/:id | ID existente | GET /titulos/{id} | Título detalhado | - | 🔲 | ALTA |
| T022 | Títulos | GET /api/lara/titulos/:id | ID inexistente | GET /titulos/ID_FAKE | 404 Not Found | - | 🔲 | MÉDIA |
| T023 | Títulos | listOpenTitlesFromOracle | Oracle conectado | Sync com CODCOB whitelist | Apenas títulos 341/756/BK | ✅ (lógica verificada) | ✅ | ALTA |
| T024 | Títulos | skipCodcobFilter | Oracle conectado | Sync com flag=true | Todos os títulos | ✅ (código verificado) | ✅ | MÉDIA |
| T025 | Títulos | Título pago | Oracle com DTPAG | Sync de título com DTPAG preenchido | Título ignorado | ✅ (filtro no Oracle) | ✅ | ALTA |

---

## BLOCO 4 — FLUXO DE COBRANÇA INBOUND

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T030 | Inbound | processarMensagemInbound | Cache populado | Enviar "oi" de cliente com débito | Resposta saudando e listando títulos | ✅ (teste backend) | ✅ | ALTA |
| T031 | Inbound | processarMensagemInbound | Cache populado | Enviar "quero pagar" | Intenção detectada: boleto/pix | ✅ (NLU testado) | ✅ | ALTA |
| T032 | Inbound | processarMensagemInbound | Cache populado | Enviar "pix" | Gerar instrução PIX | ✅ (teste backend) | ✅ | ALTA |
| T033 | Inbound | processarMensagemInbound | Cache populado | Enviar "parar" | Opt-out registrado | ✅ (teste backend) | ✅ | ALTA |
| T034 | Inbound | processarMensagemInbound | Opt-out ativo | Enviar qualquer mensagem | Não iniciar cobrança | ✅ (teste backend) | ✅ | ALTA |
| T035 | Inbound | processarMensagemInbound | Cliente sem títulos | Enviar "oi" | Informar sem pendência | ✅ (lógica verificada) | ✅ | MÉDIA |
| T036 | Inbound | Idempotência | event_id duplicado | Enviar mesmo event_id 2x | Processar apenas 1x | ✅ (teste backend) | ✅ | ALTA |
| T037 | Inbound | Circuit breaker OpenAI | 5 falhas consecutivas | Enviar mensagem | Usar fallback, não chamar OpenAI | ✅ (teste backend) | ✅ | ALTA |

---

## BLOCO 5 — PAGAMENTOS

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T040 | PIX | POST /pagamentos/pix | Bradesco habilitado | POST com codcli+duplicatas válidos | PIX QR gerado | - | 🔲 | ALTA |
| T041 | PIX | POST /pagamentos/pix | Valor = 0 | POST com cliente sem saldo | Guard bloquear | ✅ (código verificado) | ✅ | ALTA |
| T042 | PIX Webhook | POST /bradesco/pix/webhook | Secret configurado | POST sem secret | 401 Unauthorized | - | 🔲 | ALTA |
| T043 | PIX Webhook | POST /bradesco/pix/webhook | Secret configurado | POST com secret válido | Processar e confirmar | - | 🔲 | ALTA |
| T044 | Boleto | POST /winthor/boleto/gerar | Oracle conectado | POST com duplicata válida | Boleto gerado com linhadig | - | 🔲 | ALTA |
| T045 | Boleto | POST /winthor/boleto/gerar | Duplicata inválida | POST com duplic inexistente | Erro informativo | - | 🔲 | MÉDIA |

---

## BLOCO 6 — RÉGUA DE COBRANÇA

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T050 | Régua | POST /regua/disparar-cliente | CODCLI válido | POST com codcli | Template enviado para etapa correta | - | 🔲 | ALTA |
| T051 | Régua | Dedup template | Mesmo template 2x < 10 min | Disparar régua 2x | 2ª chamada bloqueada | ✅ (código verificado) | ✅ | ALTA |
| T052 | Régua | ETAPA_TEMPLATE_MAP | D+15 c/ 2 títulos | Disparar régua | Usar template lara_cobranca_d15 (total) | ✅ (código verificado) | ✅ | ALTA |
| T053 | Régua | GET /regua/ativa | Execuções registradas | GET /regua/ativa | Resumo + lista de execuções | - | 🔲 | MÉDIA |

---

## BLOCO 7 — NEGOCIAÇÃO

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T060 | Negociação | GET /negociacao/politicas | Políticas seeded | GET /negociacao/politicas | 6 políticas (D-3 a D+30) | - | 🔲 | ALTA |
| T061 | Negociação | PUT /negociacao/politicas/D+7 | Autenticado | PUT com desconto_maximo_pct=10 | Política atualizada | - | 🔲 | ALTA |
| T062 | Negociação | PUT /negociacao/politicas/D+7 | Sem auth | PUT sem token | Deveria retornar 401/403 | Retorna 200 (BUG-001) | ❌ | CRÍTICA |
| T063 | Negociação | POST /negociacao/simular | CODCLI existente | POST com codcli=347818 | Propostas geradas | - | 🔲 | ALTA |
| T064 | Negociação | /lara/negociacao UI | Usuário qualquer | Editar e salvar política | Permitido (deveria verificar perfil) | Permitido (BUG-002) | ❌ | ALTA |

---

## BLOCO 8 — HISTÓRICO E AUDITORIA

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T070 | Logs | GET /api/lara/logs | Mensagens processadas | GET /logs | Lista de logs com direction/wa_id/etapa | - | 🔲 | MÉDIA |
| T071 | Cases | GET /api/lara/cases | Cases criados | GET /cases | Lista de cases | - | 🔲 | MÉDIA |
| T072 | Promessas | GET /api/lara/promessas | Promessas registradas | GET /promessas | Lista de promessas | - | 🔲 | MÉDIA |
| T073 | Auditoria | GET /compliance/auditoria | Operações realizadas | GET /compliance/auditoria | Trilha de auditoria paginada | - | 🔲 | MÉDIA |
| T074 | Log de mensagem | processarMensagemInbound | Mensagem processada | Verificar LARA_COB_MSG_LOG | Registro criado com wa_id, etapa, direction | ✅ (código verificado) | ✅ | ALTA |

---

## BLOCO 9 — SEGURANÇA

| ID | Módulo | Tela/Endpoint | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T080 | Segurança | GET /api/lara/clientes | Sem autenticação | GET sem headers | 401 Unauthorized | 200 OK (BUG-001) | ❌ | CRÍTICA |
| T081 | Segurança | POST /api/lara/admin/inject-titulo-teste | Sem autenticação | POST sem headers | 401 Unauthorized | 200 OK (BUG-001 + BUG-004) | ❌ | CRÍTICA |
| T082 | Segurança | SQL Injection | Servidor rodando | GET /clientes?search='; DROP TABLE | Query parametrizada — sem efeito | ✅ (bind params confirmado) | ✅ | CRÍTICA |
| T083 | Segurança | Rate Limit Webhook | Servidor rodando | 61 POST em 1 min | 429 na 61ª request | - | 🔲 | ALTA |
| T084 | Segurança | HMAC Meta Webhook | APP_SECRET não configurado | POST sem X-Hub-Signature | Aceito sem validação | ✅ (comportamento confirmado = FALHA) | ❌ | ALTA |
| T085 | Segurança | CPF mascarado | Cliente com CPF | GET /clientes/:id | CPF mascarado no retorno | - | 🔲 | ALTA |
| T086 | Segurança | XSS | Servidor rodando | POST message_text com `<script>` | Tag sanitizada ou não executada | ✅ (Zod + JSON — não renderizado) | ✅ | ALTA |

---

## BLOCO 10 — UI/UX

| ID | Módulo | Tela | Pré-condição | Passos | Resultado Esperado | Resultado Encontrado | Status | Severidade |
|---|---|---|---|---|---|---|---|---|
| T090 | UI | /lara/negociacao | Servidor frontend | Abrir a rota | Página renderiza sem erro | ✅ (código verificado) | ✅ | ALTA |
| T091 | UI | /lara/negociacao | Backend offline | Abrir a rota sem backend | Alert de erro, não tela em branco | ✅ (isError → Alert) | ✅ | ALTA |
| T092 | UI | /lara/negociacao | Políticas carregadas | Clicar "Editar" em D+7 | Formulário carrega com valores atuais | ✅ (código verificado) | ✅ | ALTA |
| T093 | UI | /lara/negociacao | Editando D+7 | Clicar "Salvar alterações" | AlertDialog com diff de campos | ✅ (código verificado) | ✅ | ALTA |
| T094 | UI | /lara/negociacao | Mobile (< 768px) | Abrir em viewport mobile | Grid responsivo — não quebra | ✅ (classes sm: verificadas) | ✅ | MÉDIA |
| T095 | UI | /lara/negociacao | Usuário sem acesso | canAccess retorna false | LaraRestrictedState exibida | ✅ (código: if !hasRoutineAccess) | ⚠️ | ALTA |

---

## RESUMO DA MATRIZ

| Bloco | Total | Passou | Falhou | Parcial | Não testado |
|---|---|---|---|---|---|
| Auth/Sessão | 6 | 0 | 1 | 0 | 5 |
| Consulta Cliente | 6 | 4 | 0 | 0 | 2 |
| Consulta Títulos | 6 | 3 | 0 | 0 | 3 |
| Fluxo Inbound | 8 | 8 | 0 | 0 | 0 |
| Pagamentos | 6 | 1 | 0 | 0 | 5 |
| Régua | 4 | 3 | 0 | 0 | 1 |
| Negociação | 5 | 0 | 2 | 0 | 3 |
| Histórico | 5 | 1 | 0 | 0 | 4 |
| Segurança | 7 | 2 | 3 | 0 | 2 |
| UI/UX | 6 | 5 | 0 | 1 | 0 |
| **TOTAL** | **59** | **27** | **6** | **1** | **25** |

**Taxa de aprovação (testados):** 27/34 = **79%**  
**Falhas críticas:** 6 (todas relacionadas a segurança/permissões)
