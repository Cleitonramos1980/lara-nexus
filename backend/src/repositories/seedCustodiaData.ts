export const mockCustodias = [
  {
    id: "CUS-2026-0001", nfId: "NFT-2026-0003", nfNumero: "NF-113200",
    status: "EM_RISCO", cliente: "Havan — CD Brusque", destino: "Brusque / SC", valor: 256000,
    veiculoPlaca: "TBC-4C05", motoristaNome: "José Raimundo Costa", transportadoraNome: "TransBrasil Cargas",
    docaSaida: "Doca 01", operacaoPatio: "OPR-2026-0002",
    dataEmissao: "2026-03-07", dataSaidaPortaria: "2026-03-07T10:00:00", statusAceite: "PENDENTE",
    eventos: [
      { id: "CE-001", etapa: "Emissão", descricao: "NF-e emitida e autorizada", dataHora: "2026-03-07T08:00:00", responsavel: "Faturamento", tipo: "EMISSAO" },
      { id: "CE-002", etapa: "Vinculação", descricao: "Veículo TBC-4C05 e motorista associados", dataHora: "2026-03-07T09:00:00", responsavel: "Logística", tipo: "VINCULACAO" },
      { id: "CE-003", etapa: "Liberação", descricao: "Liberação na portaria", dataHora: "2026-03-07T09:45:00", responsavel: "Portaria", tipo: "LIBERACAO" },
      { id: "CE-004", etapa: "Saída", descricao: "Saída registrada na portaria MAO", dataHora: "2026-03-07T10:00:00", localizacao: "Portaria MAO", responsavel: "Portaria", tipo: "SAIDA" },
      { id: "CE-005", etapa: "Checkpoint", descricao: "Checkpoint Porto Velho / RO", dataHora: "2026-03-08T18:00:00", localizacao: "Porto Velho / RO", responsavel: "Rastreamento", tipo: "CHECKPOINT" },
    ],
    evidencias: [
      { id: "EV-001", tipo: "COMPROVANTE_SAIDA", descricao: "Registro de saída da portaria", dataHora: "2026-03-07T10:00:00", responsavel: "Portaria" },
    ],
    diasEmTransito: 5, scoreRisco: 78, planta: "MAO",
  },
  {
    id: "CUS-2026-0002", nfId: "NFT-2026-0006", nfNumero: "NF-112900",
    status: "ENTREGUE", cliente: "Magazine Luiza — CD Uberlândia", destino: "Uberlândia / MG", valor: 198000,
    veiculoPlaca: "NRF-8A01", motoristaNome: "Francisco Lima", transportadoraNome: "Norte Frete Express",
    docaSaida: "Doca 02",
    dataEmissao: "2026-03-03", dataSaidaPortaria: "2026-03-03T07:00:00",
    dataChegadaDestino: "2026-03-08T13:30:00", dataEntrega: "2026-03-08T14:00:00",
    recebedorNome: "Marcos Silva — Conferente CD", statusAceite: "ACEITO",
    eventos: [
      { id: "CE-010", etapa: "Emissão", descricao: "NF-e emitida", dataHora: "2026-03-03T06:00:00", responsavel: "Faturamento", tipo: "EMISSAO" },
      { id: "CE-011", etapa: "Saída", descricao: "Saída pela portaria MAO", dataHora: "2026-03-03T07:00:00", localizacao: "Portaria MAO", responsavel: "Portaria", tipo: "SAIDA" },
      { id: "CE-012", etapa: "Checkpoint", descricao: "Porto Velho / RO", dataHora: "2026-03-04T20:00:00", localizacao: "Porto Velho / RO", responsavel: "Rastreamento", tipo: "CHECKPOINT" },
      { id: "CE-013", etapa: "Checkpoint", descricao: "Cuiabá / MT", dataHora: "2026-03-06T10:00:00", localizacao: "Cuiabá / MT", responsavel: "Rastreamento", tipo: "CHECKPOINT" },
      { id: "CE-014", etapa: "Chegada", descricao: "Chegada ao CD Uberlândia", dataHora: "2026-03-08T13:30:00", localizacao: "Uberlândia / MG", responsavel: "CD Uberlândia", tipo: "CHEGADA" },
      { id: "CE-015", etapa: "Entrega", descricao: "Recebimento confirmado — conferência OK", dataHora: "2026-03-08T14:00:00", localizacao: "CD Uberlândia", responsavel: "Marcos Silva", tipo: "ENTREGA" },
    ],
    evidencias: [
      { id: "EV-010", tipo: "COMPROVANTE_SAIDA", descricao: "Registro de saída portaria", dataHora: "2026-03-03T07:00:00", responsavel: "Portaria" },
      { id: "EV-011", tipo: "COMPROVANTE_CHEGADA", descricao: "Registro de chegada CD", dataHora: "2026-03-08T13:30:00", responsavel: "CD Uberlândia" },
      { id: "EV-012", tipo: "PROVA_ENTREGA", descricao: "Canhoto assinado por Marcos Silva", dataHora: "2026-03-08T14:00:00", responsavel: "Marcos Silva" },
      { id: "EV-013", tipo: "ASSINATURA", descricao: "Assinatura digital do conferente", dataHora: "2026-03-08T14:00:00", responsavel: "Marcos Silva" },
    ],
    diasEmTransito: 5, scoreRisco: 0, planta: "MAO",
  },
  {
    id: "CUS-2026-0003", nfId: "NFT-2026-0004", nfNumero: "NF-113100",
    status: "EM_RISCO", cliente: "Riachuelo — CD Natal", destino: "Natal / RN", valor: 67000,
    veiculoPlaca: "AML-1Z99", motoristaNome: "Reginaldo Souza", transportadoraNome: "Amazônia Log",
    dataEmissao: "2026-03-05", dataSaidaPortaria: "2026-03-05T08:00:00",
    statusAceite: "PENDENTE", divergencia: "CT-e com valor divergente da NF — diferença de R$ 1.250,00",
    eventos: [
      { id: "CE-020", etapa: "Emissão", descricao: "NF-e emitida", dataHora: "2026-03-05T07:00:00", responsavel: "Faturamento", tipo: "EMISSAO" },
      { id: "CE-021", etapa: "Saída", descricao: "Saída pela portaria", dataHora: "2026-03-05T08:00:00", localizacao: "Portaria MAO", responsavel: "Portaria", tipo: "SAIDA" },
      { id: "CE-022", etapa: "Ocorrência", descricao: "CT-e com valor divergente detectado", dataHora: "2026-03-11T14:00:00", responsavel: "Fiscal", tipo: "DIVERGENCIA" },
    ],
    evidencias: [
      { id: "EV-020", tipo: "COMPROVANTE_SAIDA", descricao: "Registro de saída", dataHora: "2026-03-05T08:00:00", responsavel: "Portaria" },
    ],
    diasEmTransito: 7, scoreRisco: 95, planta: "MAO",
  },
];

export const mockCustodiaKPIs = {
  nfsEmTransito: 3, nfsEmRisco: 2, nfsAtrasadas: 2, nfsSemConfirmacao: 2,
  nfsComDivergencia: 1, entregasComRessalva: 0, devolucoes: 0,
  leadTimeMedio: 4.2, slaRota: 68, envelhecimentoMedio: 4.5,
};
