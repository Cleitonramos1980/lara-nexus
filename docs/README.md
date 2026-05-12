# Documentacao Lara - continuidade 2026-04-10 a 2026-04-25

Este indice organiza os artefatos criados para restaurar a continuidade tecnica e funcional do modulo Lara Agente de Cobranca.

## Auditoria e memoria de projeto

- `auditoria-lara-ultimos-15-dias.md`: relatorio tecnico da auditoria, com evidencias reais, lacunas, itens criados e pendencias.

## WhatsApp, n8n e Lara

- `whatsapp-lara-fluxo-funcional.md`: fluxo funcional ponta a ponta WhatsApp -> Lara -> espera -> busca -> WhatsApp.
- `n8n/lara-whatsapp-polling-reconstruido-README.md`: instrucao de uso do workflow reconstruido.
- `n8n/n8n-cloud-2.13.3-lara-whatsapp-polling-reconstruido.json`: workflow n8n conceitual/importavel com nomes normalizados.

## PIX, conciliacao e multipag

- `pagamentos-pix-conciliacao-multipag.md`: base conceitual para PIX, TXID, conciliacao bancaria e multipag.

## RECONAI recebiveis cartao (importado do quality)

- `reconai/reconai-recebiveis-cartao-winthor.md`: estudo tecnico das tabelas WinThor (`PCCOB`, `PCPEDC`, `PCPEDI`, `PCFILIAL`, `PCPLPAG`).
- `reconai/reconai-recebiveis-cartao-lara-integracao.md`: guia de aplicacao do estudo no contexto da Lara.
- `../backend/scripts/sql/recebiveis_cartao_winthor.sql`: SQL base de vendas faturadas e inconsistencias para recebiveis cartao.

## Baixa de titulo Oracle/WinThor

- `baixa-titulo-lara-funcional.md`: documento funcional da baixa apos confirmacao positiva da Lara.
- `baixa-titulo-lara-tecnica.md`: especificacao tecnica, contratos, codigos de retorno, idempotencia, auditoria e riscos.
- `oracle/baixa-pix-processo-operacional.md`: playbook operacional consolidado para baixa PIX pos-confirmacao.
- `oracle/referencia-baixa-titulo-1322007.md`: baseline real validada de baixa no Oracle (PCPREST/PCMOVCR).
- `oracle/referencia-baixa-titulo-1322007.json`: evidencia estruturada da baseline de baixa.
- `contracts/lara-payment-confirmation-input.example.json`: payload de entrada sugerido.
- `contracts/lara-settlement-response.example.json`: payload de retorno padronizado sugerido.
- `oracle/lara_baixa_titulo_pkg_skeleton.sql`: esqueleto PL/SQL conceitual, sem executar baixa real.
- `n8n/lara-baixa-titulo-pos-confirmacao-conceitual.json`: fluxo n8n conceitual para baixa apos confirmacao.
- `prompts/prompt-tecnico-baixa-titulo-lara.md`: prompt tecnico definitivo para continuidade.
- `homologacao-lara-baixa-titulo-checklist.md`: checklist de homologacao e cenarios de teste.

## Regra de seguranca

Nenhum artefato novo autoriza UPDATE direto em tabela financeira do WinThor. A baixa real depende de validacao do schema, estrategia oficial do ambiente, credenciais, rotina homologada e aprovacao operacional.
