# RELATÓRIO UI/UX — SISTEMA LARA

**Data:** 2026-06-02

---

## 1. PADRÃO VISUAL IDENTIFICADO

O sistema Lara usa **shadcn/ui** como base (Radix UI primitives + Tailwind CSS), com design system próprio em `src/components/lara/`. O padrão é consistente, dark-mode ready via CSS variables, com tipografia e espaçamento uniformes.

### Design System Lara

| Componente | Arquivo | Status |
|---|---|---|
| Layout | LaraLayout.tsx | ✅ Consistente |
| Container de página | LaraPageContainer.tsx | ✅ Consistente |
| Header de página | PageHeader.tsx | ✅ Consistente |
| Sidebar | LaraSidebar.tsx | ✅ Consistente |
| KPI Cards | CardKPI.tsx | ✅ Consistente |
| Status Badge | StatusBadge.tsx | ✅ Consistente |
| Empty State | EmptyState.tsx | ✅ Consistente |
| Table Skeleton | TableSkeleton.tsx | ✅ Consistente |
| Permission Gate | LaraPermissionGate.tsx | ✅ UI ok |
| Restricted State | LaraRestrictedState.tsx | ✅ Consistente |
| Sensitive Text | LaraSensitiveText.tsx | ✅ Consistente |
| Risk Badge | RiskBadge.tsx | ✅ Consistente |
| Alert Card | AlertCard.tsx | ✅ Consistente |
| Filter Bar | FilterBar.tsx | ✅ Consistente |
| Health Indicator | HealthIndicator.tsx | ✅ Consistente |
| Severity Badge | SeverityBadge.tsx | ✅ Consistente |
| EtapaReguaBadge | EtapaReguaBadge.tsx | ✅ Consistente |
| FilialGlobalFilter | FilialGlobalFilter.tsx | ✅ Consistente |

---

## 2. TELAS CONFORMES

| Rota | Status Visual | Observação |
|---|---|---|
| /lara/dashboard | ✅ Conforme | KPIs, gráficos Recharts, tabela |
| /lara/atendimentos | ✅ Conforme | Lista com filtros, status badges |
| /lara/conversas | ✅ Conforme | Timeline de mensagens |
| /lara/clientes | ✅ Conforme | Tabela paginada, filtros |
| /lara/clientes/:id | ✅ Conforme | Detalhe com histórico, abas |
| /lara/titulos | ✅ Conforme | Tabela com KPIs |
| /lara/regua-ativa | ✅ Conforme | Dashboard de régua |
| /lara/regua-config | ✅ Conforme | Configuração por etapa |
| /lara/cases | ✅ Conforme | Lista com filtros |
| /lara/optout | ✅ Conforme | Lista gerenciável |
| /lara/logs | ✅ Conforme | Tabela de logs |
| /lara/configuracoes | ✅ Conforme | Formulário de config |
| /lara/monitoramento | ✅ Conforme | Health indicators |
| /lara/promessas | ✅ Conforme | Lista de promessas |
| /lara/feedback | ✅ Conforme | Insights com gráficos |
| /lara/dashboard-preditivo | ✅ Conforme | Indicadores preditivos |

---

## 3. TELAS PARCIALMENTE CONFORMES

| Rota | Problema | Recomendação |
|---|---|---|
| /lara/negociacao | Abas Alçadas e Histórico com EmptyState | Implementar ou remover abas |
| /lara/portal/:token | Tela pública — não segue LaraLayout | Correto por ser público, mas verificar branding |

---

## 4. ANÁLISE DETALHADA DA ROTA /lara/negociacao

### Status: PARCIALMENTE CONFORME

**O que está correto:**

✅ Usa `LaraLayout` como todas as outras páginas  
✅ `LaraPageContainer` com padding consistente  
✅ `PageHeader` com título, subtítulo e ações  
✅ 4 `CardKPI` no topo — Políticas ativas, Desconto médio, Parcelamento máx., Entrada média  
✅ `Alert` de aviso financeiro sempre visível com ícone `LockKeyhole`  
✅ `TableSkeleton` durante carregamento  
✅ `Alert variant="destructive"` para erros de API  
✅ `EmptyState` quando nenhuma etapa está sendo editada  
✅ Tabela com colunas: Etapa, Perfil, Atraso, Desconto, Entrada, Parcelas, Validade, Alçada, Status, Ação  
✅ `AlertDialog` de confirmação antes de salvar — exibe diff de campos  
✅ Inputs desabilitados por permissão (lógica de UI correta, mesmo sem RBAC funcional)  
✅ `DisabledTooltip` no botão Salvar quando sem permissão  
✅ Tab Simulador funcional — conecta à API real `/negociacao/simular`  
✅ Responsividade: `grid-cols-2 md:grid-cols-4`, `sm:flex-row`, `2xl:grid-cols-[minmax...]`  
✅ Tipografia consistente: `text-base` para títulos de card, `text-xs text-muted-foreground` para subtítulos  
✅ Hover effects nas linhas da tabela: `hover:bg-muted/20`  
✅ Bordas e separadores consistentes  

**O que está incompleto:**

⚠️ Tab "Alçadas" → `EmptyState` com "Alçadas ainda não disponíveis"  
⚠️ Tab "Histórico" → `EmptyState` com "Sem histórico disponível"  
⚠️ Coluna "Validade" exibe "Não definida" hardcoded para todas as etapas  
⚠️ Coluna "Alçada" exibe Badge "Operação" hardcoded para todas as etapas  
⚠️ Botão "Ver logs" na header redireciona para aba "Histórico" que está vazia  

**Classificação da tela:** `PARCIALMENTE CONFORME`

**Severidade dos problemas:** MÉDIA — a tela abre, carrega, funciona para editar políticas e simular. As lacunas são de funcionalidade pendente, não de layout quebrado.

---

## 5. RECOMENDAÇÕES OBJETIVAS

### Alta prioridade

1. **Implementar Tab Alçadas** — Criar `LARA_ALCADAS` no banco com limite por perfil+etapa. Exibir na tabela. Integrar com `canAction` quando RBAC for implementado.

2. **Implementar Tab Histórico** — Criar endpoint `GET /api/lara/negociacao/historico` retornando log de quem alterou qual política, quando e com qual valor anterior/novo.

3. **Remover ou substituir valores hardcoded** — "Não definida" e "Operação" devem vir da API.

### Média prioridade

4. **Lazy loading das páginas** — Reduzir o bundle de 1MB com `React.lazy()` por rota.

5. **Estados de loading mais granulares** — No simulador, usar `simMutation.isPending` para desabilitar campos (já implementado — apenas verificar consistência em todos os pontos).

6. **Filtro global de filial** — Verificar se `FilialGlobalFilter` está conectado corretamente na tela de negociação.

### Baixa prioridade

7. **Acessibilidade** — Adicionar `aria-label` nos botões de ação da tabela.

8. **Toast de sucesso** — Após salvar política, exibir toast de confirmação (atualmente só fecha o dialog).

---

## 6. PADRÃO VISUAL AVALIADO

| Elemento | Avaliação |
|---|---|
| Sidebar | ✅ Consistente com ícones, labels, active state |
| Topbar / header de página | ✅ Consistente |
| Cards | ✅ shadcn Card com bordas, header, content |
| KPIs | ✅ CardKPI com ícone, label, valor |
| Tabelas | ✅ Table com thead/tbody padronizados |
| Formulários | ✅ Label + Input com validação |
| Botões primários | ✅ Button variant="default" |
| Botões secundários | ✅ Button variant="outline" |
| Botões destrutivos | ✅ Button variant="destructive" / AlertDialog |
| Badges | ✅ Badge variant="secondary/outline/destructive" |
| Modais | ✅ AlertDialog para confirmações críticas |
| Drawers | ✅ Sheet/Drawer componentes disponíveis |
| Toasts | ✅ Sonner + Radix Toaster configurados |
| Tooltips | ✅ DisabledTooltip implementado |
| Estados vazios | ✅ EmptyState component |
| Estados de erro | ✅ Alert variant="destructive" |
| Estados de loading | ✅ TableSkeleton |
| Responsividade | ✅ Grid adaptativo (2 cols → 4 cols) |
| Contraste | ✅ CSS variables com muted/foreground |
| Ícones | ✅ Lucide React padronizado |
| Hierarquia visual | ✅ text-base → text-sm → text-xs claramente definidos |
