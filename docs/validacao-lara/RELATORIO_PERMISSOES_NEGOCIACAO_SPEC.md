# ESPECIFICAÇÃO DE PERMISSÕES — TELA /lara/negociacao

**Data:** 2026-06-02

Este documento especifica as permissões que DEVERIAM ser verificadas na tela de negociação, baseado no código existente e nos tipos definidos em permissions.ts.

---

## ROTINA: LARA_NEGOCIACAO

| Ação | Permissão necessária | Campo afetado | Status atual |
|---|---|---|---|
| Visualizar a tela | canAccess('LARA_NEGOCIACAO') | — | Sempre liberado |
| Ver tabela de políticas | VISUALIZAR | tabela | Sempre liberado |
| Clicar em "Editar" etapa | EDITAR | — | Sempre liberado |
| Alterar desconto_maximo_pct | ALTERAR_DESCONTO | Input desconto | UI ok (input disabled), mas lógica sempre true |
| Alterar entrada_minima_pct | ALTERAR_PARCELAMENTO | Input entrada | UI ok, mas lógica sempre true |
| Alterar parcelas_maximas | ALTERAR_PARCELAMENTO | Input parcelas | UI ok, mas lógica sempre true |
| Ativar/Inativar política | ALTERAR_VALIDADE | Switch ativo | UI ok, mas lógica sempre true |
| Confirmar e salvar | SALVAR_PARAMETROS | Botão salvar | UI ok (DisabledTooltip se !canSave), mas lógica sempre true |
| Executar simulação | TESTAR_REGRA | Botão simular | UI ok (botão disabled), mas lógica sempre true |
| Ver histórico | AUDITAR | Tab histórico | Sem implementação |
| Ver alçadas | ALTERAR_ALCADA | Tab alçadas | Sem implementação |

## O QUE FUNCIONA CORRETAMENTE NA UI

- Se `canSave = false` (atualmente nunca ocorre) → `DisabledTooltip` é exibido
- Se `canTestRule = false` (atualmente nunca ocorre) → Botão "Testar Regra" e campos desabilitados
- Se `!hasRoutineAccess` (atualmente nunca ocorre) → `LaraRestrictedState` é exibido
- Inputs ficam `disabled` quando `readOnly || !canAlterDiscount` (atualmente sempre falso)

## O QUE PRECISA SER CORRIGIDO

1. `canAccess()` e `canAction()` devem retornar valores reais baseados no perfil do usuário logado
2. Backend deve rejeitar com 403 as alterações via `PUT /negociacao/politicas/:etapa` quando o usuário não tem permissão
