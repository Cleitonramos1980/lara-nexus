# RELATÓRIO DE SEGURANÇA E LGPD — SISTEMA LARA

**Data:** 2026-06-02

---

## 1. RESUMO DE VULNERABILIDADES

| Classificação | Quantidade |
|---|---|
| Críticas | 2 |
| Altas | 4 |
| Médias | 3 |
| Baixas | 2 |

---

## 2. VULNERABILIDADES CRÍTICAS

### SEC-001 — Endpoints /api/lara/ sem autenticação

**Arquivo:** `backend/src/server.ts` linhas 113–118

```typescript
const publicPathPrefixes = [
  "/api/operacional/solicitacoes-acesso/public/",
  "/api/lara/",  // ← TODOS os endpoints Lara são públicos
];
```

**Impacto:**
- Qualquer pessoa com acesso à rede pode consultar clientes com dados financeiros
- Títulos em aberto, valores, datas de vencimento — acessíveis sem login
- Histórico de conversas, cases, promessas, opt-outs — acessíveis sem login
- Endpoints admin (inject, delete, sync) — manipuláveis sem login

**Correção:**
```typescript
const publicPathPrefixes = [
  "/api/operacional/solicitacoes-acesso/public/",
];

// Criar lista específica de rotas Lara públicas:
const laraPublicPaths = new Set([
  "/api/lara/webhook/meta",
  "/api/lara/webhooks/whatsapp-inbound",
  "/api/lara/webhooks/whatsapp-status",
  "/api/lara/webhooks/regua-resultado",
  "/api/lara/bradesco/pix/webhook",
  "/api/lara/bradesco/bolepix/webhook/pagamento",
]);
const laraPublicTokenPaths = ["/api/lara/portal/"];

// No preHandler: se é /api/lara/ mas não está na lista pública, exigir JWT ou LARA_API_KEY
```

---

### SEC-002 — RBAC frontend inexistente (permissions.ts sempre retorna true)

**Arquivo:** `src/components/lara/permissions.ts`

```typescript
export function canAccess(rotina: string) {
  return Boolean(rotina);  // Sempre true
}
export function canAction(rotina: string, action: LaraAction) {
  return Boolean(rotina && action);  // Sempre true
}
```

**Impacto:**
- Qualquer usuário vê e usa qualquer função da Lara
- Usuário sem perfil financeiro pode alterar descontos, parcelamentos, políticas de negociação
- A IU de permissões é enganosa: mostra cadeados e alerts, mas não protege nada

**Correção mínima:**
```typescript
// Carregar perfil do JWT decodificado ou de contexto de auth
import { useAuthUser } from '@/contexts/AuthContext';

export function canAccess(rotina: string): boolean {
  const user = getAuthUser(); // do context ou store
  if (!user) return false;
  if (user.perfil === 'ADMIN') return true;
  return ROTINAS_POR_PERFIL[user.perfil]?.includes(rotina) ?? false;
}
```

---

## 3. VULNERABILIDADES ALTAS

### SEC-003 — LARA_API_KEY ausente no .env de produção

**Arquivo:** `backend/.env`

O backend tem código para verificar `LARA_API_KEY`:
```typescript
const laraApiKeyConfigured = String(env.LARA_API_KEY ?? "").trim();
if (path.startsWith("/api/lara/") && laraApiKeyConfigured) {
  // verificação
}
```

Mas como `LARA_API_KEY` não está no `.env`, `laraApiKeyConfigured` é vazio → verificação ignorada.

**Correção imediata:** `echo "LARA_API_KEY=$(openssl rand -hex 32)" >> backend/.env`

---

### SEC-004 — WHATSAPP_APP_SECRET não configurado

**Arquivo:** `backend/src/routes/lara.ts` linhas 961–966

O código de validação HMAC SHA-256 do webhook Meta está correto mas inativo:
```typescript
if (String(env.WHATSAPP_APP_SECRET ?? "").trim()) {
  // Só valida se APP_SECRET estiver configurado — NÃO está
}
```

Sem isso, qualquer POST ao `/api/lara/webhook/meta` é aceito — replay attacks, injeção de mensagens.

**Correção:** Configurar `WHATSAPP_APP_SECRET` com o App Secret do aplicativo Meta.

---

### SEC-005 — CORS permissivo (origin: true)

**Arquivo:** `backend/src/server.ts` linha 179

```typescript
await app.register(cors, { origin: true, ... });
```

Em produção, deve ser restrito ao(s) domínio(s) do frontend.

**Correção:**
```typescript
origin: process.env.NODE_ENV === 'production'
  ? ['https://app.rodriguescolchoes.com.br']
  : true,
```

---

### SEC-006 — Admin endpoints sem proteção de role

**Arquivo:** `backend/src/routes/lara.ts` linhas 282–400

Endpoints `/api/lara/admin/*` devem exigir role ADMIN, não apenas autenticação básica.

**Correção:** Após corrigir SEC-001, adicionar middleware de verificação de role ADMIN nesses handlers específicos.

---

## 4. VULNERABILIDADES MÉDIAS

### SEC-007 — Credenciais expostas no .env versionado

**Arquivo:** `backend/.env`

O arquivo `.env` contém credenciais reais (Oracle, Bradesco, OpenAI, WhatsApp). Verificar se está no `.gitignore`.

**Evidência verificada:** `backend/.env` tem `ORACLE_PASSWORD`, `BRADESCO_PIX_CLIENT_SECRET`, `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`.

**Correção:** Verificar `.gitignore`. Se `.env` foi commitado, rotacionar todas as credenciais imediatamente. Usar variáveis de ambiente do servidor ou cofre de segredos.

---

### SEC-008 — Portal self-service sem rate limit específico

**Arquivo:** `backend/src/routes/lara.ts` linhas 858–871

`GET /api/lara/portal/:token` e `POST /api/lara/portal/:token/pagar` são públicas (skipLaraAuth). O rate limit global de webhooks não cobre essas rotas.

**Impacto:** Brute force de tokens do portal.

**Correção:** Adicionar `assertWebhookRateLimit(req, "portal-token")` nos handlers do portal.

---

### SEC-009 — Dedup de template em memória (resets no restart)

**Arquivo:** `backend/src/modules/lara/whatsappTemplateManager.ts`

O guard de deduplicação `_recentTemplateSends` é in-memory. Reiniciar o backend limpa o guard, permitindo reenvio imediato do mesmo template.

**Impacto:** Em restart acidental, cliente pode receber o mesmo template duas vezes em sequência.

**Correção:** Persistir o guard de dedup na tabela Oracle (ou usar TTL no Redis/cache distribuído).

---

## 5. VULNERABILIDADES BAIXAS

### SEC-010 — Seed de usuários com emails hardcoded no servidor

**Arquivo:** `backend/src/server.ts` linhas 283–303

Usuários `cleiton.ramos@hotmail.com`, `teste@admin.com`, etc. são criados automaticamente com perfil ADMIN. Em produção isso deve ser removido ou configurável.

---

### SEC-011 — Sessão/auth da Lara não integrada ao sistema geral

O sistema Lara usa a mesma autenticação JWT do backend geral, mas não tem controle de sessão próprio (sem expiração forçada, sem revogação de token). Se um token JWT vazar, não há mecanismo para invalidá-lo antes do prazo de expiração.

---

## 6. ANÁLISE LGPD

### Positivos

| Item | Status |
|---|---|
| CPF/CNPJ mascarado em `sensitive.ts` | ✅ `${digits.slice(0,3)}.***.***-${digits.slice(-2)}` |
| Email mascarado | ✅ `${first2}***@domain` |
| Telefone mascarado | ✅ `***telefone***` |
| Tokens/senhas mascarados em logs | ✅ regex de palavras-chave sensíveis |
| Prompt de IA: nunca exibir CPF/CNPJ completo | ✅ Documentado e implementado |
| Opt-out implementado e respeitado | ✅ Verificado nos testes |
| Opt-out verificado ANTES de qualquer cobrança | ✅ `LARA_OPTOUT` consultado em todo inbound |
| Dados coletados apenas do sistema financeiro (WinThor) | ✅ Sem coleta adicional |
| Consentimento implícito via WhatsApp (UTILITY templates) | ✅ Categoria UTILITY não requer opt-in |

### Riscos LGPD

| Item | Risco | Mitigação |
|---|---|---|
| Endpoints públicos com dados de clientes (SEC-001) | CRÍTICO | Corrigir autenticação |
| Histórico de mensagens contém texto livre de WhatsApp | Médio | Limpar dados antigos com retention policy |
| LARA_COB_MSG_LOG sem política de retenção | Médio | Implementar job de limpeza (ex.: > 2 anos) |
| Portal self-service com dados financeiros via token | Baixo | Token tem validade (LARA_PORTAL_TOKEN_HORAS=48) |

---

## 7. PROBLEMAS DE AUTENTICAÇÃO/AUTORIZAÇÃO

| Problema | Impacto | Arquivo |
|---|---|---|
| /api/lara/ sem JWT | Crítico | server.ts:114 |
| LARA_API_KEY não configurada | Crítico | .env |
| canAccess sempre true | Alto | permissions.ts |
| Admin sem role check | Alto | routes/lara.ts |
| CORS permissivo | Médio | server.ts:179 |
| Webhook Meta sem HMAC | Médio | routes/lara.ts:963 |

---

## 8. RECOMENDAÇÕES FINAIS DE SEGURANÇA

**Ordem de execução:**

1. **IMEDIATO** — Definir `LARA_API_KEY` no `.env` (5 min)
2. **IMEDIATO** — Verificar se `.env` está no `.gitignore` e não foi commitado
3. **URGENTE** — Remover `/api/lara/` de `publicPathPrefixes` (1h)
4. **URGENTE** — Definir `WHATSAPP_APP_SECRET` no `.env` (30 min)
5. **ALTA** — Implementar RBAC real no `permissions.ts` (1-2 dias)
6. **ALTA** — Restringir CORS para domínio de produção (30 min)
7. **MÉDIA** — Adicionar rate limit no portal self-service (2h)
8. **BAIXA** — Implementar política de retenção de logs (1 sprint)
