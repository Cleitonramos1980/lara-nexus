# PLANO DE CORREÇÃO 80/20 — SISTEMA LARA

**Data:** 2026-06-02

Este plano prioriza as correções que resolvem 80% dos problemas críticos com menor esforço.

---

## NÍVEL 1 — EMERGENCIAL (1–4 horas) — resolve problemas CRÍTICOS de segurança

### CORREÇÃO 1 — Definir LARA_API_KEY no .env

**Esforço:** 5 minutos  
**Risco:** Muito baixo  
**Impacto:** Protege todos os endpoints Lara enquanto a correção estrutural é feita  

```bash
# backend/.env — adicionar:
LARA_API_KEY=<gerar: openssl rand -hex 32>
```

**Efeito:** Com LARA_API_KEY definida, qualquer requisição a `/api/lara/*` sem o header `x-lara-api-key` correto retorna 401.

**Dependência:** Nenhuma  
**Arquivo:** `backend/.env`  

---

### CORREÇÃO 2 — Remover /api/lara/ de publicPathPrefixes

**Esforço:** 30 minutos  
**Risco:** Baixo (testes após a mudança)  
**Impacto:** Corrige BUG-001 — autenticação real para endpoints Lara  

**Arquivo:** `backend/src/server.ts`

```typescript
// ANTES:
const publicPathPrefixes = [
  "/api/operacional/solicitacoes-acesso/public/",
  "/api/lara/",
];

// DEPOIS:
const publicPathPrefixes = [
  "/api/operacional/solicitacoes-acesso/public/",
];

// Adicionar lista específica de rotas Lara públicas:
const laraPublicExactPaths = new Set([
  "/api/lara/webhook/meta",
]);
const laraPublicPrefixes = [
  "/api/lara/webhooks/",
  "/api/lara/bradesco/pix/webhook",
  "/api/lara/bradesco/bolepix/webhook/",
  "/api/lara/portal/",
];

// No preHandler, após o check de LARA_API_KEY, adicionar:
if (path.startsWith("/api/lara/")) {
  if (laraPublicExactPaths.has(path)) return;
  if (laraPublicPrefixes.some(p => path.startsWith(p))) return;
  // Agora exige JWT ou LARA_API_KEY (já verificado acima)
}
```

**Dependência:** Correção 1 deve estar feita  
**Complexidade:** Baixa  

---

### CORREÇÃO 3 — Configurar WHATSAPP_APP_SECRET

**Esforço:** 15 minutos  
**Risco:** Muito baixo  
**Impacto:** Ativa validação HMAC do webhook Meta — protege contra replay attacks  

```bash
# backend/.env — adicionar:
WHATSAPP_APP_SECRET=<App Secret do app Meta — pegar no Meta Business Manager>
```

**Dependência:** Nenhuma  
**Arquivo:** `backend/.env`  

---

## NÍVEL 2 — ALTA PRIORIDADE (1–3 dias) — corrige BUGs altos

### CORREÇÃO 4 — Implementar RBAC real no permissions.ts

**Esforço:** 1–2 dias  
**Risco:** Médio (requer definir modelo de perfis e integrar com JWT)  
**Impacto:** Corrige BUG-002 — RBAC funcional no frontend  

**Arquivos a alterar:**
- `src/components/lara/permissions.ts`
- `src/contexts/LaraFiliaisContext.tsx` (ou criar `AuthContext.tsx`)
- `backend/src/utils/jwt.ts` (verificar se perfil está no token)

**Passos:**
1. Verificar payload do JWT — adicionar `perfil` ao token se não existir
2. Criar `src/contexts/AuthContext.tsx` com `getAuthUser()`
3. Definir `ROTINAS_POR_PERFIL` e `ACOES_POR_PERFIL` em `permissions.ts`
4. Implementar `canAccess()` e `canAction()` com lookup real
5. Testar nas telas críticas (especialmente `/lara/negociacao`)

---

### CORREÇÃO 5 — Adicionar verificação de role nos endpoints críticos do backend

**Esforço:** 4–8 horas  
**Risco:** Baixo  
**Impacto:** Corrige BUG-004 e P06 — admin e negociação protegidos por role  

**Arquivo a alterar:** `backend/src/routes/lara.ts`, `backend/src/utils/` (novo arquivo)

```typescript
// Criar backend/src/utils/authorization.ts
export function requireRole(req: FastifyRequest, roles: string[]): void {
  const user = (req as any).authUser;
  if (!user) throw createHttpError(401, 'Não autenticado.');
  if (!roles.includes(user.perfil)) throw createHttpError(403, 'Sem permissão.');
}

// Em routes/lara.ts — adicionar nos handlers críticos:
// PUT /negociacao/politicas/:etapa → requireRole(req, ['ADMIN', 'FINANCEIRO'])
// DELETE /admin/* → requireRole(req, ['ADMIN'])
// POST /admin/* → requireRole(req, ['ADMIN'])
// PUT /regua/config → requireRole(req, ['ADMIN', 'FINANCEIRO'])
```

---

### CORREÇÃO 6 — Restringir CORS

**Esforço:** 30 minutos  
**Risco:** Baixo  
**Impacto:** Corrige SEC-005  

**Arquivo:** `backend/src/server.ts`

```typescript
await app.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? (String(env.CORS_ALLOWED_ORIGIN || '')).split(',').filter(Boolean)
    : true,
  // ...
});
```

**Adicionar ao .env:** `CORS_ALLOWED_ORIGIN=https://app.rodriguescolchoes.com.br`

---

## NÍVEL 3 — MELHORIAS (1–2 sprints)

### CORREÇÃO 7 — Reativar conta WhatsApp

**Esforço:** Externo (Meta Business Support)  
**Risco:** Nenhum (processo de appeal)  
**Impacto:** Sistema de cobrança WhatsApp volta a funcionar  

**Passos:**
1. Acessar Meta Business Support
2. Submeter appeal justificando: empresa Rodrigues Colchões, cobrança legítima, clientes com débito ativo
3. Alterar nome do número para nome real da empresa
4. Aguardar revisão (5–10 dias úteis)

---

### CORREÇÃO 8 — Implementar Tab Alçadas e Tab Histórico na /lara/negociacao

**Esforço:** 2–3 dias  
**Risco:** Baixo  
**Arquivos:**
- `backend/src/routes/lara.ts` (novos endpoints)
- `backend/src/repositories/lara/initTables.ts` (tabela LARA_POLITICAS_NEGOCIACAO_LOG)
- `src/pages/lara/LaraNegociacaoConfig.tsx` (ativar as abas)

---

### CORREÇÃO 9 — Code splitting do bundle

**Esforço:** 4–8 horas  
**Impacto:** Bundle de 1MB → múltiplos chunks < 300KB  

```typescript
// src/App.tsx — usar lazy loading por rota
const LaraNegociacaoConfig = lazy(() => import('./pages/lara/LaraNegociacaoConfig'));
const LaraDashboardPreditivo = lazy(() => import('./pages/lara/LaraDashboardPreditivo'));
// ... para todas as 19 páginas

// Envolver router em Suspense
<Suspense fallback={<div>Carregando...</div>}>
  <Routes>...</Routes>
</Suspense>
```

---

### CORREÇÃO 10 — Persistir dedup de templates

**Esforço:** 2–4 horas  
**Arquivo:** `backend/src/modules/lara/whatsappTemplateManager.ts`  
**Impacto:** Dedup não perde estado no restart  

---

## ORDEM IDEAL DE EXECUÇÃO

```
Semana 1:
  Dia 1: Correções 1, 2, 3 (emergenciais — < 4h total)
  Dia 2-3: Correção 4 (RBAC frontend)
  Dia 4-5: Correção 5 (roles no backend)

Semana 2:
  Dia 1: Correção 6 (CORS)
  Dia 2: Correção 7 (processo Meta — iniciar imediatamente)
  Dia 3-5: Correções 8 (alçadas/histórico)

Semana 3+:
  Correções 9, 10 (bundle + dedup)
```

---

## DEPENDÊNCIAS

```
Correção 1 → permite deploy imediato seguro
Correção 2 → depende de 1 (API Key configurada antes de remover bypass)
Correção 4 → depende de JWT ter perfil no payload
Correção 5 → depende de 4 (perfis definidos) e 2 (rotas protegidas)
Correção 8 → independente, pode ir paralelo
```

---

## RESUMO DE RISCO/BENEFÍCIO

| Correção | Esforço | Benefício | Risco |
|---|---|---|---|
| 1 — LARA_API_KEY | 5 min | Crítico | Muito baixo |
| 2 — publicPathPrefixes | 30 min | Crítico | Baixo |
| 3 — APP_SECRET | 15 min | Alto | Muito baixo |
| 4 — RBAC frontend | 2 dias | Alto | Médio |
| 5 — Roles backend | 8h | Alto | Baixo |
| 6 — CORS | 30 min | Médio | Muito baixo |
| 7 — WhatsApp | Externo | Crítico | Zero |
| 8 — Alçadas/Histórico | 3 dias | Médio | Baixo |
| 9 — Code splitting | 8h | Baixo | Baixo |
| 10 — Dedup persist | 4h | Baixo | Muito baixo |
