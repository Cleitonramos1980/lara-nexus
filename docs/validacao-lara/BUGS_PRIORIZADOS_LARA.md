# BUGS PRIORIZADOS — SISTEMA LARA

**Data:** 2026-06-02

---

## CRÍTICOS

### BUG-001 — Todos os endpoints /api/lara/ são públicos (sem autenticação)

| Campo | Detalhe |
|---|---|
| Severidade | CRÍTICA |
| Módulo | Backend — Segurança |
| Rota/Arquivo | `backend/src/server.ts` linhas 113–118 |
| Descrição | O array `publicPathPrefixes` inclui `"/api/lara/"` o que faz com que **todos** os endpoints da Lara ignorem a verificação de JWT. Qualquer pessoa com acesso à rede pode consultar clientes, títulos, histórico, conversas e até executar endpoints admin. |
| Impacto | Exposição total de dados financeiros de clientes. Manipulação de cache. Violação de LGPD. |
| Como reproduzir | Fazer GET para `http://host:3333/api/lara/clientes` sem cabeçalho `Authorization` — retorna dados reais. |
| Evidência | `const publicPathPrefixes = ["/api/operacional/solicitacoes-acesso/public/", "/api/lara/"]` |
| Correção recomendada | Remover `/api/lara/` do `publicPathPrefixes`. Criar lista de rotas realmente públicas da Lara: `/api/lara/webhook/meta`, `/api/lara/portal/:token`, `/api/lara/webhooks/*`. Exigir JWT para o restante **ou** tornar `LARA_API_KEY` obrigatório (não opcional). |

---

### BUG-002 — permissions.ts: RBAC sempre retorna true

| Campo | Detalhe |
|---|---|
| Severidade | CRÍTICA |
| Módulo | Frontend — Permissões |
| Rota/Arquivo | `src/components/lara/permissions.ts` linhas 19–25 |
| Descrição | `canAccess(rotina)` retorna `Boolean(rotina)` — sempre true se a rotina for qualquer string não vazia. `canAction(rotina, action)` retorna `Boolean(rotina && action)` — sempre true. O sistema de permissões frontend é uma casca sem conteúdo. |
| Impacto | Todo usuário logado vê e executa qualquer ação: edita política de negociação, salva descontos, executa simulações, acessa logs. |
| Como reproduzir | Verificar `canAccess("LARA_NEGOCIACAO")` no console — retorna true para qualquer usuário. |
| Evidência | `return Boolean(rotina);` — sem consulta a perfil, token ou role. |
| Correção recomendada | Implementar lookup de permissões por perfil/role. No mínimo: ler perfil do token JWT decodificado e verificar contra tabela de permissões por rota. Alternativa: mover verificação de alçada para o backend (rejeitar 403 em endpoints sensíveis). |

---

### BUG-003 — Conta WhatsApp DEACTIVATED pela Meta

| Campo | Detalhe |
|---|---|
| Severidade | CRÍTICA (operacional) |
| Módulo | Integração WhatsApp |
| Rota/Arquivo | Configuração externa — Meta Business Manager |
| Descrição | O número `+55 92 8422-5050` (PHONE_NUMBER_ID: 767718899756375) tem `name_status: DECLINED` e `account_mode: LIVE` mas conta WABA suspensa por violação de política (nome "Suporte IA" rejeitado). |
| Impacto | Nenhuma mensagem de cobrança é entregue. Todo o fluxo de cobrança WhatsApp está inoperante. |
| Como reproduzir | Tentar enviar template via API — retorna erro 400 (sender blocked). |
| Evidência | Confirmado via Meta Graph API, captura de tela em sessão anterior. |
| Correção recomendada | 1) Submeter appeal no Meta Business Support justificando uso legítimo. 2) Alterar nome do número para "Rodrigues Colchões" ou nome real da empresa. 3) Alternativa: criar nova WABA com CNPJ da empresa e número diferente. |

---

## ALTOS

### BUG-004 — Admin endpoints acessíveis sem autenticação

| Campo | Detalhe |
|---|---|
| Severidade | ALTA |
| Módulo | Backend — Admin |
| Rota/Arquivo | `backend/src/routes/lara.ts` linhas 282–400 |
| Descrição | Endpoints `/api/lara/admin/*` (inject-titulo-teste, forcar-sync-codcli, purge-invalid-codcob, delete titulo-cache) não possuem nenhuma verificação de autenticação além do LARA_API_KEY opcional que não está configurado. |
| Impacto | Qualquer pessoa pode injetar títulos falsos no cache, deletar títulos do cache, forçar sincronizações. Manipulação financeira direta. |
| Como reproduzir | POST `/api/lara/admin/inject-titulo-teste` sem headers — funciona. |
| Correção recomendada | Exigir autenticação (JWT de admin ou LARA_API_KEY) nesses endpoints. Adicionar verificação de role "ADMIN" no handler. |

---

### BUG-005 — LARA_API_KEY não configurada no .env de produção

| Campo | Detalhe |
|---|---|
| Severidade | ALTA |
| Módulo | Backend — Configuração |
| Rota/Arquivo | `backend/.env` |
| Descrição | A variável `LARA_API_KEY` não está definida no arquivo `.env`. Quando não configurada, o backend ignora completamente a verificação da chave (linha 97: `if (laraApiKeyConfigured) {`). Isso significa que a única barreira é o JWT, que por sua vez é bypassado para todas as rotas Lara. |
| Impacto | Combinado com BUG-001, resulta em zero autenticação nas rotas Lara. |
| Correção recomendada | Definir `LARA_API_KEY=<chave forte>` no `.env` **imediatamente** como medida de emergência, mesmo enquanto BUG-001 é corrigido. |

---

### BUG-006 — WHATSAPP_APP_SECRET ausente — webhook Meta sem validação

| Campo | Detalhe |
|---|---|
| Severidade | ALTA |
| Módulo | Backend — Webhook |
| Rota/Arquivo | `backend/src/routes/lara.ts` linhas 961–966 |
| Descrição | O código de validação HMAC `validateMetaWebhookSignature` está implementado corretamente, mas só é executado se `WHATSAPP_APP_SECRET` estiver configurado. Como não está, qualquer requisição POST ao webhook Meta é aceita sem verificação de assinatura. |
| Impacto | Replay attacks, injeção de mensagens falsas de cobrança. |
| Correção recomendada | Configurar `WHATSAPP_APP_SECRET` no `.env` com o App Secret do App Meta. |

---

### BUG-007 — CORS: origin: true — aceita qualquer origem

| Campo | Detalhe |
|---|---|
| Severidade | ALTA |
| Módulo | Backend — CORS |
| Rota/Arquivo | `backend/src/server.ts` linha 179 |
| Descrição | `origin: true` faz o backend aceitar requisições CORS de qualquer domínio. |
| Impacto | Em combinação com BUG-001, qualquer site malicioso pode fazer requisições autenticadas ao backend Lara em nome de um usuário logado. |
| Correção recomendada | Restringir origin para domínio(s) conhecidos do frontend em produção: `origin: ['https://app.rodriguescolchoes.com.br']`. |

---

## MÉDIOS

### BUG-008 — Bundle frontend 1MB+ (acima do limite)

| Campo | Detalhe |
|---|---|
| Severidade | MÉDIA |
| Módulo | Frontend — Performance |
| Rota/Arquivo | `vite.config.ts` |
| Descrição | Bundle único de 1,014KB (gzip: 280KB). Vite emite aviso. |
| Impacto | Primeiro carregamento lento — especialmente em conexões 3G/4G. |
| Correção recomendada | Usar `React.lazy()` + `Suspense` para carregar páginas Lara sob demanda. Separar `recharts` em chunk próprio via `build.rollupOptions.output.manualChunks`. |

---

### BUG-009 — Aba "Alçadas" vazia na tela /lara/negociacao

| Campo | Detalhe |
|---|---|
| Severidade | MÉDIA |
| Módulo | Frontend — /lara/negociacao |
| Rota/Arquivo | `src/pages/lara/LaraNegociacaoConfig.tsx` linha 657 |
| Descrição | Tab "Alçadas" exibe apenas EmptyState — sem API, sem implementação. |
| Impacto | Usuários não conseguem configurar limites de alçada por perfil. |
| Correção recomendada | Implementar API de alçadas no backend e tabela LARA_ALCADAS. Ou remover a aba até estar pronta. |

---

### BUG-010 — Aba "Histórico" vazia na tela /lara/negociacao

| Campo | Detalhe |
|---|---|
| Severidade | MÉDIA |
| Módulo | Frontend — /lara/negociacao |
| Rota/Arquivo | `src/pages/lara/LaraNegociacaoConfig.tsx` linha 789 |
| Descrição | Tab "Histórico" exibe EmptyState — sem API de auditoria específica de negociação na tela. |
| Impacto | Impossível auditar quem alterou políticas e quando. |
| Correção recomendada | Criar endpoint `GET /api/lara/negociacao/historico` que retorne log de alterações nas LARA_POLITICAS_NEGOCIACAO. Integrar na aba. |

---

### BUG-011 — listTitulos com limit 5000 sem paginação visual

| Campo | Detalhe |
|---|---|
| Severidade | MÉDIA |
| Módulo | Backend + Frontend |
| Rota/Arquivo | `backend/src/routes/lara.ts` linha 248 |
| Descrição | `GET /api/lara/clientes/:codcli/titulos` usa `limit: 5000`. Para clientes com muitos títulos isso pode ser lento e consumir muita memória. |
| Correção recomendada | Adicionar paginação ao endpoint ou reduzir o limite padrão para 200 com opção de expandir. |

---

## BAIXOS

### BUG-012 — 13 warnings ESLint

| Severidade | BAIXA |
| Módulo | Frontend — LaraAtendimentos.tsx, LaraConversas.tsx |
| Descrição | `react-hooks/exhaustive-deps` em `useEffect` — dependência de variável que muda a cada render. |
| Correção | Envolver em `useMemo()` como sugerido pelo linter. |

### BUG-013 — Playwright configurado sem testes E2E

| Severidade | BAIXA |
| Módulo | Testes |
| Descrição | `playwright.config.ts` e `playwright-fixture.ts` existem mas não há testes `.spec.ts` implementados. |
| Correção | Implementar testes E2E para o fluxo crítico: login → /lara/negociacao → editar política → confirmar. |

### BUG-014 — Browserslist desatualizado

| Severidade | BAIXA |
| Módulo | Frontend — Build |
| Descrição | Aviso durante build: `caniuse-lite is 12 months old`. |
| Correção | `npx update-browserslist-db@latest` |

### BUG-015 — Validade de proposta hardcoded "Não definida"

| Severidade | BAIXA |
| Módulo | Frontend — /lara/negociacao |
| Rota/Arquivo | `src/pages/lara/LaraNegociacaoConfig.tsx` linha 444 |
| Descrição | Campo "Validade" na tabela de políticas exibe "Não definida" hardcoded. A configuração `LARA_NEGOCIACAO_VALIDADE_HORAS` existe no backend mas não é exposta pela API de políticas. |
| Correção | Incluir `validade_horas` no response de `GET /api/lara/negociacao/politicas`. |
