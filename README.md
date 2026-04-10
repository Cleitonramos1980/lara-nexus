# Lara - Agente de Cobranca

Frontend React do modulo Lara, conectado ao backend Fastify do repositorio `quality-navigator`.

## Stack

- React + TypeScript + Vite
- shadcn/ui + Tailwind
- React Router
- TanStack Query

## Rotas mantidas no frontend Lara

- `/lara/dashboard`
- `/lara/atendimentos`
- `/lara/conversas`
- `/lara/clientes`
- `/lara/clientes/:id`
- `/lara/titulos`
- `/lara/regua-ativa`
- `/lara/regua-config`
- `/lara/cases`
- `/lara/optout`
- `/lara/logs`
- `/lara/configuracoes`
- `/lara/monitoramento`

## Variaveis de ambiente

Copie `.env.example` para `.env`:

```bash
cp .env.example .env
```

Valores:

- `VITE_LARA_API_BASE_URL`: URL base da API Lara (padrao `http://localhost:3333/api`)
- `VITE_LARA_API_KEY`: chave opcional enviada no header `x-lara-api-key`

## Execucao local

1. Instalar dependencias:

```bash
npm ci
```

2. Subir o frontend:

```bash
npm run dev
```

Aplicacao local: `http://localhost:5173`

## Integracao com backend

Este frontend consome endpoints em `/api/lara/*`, incluindo:

- dashboard e monitoramento
- clientes, titulos e conversas
- pagamentos (boleto, pix, promessa)
- regua (ativa, config, execucoes)
- cases, opt-out e logs
- webhooks operacionais (via n8n/WhatsApp)

## Scripts uteis

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run test`
- `npm run lint`
