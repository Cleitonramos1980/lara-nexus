
## Análise do Projeto Atual

O projeto é um template vazio (página placeholder, sem rotas, menus ou módulos existentes). **Não há legado a preservar** — apenas a estrutura base do Vite + React + Tailwind + shadcn.

### Arquivos impactados (somente adições ou edições mínimas):
- `src/index.css` — design system tokens (cores corporativas)
- `tailwind.config.ts` — tokens extras
- `src/App.tsx` — adicionar rotas do módulo Lara
- `src/pages/Index.tsx` — redirecionar para /lara/dashboard

### Arquivos criados (novo módulo):
- `src/data/lara-mock.ts` — dados mock coerentes
- `src/components/lara/` — ~16 componentes base reutilizáveis
- `src/pages/lara/` — 10 páginas do módulo
- `src/components/lara/LaraLayout.tsx` — shell com sidebar
- `src/components/lara/LaraSidebar.tsx` — menu lateral

## Estratégia de Implementação (6 etapas)

### Etapa 1 — Design System + Shell
- Tokens corporativos (azul profundo, cinza neutro, acentos de status)
- LaraLayout + LaraSidebar com todos os submenus
- Rotas no App.tsx

### Etapa 2 — Componentes Base
- PageHeader, CardKPI, StatusBadge, FilterBar, DataTable, EmptyState, etc.

### Etapa 3 — Dados Mock
- Clientes, títulos, atendimentos, cases, régua, logs, opt-out

### Etapa 4 — Páginas Principais (Dashboard, Atendimentos, Clientes, Títulos)

### Etapa 5 — Páginas Secundárias (Régua Ativa, Cases, Opt-out, Logs, Config, Monitoramento)

### Etapa 6 — Acabamento premium

### Garantias:
- Nenhum arquivo existente será removido
- Placeholder Index redirecionará para /lara/dashboard
- Todo texto em PT-BR
- CPF/CNPJ mascarados
- Ações preparadas para integração futura (callbacks/handlers sem lógica real)
