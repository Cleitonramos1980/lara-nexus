# Lara - Ajustes Autonomos (2026-04-26)

## Escopo

Ajustes aplicados apenas com mudancas locais de codigo, sem depender de credenciais externas novas ou alteracoes destrutivas no banco.

## Backend Lara

1. **Resposta conversacional via LLM (OpenAI)**
   - arquivo: `backend/src/modules/lara/service.ts`
   - acao: respostas de `negociar` e `resposta_padrao` agora tentam compor texto com OpenAI usando contexto financeiro real (cliente + titulos + total).
   - fallback: se OpenAI falhar ou estiver desabilitado, retorna mensagem deterministica segura.
   - observabilidade: logs de integracao `openai/reply-composer` com `processado` ou `fallback_local`.

2. **Scheduler de follow-up de promessa vencida**
   - arquivos:
     - `backend/src/modules/lara/promiseFollowupScheduler.ts`
     - `backend/src/server.ts`
   - acao:
     - roda automaticamente no boot do backend;
     - varre promessas vencidas;
     - cria case `PROMESSA_VENCIDA_FOLLOWUP`;
     - registra mensagem outbound pendente e log de integracao com idempotencia.

3. **Configuracoes default para follow-up**
   - arquivo: `backend/src/modules/lara/operationalStore.ts`
   - chaves adicionadas:
     - `LARA_PROMESSA_FOLLOWUP_ATIVO=true`
     - `LARA_PROMESSA_FOLLOWUP_INTERVAL_MIN=10`

4. **Novas variaveis de ambiente**
   - arquivo: `backend/src/config/env.ts`
   - adicionadas:
     - `LARA_AI_RESPONSE_ENABLED` (default `true`)
     - `LARA_AI_RESPONSE_MAX_TOKENS` (default `280`)

## n8n (workflow hardened)

1. arquivo criado:
   - `docs/n8n/whatsapp-to-lara-system-message-orchestration-ok-hardened.json`
2. ajustes principais:
   - `active: true`
   - remocao de `trycloudflare.com`
   - remocao de `PREENCHER_LARA_API_KEY`
   - validacao real de segredo PIX com variavel de ambiente
   - timeout habilitado
3. script utilitario:
   - `scripts/harden-n8n-workflow.cjs`

## Validacao local executada

- compilacao TypeScript backend: **ok**
- testes Lara (`src/modules/lara/__tests__/*.test.ts`): **24/24 ok**

## Pendencias que continuam externas

- credenciais reais WhatsApp/n8n;
- ativacao/importacao do workflow no n8n em ambiente alvo;
- endpoints externos produtivos e DNS fixo;
- baixa financeira real no WinThor apos PIX (a reconciliacao permanece sem baixa automatica homologada).
