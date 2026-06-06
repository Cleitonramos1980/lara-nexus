# PROMPT DE CORREÇÃO — SISTEMA LARA

**Data de geração:** 2026-06-02  
**Uso:** Colar este prompt numa nova sessão do Claude Code para executar as correções identificadas na validação.

---

## PROMPT PRONTO PARA USAR

```
Você é o Claude Code atuando como ENGENHEIRO SÊNIOR FULLSTACK.

Sua missão é CORRIGIR os problemas identificados na validação completa do sistema Lara.
O sistema Lara é um Agente Autônomo de Cobrança via WhatsApp com painel de gestão.
Lara é um sistema INDEPENDENTE, não é módulo da Torre de Controle.

==================================================
CONTEXTO DO PROJETO
==================================================

Stack:
- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- Backend: Fastify + TypeScript + Oracle + SQLite
- Localização: c:/Users/cleit/Documents/New project 2/lara-nexus/

Arquivos críticos:
- Backend entry: backend/src/server.ts
- Endpoints Lara: backend/src/routes/lara.ts
- Permissões frontend: src/components/lara/permissions.ts
- Auth: backend/src/utils/jwt.ts
- Env: backend/.env
- Build: npm run build (frontend), npm run dev (backend)
- Testes: npm run test:lara (backend), npm run test (frontend)

==================================================
PROBLEMAS A CORRIGIR (em ordem de prioridade)
==================================================

CORREÇÃO 1 — CRÍTICA: Endpoints /api/lara/ sem autenticação
Arquivo: backend/src/server.ts linhas 113-118
Problema: "/api/lara/" está em publicPathPrefixes — todos os endpoints são públicos.
Ação: 
1. Remover "/api/lara/" de publicPathPrefixes.
2. Criar lista específica de rotas Lara que são legitimamente públicas:
   - GET e POST /api/lara/webhook/meta (verificação Meta + recebimento de eventos)
   - POST /api/lara/webhooks/whatsapp-inbound
   - POST /api/lara/webhooks/whatsapp-status  
   - POST /api/lara/webhooks/regua-resultado
   - POST /api/lara/bradesco/pix/webhook
   - POST /api/lara/bradesco/pix/reconciliar
   - POST /api/lara/bradesco/bolepix/webhook/pagamento
   - GET /api/lara/portal/:token (skipLaraAuth já definido)
   - POST /api/lara/portal/:token/pagar (skipLaraAuth já definido)
3. Para as rotas marcadas com config.skipLaraAuth, respeitar esse flag.
4. Para o restante de /api/lara/, exigir JWT (Bearer) OU LARA_API_KEY válida.
5. Após a correção, rodar npm run test:lara para verificar que não quebrou nada.

CORREÇÃO 2 — CRÍTICA: permissions.ts sempre retorna true
Arquivo: src/components/lara/permissions.ts
Problema: canAccess() e canAction() retornam Boolean(rotina) — sem verificação real.
Ação:
1. Verificar como o usuário logado é armazenado no frontend — procurar contexto de auth ou store.
2. Se não existir contexto de auth, criar src/contexts/AuthContext.tsx com hook useAuthUser().
3. O token JWT decodificado deve conter campo "perfil" (ex: ADMIN, FINANCEIRO, OPERACIONAL, CONSULTA).
4. Implementar ROTINAS_POR_PERFIL e ACOES_POR_PERFIL maps em permissions.ts.
5. canAccess(rotina) deve retornar false se usuário não tiver rotina no perfil.
6. canAction(rotina, action) deve retornar false se usuário não tiver ação no perfil.
7. Default seguro: se perfil desconhecido ou usuário não logado → retornar false.
8. Manter compatibilidade: não quebrar telas que hoje dependem de canAccess retornando true.
   (ou seja, para o perfil ADMIN, manter acesso total)

CORREÇÃO 3 — ALTA: Admin endpoints sem proteção de role
Arquivo: backend/src/routes/lara.ts
Endpoints afetados:
- POST /api/lara/admin/inject-titulo-teste
- DELETE /api/lara/admin/titulo-cache/:id
- POST /api/lara/admin/forcar-sync-codcli
- POST /api/lara/admin/purge-invalid-codcob
- GET /api/lara/admin/oracle-pcprest
- GET /api/lara/admin/pcfilial-columns
Ação:
1. Criar helper requireRole(req, roles[]) em backend/src/utils/authorization.ts.
2. Adicionar requireRole(req, ['ADMIN']) no início de cada handler admin.
3. Adicionar requireRole(req, ['ADMIN', 'FINANCEIRO']) no handler de PUT /negociacao/politicas/:etapa.

CORREÇÃO 4 — ALTA: CORS muito permissivo
Arquivo: backend/src/server.ts linha 179
Problema: origin: true — aceita qualquer origem.
Ação: 
1. Adicionar variável CORS_ALLOWED_ORIGIN ao schema de env.ts (opcional, default: '*').
2. Em produção (NODE_ENV=production), usar apenas as origens configuradas.
3. Em desenvolvimento, manter true para facilitar desenvolvimento local.

CORREÇÃO 5 — MÉDIA: React hooks warnings no ESLint
Arquivos: src/pages/lara/LaraAtendimentos.tsx, src/pages/lara/LaraConversas.tsx
Problema: Variáveis declaradas fora de useMemo usadas como dependências de useEffect.
Ação: Envolver a variável problemática em useMemo() como sugerido pelo linter.

CORREÇÃO 6 — BAIXA: Browserslist desatualizado
Ação: Executar npx update-browserslist-db@latest na raiz do projeto.

==================================================
REGRAS DE EXECUÇÃO
==================================================

- Execute as correções em ordem: 1 → 2 → 3 → 4 → 5 → 6.
- Após cada correção, rode o build e os testes para confirmar que não quebrou nada.
- Não remova endpoints existentes — apenas adicione proteção.
- Não altere contratos de API (request/response shapes).
- Não modifique arquivos de banco de dados ou SQL.
- Se uma correção criar risco de quebrar funcionalidade existente, pause e descreva o problema.
- Após todas as correções, rode npm run build e npm run test:lara e reporte os resultados.

==================================================
ENTREGA ESPERADA
==================================================

1. Todas as correções implementadas nos arquivos corretos.
2. Build frontend passando (npm run build).
3. Testes backend passando (npm run test:lara — 24/24).
4. Lint com 0 erros e <= 5 warnings.
5. Resumo de cada mudança feita.
```
