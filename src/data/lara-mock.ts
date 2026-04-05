// Dados mock coerentes para o módulo Lara | Cobrança Inteligente

export interface Cliente {
  codcli: string;
  cliente: string;
  telefone: string;
  wa_id: string;
  cpf_cnpj: string;
  filial: string;
  total_aberto: number;
  qtd_titulos: number;
  titulo_mais_antigo: string;
  proximo_vencimento: string;
  ultimo_contato: string;
  ultima_acao: string;
  proxima_acao: string;
  optout: boolean;
  etapa_regua: string;
  status: string;
  responsavel: string;
  risco: 'baixo' | 'medio' | 'alto' | 'critico';
}

export interface Titulo {
  id: string;
  duplicata: string;
  prestacao: string;
  codcli: string;
  cliente: string;
  telefone: string;
  valor: number;
  vencimento: string;
  dias_atraso: number;
  etapa_regua: string;
  status_atendimento: string;
  boleto_disponivel: boolean;
  ultima_acao: string;
  responsavel: string;
  filial: string;
}

export interface Atendimento {
  id: string;
  codcli: string;
  cliente: string;
  telefone: string;
  wa_id: string;
  status: string;
  origem: string;
  ultima_mensagem: string;
  ultima_interacao: string;
  etapa: string;
  qtd_titulos: number;
  boleto_enviado: boolean;
  promessa: boolean;
  optout: boolean;
}

export interface CaseItem {
  id: string;
  data_hora: string;
  cliente: string;
  codcli: string;
  wa_id: string;
  acao: string;
  etapa: string;
  duplicatas: string;
  valor_total: number;
  forma_pagamento: string;
  origem: string;
  responsavel: string;
  detalhe: string;
}

export interface LogItem {
  id: string;
  data_hora: string;
  tipo: string;
  modulo: string;
  cliente: string;
  wa_id: string;
  codcli: string;
  etapa: string;
  mensagem: string;
  severidade: 'sucesso' | 'aviso' | 'erro' | 'bloqueado';
  status: string;
  origem: string;
}

export interface OptoutItem {
  id: string;
  wa_id: string;
  codcli: string;
  cliente: string;
  motivo: string;
  ativo: boolean;
  data_criacao: string;
  data_atualizacao: string;
  origem: string;
  observacao: string;
}

export interface ReguaEtapa {
  etapa: string;
  elegivel: number;
  enviado: number;
  respondido: number;
  convertido: number;
  erro: number;
  bloqueado_optout: number;
  taxa_resposta: number;
  taxa_recuperacao: number;
}

export interface ReguaExecucao {
  id: string;
  data_hora: string;
  etapa: string;
  elegivel: number;
  disparada: number;
  erro: number;
  respondida: number;
  valor_impactado: number;
  status: string;
}

export function maskCpfCnpj(doc: string): string {
  if (doc.length === 14) return doc.replace(/(\d{2})\d{3}\.\d{3}\/\d{4}-(\d{2})/, '$1.***.***/$2');
  if (doc.length === 11) return doc.replace(/(\d{3})\d{3}\d{3}(\d{2})/, '$1.***.***-$2');
  return '***';
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const FILIAIS = ['Matriz Manaus', 'Filial Belém', 'Filial Agrestina', 'Loja 36', 'Loja 59', 'CD Norte'];
export const RESPONSAVEIS = ['Lara Automação', 'Operador Financeiro 01', 'Operador Financeiro 02', 'Supervisão de Cobrança'];
export const ETAPAS_REGUA = ['D-3', 'D0', 'D+3', 'D+7', 'D+15', 'D+30'];
export const STATUS_ATENDIMENTO = [
  'Aguardando resposta', 'Cliente respondeu', 'Cliente identificado', 'Cliente não identificado',
  'Boleto enviado', 'PIX enviado', 'Promessa registrada', 'Escalado para humano',
  'Encerrado', 'Opt-out ativo', 'Falha operacional'
];
export const TIPOS_CASE = [
  'PAGAMENTO_ENVIADO', 'PROMESSA_PAGAMENTO', 'NEGOCIACAO', 'INFO', 'ATIVO_DISPARO',
  'OPTOUT_SET', 'OPTOUT_CLEAR', 'BOLETO_REENVIADO', 'ERRO_OPERACIONAL'
];

export const mockClientes: Cliente[] = [
  { codcli: '10234', cliente: 'Comercial Norte Distribuidora Ltda', telefone: '(92) 99812-3456', wa_id: '5592998123456', cpf_cnpj: '12345678000190', filial: 'Matriz Manaus', total_aberto: 87450.00, qtd_titulos: 12, titulo_mais_antigo: '2024-11-15', proximo_vencimento: '2025-04-08', ultimo_contato: '2025-04-04 14:32', ultima_acao: 'Boleto enviado', proxima_acao: 'Aguardar pagamento', optout: false, etapa_regua: 'D+7', status: 'Boleto enviado', responsavel: 'Lara Automação', risco: 'alto' },
  { codcli: '10456', cliente: 'Atacadão Manaus Utilidades Ltda', telefone: '(92) 99734-5678', wa_id: '5592997345678', cpf_cnpj: '23456789000180', filial: 'Matriz Manaus', total_aberto: 23100.50, qtd_titulos: 4, titulo_mais_antigo: '2025-01-20', proximo_vencimento: '2025-04-10', ultimo_contato: '2025-04-05 09:15', ultima_acao: 'Cliente respondeu', proxima_acao: 'Enviar boleto', optout: false, etapa_regua: 'D0', status: 'Cliente respondeu', responsavel: 'Lara Automação', risco: 'medio' },
  { codcli: '10789', cliente: 'Rede Ponto Econômico Comércio Ltda', telefone: '(91) 98812-9012', wa_id: '5591988129012', cpf_cnpj: '34567890000170', filial: 'Filial Belém', total_aberto: 156320.00, qtd_titulos: 22, titulo_mais_antigo: '2024-09-10', proximo_vencimento: '2025-04-05', ultimo_contato: '2025-04-03 16:45', ultima_acao: 'Promessa registrada', proxima_acao: 'Verificar pagamento', optout: false, etapa_regua: 'D+15', status: 'Promessa registrada', responsavel: 'Operador Financeiro 01', risco: 'critico' },
  { codcli: '11023', cliente: 'Mercantil Oliveira e Filhos', telefone: '(92) 99645-3210', wa_id: '5592996453210', cpf_cnpj: '45678901000160', filial: 'Loja 36', total_aberto: 5430.00, qtd_titulos: 2, titulo_mais_antigo: '2025-03-01', proximo_vencimento: '2025-04-15', ultimo_contato: '2025-04-02 11:20', ultima_acao: 'Aguardando resposta', proxima_acao: 'Reenviar mensagem', optout: false, etapa_regua: 'D+3', status: 'Aguardando resposta', responsavel: 'Lara Automação', risco: 'baixo' },
  { codcli: '11345', cliente: 'Belém Center Magazine Ltda', telefone: '(91) 98756-4321', wa_id: '5591987564321', cpf_cnpj: '56789012000150', filial: 'Filial Belém', total_aberto: 42780.00, qtd_titulos: 8, titulo_mais_antigo: '2024-12-20', proximo_vencimento: '2025-04-07', ultimo_contato: '2025-04-04 10:00', ultima_acao: 'PIX enviado', proxima_acao: 'Confirmar recebimento', optout: false, etapa_regua: 'D+7', status: 'PIX enviado', responsavel: 'Lara Automação', risco: 'medio' },
  { codcli: '11567', cliente: 'Amazonas Lar e Conforto Ltda', telefone: '(92) 99523-8765', wa_id: '5592995238765', cpf_cnpj: '67890123000140', filial: 'Loja 59', total_aberto: 0, qtd_titulos: 0, titulo_mais_antigo: '-', proximo_vencimento: '-', ultimo_contato: '2025-03-28 08:45', ultima_acao: 'Opt-out aplicado', proxima_acao: 'Bloqueado', optout: true, etapa_regua: '-', status: 'Opt-out ativo', responsavel: 'Supervisão de Cobrança', risco: 'baixo' },
  { codcli: '11789', cliente: 'Rodrigues Revenda Colchões Ltda', telefone: '(92) 99412-6543', wa_id: '5592994126543', cpf_cnpj: '78901234000130', filial: 'CD Norte', total_aberto: 118900.00, qtd_titulos: 15, titulo_mais_antigo: '2024-10-05', proximo_vencimento: '2025-04-06', ultimo_contato: '2025-04-05 07:30', ultima_acao: 'Escalado para humano', proxima_acao: 'Contato manual', optout: false, etapa_regua: 'D+30', status: 'Escalado para humano', responsavel: 'Operador Financeiro 02', risco: 'critico' },
];

export const mockTitulos: Titulo[] = [
  { id: 't1', duplicata: 'NF-2024-001234', prestacao: '1/3', codcli: '10234', cliente: 'Comercial Norte Distribuidora Ltda', telefone: '(92) 99812-3456', valor: 12500.00, vencimento: '2024-11-15', dias_atraso: 141, etapa_regua: 'D+30', status_atendimento: 'Boleto enviado', boleto_disponivel: true, ultima_acao: 'Boleto enviado em 04/04', responsavel: 'Lara Automação', filial: 'Matriz Manaus' },
  { id: 't2', duplicata: 'NF-2024-001234', prestacao: '2/3', codcli: '10234', cliente: 'Comercial Norte Distribuidora Ltda', telefone: '(92) 99812-3456', valor: 12500.00, vencimento: '2024-12-15', dias_atraso: 111, etapa_regua: 'D+30', status_atendimento: 'Boleto enviado', boleto_disponivel: true, ultima_acao: 'Boleto enviado em 04/04', responsavel: 'Lara Automação', filial: 'Matriz Manaus' },
  { id: 't3', duplicata: 'NF-2024-005678', prestacao: '1/1', codcli: '10456', cliente: 'Atacadão Manaus Utilidades Ltda', telefone: '(92) 99734-5678', valor: 23100.50, vencimento: '2025-01-20', dias_atraso: 75, etapa_regua: 'D0', status_atendimento: 'Cliente respondeu', boleto_disponivel: false, ultima_acao: 'Aguardando geração de boleto', responsavel: 'Lara Automação', filial: 'Matriz Manaus' },
  { id: 't4', duplicata: 'NF-2024-009012', prestacao: '1/5', codcli: '10789', cliente: 'Rede Ponto Econômico Comércio Ltda', telefone: '(91) 98812-9012', valor: 31264.00, vencimento: '2024-09-10', dias_atraso: 207, etapa_regua: 'D+30', status_atendimento: 'Promessa registrada', boleto_disponivel: true, ultima_acao: 'Promessa para 10/04', responsavel: 'Operador Financeiro 01', filial: 'Filial Belém' },
  { id: 't5', duplicata: 'NF-2025-000345', prestacao: '1/2', codcli: '11023', cliente: 'Mercantil Oliveira e Filhos', telefone: '(92) 99645-3210', valor: 2715.00, vencimento: '2025-03-01', dias_atraso: 35, etapa_regua: 'D+3', status_atendimento: 'Aguardando resposta', boleto_disponivel: false, ultima_acao: 'Mensagem D+3 enviada', responsavel: 'Lara Automação', filial: 'Loja 36' },
  { id: 't6', duplicata: 'NF-2024-007890', prestacao: '3/6', codcli: '11345', cliente: 'Belém Center Magazine Ltda', telefone: '(91) 98756-4321', valor: 7130.00, vencimento: '2024-12-20', dias_atraso: 106, etapa_regua: 'D+7', status_atendimento: 'PIX enviado', boleto_disponivel: true, ultima_acao: 'PIX enviado em 04/04', responsavel: 'Lara Automação', filial: 'Filial Belém' },
  { id: 't7', duplicata: 'NF-2024-004567', prestacao: '2/4', codcli: '11789', cliente: 'Rodrigues Revenda Colchões Ltda', telefone: '(92) 99412-6543', valor: 29725.00, vencimento: '2024-10-05', dias_atraso: 182, etapa_regua: 'D+30', status_atendimento: 'Escalado para humano', boleto_disponivel: true, ultima_acao: 'Escalado em 05/04', responsavel: 'Operador Financeiro 02', filial: 'CD Norte' },
  { id: 't8', duplicata: 'NF-2025-000890', prestacao: '1/1', codcli: '10234', cliente: 'Comercial Norte Distribuidora Ltda', telefone: '(92) 99812-3456', valor: 8750.00, vencimento: '2025-04-08', dias_atraso: 0, etapa_regua: 'D-3', status_atendimento: 'Boleto enviado', boleto_disponivel: true, ultima_acao: 'Boleto preventivo enviado', responsavel: 'Lara Automação', filial: 'Matriz Manaus' },
];

export const mockAtendimentos: Atendimento[] = [
  { id: 'a1', codcli: '10234', cliente: 'Comercial Norte Distribuidora Ltda', telefone: '(92) 99812-3456', wa_id: '5592998123456', status: 'Boleto enviado', origem: 'Régua ativa', ultima_mensagem: 'Segue o boleto atualizado para pagamento.', ultima_interacao: '2025-04-04 14:32', etapa: 'D+7', qtd_titulos: 12, boleto_enviado: true, promessa: false, optout: false },
  { id: 'a2', codcli: '10456', cliente: 'Atacadão Manaus Utilidades Ltda', telefone: '(92) 99734-5678', wa_id: '5592997345678', status: 'Cliente respondeu', origem: 'Receptivo', ultima_mensagem: 'Boa tarde, gostaria de receber o boleto atualizado.', ultima_interacao: '2025-04-05 09:15', etapa: 'D0', qtd_titulos: 4, boleto_enviado: false, promessa: false, optout: false },
  { id: 'a3', codcli: '10789', cliente: 'Rede Ponto Econômico Comércio Ltda', telefone: '(91) 98812-9012', wa_id: '5591988129012', status: 'Promessa registrada', origem: 'Régua ativa', ultima_mensagem: 'Vou pagar dia 10, pode enviar o boleto?', ultima_interacao: '2025-04-03 16:45', etapa: 'D+15', qtd_titulos: 22, boleto_enviado: true, promessa: true, optout: false },
  { id: 'a4', codcli: '11023', cliente: 'Mercantil Oliveira e Filhos', telefone: '(92) 99645-3210', wa_id: '5592996453210', status: 'Aguardando resposta', origem: 'Régua ativa', ultima_mensagem: 'Olá! Identificamos títulos em aberto...', ultima_interacao: '2025-04-02 11:20', etapa: 'D+3', qtd_titulos: 2, boleto_enviado: false, promessa: false, optout: false },
  { id: 'a5', codcli: '11345', cliente: 'Belém Center Magazine Ltda', telefone: '(91) 98756-4321', wa_id: '5591987564321', status: 'PIX enviado', origem: 'Receptivo', ultima_mensagem: 'Chave PIX enviada. Aguardando confirmação.', ultima_interacao: '2025-04-04 10:00', etapa: 'D+7', qtd_titulos: 8, boleto_enviado: false, promessa: false, optout: false },
  { id: 'a6', codcli: '11789', cliente: 'Rodrigues Revenda Colchões Ltda', telefone: '(92) 99412-6543', wa_id: '5592994126543', status: 'Escalado para humano', origem: 'Régua ativa', ultima_mensagem: 'Preciso falar com alguém do financeiro.', ultima_interacao: '2025-04-05 07:30', etapa: 'D+30', qtd_titulos: 15, boleto_enviado: true, promessa: false, optout: false },
];

export const mockCases: CaseItem[] = [
  { id: 'c1', data_hora: '2025-04-05 09:20', cliente: 'Atacadão Manaus Utilidades Ltda', codcli: '10456', wa_id: '5592997345678', acao: 'PROMESSA_PAGAMENTO', etapa: 'D0', duplicatas: 'NF-2024-005678', valor_total: 23100.50, forma_pagamento: 'Boleto', origem: 'Receptivo', responsavel: 'Lara Automação', detalhe: 'Cliente solicitou boleto atualizado e prometeu pagamento para 10/04.' },
  { id: 'c2', data_hora: '2025-04-04 14:35', cliente: 'Comercial Norte Distribuidora Ltda', codcli: '10234', wa_id: '5592998123456', acao: 'BOLETO_REENVIADO', etapa: 'D+7', duplicatas: 'NF-2024-001234 (1/3, 2/3)', valor_total: 25000.00, forma_pagamento: 'Boleto', origem: 'Régua ativa', responsavel: 'Lara Automação', detalhe: 'Boleto atualizado gerado e enviado automaticamente via régua D+7.' },
  { id: 'c3', data_hora: '2025-04-04 10:05', cliente: 'Belém Center Magazine Ltda', codcli: '11345', wa_id: '5591987564321', acao: 'PAGAMENTO_ENVIADO', etapa: 'D+7', duplicatas: 'NF-2024-007890 (3/6)', valor_total: 7130.00, forma_pagamento: 'PIX', origem: 'Receptivo', responsavel: 'Lara Automação', detalhe: 'Chave PIX enviada ao cliente após identificação.' },
  { id: 'c4', data_hora: '2025-04-03 16:50', cliente: 'Rede Ponto Econômico Comércio Ltda', codcli: '10789', wa_id: '5591988129012', acao: 'PROMESSA_PAGAMENTO', etapa: 'D+15', duplicatas: 'NF-2024-009012 (1/5)', valor_total: 31264.00, forma_pagamento: 'Boleto', origem: 'Régua ativa', responsavel: 'Operador Financeiro 01', detalhe: 'Cliente prometeu pagamento para 10/04/2025.' },
  { id: 'c5', data_hora: '2025-04-05 07:35', cliente: 'Rodrigues Revenda Colchões Ltda', codcli: '11789', wa_id: '5592994126543', acao: 'INFO', etapa: 'D+30', duplicatas: 'NF-2024-004567', valor_total: 29725.00, forma_pagamento: '-', origem: 'Régua ativa', responsavel: 'Operador Financeiro 02', detalhe: 'Cliente solicitou contato com financeiro. Escalado para atendimento humano.' },
  { id: 'c6', data_hora: '2025-03-28 08:50', cliente: 'Amazonas Lar e Conforto Ltda', codcli: '11567', wa_id: '5592995238765', acao: 'OPTOUT_SET', etapa: '-', duplicatas: '-', valor_total: 0, forma_pagamento: '-', origem: 'Receptivo', responsavel: 'Supervisão de Cobrança', detalhe: 'Cliente solicitou bloqueio de mensagens. Opt-out aplicado.' },
];

export const mockLogs: LogItem[] = [
  { id: 'l1', data_hora: '2025-04-05 09:20', tipo: 'Atendimento', modulo: 'WhatsApp', cliente: 'Atacadão Manaus Utilidades Ltda', wa_id: '5592997345678', codcli: '10456', etapa: 'D0', mensagem: 'Mensagem receptiva recebida e processada com sucesso.', severidade: 'sucesso', status: 'Processado', origem: 'WhatsApp' },
  { id: 'l2', data_hora: '2025-04-05 07:30', tipo: 'Escalação', modulo: 'Atendimento', cliente: 'Rodrigues Revenda Colchões Ltda', wa_id: '5592994126543', codcli: '11789', etapa: 'D+30', mensagem: 'Atendimento escalado para operador humano.', severidade: 'aviso', status: 'Processado', origem: 'Régua ativa' },
  { id: 'l3', data_hora: '2025-04-04 15:10', tipo: 'Boleto', modulo: 'Integração', cliente: 'Comercial Norte Distribuidora Ltda', wa_id: '5592998123456', codcli: '10234', etapa: 'D+7', mensagem: 'Boleto gerado e enviado com sucesso.', severidade: 'sucesso', status: 'Concluído', origem: 'Régua ativa' },
  { id: 'l4', data_hora: '2025-04-04 12:00', tipo: 'Régua', modulo: 'Automação', cliente: '-', wa_id: '-', codcli: '-', etapa: 'D+3', mensagem: 'Disparo D+3 executado: 45 elegíveis, 43 enviados, 2 erros.', severidade: 'aviso', status: 'Parcial', origem: 'n8n' },
  { id: 'l5', data_hora: '2025-04-04 11:45', tipo: 'Integração', modulo: 'Oracle', cliente: '-', wa_id: '-', codcli: '-', etapa: '-', mensagem: 'Falha temporária na consulta de títulos. Timeout após 30s.', severidade: 'erro', status: 'Falha', origem: 'Backend' },
  { id: 'l6', data_hora: '2025-04-03 18:00', tipo: 'Opt-out', modulo: 'Compliance', cliente: 'Amazonas Lar e Conforto Ltda', wa_id: '5592995238765', codcli: '11567', etapa: '-', mensagem: 'Opt-out aplicado por solicitação do cliente.', severidade: 'bloqueado', status: 'Aplicado', origem: 'Receptivo' },
  { id: 'l7', data_hora: '2025-04-05 06:00', tipo: 'Régua', modulo: 'Automação', cliente: '-', wa_id: '-', codcli: '-', etapa: 'D-3', mensagem: 'Disparo preventivo D-3: 28 elegíveis, 28 enviados, 0 erros.', severidade: 'sucesso', status: 'Concluído', origem: 'n8n' },
];

export const mockOptouts: OptoutItem[] = [
  { id: 'o1', wa_id: '5592995238765', codcli: '11567', cliente: 'Amazonas Lar e Conforto Ltda', motivo: 'Solicitação do cliente', ativo: true, data_criacao: '2025-03-28 08:50', data_atualizacao: '2025-03-28 08:50', origem: 'Receptivo', observacao: 'Cliente enviou mensagem solicitando bloqueio de comunicações.' },
  { id: 'o2', wa_id: '5592991234567', codcli: '12001', cliente: 'Ferreira Materiais de Construção', motivo: 'Reclamação reiterada', ativo: true, data_criacao: '2025-03-15 14:20', data_atualizacao: '2025-03-15 14:20', origem: 'Supervisão', observacao: 'Bloqueio aplicado após 3 reclamações consecutivas.' },
  { id: 'o3', wa_id: '5591987650000', codcli: '12045', cliente: 'Norte Papelaria Express', motivo: 'Solicitação do cliente', ativo: false, data_criacao: '2025-02-10 10:00', data_atualizacao: '2025-03-20 09:30', origem: 'Receptivo', observacao: 'Cliente solicitou retorno de contato. Opt-out removido.' },
];

export const mockReguaEtapas: ReguaEtapa[] = [
  { etapa: 'D-3', elegivel: 28, enviado: 28, respondido: 8, convertido: 3, erro: 0, bloqueado_optout: 0, taxa_resposta: 28.6, taxa_recuperacao: 10.7 },
  { etapa: 'D0', elegivel: 52, enviado: 50, respondido: 18, convertido: 7, erro: 2, bloqueado_optout: 1, taxa_resposta: 36.0, taxa_recuperacao: 14.0 },
  { etapa: 'D+3', elegivel: 45, enviado: 43, respondido: 12, convertido: 4, erro: 2, bloqueado_optout: 2, taxa_resposta: 27.9, taxa_recuperacao: 9.3 },
  { etapa: 'D+7', elegivel: 38, enviado: 36, respondido: 15, convertido: 6, erro: 1, bloqueado_optout: 3, taxa_resposta: 41.7, taxa_recuperacao: 16.7 },
  { etapa: 'D+15', elegivel: 30, enviado: 27, respondido: 10, convertido: 3, erro: 1, bloqueado_optout: 4, taxa_resposta: 37.0, taxa_recuperacao: 11.1 },
  { etapa: 'D+30', elegivel: 22, enviado: 18, respondido: 5, convertido: 1, erro: 2, bloqueado_optout: 5, taxa_resposta: 27.8, taxa_recuperacao: 5.6 },
];

export const mockReguaExecucoes: ReguaExecucao[] = [
  { id: 'r1', data_hora: '2025-04-05 06:00', etapa: 'D-3', elegivel: 28, disparada: 28, erro: 0, respondida: 8, valor_impactado: 145600, status: 'Concluído' },
  { id: 'r2', data_hora: '2025-04-04 12:00', etapa: 'D+3', elegivel: 45, disparada: 43, erro: 2, respondida: 12, valor_impactado: 234500, status: 'Parcial' },
  { id: 'r3', data_hora: '2025-04-04 06:00', etapa: 'D0', elegivel: 52, disparada: 50, erro: 2, respondida: 18, valor_impactado: 312000, status: 'Parcial' },
  { id: 'r4', data_hora: '2025-04-03 12:00', etapa: 'D+7', elegivel: 38, disparada: 36, erro: 1, respondida: 15, valor_impactado: 278900, status: 'Concluído' },
  { id: 'r5', data_hora: '2025-04-03 06:00', etapa: 'D+15', elegivel: 30, disparada: 27, erro: 1, respondida: 10, valor_impactado: 198000, status: 'Concluído' },
  { id: 'r6', data_hora: '2025-04-02 12:00', etapa: 'D+30', elegivel: 22, disparada: 18, erro: 2, respondida: 5, valor_impactado: 456000, status: 'Parcial' },
];
