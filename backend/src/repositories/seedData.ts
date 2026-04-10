/**
 * Seed data for Inventário and Operacional collections.
 * Called once at startup to populate db if collections are empty.
 */
import { db } from "./dataStore.js";

const now = "2026-03-12";

export function seedInventarioData(): void {
  if ((db.inventarioLojas as any[]).length > 0) return;

  db.inventarioLojas = [
    { id: "L01", codigo: "001", nome: "Loja Centro Manaus", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Ana Souza" },
    { id: "L02", codigo: "002", nome: "Loja Adrianópolis", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Bruno Lima" },
    { id: "L03", codigo: "003", nome: "Loja Cachoeirinha", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Ana Souza" },
    { id: "L04", codigo: "004", nome: "Loja Parque 10", regional: "Norte", gerente: "Fernanda Reis", supervisor: "Diego Martins" },
    { id: "L05", codigo: "005", nome: "Loja Belém Nazaré", regional: "Norte", gerente: "Fernanda Reis", supervisor: "Camila Barros" },
    { id: "L06", codigo: "006", nome: "Loja Belém Pedreira", regional: "Norte", gerente: "Fernanda Reis", supervisor: "Camila Barros" },
    { id: "L07", codigo: "007", nome: "Loja Agrestina Centro", regional: "Nordeste", gerente: "Roberto Silva", supervisor: "Juliana Ramos" },
    { id: "L08", codigo: "008", nome: "Loja Caruaru", regional: "Nordeste", gerente: "Roberto Silva", supervisor: "Marcos Oliveira" },
    { id: "L09", codigo: "009", nome: "Loja Recife Boa Viagem", regional: "Nordeste", gerente: "Roberto Silva", supervisor: "Juliana Ramos" },
    { id: "L10", codigo: "010", nome: "Loja Cidade Nova", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Bruno Lima" },
  ] as any;

  db.inventarioDepartamentos = [
    { id: "D01", codigo: "COL", nome: "Colchões" },
    { id: "D02", codigo: "EST", nome: "Estofados" },
    { id: "D03", codigo: "MOV", nome: "Móveis" },
    { id: "D04", codigo: "ACE", nome: "Acessórios" },
    { id: "D05", codigo: "COZ", nome: "Cozinha" },
    { id: "D06", codigo: "DEC", nome: "Decoração" },
  ] as any;

  db.inventarioFrequencias = [
    { id: "FC01", lojaId: "L01", lojaNome: "Loja Centro Manaus", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Ana Souza", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", ativo: true, proximaExecucao: "2026-03-13", responsavelPadrao: "Maria Santos" },
    { id: "FC02", lojaId: "L01", lojaNome: "Loja Centro Manaus", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Ana Souza", departamentoId: "D02", departamentoNome: "Estofados", frequencia: "SEMANAL", ativo: true, proximaExecucao: "2026-03-16", responsavelPadrao: "Maria Santos" },
    { id: "FC03", lojaId: "L02", lojaNome: "Loja Adrianópolis", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Bruno Lima", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", ativo: true, proximaExecucao: "2026-03-13", responsavelPadrao: "Pedro Costa" },
  ] as any;

  function generateItems(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `ITEM-${String(i + 1).padStart(3, "0")}`,
      codigoItem: `${1000 + i * 13}`,
      codigoBarras: `789${String(Math.floor(Math.random() * 9999999999)).padStart(10, "0")}`,
      descricao: `Produto ${i + 1}`,
      estoqueSistema: 20 + i,
      quantidadeContada: 20 + i + (Math.random() > 0.7 ? Math.floor((Math.random() - 0.5) * 4) : 0),
      diferenca: 0,
    }));
  }

  db.inventarioContagens = [
    { id: "CNT-2026-0001", numero: "CNT-2026-0001", tarefaId: "T01", data: now, lojaId: "L01", lojaNome: "Loja Centro Manaus", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Ana Souza", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", responsavel: "Maria Santos", status: "VALIDADO", itens: generateItems(10), itensContados: 10, itensDivergentes: 1, acuracidade: 97.2, iniciadoEm: "2026-03-12T08:15:00", concluidoEm: "2026-03-12T09:45:00", validadoEm: "2026-03-12T10:30:00", validadoPor: "Ana Souza" },
    { id: "CNT-2026-0002", numero: "CNT-2026-0002", tarefaId: "T02", data: now, lojaId: "L02", lojaNome: "Loja Adrianópolis", regional: "Norte", gerente: "Carlos Mendes", supervisor: "Bruno Lima", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", responsavel: "Pedro Costa", status: "CONCLUIDO", itens: generateItems(10), itensContados: 10, itensDivergentes: 3, acuracidade: 88.5, iniciadoEm: "2026-03-12T07:30:00", concluidoEm: "2026-03-12T09:10:00" },
    { id: "CNT-2026-0003", numero: "CNT-2026-0003", tarefaId: "T03", data: now, lojaId: "L04", lojaNome: "Loja Parque 10", regional: "Norte", gerente: "Fernanda Reis", supervisor: "Diego Martins", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", responsavel: "Lucas Ferreira", status: "EM_ANDAMENTO", itens: generateItems(10), itensContados: 6, itensDivergentes: 2, acuracidade: 91.0, iniciadoEm: "2026-03-12T08:00:00" },
    { id: "CNT-2026-0004", numero: "CNT-2026-0004", tarefaId: "T04", data: now, lojaId: "L07", lojaNome: "Loja Agrestina Centro", regional: "Nordeste", gerente: "Roberto Silva", supervisor: "Juliana Ramos", departamentoId: "D01", departamentoNome: "Colchões", frequencia: "DIARIA", responsavel: "Sandra Vieira", status: "NAO_INICIADO", itens: generateItems(10), itensContados: 0, itensDivergentes: 0, acuracidade: 0 },
  ] as any;

  db.inventarioTarefas = (db.inventarioContagens as any[]).map((c: any, i: number) => ({
    id: `T${String(i + 1).padStart(2, "0")}`,
    data: c.data,
    lojaId: c.lojaId,
    lojaNome: c.lojaNome,
    regional: c.regional,
    gerente: c.gerente,
    supervisor: c.supervisor,
    departamentoId: c.departamentoId,
    departamentoNome: c.departamentoNome,
    frequencia: c.frequencia,
    responsavel: c.responsavel,
    status: c.status,
    contagemId: c.id,
  })) as any;

  db.inventarioDivergencias = [
    { data: now, lojaId: "L01", lojaNome: "Loja Centro Manaus", supervisor: "Ana Souza", departamento: "Colchões", frequencia: "DIARIA", itensContados: 10, itensDivergentes: 1, acuracidade: 97.2, status: "VALIDADO", contagemId: "CNT-2026-0001", nivel: "ok" },
    { data: now, lojaId: "L02", lojaNome: "Loja Adrianópolis", supervisor: "Bruno Lima", departamento: "Colchões", frequencia: "DIARIA", itensContados: 10, itensDivergentes: 3, acuracidade: 88.5, status: "CONCLUIDO", contagemId: "CNT-2026-0002", nivel: "atencao" },
    { data: now, lojaId: "L08", lojaNome: "Loja Caruaru", supervisor: "Marcos Oliveira", departamento: "Estofados", frequencia: "SEMANAL", itensContados: 10, itensDivergentes: 5, acuracidade: 72.0, status: "RECONTAGEM", contagemId: "CNT-2026-0006", nivel: "alta" },
  ] as any;
}

export function seedOperacionalData(): void {
  if ((db.operacionalAcessos as any[]).length > 0) return;

  db.operacionalAcessos = [
    { id: "ACS-2026-0001", tipo: "VISITANTE", nome: "João Carlos de Mendonça", documento: "123.456.789-01", empresa: "Consultoria Norte LTDA", placa: "ABC-1D23", tipoVeiculo: "Carro", responsavelInterno: "Ana Paula Soares", setorDestino: "Diretoria", horarioPrevisto: "2026-03-12T09:00:00", horarioReal: "2026-03-12T09:12:00", status: "EM_PERMANENCIA", criticidade: "BAIXA", motivo: "Reunião comercial", planta: "MAO", criadoEm: "2026-03-11T15:00:00", criadoPor: "Sistema", ultimaAtualizacao: "2026-03-12T09:12:00" },
    { id: "ACS-2026-0002", tipo: "MOTORISTA", nome: "Carlos Eduardo Silva", documento: "987.654.321-00", empresa: "Rápido Manaus Log.", placa: "MNO-5F67", tipoVeiculo: "Caminhão Truck", responsavelInterno: "Ricardo Lima", setorDestino: "Doca 03", horarioPrevisto: "2026-03-12T07:00:00", horarioReal: "2026-03-12T07:45:00", status: "ENTRADA_REGISTRADA", criticidade: "MEDIA", motivo: "Descarga NF 112500", planta: "MAO", criadoEm: "2026-03-11T18:00:00", criadoPor: "Agendamento", ultimaAtualizacao: "2026-03-12T07:45:00" },
    { id: "ACS-2026-0003", tipo: "PRESTADOR", nome: "Marcos Antônio Ferreira", documento: "456.123.789-55", empresa: "Manutenção Industrial MA", responsavelInterno: "Pedro Almeida", setorDestino: "Manutenção", horarioPrevisto: "2026-03-12T08:00:00", status: "AGUARDANDO_VALIDACAO", criticidade: "BAIXA", motivo: "Manutenção preventiva compressores", planta: "MAO", criadoEm: "2026-03-12T07:30:00", criadoPor: "Pedro Almeida", ultimaAtualizacao: "2026-03-12T07:30:00" },
  ] as any;

  db.operacionalVisitantes = [
    { id: "VIS-2026-0001", nome: "João Carlos de Mendonça", documento: "123.456.789-01", empresa: "Consultoria Norte LTDA", telefone: "(92) 99876-5432", email: "joao@consultorianorte.com.br", responsavelInterno: "Ana Paula Soares", setorDestino: "Diretoria", motivoVisita: "Reunião comercial trimestral", status: "VISITA_EM_ANDAMENTO", possuiVeiculo: true, veiculoId: "VVE-2026-0001", dataVisitaPrevista: "2026-03-12", criadoEm: "2026-03-11T15:00:00", criadoPor: "Ana Paula Soares", ultimaAtualizacao: "2026-03-12T09:12:00", planta: "MAO" },
    { id: "VIS-2026-0002", nome: "Maria Fernanda Oliveira", documento: "321.654.987-11", empresa: "Grupo Varejo Norte", telefone: "(92) 98765-4321", responsavelInterno: "Diretoria", setorDestino: "Sala de Reuniões", motivoVisita: "Visita técnica", status: "APROVADO", possuiVeiculo: true, veiculoId: "VVE-2026-0002", dataVisitaPrevista: "2026-03-12", criadoEm: "2026-03-10T10:00:00", criadoPor: "Ana Paula Soares", ultimaAtualizacao: "2026-03-11T16:00:00", planta: "MAO", qrCodeUrl: "QR-VIS-0002" },
    { id: "VIS-2026-0003", nome: "Roberto Nascimento", documento: "555.666.777-88", empresa: "Auditoria Externa S/A", telefone: "(11) 91234-5678", responsavelInterno: "Qualidade", setorDestino: "Qualidade", motivoVisita: "Auditoria ISO 9001", status: "ENCERRADO", possuiVeiculo: false, dataVisitaPrevista: "2026-03-11", criadoEm: "2026-03-10T08:00:00", criadoPor: "Pedro Almeida", ultimaAtualizacao: "2026-03-11T17:00:00", planta: "MAO" },
    { id: "VIS-2026-0004", nome: "Patrícia Lima Santos", documento: "999.888.777-66", empresa: "Fornecedor Têxtil PA", telefone: "(91) 98888-7777", responsavelInterno: "Compras", setorDestino: "Compras", motivoVisita: "Apresentação de tecidos", status: "EXPIRADO", possuiVeiculo: false, dataVisitaPrevista: "2026-03-10", criadoEm: "2026-03-08T14:00:00", criadoPor: "Compras", ultimaAtualizacao: "2026-03-10T23:59:00", planta: "MAO" },
    { id: "VIS-2026-0005", nome: "Fernando Albuquerque", documento: "444.555.666-77", empresa: "Tech Solutions AM", telefone: "(92) 97777-6666", responsavelInterno: "TI", setorDestino: "CPD", motivoVisita: "Instalação de servidor", status: "AGUARDANDO_VALIDACAO", possuiVeiculo: true, veiculoId: "VVE-2026-0003", dataVisitaPrevista: "2026-03-13", criadoEm: "2026-03-12T08:00:00", criadoPor: "TI", ultimaAtualizacao: "2026-03-12T08:00:00", planta: "MAO" },
    { id: "VIS-2026-0006", nome: "Luciana Barros", documento: "222.333.444-55", empresa: "Labtest Equipamentos", telefone: "(92) 96666-5555", responsavelInterno: "Qualidade", setorDestino: "Laboratório", motivoVisita: "Calibração de equipamentos", status: "CADASTRO_PREENCHIDO", possuiVeiculo: false, dataVisitaPrevista: "2026-03-14", criadoEm: "2026-03-12T09:00:00", criadoPor: "Sistema", ultimaAtualizacao: "2026-03-12T10:30:00", planta: "MAO" },
  ] as any;

  db.operacionalVeiculosVisitantes = [
    { id: "VVE-2026-0001", placa: "ABC-1D23", tipo: "Carro", modelo: "Toyota Corolla", cor: "Prata", visitanteId: "VIS-2026-0001", visitanteNome: "João Carlos de Mendonça", empresaOrigem: "Consultoria Norte LTDA", localVaga: "Estacionamento Visitantes - Vaga 04", horarioEntrada: "2026-03-12T09:12:00", status: "ESTACIONADO", planta: "MAO" },
    { id: "VVE-2026-0002", placa: "DEF-2G45", tipo: "SUV", modelo: "Hyundai Tucson", cor: "Branco", visitanteId: "VIS-2026-0002", visitanteNome: "Maria Fernanda Oliveira", empresaOrigem: "Grupo Varejo Norte", status: "AGUARDANDO_CHEGADA", planta: "MAO" },
    { id: "VVE-2026-0003", placa: "JKL-4M56", tipo: "Carro", modelo: "Honda Civic", cor: "Preto", visitanteId: "VIS-2026-0005", visitanteNome: "Fernando Albuquerque", empresaOrigem: "Tech Solutions AM", status: "AGUARDANDO_CHEGADA", planta: "MAO" },
  ] as any;

  db.operacionalFrota = [
    { id: "FRT-2026-0001", placa: "ROD-1A01", tipo: "Van", modelo: "Mercedes Sprinter", ano: 2024, setor: "Assistência Técnica", motoristaResponsavel: "Antônio Souza", status: "EM_DESLOCAMENTO", ultimaMovimentacao: "2026-03-12T07:30:00", quilometragem: 45230, planta: "MAO", alertas: [] },
    { id: "FRT-2026-0002", placa: "ROD-2B02", tipo: "Caminhão Toco", modelo: "VW Delivery 11.180", ano: 2023, setor: "Expedição", motoristaResponsavel: "Paulo Roberto", status: "DISPONIVEL", ultimaMovimentacao: "2026-03-11T17:00:00", quilometragem: 78500, planta: "MAO", alertas: ["Revisão em 500 km"], proximaManutencao: "2026-03-20" },
    { id: "FRT-2026-0003", placa: "ROD-3C03", tipo: "Utilitário", modelo: "Fiat Fiorino", ano: 2024, setor: "Compras", motoristaResponsavel: "Marcos Vieira", status: "PARADA_PROGRAMADA", ultimaMovimentacao: "2026-03-12T06:00:00", quilometragem: 23100, planta: "MAO", alertas: [] },
    { id: "FRT-2026-0004", placa: "ROD-4D04", tipo: "Van", modelo: "Renault Master", ano: 2022, setor: "Assistência Técnica", motoristaResponsavel: "José Oliveira", status: "EM_MANUTENCAO", ultimaMovimentacao: "2026-03-10T14:00:00", quilometragem: 89700, planta: "MAO", alertas: ["Troca de embreagem"], proximaManutencao: "2026-03-15" },
    { id: "FRT-2026-0005", placa: "ROD-5E05", tipo: "Caminhão 3/4", modelo: "Iveco Daily 35S14", ano: 2024, setor: "Expedição", motoristaResponsavel: "Raimundo Costa", status: "EM_DESLOCAMENTO", ultimaMovimentacao: "2026-03-12T05:30:00", quilometragem: 31200, planta: "MAO", alertas: ["Licenciamento vence em 15 dias"] },
    { id: "FRT-2026-0006", placa: "ROD-6F06", tipo: "Moto", modelo: "Honda CG 160", ano: 2025, setor: "Expedição Urbana", motoristaResponsavel: "Diego Santos", status: "DISPONIVEL", ultimaMovimentacao: "2026-03-12T08:00:00", quilometragem: 8900, planta: "MAO", alertas: [] },
    { id: "FRT-2026-0007", placa: "ROD-7G07", tipo: "Caminhão Truck", modelo: "Scania P250", ano: 2021, setor: "Transferência", motoristaResponsavel: "Luís Fernando", status: "BLOQUEADO", ultimaMovimentacao: "2026-03-08T10:00:00", quilometragem: 156000, planta: "MAO", alertas: ["IPVA atrasado", "Seguro vencido"] },
  ] as any;

  db.operacionalDeslocamentos = [
    { id: "DSL-001", veiculoId: "FRT-2026-0001", placa: "ROD-1A01", motorista: "Antônio Souza", origem: "Fábrica MAO", destino: "Cliente Magazine Luiza - Centro", horarioSaida: "2026-03-12T07:30:00", horarioPrevistoChegada: "2026-03-12T08:30:00", status: "EM_ROTA", kmPercorrido: 12, notasFiscais: [{ numero: "NF-112500", descricao: "Colchões King" }] },
    { id: "DSL-002", veiculoId: "FRT-2026-0005", placa: "ROD-5E05", motorista: "Raimundo Costa", origem: "CD Manaus", destino: "Filial Iranduba", horarioSaida: "2026-03-12T05:30:00", horarioPrevistoChegada: "2026-03-12T07:00:00", status: "ATRASADO", kmPercorrido: 35, notasFiscais: [{ numero: "NF-113200" }] },
  ] as any;

  db.operacionalTransportadoras = [
    { id: "TRN-001", nome: "Rápido Manaus Logística", cnpj: "12.345.678/0001-90", contato: "Carlos Operações", telefone: "(92) 3232-1010", status: "ATIVA", rntrc: "RNTRC-000123", qtdOperacoes: 48, mediaAtraso: 15, slaScore: 87 },
    { id: "TRN-002", nome: "TransBrasil Cargas", cnpj: "98.765.432/0001-10", contato: "Sandra Logística", telefone: "(92) 3131-2020", status: "ATIVA", rntrc: "RNTRC-000456", qtdOperacoes: 32, mediaAtraso: 45, slaScore: 62 },
    { id: "TRN-003", nome: "Norte Frete Express", cnpj: "55.444.333/0001-22", contato: "Marcos Expedição", telefone: "(92) 3030-3030", status: "ATIVA", rntrc: "RNTRC-000789", qtdOperacoes: 15, mediaAtraso: 8, slaScore: 94 },
    { id: "TRN-004", nome: "Amazônia Log", cnpj: "11.222.333/0001-44", contato: "Roberto Fretes", telefone: "(92) 2929-4040", status: "BLOQUEADA", rntrc: "RNTRC-001234", qtdOperacoes: 5, mediaAtraso: 120, slaScore: 28 },
  ] as any;

  db.operacionalMotoristasTerceiros = [
    { id: "MOT-T-001", nome: "Carlos Eduardo Silva", documento: "987.654.321-00", transportadoraId: "TRN-001", transportadoraNome: "Rápido Manaus Logística", telefone: "(92) 98765-0001", status: "ATIVO", ultimaEntrada: "2026-03-12T07:45:00" },
    { id: "MOT-T-002", nome: "José Raimundo Costa", documento: "111.222.333-44", transportadoraId: "TRN-002", transportadoraNome: "TransBrasil Cargas", telefone: "(92) 98765-0002", status: "ATIVO", ultimaEntrada: "2026-03-12T08:30:00" },
    { id: "MOT-T-003", nome: "Francisco Lima", documento: "777.888.999-00", transportadoraId: "TRN-003", transportadoraNome: "Norte Frete Express", telefone: "(92) 98765-0003", status: "ATIVO" },
  ] as any;

  db.operacionalVeiculosTerceiros = [
    { id: "VT-001", placa: "MNO-5F67", tipo: "Caminhão Truck", transportadoraId: "TRN-001", transportadoraNome: "Rápido Manaus Logística", motoristaId: "MOT-T-001", motoristaNome: "Carlos Eduardo Silva", statusOperacao: "EM_DOCA", localizacao: "Doca 03", docaAtual: "DCA-003" },
    { id: "VT-002", placa: "GHI-3H89", tipo: "Carreta", transportadoraId: "TRN-002", transportadoraNome: "TransBrasil Cargas", motoristaId: "MOT-T-002", motoristaNome: "José Raimundo Costa", statusOperacao: "AGUARDANDO_DOCA", localizacao: "Pátio" },
    { id: "VT-003", placa: "PQR-6I01", tipo: "Caminhão Toco", transportadoraId: "TRN-003", transportadoraNome: "Norte Frete Express", motoristaId: "MOT-T-003", motoristaNome: "Francisco Lima", statusOperacao: "FILA_EXTERNA", localizacao: "Fila Externa" },
  ] as any;

  db.operacionalOperacoes = [
    { id: "OPR-2026-0001", tipo: "DESCARGA", transportadoraId: "TRN-001", transportadoraNome: "Rápido Manaus Logística", motoristaId: "MOT-T-001", motoristaNome: "Carlos Eduardo Silva", veiculoId: "VT-001", placa: "MNO-5F67", docaId: "DCA-003", docaNome: "Doca 03", horarioPrevisto: "2026-03-12T07:00:00", horarioChegada: "2026-03-12T07:45:00", horarioInicio: "2026-03-12T08:15:00", status: "EM_ANDAMENTO", nfVinculada: "NF-112500", planta: "MAO" },
    { id: "OPR-2026-0002", tipo: "CARGA", transportadoraId: "TRN-002", transportadoraNome: "TransBrasil Cargas", motoristaId: "MOT-T-002", motoristaNome: "José Raimundo Costa", veiculoId: "VT-002", placa: "GHI-3H89", horarioPrevisto: "2026-03-12T06:00:00", horarioChegada: "2026-03-12T08:30:00", status: "ATRASADA", nfVinculada: "NF-113200", planta: "MAO" },
  ] as any;

  db.operacionalAgendamentos = [
    { id: "AGE-2026-0001", docaId: "DCA-003", docaNome: "Doca 03", transportadoraId: "TRN-001", transportadoraNome: "Rápido Manaus Logística", operacao: "DESCARGA", horarioPrevisto: "2026-03-12T07:00:00", status: "EM_ANDAMENTO", placa: "MNO-5F67", motorista: "Carlos Eduardo Silva", planta: "MAO" },
    { id: "AGE-2026-0002", docaId: "DCA-001", docaNome: "Doca 01", transportadoraId: "TRN-002", transportadoraNome: "TransBrasil Cargas", operacao: "CARGA", horarioPrevisto: "2026-03-12T06:00:00", status: "JANELA_PERDIDA", placa: "GHI-3H89", motorista: "José Raimundo Costa", planta: "MAO" },
    { id: "AGE-2026-0003", docaId: "DCA-002", docaNome: "Doca 02", transportadoraId: "TRN-003", transportadoraNome: "Norte Frete Express", operacao: "COLETA", horarioPrevisto: "2026-03-12T10:00:00", status: "CONFIRMADO", placa: "PQR-6I01", motorista: "Francisco Lima", planta: "MAO" },
  ] as any;

  db.operacionalDocas = [
    { id: "DCA-001", nome: "Doca 01", status: "LIVRE", planta: "MAO" },
    { id: "DCA-002", nome: "Doca 02", status: "LIVRE", planta: "MAO" },
    { id: "DCA-003", nome: "Doca 03", status: "OCUPADA", veiculoAtual: "VT-001", placaAtual: "MNO-5F67", operacaoAtual: "Descarga NF-112500", tempoOcupacao: 75, planta: "MAO" },
    { id: "DCA-004", nome: "Doca 04", status: "MANUTENCAO", planta: "MAO" },
    { id: "DCA-005", nome: "Doca 05", status: "LIVRE", planta: "MAO" },
  ] as any;

  db.operacionalFilaPatio = [
    { id: "FP-001", ordem: 1, placa: "GHI-3H89", tipoVeiculo: "Carreta", transportadora: "TransBrasil Cargas", operacao: "CARGA", horarioChegada: "2026-03-12T08:30:00", tempoAguardando: 90, prioridade: "ALTA", status: "AGUARDANDO_DOCA" },
    { id: "FP-002", ordem: 2, placa: "PQR-6I01", tipoVeiculo: "Caminhão Toco", transportadora: "Norte Frete Express", operacao: "COLETA", horarioChegada: "2026-03-12T09:30:00", tempoAguardando: 30, prioridade: "NORMAL", status: "FILA_EXTERNA" },
  ] as any;

  db.operacionalAlertas = [
    { id: "ALT-001", tipo: "ATRASO_OPERACAO", descricao: "Operação OPR-2026-0002 atrasada", origem: "Operação", origemId: "OPR-2026-0002", criticidade: "ALTA", responsavel: "Logística", status: "ATIVO", criadoEm: "2026-03-12T08:35:00", acaoSugerida: "Replanejar doca" },
    { id: "ALT-002", tipo: "DOCA_OCUPADA_ACIMA_LIMITE", descricao: "Doca 03 ocupada há 75 min", origem: "Pátio", origemId: "DCA-003", criticidade: "MEDIA", responsavel: "Supervisor Pátio", status: "ATIVO", criadoEm: "2026-03-12T09:30:00" },
    { id: "ALT-003", tipo: "NF_EM_RISCO", descricao: "NF 113200 — 5 dias sem confirmação", origem: "NF em Trânsito", origemId: "NFT-2026-0003", criticidade: "ALTA", responsavel: "Logística", status: "ATIVO", criadoEm: "2026-03-12T06:00:00" },
  ] as any;

  db.operacionalExcecoes = [
    { id: "EXC-2026-0001", tipo: "Atraso Operacional", origem: "Operação", origemId: "OPR-2026-0002", descricao: "Veículo GHI-3H89 chegou 2h30 atrasado", criticidade: "ALTA", responsavel: "Logística", status: "ABERTA", abertura: "2026-03-12T08:35:00", prazo: "2026-03-12T12:00:00", acaoSugerida: "Replanejar e abrir NC" },
    { id: "EXC-2026-0002", tipo: "Divergência Fiscal", origem: "NF em Trânsito", origemId: "NFT-2026-0004", descricao: "CT-e com valor divergente", criticidade: "CRITICA", responsavel: "Fiscal", status: "EM_TRATAMENTO", abertura: "2026-03-11T14:00:00", prazo: "2026-03-12T14:00:00", acaoSugerida: "Verificar com transportadora" },
  ] as any;

  db.operacionalNFsTransito = [
    { id: "NFT-2026-0001", numero: "NF-113500", chaveNfe: "13260312345678000190550010001135001001135009", cliente: "Magazine Luiza — CD São Paulo", destino: "São Paulo / SP", uf: "SP", valor: 185000, peso: 4200, volumes: 120, dataEmissao: "2026-03-10", dataSaidaPrevista: "2026-03-10", dataSaidaReal: "2026-03-10T16:00:00", dataEntregaPrevista: "2026-03-15", diasEmTransito: 2, status: "EM_TRANSITO", criticidade: "VERDE", scoreRisco: 15, transportadoraNome: "Norte Frete Express", transportadoraId: "TRN-003", placa: "NRF-8A01", motoristaNome: "Francisco Lima", checkpoints: [{ id: "CK-001", tipo: "SAIDA_PORTARIA", descricao: "Saída registrada", dataHora: "2026-03-10T16:00:00", localizacao: "Portaria MAO" }], alertas: [], planta: "MAO" },
    { id: "NFT-2026-0003", numero: "NF-113200", chaveNfe: "13260312345678000190550010001132001001132009", cliente: "Havan — CD Brusque", destino: "Brusque / SC", uf: "SC", valor: 256000, peso: 5800, volumes: 180, dataEmissao: "2026-03-07", dataSaidaPrevista: "2026-03-07", dataSaidaReal: "2026-03-07T10:00:00", dataEntregaPrevista: "2026-03-12", diasEmTransito: 5, status: "EM_RISCO", criticidade: "VERMELHO", scoreRisco: 78, motivoRisco: "Prazo vencido", acaoRecomendada: "Contatar transportadora", transportadoraNome: "TransBrasil Cargas", transportadoraId: "TRN-002", placa: "TBC-4C05", motoristaNome: "José Raimundo Costa", checkpoints: [{ id: "CK-006", tipo: "SAIDA_PORTARIA", descricao: "Saída registrada", dataHora: "2026-03-07T10:00:00", localizacao: "Portaria MAO" }], alertas: ["Prazo vencido", "Sem atualização há 3 dias"], planta: "MAO" },
  ] as any;

  db.operacionalExcecoesFiscais = [
    { id: "EXF-001", tipo: "CT-e Divergente", nfId: "NFT-2026-0004", nfNumero: "NF-113100", descricao: "Valor do CT-e diverge da NF", criticidade: "CRITICO", status: "EM_TRATAMENTO", criadoEm: "2026-03-11T14:00:00", responsavel: "Fiscal" },
    { id: "EXF-003", tipo: "Sem Confirmação", nfId: "NFT-2026-0003", nfNumero: "NF-113200", descricao: "NF sem confirmação de recebimento", criticidade: "VERMELHO", status: "ABERTA", criadoEm: "2026-03-12T06:00:00", responsavel: "Logística" },
  ] as any;

  db.operacionalMovimentacoesFrota = [
    { id: "MOV-001", veiculoId: "FRT-2026-0001", statusAnterior: "DISPONIVEL", statusNovo: "EM_DESLOCAMENTO", descricao: "Saída para entrega", dataHora: "2026-03-12T07:30:00", usuario: "Antônio Souza", km: 45218 },
    { id: "MOV-002", veiculoId: "FRT-2026-0002", statusAnterior: "EM_DESLOCAMENTO", statusNovo: "DISPONIVEL", descricao: "Retorno de entrega", dataHora: "2026-03-11T17:00:00", usuario: "Paulo Roberto", docaNome: "Doca 01", km: 78500 },
  ] as any;

  db.operacionalTimeline = [
    { id: "EVT-001", tipo: "PRE_AUTORIZACAO", descricao: "Pré-autorização criada", dataHora: "2026-03-11T15:00:00", usuario: "Ana Paula Soares" },
    { id: "EVT-002", tipo: "LINK_ENVIADO", descricao: "Link de cadastro enviado ao visitante", dataHora: "2026-03-11T15:05:00", usuario: "Sistema" },
    { id: "EVT-003", tipo: "APROVACAO", descricao: "Acesso aprovado pela responsável", dataHora: "2026-03-11T19:00:00", usuario: "Ana Paula Soares" },
    { id: "EVT-004", tipo: "ENTRADA_REGISTRADA", descricao: "Entrada registrada na portaria", dataHora: "2026-03-12T09:12:00", usuario: "Portaria", detalhes: "Placa ABC-1D23 identificada" },
  ] as any;

  db.operacionalDashboard = {
    visitantesPresentes: 2,
    veiculosVisitantesPresentes: 1,
    frotaEmDeslocamento: 2,
    terceirosNaUnidade: 2,
    docasOcupadas: 1,
    docasTotal: 5,
    filaExterna: 2,
    filaInterna: 0,
    veiculosParados: 1,
    tempoMedioPatio: 65,
    slaGeral: 74,
    alertasAtivos: 3,
    nfsEmTransito: 2,
    nfsEmRisco: 1,
    nfsSemConfirmacao: 1,
    valorEmTransito: 441000,
    valorEmRisco: 256000,
    mediaDiasTransito: 3.5,
  } as any;
}
