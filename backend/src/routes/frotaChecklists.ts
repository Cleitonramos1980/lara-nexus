import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, nextId, appendAudit } from "../repositories/dataStore.js";

const checklistStatusSchema = z.enum(["RASCUNHO", "CONCLUIDO", "CANCELADO"]);
const tipoAtendimentoSchema = z.enum([
  "CLIENTE_PLATAFORMA",
  "GUINCHO_GARAGEM",
  "TAXI",
  "SOS_MECANICOS",
  "PARTICULAR",
]);
const condicaoPneusSchema = z.enum(["NOVOS", "BONS", "RUINS"]);
const vistoriaTipoVeiculoSchema = z.enum(["PASSEIO", "MOTOCICLETA", "UTILITARIO"]);
const tipoDanoSchema = z.enum(["AMASSADO", "RISCADO", "QUEBRADO"]);
const acessorioStatusSchema = z.enum(["S", "N", "A"]);

const enderecoSchema = z.object({
  endereco: z.string().default(""),
  numero: z.string().default(""),
  bairro: z.string().default(""),
  cidade: z.string().default(""),
  telefone: z.string().default(""),
  estado: z.string().default(""),
});

const destinoSchema = enderecoSchema.extend({
  oficina: z.string().default(""),
});

const avariaSchema = z.object({
  id: z.string().optional(),
  pontoId: z.string().min(1),
  pontoLabel: z.string().min(1),
  tipoDano: tipoDanoSchema,
  observacao: z.string().default(""),
  x: z.number(),
  y: z.number(),
  lado: z.string().default("EXTERNO"),
});

const acessorioSchema = z.object({
  id: z.string().optional(),
  item: z.string().min(1),
  status: acessorioStatusSchema,
  observacao: z.string().optional().default(""),
});

const fotoSchema = z.object({
  id: z.string().optional(),
  nomeArquivo: z.string().min(1),
  url: z.string().min(1),
  tamanhoBytes: z.number().nonnegative().default(0),
  adicionadoEm: z.string().optional(),
  adicionadoPor: z.string().optional(),
});

const assinaturasSchema = z.object({
  seguradoBeneficiario: z.object({
    nome: z.string().default(""),
    data: z.string().default(""),
    hora: z.string().default(""),
    assinatura: z.string().default(""),
  }),
  destinatarioPrestador: z.object({
    nome: z.string().default(""),
    data: z.string().default(""),
    hora: z.string().default(""),
    assinaturaDestinatario: z.string().default(""),
    assinaturaPrestador: z.string().default(""),
  }),
});

const checklistPayloadSchema = z.object({
  data: z.string().min(1),
  horaSolicitacao: z.string().min(1),
  placa: z.string().default(""),
  km: z.number().nullable(),
  tipoAtendimento: z.array(tipoAtendimentoSchema).default([]),
  motorista: z.string().default(""),
  sinistro: z.string().default(""),
  proprietario: z.string().default(""),
  seguradora: z.string().default(""),
  telefone: z.string().default(""),
  veiculo: z.string().default(""),
  ano: z.string().default(""),
  cor: z.string().default(""),
  placaVeiculo: z.string().default(""),
  kmVeiculo: z.number().nullable(),
  atendimento: enderecoSchema,
  destino: destinoSchema,
  vistoriaTipoVeiculo: vistoriaTipoVeiculoSchema,
  avarias: z.array(avariaSchema).default([]),
  fotos: z.array(fotoSchema).default([]),
  fotografado: z.boolean().default(false),
  combustivel: z.number().min(0).max(100).default(50),
  condicaoPneus: condicaoPneusSchema,
  acessorios: z.array(acessorioSchema).default([]),
  clienteDispensaVistoria: z.boolean().default(false),
  usuarioAcompanhouRemocao: z.boolean().default(false),
  usuarioOrientadoRetirarPertences: z.boolean().default(false),
  clienteCiente: z.boolean().default(false),
  assinaturas: assinaturasSchema,
});

type ChecklistPayload = z.infer<typeof checklistPayloadSchema>;
type ChecklistStatus = z.infer<typeof checklistStatusSchema>;

interface ChecklistMainRecord extends ChecklistPayload {
  id: string;
  numeroChecklist: string;
  status: ChecklistStatus;
  criadoPor: string;
  criadoEm: string;
  atualizadoPor: string;
  atualizadoEm: string;
  concluidoPor?: string;
  concluidoEm?: string;
  canceladoPor?: string;
  canceladoEm?: string;
}

interface ChildRecordBase {
  id: string;
  checklistId: string;
}

interface AvariaRecord extends ChildRecordBase {
  pontoId: string;
  pontoLabel: string;
  tipoDano: z.infer<typeof tipoDanoSchema>;
  observacao: string;
  x: number;
  y: number;
  lado: string;
}

interface AcessorioRecord extends ChildRecordBase {
  item: string;
  status: z.infer<typeof acessorioStatusSchema>;
  observacao: string;
}

interface FotoRecord extends ChildRecordBase {
  nomeArquivo: string;
  url: string;
  tamanhoBytes: number;
  adicionadoEm: string;
  adicionadoPor: string;
}

interface AssinaturaRecord extends ChildRecordBase {
  tipo: "SEGURADO_BENEFICIARIO" | "DESTINATARIO" | "PRESTADOR";
  nome: string;
  data: string;
  hora: string;
  assinatura: string;
}

interface HistoricoRecord extends ChildRecordBase {
  dataHora: string;
  usuario: string;
  acao: string;
  descricao: string;
}

function currentUser(req: any): string {
  return req?.authUser?.nome || "system";
}

function canEditConcluded(req: any): boolean {
  const perfil = req?.authUser?.perfil;
  return perfil === "ADMIN";
}

function nextChecklistNumber(records: ChecklistMainRecord[]): string {
  const year = new Date().getFullYear();
  const regex = new RegExp(`^CHK-${year}-(\\d{4})$`);
  const max = records.reduce((acc, item) => {
    const match = item.numeroChecklist.match(regex);
    if (!match) return acc;
    const seq = Number(match[1]);
    return Number.isFinite(seq) ? Math.max(acc, seq) : acc;
  }, 0);
  return `CHK-${year}-${String(max + 1).padStart(4, "0")}`;
}

function addHistorico(checklistId: string, usuario: string, acao: string, descricao: string): void {
  const historico = db.frotaChecklistHistorico as HistoricoRecord[];
  historico.unshift({
    id: nextId("HFC", historico.length),
    checklistId,
    dataHora: new Date().toISOString(),
    usuario,
    acao,
    descricao,
  });
}

function replaceChildCollections(checklistId: string, payload: ChecklistPayload, usuario: string): void {
  const avarias = db.frotaChecklistAvarias as AvariaRecord[];
  const acessorios = db.frotaChecklistAcessorios as AcessorioRecord[];
  const fotos = db.frotaChecklistFotos as FotoRecord[];
  const assinaturas = db.frotaChecklistAssinaturas as AssinaturaRecord[];

  db.frotaChecklistAvarias = avarias.filter((item) => item.checklistId !== checklistId);
  db.frotaChecklistAcessorios = acessorios.filter((item) => item.checklistId !== checklistId);
  db.frotaChecklistFotos = fotos.filter((item) => item.checklistId !== checklistId);
  db.frotaChecklistAssinaturas = assinaturas.filter((item) => item.checklistId !== checklistId);

  const nextAvarias = payload.avarias.map((item, index) => ({
    id: item.id || `AVR-${checklistId}-${index + 1}`,
    checklistId,
    pontoId: item.pontoId,
    pontoLabel: item.pontoLabel,
    tipoDano: item.tipoDano,
    observacao: item.observacao || "",
    x: item.x,
    y: item.y,
    lado: item.lado || "EXTERNO",
  }));

  const nextAcessorios = payload.acessorios.map((item, index) => ({
    id: item.id || `ACC-${checklistId}-${index + 1}`,
    checklistId,
    item: item.item,
    status: item.status,
    observacao: item.observacao || "",
  }));

  const now = new Date().toISOString();
  const nextFotos = payload.fotos.map((item, index) => ({
    id: item.id || `FTO-${checklistId}-${index + 1}`,
    checklistId,
    nomeArquivo: item.nomeArquivo,
    url: item.url,
    tamanhoBytes: item.tamanhoBytes || 0,
    adicionadoEm: item.adicionadoEm || now,
    adicionadoPor: item.adicionadoPor || usuario,
  }));

  const nextAssinaturas: AssinaturaRecord[] = [
    {
      id: `ASN-${checklistId}-1`,
      checklistId,
      tipo: "SEGURADO_BENEFICIARIO",
      nome: payload.assinaturas.seguradoBeneficiario.nome,
      data: payload.assinaturas.seguradoBeneficiario.data,
      hora: payload.assinaturas.seguradoBeneficiario.hora,
      assinatura: payload.assinaturas.seguradoBeneficiario.assinatura,
    },
    {
      id: `ASN-${checklistId}-2`,
      checklistId,
      tipo: "DESTINATARIO",
      nome: payload.assinaturas.destinatarioPrestador.nome,
      data: payload.assinaturas.destinatarioPrestador.data,
      hora: payload.assinaturas.destinatarioPrestador.hora,
      assinatura: payload.assinaturas.destinatarioPrestador.assinaturaDestinatario,
    },
    {
      id: `ASN-${checklistId}-3`,
      checklistId,
      tipo: "PRESTADOR",
      nome: payload.assinaturas.destinatarioPrestador.nome,
      data: payload.assinaturas.destinatarioPrestador.data,
      hora: payload.assinaturas.destinatarioPrestador.hora,
      assinatura: payload.assinaturas.destinatarioPrestador.assinaturaPrestador,
    },
  ];

  db.frotaChecklistAvarias = [...(db.frotaChecklistAvarias as AvariaRecord[]), ...nextAvarias];
  db.frotaChecklistAcessorios = [...(db.frotaChecklistAcessorios as AcessorioRecord[]), ...nextAcessorios];
  db.frotaChecklistFotos = [...(db.frotaChecklistFotos as FotoRecord[]), ...nextFotos];
  db.frotaChecklistAssinaturas = [...(db.frotaChecklistAssinaturas as AssinaturaRecord[]), ...nextAssinaturas];
}

function toResponse(main: ChecklistMainRecord) {
  const avarias = (db.frotaChecklistAvarias as AvariaRecord[]).filter((item) => item.checklistId === main.id);
  const acessorios = (db.frotaChecklistAcessorios as AcessorioRecord[]).filter((item) => item.checklistId === main.id);
  const fotos = (db.frotaChecklistFotos as FotoRecord[]).filter((item) => item.checklistId === main.id);
  const assinaturas = (db.frotaChecklistAssinaturas as AssinaturaRecord[]).filter((item) => item.checklistId === main.id);
  const historico = (db.frotaChecklistHistorico as HistoricoRecord[])
    .filter((item) => item.checklistId === main.id)
    .map((item) => ({
      id: item.id,
      dataHora: item.dataHora,
      usuario: item.usuario,
      acao: item.acao,
      descricao: item.descricao,
    }));

  const segurado = assinaturas.find((item) => item.tipo === "SEGURADO_BENEFICIARIO");
  const destinatario = assinaturas.find((item) => item.tipo === "DESTINATARIO");
  const prestador = assinaturas.find((item) => item.tipo === "PRESTADOR");

  return {
    ...main,
    avarias: avarias.map((item) => ({
      id: item.id,
      pontoId: item.pontoId,
      pontoLabel: item.pontoLabel,
      tipoDano: item.tipoDano,
      observacao: item.observacao,
      x: item.x,
      y: item.y,
      lado: item.lado,
    })),
    acessorios: acessorios.map((item) => ({
      id: item.id,
      item: item.item,
      status: item.status,
      observacao: item.observacao,
    })),
    fotos: fotos.map((item) => ({
      id: item.id,
      nomeArquivo: item.nomeArquivo,
      url: item.url,
      tamanhoBytes: item.tamanhoBytes,
      adicionadoEm: item.adicionadoEm,
      adicionadoPor: item.adicionadoPor,
    })),
    assinaturas: {
      seguradoBeneficiario: {
        nome: segurado?.nome || "",
        data: segurado?.data || "",
        hora: segurado?.hora || "",
        assinatura: segurado?.assinatura || "",
      },
      destinatarioPrestador: {
        nome: destinatario?.nome || "",
        data: destinatario?.data || "",
        hora: destinatario?.hora || "",
        assinaturaDestinatario: destinatario?.assinatura || "",
        assinaturaPrestador: prestador?.assinatura || "",
      },
    },
    historico,
    temAvarias: avarias.length > 0,
    temFotos: fotos.length > 0,
  };
}

export async function frotaChecklistsRoutes(app: FastifyInstance) {
  app.get("/api/frota/checklists", async (req) => {
    const query = z.object({
      periodoInicio: z.string().optional(),
      periodoFim: z.string().optional(),
      placa: z.string().optional(),
      motorista: z.string().optional(),
      proprietario: z.string().optional(),
      seguradora: z.string().optional(),
      status: checklistStatusSchema.optional(),
      tipoAtendimento: tipoAtendimentoSchema.optional(),
      cidade: z.string().optional(),
    }).parse(req.query);

    const all = (db.frotaChecklists as ChecklistMainRecord[]).map(toResponse);
    return all.filter((item) => {
      if (query.periodoInicio && item.data < query.periodoInicio) return false;
      if (query.periodoFim && item.data > query.periodoFim) return false;
      if (query.placa && !item.placa.toLowerCase().includes(query.placa.toLowerCase())) return false;
      if (query.motorista && !item.motorista.toLowerCase().includes(query.motorista.toLowerCase())) return false;
      if (query.proprietario && !item.proprietario.toLowerCase().includes(query.proprietario.toLowerCase())) return false;
      if (query.seguradora && !item.seguradora.toLowerCase().includes(query.seguradora.toLowerCase())) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.tipoAtendimento && !item.tipoAtendimento.includes(query.tipoAtendimento)) return false;
      if (query.cidade) {
        const c = query.cidade.toLowerCase();
        const atendimento = item.atendimento.cidade.toLowerCase();
        const destino = item.destino.cidade.toLowerCase();
        if (!atendimento.includes(c) && !destino.includes(c)) return false;
      }
      return true;
    });
  });

  app.get("/api/frota/checklists/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const found = (db.frotaChecklists as ChecklistMainRecord[]).find((item) => item.id === id);
    if (!found) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
    return toResponse(found);
  });

  app.post("/api/frota/checklists", async (req, reply) => {
    const payload = checklistPayloadSchema.parse(req.body);
    const usuario = currentUser(req);
    const now = new Date().toISOString();
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const rec: ChecklistMainRecord = {
      ...payload,
      id: nextId("FCH", records.length),
      numeroChecklist: nextChecklistNumber(records),
      status: "RASCUNHO",
      criadoPor: usuario,
      criadoEm: now,
      atualizadoPor: usuario,
      atualizadoEm: now,
    };
    records.unshift(rec);
    replaceChildCollections(rec.id, payload, usuario);
    addHistorico(rec.id, usuario, "CRIACAO", "Checklist criado em modo rascunho.");
    appendAudit("CRIAR", "FROTA_CHECKLIST", rec.id, `Checklist ${rec.numeroChecklist} criado`, usuario);
    return reply.status(201).send(toResponse(rec));
  });

  app.put("/api/frota/checklists/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const payload = checklistPayloadSchema.parse(req.body);
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });

    const atual = records[index];
    if (atual.status === "CONCLUIDO" && !canEditConcluded(req)) {
      return reply.status(403).send({ error: { message: "Checklist concluido bloqueado para edicao." } });
    }
    if (atual.status === "CANCELADO") {
      return reply.status(409).send({ error: { message: "Checklist cancelado nao pode ser editado." } });
    }

    const usuario = currentUser(req);
    const next: ChecklistMainRecord = {
      ...atual,
      ...payload,
      atualizadoPor: usuario,
      atualizadoEm: new Date().toISOString(),
    };
    records[index] = next;
    replaceChildCollections(next.id, payload, usuario);
    addHistorico(next.id, usuario, "ATUALIZACAO", "Checklist atualizado.");
    appendAudit("ATUALIZAR", "FROTA_CHECKLIST", next.id, `Checklist ${next.numeroChecklist} atualizado`, usuario);
    return toResponse(next);
  });

  app.post("/api/frota/checklists/:id/concluir", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
    if (records[index].status === "CANCELADO") {
      return reply.status(409).send({ error: { message: "Checklist cancelado nao pode ser concluido." } });
    }
    const usuario = currentUser(req);
    const now = new Date().toISOString();
    records[index] = {
      ...records[index],
      status: "CONCLUIDO",
      concluidoPor: usuario,
      concluidoEm: now,
      atualizadoPor: usuario,
      atualizadoEm: now,
    };
    addHistorico(id, usuario, "CONCLUSAO", "Checklist concluido.");
    appendAudit("CONCLUIR", "FROTA_CHECKLIST", id, "Checklist concluido", usuario);
    return toResponse(records[index]);
  });

  app.post("/api/frota/checklists/:id/cancelar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
    const usuario = currentUser(req);
    const now = new Date().toISOString();
    records[index] = {
      ...records[index],
      status: "CANCELADO",
      canceladoPor: usuario,
      canceladoEm: now,
      atualizadoPor: usuario,
      atualizadoEm: now,
    };
    addHistorico(id, usuario, "CANCELAMENTO", "Checklist cancelado.");
    appendAudit("CANCELAR", "FROTA_CHECKLIST", id, "Checklist cancelado", usuario);
    return toResponse(records[index]);
  });

  app.post("/api/frota/checklists/:id/duplicar", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const source = records.find((item) => item.id === id);
    if (!source) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });

    const usuario = currentUser(req);
    const now = new Date().toISOString();
    const novoId = nextId("FCH", records.length);
    const novo: ChecklistMainRecord = {
      ...source,
      id: novoId,
      numeroChecklist: nextChecklistNumber(records),
      status: "RASCUNHO",
      criadoPor: usuario,
      criadoEm: now,
      atualizadoPor: usuario,
      atualizadoEm: now,
      concluidoPor: undefined,
      concluidoEm: undefined,
      canceladoPor: undefined,
      canceladoEm: undefined,
    };
    records.unshift(novo);
    replaceChildCollections(novo.id, source, usuario);
    addHistorico(novo.id, usuario, "DUPLICACAO", `Checklist duplicado a partir de ${source.numeroChecklist}.`);
    appendAudit("DUPLICAR", "FROTA_CHECKLIST", novo.id, "Checklist duplicado", usuario);
    return reply.status(201).send(toResponse(novo));
  });

  app.post("/api/frota/checklists/:id/fotos", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ fotos: z.array(fotoSchema).min(1) }).parse(req.body);
    const records = db.frotaChecklists as ChecklistMainRecord[];
    const main = records.find((item) => item.id === id);
    if (!main) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });

    const usuario = currentUser(req);
    const now = new Date().toISOString();
    const fotos = db.frotaChecklistFotos as FotoRecord[];
    body.fotos.forEach((foto, index) => {
      fotos.push({
        id: foto.id || `FTO-${id}-${Date.now()}-${index + 1}`,
        checklistId: id,
        nomeArquivo: foto.nomeArquivo,
        url: foto.url,
        tamanhoBytes: foto.tamanhoBytes || 0,
        adicionadoEm: foto.adicionadoEm || now,
        adicionadoPor: foto.adicionadoPor || usuario,
      });
    });
    main.atualizadoPor = usuario;
    main.atualizadoEm = now;
    addHistorico(id, usuario, "FOTO", `${body.fotos.length} foto(s) anexada(s).`);
    appendAudit("ANEXAR_FOTO", "FROTA_CHECKLIST", id, `${body.fotos.length} foto(s) anexada(s)`, usuario);
    return toResponse(main);
  });

  app.get("/api/frota/checklists/:id/pdf", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const found = (db.frotaChecklists as ChecklistMainRecord[]).find((item) => item.id === id);
    if (!found) return reply.status(404).send({ error: { message: "Checklist nao encontrado." } });
    return {
      checklist: toResponse(found),
      geradoEm: new Date().toISOString(),
    };
  });
}

