/**
 * Seed data for Inspeções module — REAL data extracted 1:1 from the uploaded spreadsheet.
 * CHECKLIST_MANAUS_-_qualidade.xlsx
 * 15 sectors, 185 checklist items, 167 NC types, 16 spring patterns, 4 machines.
 */
import { db } from "./dataStore.js";
import { randomUUID } from "node:crypto";

// ── SETORES REAIS (extracted from Checklist sheet) ──
export const SETORES_REAIS = [
  "ESPUMAÇÃO",
  "ÁREA DE CURA",
  "FLOCADEIRA",
  "LAMINAÇÃO",
  "MOLA",
  "BORDADEIRA",
  "CORTE E COSTURA",
  "MARCENARIA",
  "TAPEÇARIA",
  "FECHAMENTO",
  "MÓVEIS",
  "EMBALAGEM",
  "ALMOXARIFADO",
  "ESTOFAMENTO",
  "EMBALAGEM DE BASE",
] as const;

// ── MÁQUINAS REAIS DE MOLA ──
export const MAQUINAS_REAIS = ["01", "02", "03", "04"] as const;

// ── Sector code mapping (spreadsheet prefix -> clean name) ──
const SETOR_MAP: Record<string, string> = {
  "1.0 - ESPUMAÇÃO": "ESPUMAÇÃO",
  "2.0 - ÁREA DE CURA": "ÁREA DE CURA",
  "3.0 - FLOCADEIRA": "FLOCADEIRA",
  "4.0 - LAMINAÇÃO": "LAMINAÇÃO",
  "5.0 - MOLA": "MOLA",
  "6.0 - BORDADEIRA": "BORDADEIRA",
  "7.0 - CORTE E COSTURA": "CORTE E COSTURA",
  "8.0 - MARCENARIA": "MARCENARIA",
  "9.0 - TAPEÇARIA": "TAPEÇARIA",
  "10.0 - FECHAMENTO": "FECHAMENTO",
  "11.0 - MÓVEIS": "MÓVEIS",
  "12.0 - EMBALAGEM": "EMBALAGEM",
  "13.0 - ALMOXARIFADO": "ALMOXARIFADO",
  "14.0 - ESTOFAMENTO": "ESTOFAMENTO",
  "15.0 - EMBALAGEM DE BASE": "EMBALAGEM DE BASE",
};

// ── NC_PADROES setor mapping (sheet uses unaccented names) ──
const NC_SETOR_MAP: Record<string, string> = {
  "ESPUMACAO": "ESPUMAÇÃO",
  "AREA DE CURA": "ÁREA DE CURA",
  "FLOCADEIRA": "FLOCADEIRA",
  "LAMINACAO": "LAMINAÇÃO",
  "BORDADEIRA": "BORDADEIRA",
  "ALMOXARIFADO": "ALMOXARIFADO",
  "MOLA": "MOLA",
  "CORTE E COSTURA": "CORTE E COSTURA",
  "ESTOFAMENTO": "ESTOFAMENTO",
  "FECHAMENTO": "FECHAMENTO",
  "EMBALAGEM": "EMBALAGEM",
  "MARCENARIA": "MARCENARIA",
  "TAPECARIA": "TAPEÇARIA",
  "MOVEIS": "MÓVEIS",
  "EMBALAGEM DE BASE": "EMBALAGEM DE BASE",
};

let _itemCounter = 0;
function itemId() { return `ITEM-${String(++_itemCounter).padStart(4, "0")}`; }

// ── CHECKLIST ITEMS — exact text from spreadsheet ──
interface ChecklistRawItem {
  setor: string;
  item: string;
  descricao: string;
}

const CHECKLIST_ITEMS_RAW: ChecklistRawItem[] = [
  { setor: "ESPUMAÇÃO", item: "1.1", descricao: "Verificar se a produção de Bloco está sendo realizada de acordo com a Formulação-IT 1-2;" },
  { setor: "ESPUMAÇÃO", item: "1.2", descricao: "Verificar Blocos Retangurales e Cilíndricos estão devidamente Identificados (OP, Data, Hora, Peso e Densidade). Checar se possui carimbo de Aprovação/Reprovado (quando a unidade for aplicavel);" },
  { setor: "ESPUMAÇÃO", item: "1.3", descricao: "Verificar visualmente Defeitos como bolhas, falhas ou queima;" },
  { setor: "ESPUMAÇÃO", item: "1.4", descricao: "Checar Sobras de Blocos se estão identificados (OP, Data de Produção e Densidade);" },
  { setor: "ESPUMAÇÃO", item: "1.5", descricao: "Checar Registro de Controle de Processo-IT1-3, está devidamente preenchida. Em caso de Não Conformidade foram tratadas;" },
  { setor: "ESPUMAÇÃO", item: "1.6", descricao: "Verificar Matéria Prima em Contato Direto com o Piso;" },
  { setor: "ESPUMAÇÃO", item: "1.7", descricao: "Checar Validade dos Produtos Químicos e se estão devidamente Identificados com o Lote Interno;" },
  { setor: "ESPUMAÇÃO", item: "1.8", descricao: "No Setor foi identificado alguma Matéria Prima enconstada na parede?" },
  { setor: "ESPUMAÇÃO", item: "1.9", descricao: "O local de trabalho está Limpo e Oganizado-Programa 5S aplicado?" },
  { setor: "ESPUMAÇÃO", item: "1.10", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "ESPUMAÇÃO", item: "1.11", descricao: "Existe Resíduo para descarte acumulado no setor?" },
  { setor: "ESPUMAÇÃO", item: "1.12", descricao: "Verificar se os colaboradores estão usando trena na execução de sua atividade durante o decorrer do turno. ( Medições)." },
  { setor: "ÁREA DE CURA", item: "2.1", descricao: "Conferir se os Blocos Retangurales e Cilíndricos, estão devidamente identificados com (OP, Data, Hora e Densidade);" },
  { setor: "ÁREA DE CURA", item: "2.2", descricao: "Avaliar Aparência Visual Deformados ou Colapsados (rachaduras, bolhas, manchas ou outra anormalidades);" },
  { setor: "ÁREA DE CURA", item: "2.3", descricao: "Verificar o Distanciamento dos Blocos (Espaçamento entre blocos 30 a 50 cm de distância entre um bloco e outro);" },
  { setor: "ÁREA DE CURA", item: "2.4", descricao: "Verificar se o Tempo Mínimo de Cura foi cumprido para cada lote (recomendado 8h a 24h);" },
  { setor: "ÁREA DE CURA", item: "2.5", descricao: "Verificar se os Termômetros estão sendo uitlizados corretamente no monitoramento dos Blocos;" },
  { setor: "ÁREA DE CURA", item: "2.6", descricao: "Verificar o Processo PEPS-Primeiro que Entra/Primeiro que Sai, está sendo aplicado;" },
  { setor: "ÁREA DE CURA", item: "2.7", descricao: "Verificar se tem Bloco (s) antes do Período de Cura armazenado de Lado;" },
  { setor: "ÁREA DE CURA", item: "2.8", descricao: "Checar se todos os Blocos estão atendendo ao Padrão de Cor, conforme a Planilha de Formulação-IT 1-2 ?" },
  { setor: "ÁREA DE CURA", item: "2.9", descricao: "O local de trabalho está Limpo e Oganizado-Programa 5S aplicado?" },
  { setor: "ÁREA DE CURA", item: "2.10", descricao: "Verificar se os colaboradores estão usando trena na execução de sua atividade durante o decorrer do turno. ( Medições)." },
  { setor: "FLOCADEIRA", item: "3.1", descricao: "Verificar Blocos Flocados estão devidamente Identificados (OP, Data, Hora, Peso). Checar se possui carimbo de Aprovação/Reprovado (quando a unidade for aplicavel);" },
  { setor: "FLOCADEIRA", item: "3.2", descricao: "Inspecionar visualmente a Homogeneidade da Placa (sem falhas, buracos ou excesso de cola);" },
  { setor: "FLOCADEIRA", item: "3.3", descricao: "Verificação da cola se está homogênea firme;" },
  { setor: "FLOCADEIRA", item: "3.4", descricao: "Verificar se existe Placas Cortadas em Contato Direto com o Piso;" },
  { setor: "FLOCADEIRA", item: "3.5", descricao: "O local de trabalho está Limpo e Oganizado-Programa 5S aplicado?" },
  { setor: "FLOCADEIRA", item: "3.6", descricao: "Verificar Material em Desuso espalhado pelo Setor;" },
  { setor: "FLOCADEIRA", item: "3.7", descricao: "Verificar se tem Resíduos para descarte acumulado no setor;" },
  { setor: "FLOCADEIRA", item: "3.8", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "FLOCADEIRA", item: "3.9", descricao: "A Luminosidade da área está em funcionamento (Lâmpadas funcionando e Íntegras)?" },
  { setor: "FLOCADEIRA", item: "3.10", descricao: "Verificar se os colaboradores estão usando trena na execução de sua atividade durante o decorrer do turno. ( Medições)." },
  { setor: "LAMINAÇÃO", item: "4.1", descricao: "Verificar as pilhas de Lâminas Cortadas estão devidamente identificadas (OP, Produto, Quantidade eTamanho);" },
  { setor: "LAMINAÇÃO", item: "4.2", descricao: "Verificar se as Lâminas estão com Espessura correta e uniforme;" },
  { setor: "LAMINAÇÃO", item: "4.3", descricao: "Checar visualmente se há Cortes tortos, espuma rasgada ou marcas de faca;" },
  { setor: "LAMINAÇÃO", item: "4.4", descricao: "Checar se os Blocos em processo de Lâminação estão Curados e Aprovados;" },
  { setor: "LAMINAÇÃO", item: "4.5", descricao: "Checar Registro de Controle de Processo-IT2-2, está devidamente preenchida. Em caso de Não Conformidade foram tratadas;" },
  { setor: "LAMINAÇÃO", item: "4.6", descricao: "Verificar os Blocos em processo de Lâminação estão atendendo o PEPS (Primeiro que Sai/Primeiro que Entra) da Espumação?" },
  { setor: "LAMINAÇÃO", item: "4.7", descricao: "Verificar se existe Lâminas Cortadas em Contato Direto com o Piso;" },
  { setor: "LAMINAÇÃO", item: "4.8", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "LAMINAÇÃO", item: "4.9", descricao: "Verificar Material em Desuso espalhado pelo Setor;" },
  { setor: "LAMINAÇÃO", item: "4.10", descricao: "Verificar se tem Resíduos para descarte acumulado no setor;" },
  { setor: "LAMINAÇÃO", item: "4.11", descricao: "Verificar se os colaboradores estão usando trena na execução de sua atividade durante o decorrer do turno. ( Medições)." },
  { setor: "MOLA", item: "5.1", descricao: "Verificar se os Materiais e/ou PI's, estão segregados em cima de Palete para evitar Sujidades;" },
  { setor: "MOLA", item: "5.2", descricao: "Confirmar Padrão (modelo do molejo, medida, Fio de aço e TNT) se está conforme OP;" },
  { setor: "MOLA", item: "5.3", descricao: "Verificar a Montagem da Estrutura Alinhamento e Colagem do Molejo;" },
  { setor: "MOLA", item: "5.4", descricao: "Verificar Acabamento (Limpeza, Colagens, Encapsulamento das molas, etc);" },
  { setor: "MOLA", item: "5.5", descricao: "O local de trabalho está Limpo e Oganizado-Programa 5S aplicado?" },
  { setor: "MOLA", item: "5.6", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "MOLA", item: "5.7", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "MOLA", item: "5.8", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "MOLA", item: "5.9", descricao: "Os colaboradores foram treinados em suas respectivas funções?" },
  { setor: "BORDADEIRA", item: "6.1", descricao: "Verificar o Alinhamento da Borda das Faixa e Tampos de Cama e Colchão;" },
  { setor: "BORDADEIRA", item: "6.2", descricao: "Checar Estética da Costura (reta, limpa, sem ondulações);" },
  { setor: "BORDADEIRA", item: "6.3", descricao: "Conferir se as Etiquetas (falhas, faltando informação, etc.) e se estão fixadas corretamente (centralizadas);" },
  { setor: "BORDADEIRA", item: "6.4", descricao: "Verificar o Registro de Controle de Processo-IT 3-2 BORDADEIRA está sendo Preenchido Corretamente;" },
  { setor: "BORDADEIRA", item: "6.5", descricao: "Verificar os Rolos de Tecidos estão devidamente Identificados com suas respectivas Etiquetas e Embalados?" },
  { setor: "BORDADEIRA", item: "6.6", descricao: "Verificar se existe PI's (Tampos/Tecidos/Rolos de Faixa) em Contato Direto com o Piso;" },
  { setor: "BORDADEIRA", item: "6.7", descricao: "Verificar sobras de Cilíndro estão devidamente Identificadas com suas respectivas OP;" },
  { setor: "BORDADEIRA", item: "6.8", descricao: "Verificar Tampos e Rolos de Faixa estão identificados com (OP, Produto, Quantidade eTamanho);" },
  { setor: "BORDADEIRA", item: "6.9", descricao: "O local de trabalho está Limpo e Oganizado-programa 5S aplicado?" },
  { setor: "BORDADEIRA", item: "6.10", descricao: "Verificar Material em Desuso espalhado pelo Setor;" },
  { setor: "BORDADEIRA", item: "6.11", descricao: "Verificar se tem Resíduos para descarte acumulado no setor;" },
  { setor: "BORDADEIRA", item: "6.12", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "BORDADEIRA", item: "6.13", descricao: "Verificar se os colaboradores estão usando trena na execução de sua atividade durante o decorrer do turno. ( Medições)." },
  { setor: "CORTE E COSTURA", item: "7.1", descricao: "Mesa Corte- Verificar se o Tecido/TNT/NAPA está sendo checado quanto a Defeitos (manchas, furos, linhas puxadas), antes do corte;" },
  { setor: "CORTE E COSTURA", item: "7.2", descricao: "Mesa Corte- Verificar a Identificação de Peças Cortadas se estão de acordo com OP-Ordem de Produção;" },
  { setor: "CORTE E COSTURA", item: "7.3", descricao: "Mesa Corte- Verificar Tecidos,TNTe NAPA estão devidamente Embalados e Identificados?" },
  { setor: "CORTE E COSTURA", item: "7.4", descricao: "Mesa Corte-  Verificar os materiais cortados se constam Identificados (Produto, Quantidade, Tamanho e OP)?" },
  { setor: "CORTE E COSTURA", item: "7.5", descricao: "Mesa Corte- O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "CORTE E COSTURA", item: "7.6", descricao: "Mesa Corte- Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "CORTE E COSTURA", item: "7.7", descricao: "Mesa Corte- Existe Resíduo para descarte acumulado no setor?" },
  { setor: "CORTE E COSTURA", item: "7.8", descricao: "Costura- Checar Estética da Costura (reta, limpa e sem sobras de linha);" },
  { setor: "CORTE E COSTURA", item: "7.9", descricao: "Costura- Verificar se a Etiquetas na Faixa está Centralizada;" },
  { setor: "CORTE E COSTURA", item: "7.10", descricao: "Costura- Verificar as Faixas em Processo de Produção se estão de acordo com as suas respectivas Etiquetas;" },
  { setor: "CORTE E COSTURA", item: "7.11", descricao: "Costura- Verificar os Rolos de Tecidos estão devidamente Identificados com suas respectivas Etiquetas e Embalados;" },
  { setor: "CORTE E COSTURA", item: "7.12", descricao: "Costura- Verificar se existe PI (Tecidos/Rolos de Faixa) em Contato Direto com o Piso;" },
  { setor: "CORTE E COSTURA", item: "7.13", descricao: "Costura- Checar Sobras de Cilíndro estão devidamente Identificadas com suas respectivas OP;" },
  { setor: "CORTE E COSTURA", item: "7.14", descricao: "Costura- Verificar Rolos de Faixa estão identificados com (OP, Produto, Quantidade eTamanho)?" },
  { setor: "CORTE E COSTURA", item: "7.15", descricao: "Costura- O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "CORTE E COSTURA", item: "7.16", descricao: "Costura- Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "CORTE E COSTURA", item: "7.17", descricao: "Costura- Existe Resíduo para descarte acumulado no setor?" },
  { setor: "CORTE E COSTURA", item: "7.18", descricao: "Costura- Os Extintores estão Desobstruidos?" },
  { setor: "CORTE E COSTURA", item: "7.19", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "MARCENARIA", item: "8.1", descricao: "Conferir se as Bases (PI) estão nas dimensões corretas, conforme (Plano de Corte);" },
  { setor: "MARCENARIA", item: "8.2", descricao: "Verificar Firmeza da Estrutura (sem folgas, partes soltas ou tortas);" },
  { setor: "MARCENARIA", item: "8.3", descricao: "Avaliar Acabamento (sem farpas, lascas, sobras de cola, grampos visíveis, etc.);" },
  { setor: "MARCENARIA", item: "8.4", descricao: "Verificar Alinhamento do Compensado na Base;" },
  { setor: "MARCENARIA", item: "8.5", descricao: "Verificar se Madeira e Compensado utilizado está integro (sem umidades, rachaduras, nós e infestada);" },
  { setor: "MARCENARIA", item: "8.6", descricao: "Verificar se o teste de extração da BUCHA AMERICANA está sendo realizado corretamente" },
  { setor: "MARCENARIA", item: "8.7", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "MARCENARIA", item: "8.8", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "MARCENARIA", item: "8.9", descricao: "Existe Resíduo para descarte acumulado no setor?" },
  { setor: "MARCENARIA", item: "8.10", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "TAPEÇARIA", item: "9.1", descricao: "Conferir as Estruturas das Bases se estão integras(rachaduras, nó, odor, etc.);" },
  { setor: "TAPEÇARIA", item: "9.2", descricao: "Verificar se as Bases em produção estão com as Lâminas de acordo com o documento Caderno Estrutura do Produto;" },
  { setor: "TAPEÇARIA", item: "9.3", descricao: "Verificar o Enviesamento de Bordado, após o Tapeçamento;" },
  { setor: "TAPEÇARIA", item: "9.4", descricao: "Verificar a existência da etiqueta na Capa e se está fixada corretamente (centralizada)." },
  { setor: "TAPEÇARIA", item: "9.5", descricao: "Verificar Combianção dos Acessórios (Cantoneiras e Pés);" },
  { setor: "TAPEÇARIA", item: "9.6", descricao: "Verificar a Condições das Cantoneiras, após a Embalagem;" },
  { setor: "TAPEÇARIA", item: "9.7", descricao: "Verificar a se a Etiqueta do Operador (rasreabilidade) está fixada no Produto;" },
  { setor: "TAPEÇARIA", item: "9.8", descricao: "Verificar se as Capas estão Armazenadas de forma correta a fim de evitar Sujidades;" },
  { setor: "TAPEÇARIA", item: "9.9", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "TAPEÇARIA", item: "9.10", descricao: "Existe Bases/Peças em Contato Direto com o Piso?" },
  { setor: "TAPEÇARIA", item: "9.11", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "TAPEÇARIA", item: "9.12", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "TAPEÇARIA", item: "9.13", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "FECHAMENTO", item: "10.1", descricao: "Conferir o Acabamento Geral do Colchão (sem fios soltos/linhas, vincos ou deformações);" },
  { setor: "FECHAMENTO", item: "10.2", descricao: "Verificar o Acabamento Fitilio e/ou Faixa está Alinhado, Sem Sujeiras e Encontro da Pontas do Fitilio;" },
  { setor: "FECHAMENTO", item: "10.3", descricao: "Verificar o Cadaço se é o Padrão definido para o produto ( seguir o documento Caderno Estrutura do Produto);" },
  { setor: "FECHAMENTO", item: "10.4", descricao: "Verificar o Tamanho e Aperto do Ponto da Costura/Fechamento do produto;" },
  { setor: "FECHAMENTO", item: "10.5", descricao: "Checar se as Laterais (Faixa e Tampo) estão ajustadas corretamente;" },
  { setor: "FECHAMENTO", item: "10.6", descricao: "Confirmar se o Colchão corresponde ao Modelo e Medida corretos;" },
  { setor: "FECHAMENTO", item: "10.7", descricao: "Checar Altura e Alinhamento das bordas;" },
  { setor: "FECHAMENTO", item: "10.8", descricao: "Verificar as Etiquetas foram fixadas corretamente (centralizadas);" },
  { setor: "FECHAMENTO", item: "10.9", descricao: "Verificar se as Informações da Etiqueta corresponde com o produto;" },
  { setor: "FECHAMENTO", item: "10.10", descricao: "As Capas do Unibox estão Armazenados de Forma Correta a fim de evitar Sujidades?" },
  { setor: "FECHAMENTO", item: "10.11", descricao: "Verificar se o Operador fez limpeza na máquiina e na mesa;" },
  { setor: "FECHAMENTO", item: "10.12", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "FECHAMENTO", item: "10.13", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "FECHAMENTO", item: "10.14", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "MÓVEIS", item: "11.1", descricao: "Mesa Corte- Verificar se o Tecido/TNT/NAPA está sendo checado quanto a Defeitos (manchas, furos, linhas puxadas), antes do corte;" },
  { setor: "MÓVEIS", item: "11.2", descricao: "Mesa Corte - Verificar se os Tecidos e TNT estão devidamente Embalados e Identificados;" },
  { setor: "MÓVEIS", item: "11.3", descricao: "Mesa Corte - Checar se o Material Cortado estão Identificados (OP, Produto, Quantidade eTamanho);" },
  { setor: "MÓVEIS", item: "11.4", descricao: "Mesa Corte - Verificar se há Plano de Corte de tecidos Padrão sendo seguido;" },
  { setor: "MÓVEIS", item: "11.5", descricao: "Verificar se os Materiais e/ou PI's, estão segregados em cima de Palete para evitar Sujidades;" },
  { setor: "MÓVEIS", item: "11.6", descricao: "Confirmar Padrão (modelo do móvel, medida, tipo de revestimento, acessórios) se está conforme OP;" },
  { setor: "MÓVEIS", item: "11.7", descricao: "Verificar a Montagem da Estrutura Alinhamento e Colagem da Espuma;" },
  { setor: "MÓVEIS", item: "11.8", descricao: "Conferir o Acabamento Geral do Produto em Produção (sem fios soltos/linhas, vincos, deformações, outras falhas);" },
  { setor: "MÓVEIS", item: "11.9", descricao: "Verifiar se os Botões estão Centralizados nos Produtos;" },
  { setor: "MÓVEIS", item: "11.10", descricao: "Verificar as Condições das Cantoneira ;" },
  { setor: "MÓVEIS", item: "11.11", descricao: "Verificar Acabamento (Limpeza, Firmeza do Estofado, Colagens, Grampos Visíveis, etc);" },
  { setor: "MÓVEIS", item: "11.12", descricao: "Verificar o Desfiamento no processo da Máquina de Fibra;" },
  { setor: "MÓVEIS", item: "11.13", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "MÓVEIS", item: "11.14", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "MÓVEIS", item: "11.15", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "MÓVEIS", item: "11.16", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "MÓVEIS", item: "11.17", descricao: "Verificar a Montagem da Estrutura Alinhamento e Colagem da Espuma;" },
  { setor: "EMBALAGEM", item: "12.1", descricao: "Verificar se o PA (Colchão/Cama), está sendo Conferido por Modelo e Medidas (Solteiro, Casal, Queen, King etc.)?" },
  { setor: "EMBALAGEM", item: "12.2", descricao: "Checar se o PA (Colchão/Cama), está sendo Verificado se está Limpo e sem Defeitos Visuais?" },
  { setor: "EMBALAGEM", item: "12.3", descricao: "Verificar a presença de Umidade nos Produtos Acabados;" },
  { setor: "EMBALAGEM", item: "12.4", descricao: "Verificar o PA (Colchão/Cama), Embalado estão com Ausência de Fios/Linhas Soltos, Manchas, Sujeiras, ou outras Desvios;" },
  { setor: "EMBALAGEM", item: "12.5", descricao: "Verificar se os Box/Unibox/ Baú/Ortopédico, estão sendo Embalados com os Acessórios (Pés,etc.);" },
  { setor: "EMBALAGEM", item: "12.6", descricao: "Verificar Altura de Empilhamento dos Produtos Acabados;" },
  { setor: "EMBALAGEM", item: "12.7", descricao: "Verificar o Registro de Controle de Processo-IT 10-1 Inspeção Visual, está sendo Preenchido Corretamente;" },
  { setor: "EMBALAGEM", item: "12.8", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "EMBALAGEM", item: "12.9", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "EMBALAGEM", item: "12.10", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "EMBALAGEM", item: "12.11", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "ALMOXARIFADO", item: "13.1", descricao: "Verificar se o Controle de Entrada de Recebimento de Materiais, está devidamente preenchida. Em caso de Não Conformidade foram tratadas;" },
  { setor: "ALMOXARIFADO", item: "13.2", descricao: "Verificar o Armazenamento dos materiais em local correto e identificado;" },
  { setor: "ALMOXARIFADO", item: "13.3", descricao: "Verificar a Etiqueta de Identificação de Lote se está sendo aplicada nos produtos (químicos, tecidos, molejos, etc);" },
  { setor: "ALMOXARIFADO", item: "13.4", descricao: "Verificar se os Produtos estão organizados por tipo e categoria (espumas, tecidos, madeira etc.)" },
  { setor: "ALMOXARIFADO", item: "13.5", descricao: "Verificar Materiais pesados nas prateleiras inferiores;" },
  { setor: "ALMOXARIFADO", item: "13.6", descricao: "Verificar Materiais identificados com etiquetas legíveis;" },
  { setor: "ALMOXARIFADO", item: "13.7", descricao: "Verificar se Área de Separação e Armazenamento está organizada e limpa/5S;" },
  { setor: "ALMOXARIFADO", item: "13.8", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "ALMOXARIFADO", item: "13.9", descricao: "Os Extintores estão Desobstruidos?" },
  { setor: "ALMOXARIFADO", item: "13.10", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
  { setor: "ALMOXARIFADO", item: "13.11", descricao: "Os Colabradores estão devidamente uniformizados e utilizando EPI adequado para a atividade que está sendo exercida?" },
  { setor: "ALMOXARIFADO", item: "13.12", descricao: "A Luminosidade da área está funcionamento (Lâmpadas funcionando e Íntegras)?" },
  { setor: "ALMOXARIFADO", item: "13.13", descricao: "Os colaboradores foram treinados em suas respectivas funções?" },
  { setor: "ESTOFAMENTO", item: "13.1", descricao: "Verificar se os PI's (Lâminas, Feltros, EPS), estão segregados em cima de Palete para evitar Sujidades;" },
  { setor: "ESTOFAMENTO", item: "13.2", descricao: "Conferir a Espessura das Lâminas conforme o Caderno de Estrutura Padrão;" },
  { setor: "ESTOFAMENTO", item: "13.3", descricao: "Verifiar a Quantidade de Cola (excesso ou falta) que está sendo aplicado no Produto;" },
  { setor: "ESTOFAMENTO", item: "13.4", descricao: "Verifiar o Alinhamento dos Componentes da Montagem do Produto;" },
  { setor: "ESTOFAMENTO", item: "13.5", descricao: "Medir Altura e Largura do Colchão após estofado;" },
  { setor: "ESTOFAMENTO", item: "13.6", descricao: "Checar visualmente a Uniformidade do Estofamento (sem bolhas, dobras ou falhas);" },
  { setor: "ESTOFAMENTO", item: "13.7", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "ESTOFAMENTO", item: "13.8", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "ESTOFAMENTO", item: "13.9", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "ESTOFAMENTO", item: "13.10", descricao: "Os Extintores estão Desobstruidos?" },
  { setor: "ESTOFAMENTO", item: "13.11", descricao: "Os Colabradores estão devidamente uniformizados e utilizando EPI adequado para a atividade que está sendo exercida?" },
  { setor: "ESTOFAMENTO", item: "13.12", descricao: "A Luminosidade da área está funcionamento (Lâmpadas funcionando e Íntegras)?" },
  { setor: "ESTOFAMENTO", item: "13.13", descricao: "Os colaboradores foram treinados em suas respectivas funções?" },
  { setor: "EMBALAGEM DE BASE", item: "15.1", descricao: "Verificar se o PA (BASE BOX), está sendo Conferido por Modelo e Medidas (Solteiro, Casal, Queen, King etc.)?" },
  { setor: "EMBALAGEM DE BASE", item: "15.2", descricao: "Checar se o PA (BASE BOX), está sendo Verificado se está Limpo e sem Defeitos Visuais?" },
  { setor: "EMBALAGEM DE BASE", item: "15.3", descricao: "Verificar a presença de Umidade nos Produtos Acabados;" },
  { setor: "EMBALAGEM DE BASE", item: "15.4", descricao: "Verifiar o Alinhamento dos Componentes da Montagem do Produto;" },
  { setor: "EMBALAGEM DE BASE", item: "15.5", descricao: "Verificar se os Box/Unibox/ Baú/Ortopédico, estão sendo Embalados com os Acessórios (Pés,etc.);" },
  { setor: "EMBALAGEM DE BASE", item: "15.6", descricao: "Verificar Altura de Empilhamento dos Produtos Acabados;" },
  { setor: "EMBALAGEM DE BASE", item: "15.7", descricao: "O local de trabalho está Limpo e Oganizado-5S aplicado?" },
  { setor: "EMBALAGEM DE BASE", item: "15.8", descricao: "Existe Material em Desuso espalhado pelo Setor?" },
  { setor: "EMBALAGEM DE BASE", item: "15.9", descricao: "Existe Resíduo para descarte acumulado no Setor?" },
  { setor: "EMBALAGEM DE BASE", item: "15.10", descricao: "No Setor foi identificado alguma Matéria Prima Enconstada na Parede?" },
];

// ── NC TYPES — exact text from NC_PADROES sheet ──
interface NcRawItem {
  setor: string;
  defeito: string;
}

const NC_TYPES_RAW: NcRawItem[] = [
  { setor: "ESPUMAÇÃO", defeito: "Totalidade cor fora do padrão" },
  { setor: "ESPUMAÇÃO", defeito: "Rachos ou Fendas" },
  { setor: "ESPUMAÇÃO", defeito: "Excesso de Graxa" },
  { setor: "ESPUMAÇÃO", defeito: "Bloco Seco" },
  { setor: "ESPUMAÇÃO", defeito: "Colapsos" },
  { setor: "ESPUMAÇÃO", defeito: "Impureza" },
  { setor: "ESPUMAÇÃO", defeito: "Deformação ou empenamento" },
  { setor: "ESPUMAÇÃO", defeito: "Queima do Bloco" },
  { setor: "ESPUMAÇÃO", defeito: "Odor Forte/Persistente" },
  { setor: "ESPUMAÇÃO", defeito: "Espuma Farelascenta" },
  { setor: "ESPUMAÇÃO", defeito: "Tonalidade Escura" },
  { setor: "ESPUMAÇÃO", defeito: "Bolhas" },
  { setor: "ESPUMAÇÃO", defeito: "Rachadura" },
  { setor: "ESPUMAÇÃO", defeito: "Estrutura" },
  { setor: "ESPUMAÇÃO", defeito: "Descascamento/Desenrolamento" },
  { setor: "ESPUMAÇÃO", defeito: "Deformação da Ponta" },
  { setor: "ESPUMAÇÃO", defeito: "Esfumação desigual" },
  { setor: "ESPUMAÇÃO", defeito: "Pontas torta" },
  { setor: "ESPUMAÇÃO", defeito: "Falha operador" },
  { setor: "ESPUMAÇÃO", defeito: "SEM OP" },
  { setor: "ESPUMAÇÃO", defeito: "OUTRO" },
  { setor: "ÁREA DE CURA", defeito: "Tomalidade fora do padrão" },
  { setor: "ÁREA DE CURA", defeito: "Rachaduras" },
  { setor: "ÁREA DE CURA", defeito: "Colapsos" },
  { setor: "ÁREA DE CURA", defeito: "Encolhimento especificações" },
  { setor: "ÁREA DE CURA", defeito: "Deformação" },
  { setor: "ÁREA DE CURA", defeito: "Bolhas" },
  { setor: "ÁREA DE CURA", defeito: "Odor Forte/Persistente" },
  { setor: "ÁREA DE CURA", defeito: "Fundo Denso" },
  { setor: "ÁREA DE CURA", defeito: "Falha operador" },
  { setor: "ÁREA DE CURA", defeito: "OUTRO" },
  { setor: "FLOCADEIRA", defeito: "Cola aderência" },
  { setor: "FLOCADEIRA", defeito: "Químico" },
  { setor: "FLOCADEIRA", defeito: "Especificações" },
  { setor: "FLOCADEIRA", defeito: "Aglomerado Fraco/Farelando" },
  { setor: "FLOCADEIRA", defeito: "Elasticidade" },
  { setor: "FLOCADEIRA", defeito: "Cola Excessiva (Zonas Duras)" },
  { setor: "FLOCADEIRA", defeito: "Fendas e Rachos Internos" },
  { setor: "FLOCADEIRA", defeito: "Superfície Irregular" },
  { setor: "FLOCADEIRA", defeito: "OUTRO" },
  { setor: "FLOCADEIRA", defeito: "Falha operador" },
  { setor: "LAMINAÇÃO", defeito: "Delaminação" },
  { setor: "LAMINAÇÃO", defeito: "Falha na colagem (Túneis/Bolhas)" },
  { setor: "LAMINAÇÃO", defeito: "Rugosidade/Vincos" },
  { setor: "LAMINAÇÃO", defeito: "Marcas indesejáveis" },
  { setor: "LAMINAÇÃO", defeito: "Células Fechadas" },
  { setor: "LAMINAÇÃO", defeito: "Rachos ou Fendas" },
  { setor: "LAMINAÇÃO", defeito: "Queima (Reversão)" },
  { setor: "LAMINAÇÃO", defeito: "Telescopagem" },
  { setor: "LAMINAÇÃO", defeito: "Variação de espessura" },
  { setor: "LAMINAÇÃO", defeito: "Impureza" },
  { setor: "LAMINAÇÃO", defeito: "Estorado" },
  { setor: "LAMINAÇÃO", defeito: "Falha operador" },
  { setor: "LAMINAÇÃO", defeito: "Corte fora do padrão" },
  { setor: "LAMINAÇÃO", defeito: "Laminas sem identificação" },
  { setor: "LAMINAÇÃO", defeito: "OUTRO" },
  { setor: "BORDADEIRA", defeito: "Cilindro com Impureza" },
  { setor: "BORDADEIRA", defeito: "Cilindro Rasgado" },
  { setor: "BORDADEIRA", defeito: "Falha operador" },
  { setor: "BORDADEIRA", defeito: "Cilindro fora da especificação" },
  { setor: "BORDADEIRA", defeito: "Cilindro Manchado" },
  { setor: "BORDADEIRA", defeito: "Cilindro Danificado" },
  { setor: "BORDADEIRA", defeito: "Tecido com morfo" },
  { setor: "BORDADEIRA", defeito: "Tecido sujo" },
  { setor: "BORDADEIRA", defeito: "Tecido fora do padrão" },
  { setor: "BORDADEIRA", defeito: "Tecido Rasgado" },
  { setor: "BORDADEIRA", defeito: "Tecido molhado" },
  { setor: "BORDADEIRA", defeito: "Tecido com Odor" },
  { setor: "BORDADEIRA", defeito: "Tecido Fios Faltantes" },
  { setor: "BORDADEIRA", defeito: "Tecido Buracos/Furo" },
  { setor: "BORDADEIRA", defeito: "Tecido Trama Torta/Enviesada" },
  { setor: "BORDADEIRA", defeito: "Tecido Manchas de Óleo" },
  { setor: "BORDADEIRA", defeito: "Tecido Tingimento Irregular" },
  { setor: "BORDADEIRA", defeito: "Tecido Baixa Refletividade" },
  { setor: "BORDADEIRA", defeito: "Tecido Pilling" },
  { setor: "BORDADEIRA", defeito: "OUTRO" },
  { setor: "ALMOXARIFADO", defeito: "Materiais Segregados por tipo." },
  { setor: "ALMOXARIFADO", defeito: "Embalagens Abertas." },
  { setor: "ALMOXARIFADO", defeito: "Poeira ou sujidades na Embalagem." },
  { setor: "ALMOXARIFADO", defeito: "Poeira ou Sujidades no Material." },
  { setor: "ALMOXARIFADO", defeito: "OUTRO" },
  { setor: "MOLA", defeito: "Materiais Segregados por tipo." },
  { setor: "MOLA", defeito: "Molejo com Molas expostas." },
  { setor: "MOLA", defeito: "Poeira ou sujidades na TNT das molas." },
  { setor: "MOLA", defeito: "Molas tortas." },
  { setor: "MOLA", defeito: "Altura incorreta." },
  { setor: "MOLA", defeito: "OUTRO" },
  { setor: "CORTE E COSTURA", defeito: "Materiais não Segregados por tipo." },
  { setor: "CORTE E COSTURA", defeito: "Costura frágil." },
  { setor: "CORTE E COSTURA", defeito: "Falha no bordado." },
  { setor: "CORTE E COSTURA", defeito: "Etiqueta desalinhada." },
  { setor: "CORTE E COSTURA", defeito: "Etiqueta Informação incorreta." },
  { setor: "CORTE E COSTURA", defeito: "Materiais não Segregados por tipo." },
  { setor: "CORTE E COSTURA", defeito: "Dimensões incorretas." },
  { setor: "CORTE E COSTURA", defeito: "Tecido sujo." },
  { setor: "CORTE E COSTURA", defeito: "Tecido furado." },
  { setor: "CORTE E COSTURA", defeito: "Tecido rasgado." },
  { setor: "CORTE E COSTURA", defeito: "Tecido enrugado." },
  { setor: "CORTE E COSTURA", defeito: "OUTRO" },
  { setor: "ESTOFAMENTO", defeito: "Materiais não Segregados por tipo." },
  { setor: "ESTOFAMENTO", defeito: "Dimensões incorretas das lâminas de espuma." },
  { setor: "ESTOFAMENTO", defeito: "Alinhamento da colagem das espumas." },
  { setor: "ESTOFAMENTO", defeito: "Colagem Soltando." },
  { setor: "ESTOFAMENTO", defeito: "OUTRO" },
  { setor: "FECHAMENTO", defeito: "Materiais não Segregado por tipo." },
  { setor: "FECHAMENTO", defeito: "Cadarço Desalinhado." },
  { setor: "FECHAMENTO", defeito: "Cadarço descosturado." },
  { setor: "FECHAMENTO", defeito: "Fios soltos Bordado." },
  { setor: "FECHAMENTO", defeito: "Fios soltos Cadarço." },
  { setor: "FECHAMENTO", defeito: "OUTRO" },
  { setor: "EMBALAGEM", defeito: "Materiais não Segregado por tipo." },
  { setor: "EMBALAGEM", defeito: "Embalagem aberta." },
  { setor: "EMBALAGEM", defeito: "OUTRO" },
  { setor: "MARCENARIA", defeito: "Base/PI fora das dimensões do plano de corte" },
  { setor: "MARCENARIA", defeito: "Estrutura com folgas" },
  { setor: "MARCENARIA", defeito: "Estrutura com partes soltas" },
  { setor: "MARCENARIA", defeito: "Estrutura torta" },
  { setor: "MARCENARIA", defeito: "Presença de farpas" },
  { setor: "MARCENARIA", defeito: "Presença de lascas" },
  { setor: "MARCENARIA", defeito: "Sobra de cola" },
  { setor: "MARCENARIA", defeito: "Grampos visíveis" },
  { setor: "MARCENARIA", defeito: "Madeira com umidade" },
  { setor: "MARCENARIA", defeito: "Madeira rachada" },
  { setor: "MARCENARIA", defeito: "Madeira com nós" },
  { setor: "MARCENARIA", defeito: "Madeira/compensado infestado" },
  { setor: "MARCENARIA", defeito: "Lâmpadas sem funcionamento" },
  { setor: "MARCENARIA", defeito: "Luminária danificada" },
  { setor: "MARCENARIA", defeito: "OUTRO" },
  { setor: "TAPEÇARIA", defeito: "Estrutura com rachaduras" },
  { setor: "TAPEÇARIA", defeito: "Estrutura com nó" },
  { setor: "TAPEÇARIA", defeito: "Estrutura com odor" },
  { setor: "TAPEÇARIA", defeito: "Etiqueta da capa descentralizada" },
  { setor: "TAPEÇARIA", defeito: "Cantoneira incorreta" },
  { setor: "TAPEÇARIA", defeito: "Pé incorreto" },
  { setor: "TAPEÇARIA", defeito: "Etiqueta do operador sem rastreabilidade" },
  { setor: "TAPEÇARIA", defeito: "Lâmpadas sem funcionamento" },
  { setor: "TAPEÇARIA", defeito: "Luminária danificada" },
  { setor: "TAPEÇARIA", defeito: "OUTRO" },
  { setor: "MÓVEIS", defeito: "Tecido com manchas" },
  { setor: "MÓVEIS", defeito: "Tecido com furos" },
  { setor: "MÓVEIS", defeito: "Tecido com linhas puxadas" },
  { setor: "MÓVEIS", defeito: "Material cortado sem OP" },
  { setor: "MÓVEIS", defeito: "Material cortado sem identificação do produto" },
  { setor: "MÓVEIS", defeito: "Material cortado sem quantidade" },
  { setor: "MÓVEIS", defeito: "Material cortado sem tamanho" },
  { setor: "MÓVEIS", defeito: "Modelo do móvel divergente" },
  { setor: "MÓVEIS", defeito: "Medida divergente" },
  { setor: "MÓVEIS", defeito: "Tipo de revestimento divergente" },
  { setor: "MÓVEIS", defeito: "Acessórios divergentes" },
  { setor: "MÓVEIS", defeito: "Presença de farpas" },
  { setor: "MÓVEIS", defeito: "Presença de lascas" },
  { setor: "MÓVEIS", defeito: "Sobra de cola" },
  { setor: "MÓVEIS", defeito: "Grampos visíveis" },
  { setor: "MÓVEIS", defeito: "Fios soltos" },
  { setor: "MÓVEIS", defeito: "Linhas aparentes/soltas" },
  { setor: "MÓVEIS", defeito: "Vincos" },
  { setor: "MÓVEIS", defeito: "Deformações" },
  { setor: "MÓVEIS", defeito: "Outras falhas de acabamento" },
  { setor: "MÓVEIS", defeito: "Produto sujo" },
  { setor: "MÓVEIS", defeito: "Estofado sem firmeza" },
  { setor: "MÓVEIS", defeito: "Falha de colagem" },
  { setor: "MÓVEIS", defeito: "Lâmpadas sem funcionamento" },
  { setor: "MÓVEIS", defeito: "Luminária danificada" },
  { setor: "MÓVEIS", defeito: "OUTRO" },
  { setor: "EMBALAGEM DE BASE", defeito: "Materiais não Segregado por tipo." },
  { setor: "EMBALAGEM DE BASE", defeito: "Embalagem aberta." },
  { setor: "EMBALAGEM DE BASE", defeito: "OUTRO" },
];

// ── MOLA PATTERNS — exact from Molas_Padroes sheet ──
interface MolaPadraoRaw {
  alturaTipo: string;
  item: string;
  descricao: string;
  padrao: string;
  minimo: number;
  maximo: number;
  unidade: string;
}

const MOLA_PADROES_RAW: MolaPadraoRaw[] = [
  { alturaTipo: "130", item: "1", descricao: "ALTURA MOLA", padrao: "130 ± 5", minimo: 125.0, maximo: 135.0, unidade: "mm" },
  { alturaTipo: "130", item: "2", descricao: "Ø INFERIOR", padrao: "60 ± 5", minimo: 55.0, maximo: 65.0, unidade: "mm" },
  { alturaTipo: "130", item: "3", descricao: "Ø SUPERIOR", padrao: "60 ± 5", minimo: 55.0, maximo: 65.0, unidade: "mm" },
  { alturaTipo: "130", item: "4", descricao: "Ø CENTRO", padrao: "65,5 ± 5", minimo: 60.5, maximo: 70.5, unidade: "mm" },
  { alturaTipo: "130", item: "5", descricao: "ESPESSURA", padrao: "2,0 ± 0,2", minimo: 1.8, maximo: 2.2, unidade: "mm" },
  { alturaTipo: "130", item: "6", descricao: "PESO", padrao: "18 ± 1", minimo: 17.0, maximo: 19.0, unidade: "g" },
  { alturaTipo: "130", item: "7", descricao: "ALTURA MOLA ENSACADA", padrao: "100 ± 5", minimo: 95.0, maximo: 105.0, unidade: "mm" },
  { alturaTipo: "130", item: "8", descricao: "TÊMPERA", padrao: "180 ± 0", minimo: 180.0, maximo: 180.0, unidade: "°C" },
  { alturaTipo: "200", item: "1", descricao: "ALTURA MOLA", padrao: "200 ± 5", minimo: 195.0, maximo: 205.0, unidade: "mm" },
  { alturaTipo: "200", item: "2", descricao: "Ø INFERIOR", padrao: "60 ± 5", minimo: 55.0, maximo: 65.0, unidade: "mm" },
  { alturaTipo: "200", item: "3", descricao: "Ø SUPERIOR", padrao: "60 ± 5", minimo: 55.0, maximo: 65.0, unidade: "mm" },
  { alturaTipo: "200", item: "4", descricao: "Ø CENTRO", padrao: "65,5 ± 5", minimo: 60.5, maximo: 70.5, unidade: "mm" },
  { alturaTipo: "200", item: "5", descricao: "ESPESSURA", padrao: "2,0 ± 0,2", minimo: 1.8, maximo: 2.2, unidade: "mm" },
  { alturaTipo: "200", item: "6", descricao: "PESO", padrao: "18 ± 1", minimo: 19.0, maximo: 21.0, unidade: "g" },
  { alturaTipo: "200", item: "7", descricao: "ALTURA MOLA ENSACADA", padrao: "150 ± 5", minimo: 145.0, maximo: 155.0, unidade: "mm" },
  { alturaTipo: "200", item: "8", descricao: "TÊMPERA", padrao: "180 ± 0", minimo: 180.0, maximo: 180.0, unidade: "°C" },
];

// ── USERS from spreadsheet ──
export const PLANILHA_USERS = [
  { usuario: "anderson", nome: "anderson", ativo: "SIM" },
  { usuario: "paulo", nome: "paulo", ativo: "SIM" },
  { usuario: "ryan", nome: "ryan", ativo: "SIM" },
  { usuario: "clay", nome: "clayberson", ativo: "SIM" },
];

// ── SEED FUNCTION ──
export function seedInspecoesData() {
  if (db.inspecoesModelos.length > 0) return; // idempotent

  const now = new Date().toISOString();

  // Group checklist items by sector -> create one modelo per sector
  const bySetor = new Map<string, ChecklistRawItem[]>();
  for (const ci of CHECKLIST_ITEMS_RAW) {
    if (!bySetor.has(ci.setor)) bySetor.set(ci.setor, []);
    bySetor.get(ci.setor)!.push(ci);
  }

  let modeloOrdem = 1;
  for (const [setor, items] of bySetor) {
    const itens = items.map((ci, idx) => {
      // Derive order from Item column (e.g., "1.2" -> 2), consistent with import script
      const parts = ci.item.split(".");
      let ordem = parts.length >= 2 ? parseInt(parts[parts.length - 1], 10) : idx + 1;
      if (isNaN(ordem)) ordem = idx + 1;

      return {
        id: itemId(),
        descricao: ci.descricao,
        ordem,
        obrigatorio: true,       // Default: all quality items are obligatory
        exigeEvidenciaNc: false,  // Default: evidence is optional (not mandatory for every NC)
        exigeTipoNc: true,       // Default: NC type classification is always required
        ativo: true,
      };
    });

    db.inspecoesModelos.push({
      id: `MOD-${String(modeloOrdem).padStart(3, "0")}`,
      nome: `Checklist ${setor}`,
      setor,
      descricao: `Checklist de inspeção do setor ${setor} — importado da planilha oficial`,
      ativo: true,
      ordem: modeloOrdem++,
      itens,
      createdAt: now,
      updatedAt: now,
    } as any);
  }

  // NC types
  let ncOrdem = 1;
  for (const nc of NC_TYPES_RAW) {
    db.inspecoesTiposNc.push({
      id: `TNC-${String(ncOrdem).padStart(3, "0")}`,
      setor: nc.setor,
      nome: nc.defeito,
      categoria: nc.defeito === "OUTRO" ? "Outro" : "Processo",
      ativo: true,
    } as any);
    ncOrdem++;
  }

  // Mola patterns
  let molaOrdem = 1;
  for (const mp of MOLA_PADROES_RAW) {
    db.inspecoesPadroesMola.push({
      id: `PM-${String(molaOrdem).padStart(3, "0")}`,
      alturaTipo: mp.alturaTipo,
      item: mp.item,
      descricao: mp.descricao,
      padrao: mp.padrao,
      minimo: mp.minimo,
      maximo: mp.maximo,
      unidade: mp.unidade,
      ativo: true,
    } as any);
    molaOrdem++;
  }
}
