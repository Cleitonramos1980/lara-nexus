# RELATÓRIO DE PERMISSÕES — SISTEMA LARA

**Data:** 2026-06-02

---

## 1. MODELO DE PERMISSÕES ENCONTRADO

O sistema Lara tem uma estrutura de permissões **apenas no frontend**, sem contrapartida funcional no backend.

### Frontend (src/components/lara/permissions.ts)

```typescript
export type LaraAction =
  | "VISUALIZAR" | "CRIAR" | "EDITAR" | "EXCLUIR" | "ATIVAR" | "INATIVAR"
  | "DUPLICAR" | "TESTAR_REGRA" | "EXPORTAR" | "VER_LOGS"
  | "ALTERAR_DESCONTO" | "ALTERAR_PARCELAMENTO" | "ALTERAR_ALCADA"
  | "ALTERAR_VALIDADE" | "SALVAR_PARAMETROS" | "AUDITAR";

export function canAccess(rotina: string) {
  return Boolean(rotina);  // ← SEMPRE TRUE
}

export function canAction(rotina: string, action: LaraAction) {
  return Boolean(rotina && action);  // ← SEMPRE TRUE
}
```

**Diagnóstico:** As funções `canAccess` e `canAction` retornam `true` para qualquer input não-vazio. O sistema de permissões foi estruturado (tipos definidos, componentes de gate), mas a lógica de verificação **não foi implementada**.

### Backend (server.ts preHandler)

O backend tem autenticação JWT para rotas gerais, mas todas as rotas `/api/lara/` são tratadas como públicas (BUG-001). Não há verificação de role/perfil nos handlers dos endpoints Lara.

---

## 2. FALHAS DE CONTROLE DE ACESSO

| # | Falha | Arquivo | Severidade |
|---|---|---|---|
| P01 | canAccess() sempre retorna true — sem lookup de perfil | permissions.ts | CRÍTICA |
| P02 | canAction() sempre retorna true — sem lookup de ação | permissions.ts | CRÍTICA |
| P03 | Todos os endpoints /api/lara/ sem JWT | server.ts | CRÍTICA |
| P04 | Admin endpoints sem verificação de role | routes/lara.ts | ALTA |
| P05 | Nenhum endpoint Lara verifica perfil do usuário autenticado | routes/lara.ts | ALTA |
| P06 | Política de negociação editável por qualquer perfil | routes/lara.ts:833 | ALTA |
| P07 | Opt-out removível por qualquer perfil | routes/lara.ts:629 | MÉDIA |
| P08 | Configurações globais alteráveis por qualquer perfil | routes/lara.ts:572 | MÉDIA |

---

## 3. AÇÕES CRÍTICAS SEM BLOQUEIO NO BACKEND

| Ação | Endpoint | Verificação atual | Risco |
|---|---|---|---|
| Gerar boleto | POST /pagamentos/boleto | Nenhuma | ALTO |
| Enviar PIX | POST /pagamentos/pix | Nenhuma | ALTO |
| Alterar política de negociação | PUT /negociacao/politicas/:etapa | Nenhuma | ALTO |
| Remover opt-out | DELETE /optout/:id | Nenhuma | ALTO |
| Injetar título no cache | POST /admin/inject-titulo-teste | Nenhuma | CRÍTICO |
| Deletar título do cache | DELETE /admin/titulo-cache/:id | Nenhuma | CRÍTICO |
| Forçar sync Oracle | POST /admin/forcar-sync-codcli | Nenhuma | ALTO |
| Purgar CODCOB inválidos | POST /admin/purge-invalid-codcob | Nenhuma | ALTO |
| Salvar configurações | PUT /regua/config | Nenhuma | ALTO |

---

## 4. ROTAS ACESSÍVEIS INDEVIDAMENTE

Dado que `/api/lara/` é público (sem JWT):

| Rota | Dados expostos |
|---|---|
| GET /api/lara/clientes | Nome, telefone, valor em aberto, CODCLI |
| GET /api/lara/clientes/:codcli | Dados completos do cliente |
| GET /api/lara/titulos | Valores, vencimentos, duplicatas |
| GET /api/lara/conversas | Histórico de mensagens WhatsApp |
| GET /api/lara/promessas | Promessas de pagamento |
| GET /api/lara/logs | Logs de cobrança com textos das mensagens |
| GET /api/lara/cases | Cases de atendimento |
| GET /api/lara/compliance/auditoria | Trilha de auditoria completa |

---

## 5. RECOMENDAÇÕES

### Correção emergencial (1 hora)

1. Definir `LARA_API_KEY` no `.env` como medida de curto prazo
2. Remover `/api/lara/` de `publicPathPrefixes` no `server.ts`

### Correção estrutural — Frontend RBAC (2 dias)

Implementar `permissions.ts` com lookup real:

```typescript
// src/contexts/AuthContext.tsx
export type LaraUser = {
  id: string;
  nome: string;
  email: string;
  perfil: 'ADMIN' | 'FINANCEIRO' | 'OPERACIONAL' | 'CONSULTA';
};

// Definir permissões por perfil
const ROTINAS_POR_PERFIL: Record<string, string[]> = {
  ADMIN: ['LARA_NEGOCIACAO', 'LARA_CLIENTES', 'LARA_TITULOS', 'LARA_LOGS', 'LARA_CONFIG'],
  FINANCEIRO: ['LARA_NEGOCIACAO', 'LARA_CLIENTES', 'LARA_TITULOS', 'LARA_PROMESSAS'],
  OPERACIONAL: ['LARA_CLIENTES', 'LARA_ATENDIMENTOS', 'LARA_CASES'],
  CONSULTA: ['LARA_CLIENTES', 'LARA_TITULOS'],
};

const ACOES_POR_PERFIL: Record<string, LaraAction[]> = {
  ADMIN: ['VISUALIZAR', 'CRIAR', 'EDITAR', 'EXCLUIR', 'ALTERAR_DESCONTO',
          'ALTERAR_PARCELAMENTO', 'SALVAR_PARAMETROS', 'AUDITAR', 'EXPORTAR'],
  FINANCEIRO: ['VISUALIZAR', 'CRIAR', 'EDITAR', 'ALTERAR_DESCONTO', 'ALTERAR_PARCELAMENTO'],
  OPERACIONAL: ['VISUALIZAR', 'CRIAR'],
  CONSULTA: ['VISUALIZAR'],
};

export function canAccess(rotina: string): boolean {
  const user = useAuthUserSync(); // store ou context
  if (!user) return false;
  return ROTINAS_POR_PERFIL[user.perfil]?.includes(rotina) ?? false;
}

export function canAction(rotina: string, action: LaraAction): boolean {
  if (!canAccess(rotina)) return false;
  const user = useAuthUserSync();
  if (!user) return false;
  return ACOES_POR_PERFIL[user.perfil]?.includes(action) ?? false;
}
```

### Correção estrutural — Backend RBAC (1-2 dias)

Adicionar verificação de role nos handlers críticos:

```typescript
// utils/authorization.ts
export function requireRole(req: FastifyRequest, roles: string[]): void {
  const user = (req as any).authUser;
  if (!user || !roles.includes(user.perfil)) {
    const err: any = new Error('Não autorizado para esta operação.');
    err.statusCode = 403;
    throw err;
  }
}

// Em routes/lara.ts:
app.put("/api/lara/negociacao/politicas/:etapa", async (req) => {
  requireRole(req, ['ADMIN', 'FINANCEIRO']);
  // ...
});

app.delete("/api/lara/admin/titulo-cache/:id", async (req) => {
  requireRole(req, ['ADMIN']);
  // ...
});
```

---

## 6. MODELO IDEAL DE PERMISSÕES PARA A LARA

| Perfil | Acesso |
|---|---|
| ADMIN | Tudo — configurações, políticas, admin endpoints, logs, auditoria |
| FINANCEIRO | Clientes, títulos, boleto, PIX, negociação, promessas |
| OPERACIONAL | Clientes, atendimentos, cases, conversas |
| CONSULTA | Leitura de clientes e títulos apenas |
| SISTEMA | Webhooks, regua (sem sessão humana) |
