import { randomUUID } from "node:crypto";
import { executeOracle, isOracleEnabled } from "../../db/oracle.js";
import { execDml, queryOne } from "../baseRepository.js";
import { CHECKLIST_PRE_INVENTARIO_TEMPLATE } from "./checklistTemplate.js";

type EnsureIndex = { name: string; table: string; columns: string; unique?: boolean };

let initialized = false;

const TABLES: Array<{ name: string; ddl: string }> = [
  {
    name: "LOJAS_INVENTARIO",
    ddl: `CREATE TABLE LOJAS_INVENTARIO (
      ID VARCHAR2(36) PRIMARY KEY,
      CODIGO VARCHAR2(20) NOT NULL,
      NOME VARCHAR2(160) NOT NULL,
      REGIONAL VARCHAR2(120),
      GERENTE VARCHAR2(120),
      SUPERVISOR VARCHAR2(120),
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "DEPARTAMENTOS_INVENTARIO",
    ddl: `CREATE TABLE DEPARTAMENTOS_INVENTARIO (
      ID VARCHAR2(36) PRIMARY KEY,
      CODIGO VARCHAR2(20) NOT NULL,
      NOME VARCHAR2(160) NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "FREQUENCIA_CONFIGS",
    ddl: `CREATE TABLE FREQUENCIA_CONFIGS (
      ID VARCHAR2(36) PRIMARY KEY,
      LOJA_ID VARCHAR2(36) NOT NULL,
      DEPARTAMENTO_ID VARCHAR2(36) NOT NULL,
      FREQUENCIA VARCHAR2(20) NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      PROXIMA_EXECUCAO DATE,
      RESPONSAVEL_PADRAO VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "TAREFAS_INVENTARIO",
    ddl: `CREATE TABLE TAREFAS_INVENTARIO (
      ID VARCHAR2(36) PRIMARY KEY,
      DATA_REFERENCIA DATE NOT NULL,
      LOJA_ID VARCHAR2(36) NOT NULL,
      DEPARTAMENTO_ID VARCHAR2(36) NOT NULL,
      FREQUENCIA VARCHAR2(20) NOT NULL,
      RESPONSAVEL VARCHAR2(120),
      STATUS VARCHAR2(30) NOT NULL,
      CONTAGEM_ID VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CONTAGENS",
    ddl: `CREATE TABLE CONTAGENS (
      ID VARCHAR2(36) PRIMARY KEY,
      NUMERO VARCHAR2(60) NOT NULL,
      TAREFA_ID VARCHAR2(36),
      DATA_CONTAGEM DATE NOT NULL,
      LOJA_ID VARCHAR2(36) NOT NULL,
      DEPARTAMENTO_ID VARCHAR2(36) NOT NULL,
      FREQUENCIA VARCHAR2(20) NOT NULL,
      RESPONSAVEL VARCHAR2(120),
      STATUS VARCHAR2(30) NOT NULL,
      ITENS_CONTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      ITENS_DIVERGENTES NUMBER(10) DEFAULT 0 NOT NULL,
      ACURACIDADE NUMBER(8,2) DEFAULT 0 NOT NULL,
      CONSENSO_STATUS VARCHAR2(40) DEFAULT 'NAO_APLICAVEL' NOT NULL,
      RISCO_DIVERGENCIA VARCHAR2(20) DEFAULT 'ok' NOT NULL,
      RECONTAGEM NUMBER(1) DEFAULT 0 NOT NULL,
      RECONTAGEM_ORIGEM VARCHAR2(36),
      INICIADO_EM TIMESTAMP,
      CONCLUIDO_EM TIMESTAMP,
      VALIDADO_EM TIMESTAMP,
      VALIDADO_POR VARCHAR2(120),
      ESCALADO_SUPERVISOR NUMBER(1) DEFAULT 0 NOT NULL,
      CREATED_BY VARCHAR2(120),
      UPDATED_BY VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "ITENS_CONTAGEM",
    ddl: `CREATE TABLE ITENS_CONTAGEM (
      ID VARCHAR2(36) PRIMARY KEY,
      CONTAGEM_ID VARCHAR2(36) NOT NULL,
      ORDEM_ITEM NUMBER(8) DEFAULT 0 NOT NULL,
      CODIGO_ITEM VARCHAR2(80),
      CODIGO_BARRAS VARCHAR2(80),
      DESCRICAO VARCHAR2(500) NOT NULL,
      ESTOQUE_SISTEMA NUMBER(12,3) DEFAULT 0 NOT NULL,
      QTD_CONTAGEM_1 NUMBER(12,3),
      QTD_CONTAGEM_2 NUMBER(12,3),
      QTD_CONTAGEM_3 NUMBER(12,3),
      QTD_CONSENSO NUMBER(12,3),
      DIFERENCA NUMBER(12,3),
      MOTIVO_DIVERGENCIA VARCHAR2(1000),
      OBSERVACAO VARCHAR2(1000),
      STATUS_CONSENSO VARCHAR2(40) DEFAULT 'PENDENTE' NOT NULL,
      CONSENSO_OBTIDO_EM TIMESTAMP,
      ESCALADO_SUPERVISOR NUMBER(1) DEFAULT 0 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "DIVERGENCIAS_DIARIAS",
    ddl: `CREATE TABLE DIVERGENCIAS_DIARIAS (
      ID VARCHAR2(36) PRIMARY KEY,
      DATA_REFERENCIA DATE NOT NULL,
      CONTAGEM_ID VARCHAR2(36) NOT NULL,
      LOJA_ID VARCHAR2(36) NOT NULL,
      DEPARTAMENTO_ID VARCHAR2(36) NOT NULL,
      ITENS_CONTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      ITENS_DIVERGENTES NUMBER(10) DEFAULT 0 NOT NULL,
      ACURACIDADE NUMBER(8,2) DEFAULT 0 NOT NULL,
      NIVEL VARCHAR2(20) NOT NULL,
      STATUS_CONTAGEM VARCHAR2(30) NOT NULL,
      SUPERVISOR VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CHECKLIST_MODELOS",
    ddl: `CREATE TABLE CHECKLIST_MODELOS (
      ID VARCHAR2(36) PRIMARY KEY,
      NOME VARCHAR2(240) NOT NULL,
      DESCRICAO VARCHAR2(1000),
      BLOCO_PADRAO_QTD NUMBER(6) DEFAULT 0 NOT NULL,
      ITEM_PADRAO_QTD NUMBER(6) DEFAULT 0 NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CHECKLISTS_PRE_INVENTARIO",
    ddl: `CREATE TABLE CHECKLISTS_PRE_INVENTARIO (
      ID VARCHAR2(36) PRIMARY KEY,
      NOME VARCHAR2(260) NOT NULL,
      UNIDADE VARCHAR2(140) NOT NULL,
      DATA_PREVISTA_INVENTARIO DATE NOT NULL,
      TIPO_INVENTARIO VARCHAR2(80) NOT NULL,
      RESPONSAVEL_GERAL VARCHAR2(140) NOT NULL,
      STATUS_GERAL VARCHAR2(30) NOT NULL,
      OBSERVACOES VARCHAR2(2000),
      PROGRESSO_GERAL NUMBER(6,2) DEFAULT 0 NOT NULL,
      BLOQUEAR_CONCLUSAO_POR_NC NUMBER(1) DEFAULT 1 NOT NULL,
      MODELO_ID VARCHAR2(36),
      CRIADO_POR VARCHAR2(140),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_BY VARCHAR2(140)
    )`,
  },
  {
    name: "CHECKLIST_BLOCOS",
    ddl: `CREATE TABLE CHECKLIST_BLOCOS (
      ID VARCHAR2(36) PRIMARY KEY,
      CHECKLIST_ID VARCHAR2(36) NOT NULL,
      CODIGO VARCHAR2(20) NOT NULL,
      ORDEM NUMBER(6) NOT NULL,
      NOME VARCHAR2(260) NOT NULL,
      PROGRESSO NUMBER(6,2) DEFAULT 0 NOT NULL,
      TOTAL_ITENS NUMBER(6) DEFAULT 0 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CHECKLIST_ITENS",
    ddl: `CREATE TABLE CHECKLIST_ITENS (
      ID VARCHAR2(36) PRIMARY KEY,
      CHECKLIST_ID VARCHAR2(36) NOT NULL,
      BLOCO_ID VARCHAR2(36) NOT NULL,
      CODIGO VARCHAR2(30),
      ORDEM NUMBER(6) NOT NULL,
      DESCRICAO VARCHAR2(500) NOT NULL,
      STATUS VARCHAR2(30) NOT NULL,
      RESPONSAVEL VARCHAR2(140),
      DATA_REFERENCIA DATE,
      SETOR VARCHAR2(120),
      CRITICIDADE VARCHAR2(20) NOT NULL,
      NC_ABERTA NUMBER(1) DEFAULT 0 NOT NULL,
      PLANO_ACAO VARCHAR2(1000),
      OBSERVACAO VARCHAR2(2000),
      EVIDENCIA_RESUMO VARCHAR2(500),
      ULTIMA_ALTERACAO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ULTIMA_ALTERACAO_POR VARCHAR2(140),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CHECKLIST_ITENS_EVIDENCIAS",
    ddl: `CREATE TABLE CHECKLIST_ITENS_EVIDENCIAS (
      ID VARCHAR2(36) PRIMARY KEY,
      CHECKLIST_ID VARCHAR2(36) NOT NULL,
      ITEM_ID VARCHAR2(36) NOT NULL,
      ANEXO_ID VARCHAR2(36),
      NOME_ARQUIVO VARCHAR2(260),
      CAMINHO VARCHAR2(700),
      MIME_TYPE VARCHAR2(140),
      TAMANHO_BYTES NUMBER(18),
      DESCRICAO VARCHAR2(1000),
      CRIADO_POR VARCHAR2(140),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "CHECKLIST_ITENS_HISTORICO",
    ddl: `CREATE TABLE CHECKLIST_ITENS_HISTORICO (
      ID VARCHAR2(36) PRIMARY KEY,
      CHECKLIST_ID VARCHAR2(36) NOT NULL,
      ITEM_ID VARCHAR2(36) NOT NULL,
      ACAO VARCHAR2(60) NOT NULL,
      DETALHE VARCHAR2(2000),
      USUARIO VARCHAR2(140) NOT NULL,
      VALOR_ANTERIOR CLOB,
      VALOR_NOVO CLOB,
      DATA_EVENTO TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "SGQ_ANEXOS",
    ddl: `CREATE TABLE SGQ_ANEXOS (
      ID VARCHAR2(36) PRIMARY KEY,
      MODULO VARCHAR2(80) NOT NULL,
      ORIGEM_ENTIDADE VARCHAR2(80) NOT NULL,
      ORIGEM_ID VARCHAR2(36) NOT NULL,
      NOME_ORIGINAL VARCHAR2(260) NOT NULL,
      NOME_ARMAZENADO VARCHAR2(260) NOT NULL,
      STORAGE_KEY VARCHAR2(700) NOT NULL,
      MIME_TYPE VARCHAR2(140),
      TAMANHO_BYTES NUMBER(18),
      USUARIO_UPLOAD VARCHAR2(140),
      DATA_UPLOAD TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "SGQ_AUDITORIA_EVENTOS",
    ddl: `CREATE TABLE SGQ_AUDITORIA_EVENTOS (
      ID VARCHAR2(36) PRIMARY KEY,
      MODULO VARCHAR2(80) NOT NULL,
      ACAO VARCHAR2(80) NOT NULL,
      ENTIDADE VARCHAR2(80) NOT NULL,
      ENTIDADE_ID VARCHAR2(36),
      USUARIO_ID VARCHAR2(120),
      USUARIO_NOME VARCHAR2(180),
      PERFIL VARCHAR2(80),
      DETALHE VARCHAR2(2000),
      PAYLOAD CLOB,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
];

const INDEXES: EnsureIndex[] = [
  { name: "UX_LOJAS_INV_CODIGO", table: "LOJAS_INVENTARIO", columns: "CODIGO", unique: true },
  { name: "UX_DEPT_INV_CODIGO", table: "DEPARTAMENTOS_INVENTARIO", columns: "CODIGO", unique: true },
  { name: "UX_FREQ_CFG_UNQ", table: "FREQUENCIA_CONFIGS", columns: "LOJA_ID, DEPARTAMENTO_ID", unique: true },
  { name: "IDX_CONTAGENS_DATA_STATUS", table: "CONTAGENS", columns: "DATA_CONTAGEM, STATUS, LOJA_ID" },
  { name: "IDX_ITENS_CONTAGEM_CONSENSO", table: "ITENS_CONTAGEM", columns: "CONTAGEM_ID, STATUS_CONSENSO" },
  { name: "IDX_DIVERG_DATA_NIVEL", table: "DIVERGENCIAS_DIARIAS", columns: "DATA_REFERENCIA, NIVEL, LOJA_ID" },
  { name: "IDX_CKL_STATUS_DATA", table: "CHECKLISTS_PRE_INVENTARIO", columns: "STATUS_GERAL, DATA_PREVISTA_INVENTARIO, UNIDADE" },
  { name: "UX_CKL_BLOCO_ORDEM", table: "CHECKLIST_BLOCOS", columns: "CHECKLIST_ID, ORDEM", unique: true },
  { name: "UX_CKL_ITEM_ORDEM", table: "CHECKLIST_ITENS", columns: "CHECKLIST_ID, BLOCO_ID, ORDEM", unique: true },
  { name: "IDX_CKL_ITEM_FILTROS", table: "CHECKLIST_ITENS", columns: "STATUS, CRITICIDADE, SETOR, RESPONSAVEL" },
  { name: "IDX_CKL_ITEM_HIST", table: "CHECKLIST_ITENS_HISTORICO", columns: "ITEM_ID, DATA_EVENTO" },
  { name: "IDX_SGQ_ANEXOS_ORIGEM", table: "SGQ_ANEXOS", columns: "MODULO, ORIGEM_ENTIDADE, ORIGEM_ID" },
];

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await executeOracle(`SELECT * FROM ${tableName} WHERE 1 = 0`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ORA-00942")) return false;
    throw error;
  }
}

async function indexExists(indexName: string): Promise<boolean> {
  const row = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_INDEXES WHERE INDEX_NAME = :indexName`,
    { indexName: indexName.toUpperCase() },
  );
  return Number((row as any)?.CNT ?? 0) > 0;
}

async function createTableIfMissing(name: string, ddl: string): Promise<void> {
  if (await tableExists(name)) return;
  try {
    await execDml(ddl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ORA-00955") || message.includes("ORA-01031")) return;
    throw error;
  }
}

async function createIndexIfMissing(def: EnsureIndex): Promise<void> {
  if (!(await tableExists(def.table))) return;
  if (await indexExists(def.name)) return;
  const prefix = def.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
  try {
    await execDml(`${prefix} ${def.name} ON ${def.table} (${def.columns})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ORA-00955") || message.includes("ORA-01408") || message.includes("ORA-01031")) return;
    throw error;
  }
}

async function ensureConstraintsAndChecks(): Promise<void> {
  const statements = [
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE FREQUENCIA_CONFIGS ADD CONSTRAINT FK_FREQ_LOJA FOREIGN KEY (LOJA_ID) REFERENCES LOJAS_INVENTARIO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE FREQUENCIA_CONFIGS ADD CONSTRAINT FK_FREQ_DEP FOREIGN KEY (DEPARTAMENTO_ID) REFERENCES DEPARTAMENTOS_INVENTARIO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE TAREFAS_INVENTARIO ADD CONSTRAINT FK_TAREFA_LOJA FOREIGN KEY (LOJA_ID) REFERENCES LOJAS_INVENTARIO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE TAREFAS_INVENTARIO ADD CONSTRAINT FK_TAREFA_DEP FOREIGN KEY (DEPARTAMENTO_ID) REFERENCES DEPARTAMENTOS_INVENTARIO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE CONTAGENS ADD CONSTRAINT FK_CONTAGEM_TAREFA FOREIGN KEY (TAREFA_ID) REFERENCES TAREFAS_INVENTARIO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE ITENS_CONTAGEM ADD CONSTRAINT FK_ITEM_CONTAGEM FOREIGN KEY (CONTAGEM_ID) REFERENCES CONTAGENS(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE CHECKLISTS_PRE_INVENTARIO ADD CONSTRAINT CK_CKL_STATUS_GERAL CHECK (STATUS_GERAL IN (''ABERTO'',''EM_ANDAMENTO'',''CONCLUIDO'',''CANCELADO''))'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2260,-2443,-2261) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE CHECKLIST_ITENS ADD CONSTRAINT CK_CKL_ITEM_STATUS CHECK (STATUS IN (''PENDENTE'',''EM_ANDAMENTO'',''CONCLUIDO'',''CANCELADO'',''NAO_APLICAVEL''))'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2260,-2443,-2261) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE CHECKLIST_ITENS ADD CONSTRAINT CK_CKL_ITEM_CRIT CHECK (CRITICIDADE IN (''ALTA'',''MEDIA'',''BAIXA''))'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2260,-2443,-2261) THEN RAISE; END IF; END;`,
  ];
  for (const sql of statements) {
    try {
      await execDml(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ORA-01031") || message.includes("ORA-02264")) continue;
      throw error;
    }
  }
}

async function countRows(table: string): Promise<number> {
  const row = await queryOne<{ CNT: number }>(`SELECT COUNT(*) AS CNT FROM ${table}`);
  return Number((row as any)?.CNT ?? 0);
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function seedEssentials(): Promise<void> {
  if ((await countRows("LOJAS_INVENTARIO")) === 0) {
    await execDml(`INSERT INTO LOJAS_INVENTARIO (ID, CODIGO, NOME, REGIONAL, GERENTE, SUPERVISOR) VALUES ('L01','001','Loja Centro Manaus','NORTE','Carlos Mendes','Ana Souza')`);
    await execDml(`INSERT INTO LOJAS_INVENTARIO (ID, CODIGO, NOME, REGIONAL, GERENTE, SUPERVISOR) VALUES ('L02','002','Loja Adrianopolis','NORTE','Carlos Mendes','Bruno Lima')`);
    await execDml(`INSERT INTO LOJAS_INVENTARIO (ID, CODIGO, NOME, REGIONAL, GERENTE, SUPERVISOR) VALUES ('L03','003','Loja Agrestina Centro','NORDESTE','Roberto Silva','Juliana Ramos')`);
  }

  if ((await countRows("DEPARTAMENTOS_INVENTARIO")) === 0) {
    await execDml(`INSERT INTO DEPARTAMENTOS_INVENTARIO (ID, CODIGO, NOME) VALUES ('D01','COL','Colchoes')`);
    await execDml(`INSERT INTO DEPARTAMENTOS_INVENTARIO (ID, CODIGO, NOME) VALUES ('D02','EST','Estofados')`);
  }

  if ((await countRows("CHECKLIST_MODELOS")) === 0) {
    const totalItens = CHECKLIST_PRE_INVENTARIO_TEMPLATE.reduce((sum, b) => sum + b.itens.length, 0);
    await execDml(
      `INSERT INTO CHECKLIST_MODELOS (ID, NOME, DESCRICAO, BLOCO_PADRAO_QTD, ITEM_PADRAO_QTD, ATIVO)
       VALUES ('CKLMODEL-001','Template Checklist Pre-Inventario','Template padrao com 10 blocos e 47 itens.',:blocos,:itens,1)`,
      { blocos: CHECKLIST_PRE_INVENTARIO_TEMPLATE.length, itens: totalItens },
    );
  }

  if ((await countRows("CHECKLISTS_PRE_INVENTARIO")) > 0) return;

  const checklists = [
    { id: "CKL-001", nome: "Checklist Inventario Q2 - CD Sao Paulo", unidade: "CD Sao Paulo", tipo: "Inventario Geral", dataPrevista: isoOffset(16), responsavel: "Carlos Lima", criadoPor: "Ana Souza" },
    { id: "CKL-002", nome: "Checklist Inventario Rotativo - Filial BH", unidade: "Filial Belo Horizonte", tipo: "Inventario Rotativo", dataPrevista: isoOffset(23), responsavel: "Fernanda Dias", criadoPor: "Roberto Mendes" },
    { id: "CKL-003", nome: "Checklist Inventario Anual - CD Curitiba", unidade: "CD Curitiba", tipo: "Inventario Geral", dataPrevista: isoOffset(32), responsavel: "Juliana Rocha", criadoPor: "Ana Souza" },
  ];

  for (const c of checklists) {
    await execDml(
      `INSERT INTO CHECKLISTS_PRE_INVENTARIO (
        ID, NOME, UNIDADE, DATA_PREVISTA_INVENTARIO, TIPO_INVENTARIO, RESPONSAVEL_GERAL,
        STATUS_GERAL, OBSERVACOES, MODELO_ID, CRIADO_POR, UPDATED_BY
      ) VALUES (
        :id, :nome, :unidade, TO_DATE(:dataPrevista,'YYYY-MM-DD'), :tipo, :responsavel,
        'ABERTO', 'Checklist gerado automaticamente com template padrao.', 'CKLMODEL-001', :criadoPor, :criadoPor
      )`,
      c,
    );

    for (const bloco of CHECKLIST_PRE_INVENTARIO_TEMPLATE) {
      const blocoId = `${c.id}-${bloco.codigo}`;
      await execDml(
        `INSERT INTO CHECKLIST_BLOCOS (ID, CHECKLIST_ID, CODIGO, ORDEM, NOME, TOTAL_ITENS)
         VALUES (:id, :checklistId, :codigo, :ordem, :nome, :totalItens)`,
        { id: blocoId, checklistId: c.id, codigo: bloco.codigo, ordem: bloco.ordem, nome: bloco.nome, totalItens: bloco.itens.length },
      );

      let ordemItem = 1;
      for (const item of bloco.itens) {
        const itemId = `${blocoId}-I${pad(ordemItem)}`;
        await execDml(
          `INSERT INTO CHECKLIST_ITENS (
            ID, CHECKLIST_ID, BLOCO_ID, CODIGO, ORDEM, DESCRICAO, STATUS, RESPONSAVEL,
            DATA_REFERENCIA, SETOR, CRITICIDADE, NC_ABERTA, ULTIMA_ALTERACAO_POR
          ) VALUES (
            :id, :checklistId, :blocoId, :codigo, :ordem, :descricao, 'PENDENTE', :responsavel,
            TO_DATE(:dataRef,'YYYY-MM-DD'), :setor, :criticidade, 0, :usuario
          )`,
          {
            id: itemId,
            checklistId: c.id,
            blocoId,
            codigo: `${bloco.codigo}-${pad(ordemItem)}`,
            ordem: ordemItem,
            descricao: item.descricao,
            responsavel: c.responsavel,
            dataRef: c.dataPrevista,
            setor: "Operacao",
            criticidade: item.criticidade,
            usuario: c.criadoPor,
          },
        );

        await execDml(
          `INSERT INTO CHECKLIST_ITENS_HISTORICO (ID, CHECKLIST_ID, ITEM_ID, ACAO, DETALHE, USUARIO, VALOR_NOVO)
           VALUES (:id, :checklistId, :itemId, 'CRIACAO', 'Item criado automaticamente no checklist.', :usuario, :valorNovo)`,
          {
            id: randomUUID(),
            checklistId: c.id,
            itemId,
            usuario: c.criadoPor,
            valorNovo: JSON.stringify({ status: "PENDENTE" }),
          },
        );
        ordemItem += 1;
      }
    }
  }
}

export async function ensureInventarioTables(): Promise<void> {
  if (!isOracleEnabled() || initialized) return;
  for (const table of TABLES) await createTableIfMissing(table.name, table.ddl);
  await ensureConstraintsAndChecks();
  for (const index of INDEXES) await createIndexIfMissing(index);
  await seedEssentials();
  initialized = true;
}
