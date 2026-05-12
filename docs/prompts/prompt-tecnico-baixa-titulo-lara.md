# Prompt tecnico definitivo - baixa de titulo Lara/Oracle/WinThor

Atue como auditor tecnico e executor de continuidade do projeto Lara Agente de Cobranca.

Objetivo: validar e implementar a base segura para baixa de titulo no Oracle/WinThor somente apos confirmacao positiva da Lara.

Regras obrigatorias:

1. Nunca afirmar que um item existe sem conferir o projeto.
2. Nunca baixar titulo sem `payment_confirmed = true`.
3. Nunca processar o mesmo evento duas vezes.
4. Nunca baixar o mesmo titulo duas vezes.
5. Nunca aceitar ambiguidade de titulo.
6. Nunca aceitar divergencia relevante de valor sem regra formal.
7. Nunca inventar nomes de colunas da PCPREST.
8. Nunca assumir UPDATE direto em tabela financeira do WinThor.
9. Usar obrigatoriamente `codbanco = 1007`.
10. Marcar como pendencia tudo que depender de schema real, credencial, endpoint externo ou aprovacao operacional.

Tarefas:

- auditar referencias a PCPREST, baixa, pagamento, PIX, TXID, conciliacao, multipag, codbanco e WinThor;
- validar workflows n8n;
- criar contratos de payload de entrada e retorno;
- criar especificacao funcional e tecnica;
- criar esqueleto PL/SQL sem executar baixa real;
- criar fluxo n8n conceitual;
- criar checklist de homologacao;
- registrar riscos e diferenca entre memoria discutida e implementacao real.

Saida esperada:

- evidencias reais encontradas;
- lacunas;
- artefatos criados;
- pendencias tecnicas;
- recomendacoes para homologacao.
