/**
 * Ensures INS_* baseline tables/columns exist in Oracle.
 * This function is idempotent and can run on each startup.
 */
import { execDml, queryOne } from "../baseRepository.js";
import { executeOracle, isOracleEnabled } from "../../db/oracle.js";

type EnsureColumn = {
  table: string;
  column: string;
  ddl: string;
};

type EnsureIndex = {
  name: string;
  table: string;
  columns: string;
  unique?: boolean;
};

let initialized = false;

const TABLE_DDL: Array<{ name: string; ddl: string }> = [
  {
    name: "INS_SETOR",
    ddl: `CREATE TABLE INS_SETOR (
      ID VARCHAR2(40) PRIMARY KEY,
      NOME VARCHAR2(120) NOT NULL,
      ORDEM NUMBER(5) NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_USUARIO_SETOR",
    ddl: `CREATE TABLE INS_USUARIO_SETOR (
      ID VARCHAR2(60) PRIMARY KEY,
      USUARIO_ID VARCHAR2(80) NOT NULL,
      SETOR_ID VARCHAR2(40) NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MODELO_CHECKLIST",
    ddl: `CREATE TABLE INS_MODELO_CHECKLIST (
      ID VARCHAR2(40) PRIMARY KEY,
      NOME VARCHAR2(200) NOT NULL,
      DESCRICAO VARCHAR2(1000),
      SETOR_ID VARCHAR2(40) NOT NULL,
      ORDEM NUMBER(6) DEFAULT 1 NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MODELO_CHECKLIST_ITEM",
    ddl: `CREATE TABLE INS_MODELO_CHECKLIST_ITEM (
      ID VARCHAR2(40) PRIMARY KEY,
      MODELO_ID VARCHAR2(40) NOT NULL,
      SETOR_ID VARCHAR2(40) NOT NULL,
      CODIGO_ITEM VARCHAR2(40) NOT NULL,
      ORDEM NUMBER(6) NOT NULL,
      DESCRICAO VARCHAR2(1500) NOT NULL,
      OBRIGATORIO NUMBER(1) DEFAULT 1 NOT NULL,
      EXIGE_EVIDENCIA NUMBER(1) DEFAULT 0 NOT NULL,
      EXIGE_TIPO_NC NUMBER(1) DEFAULT 1 NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_TIPO_NC",
    ddl: `CREATE TABLE INS_TIPO_NC (
      ID VARCHAR2(40) PRIMARY KEY,
      SETOR_ID VARCHAR2(40) NOT NULL,
      NOME VARCHAR2(300) NOT NULL,
      CATEGORIA VARCHAR2(100),
      OBSERVACAO VARCHAR2(2000),
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_EXECUCAO",
    ddl: `CREATE TABLE INS_EXECUCAO (
      ID VARCHAR2(40) PRIMARY KEY,
      CODIGO VARCHAR2(80) NOT NULL,
      MODELO_ID VARCHAR2(40) NOT NULL,
      SETOR_ID VARCHAR2(40) NOT NULL,
      EXECUTOR_USUARIO_ID VARCHAR2(80),
      EXECUTOR_NOME VARCHAR2(200),
      DATA_HORA TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      STATUS VARCHAR2(40) NOT NULL,
      TOTAL_ITENS NUMBER(8) DEFAULT 0 NOT NULL,
      CONFORMES NUMBER(8) DEFAULT 0 NOT NULL,
      NAO_CONFORMES NUMBER(8) DEFAULT 0 NOT NULL,
      NAO_APLICA NUMBER(8) DEFAULT 0 NOT NULL,
      TAXA_CONFORMIDADE NUMBER(6,2) DEFAULT 0 NOT NULL,
      OBSERVACAO_GERAL VARCHAR2(2000),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_EXECUCAO_ITEM",
    ddl: `CREATE TABLE INS_EXECUCAO_ITEM (
      ID VARCHAR2(40) PRIMARY KEY,
      EXECUCAO_ID VARCHAR2(40) NOT NULL,
      MODELO_ITEM_ID VARCHAR2(40) NOT NULL,
      CODIGO_ITEM VARCHAR2(40) NOT NULL,
      ORDEM NUMBER(6) NOT NULL,
      DESCRICAO VARCHAR2(1500) NOT NULL,
      RESULTADO VARCHAR2(30) NOT NULL,
      TIPO_NC_ID VARCHAR2(40),
      TIPO_NC_NOME VARCHAR2(300),
      OUTRA_NC VARCHAR2(1000),
      OBSERVACAO VARCHAR2(2000),
      TIMESTAMP_RESPOSTA TIMESTAMP DEFAULT SYSTIMESTAMP,
      USUARIO VARCHAR2(80),
      NOME VARCHAR2(200),
      SETOR VARCHAR2(120),
      FOTO_URL VARCHAR2(1000),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_EXECUCAO_ITEM_EVIDENCIA",
    ddl: `CREATE TABLE INS_EXECUCAO_ITEM_EVIDENCIA (
      ID VARCHAR2(40) PRIMARY KEY,
      EXECUCAO_ITEM_ID VARCHAR2(40) NOT NULL,
      ORDEM_ARQUIVO NUMBER(4) DEFAULT 1 NOT NULL,
      NOME_ARQUIVO VARCHAR2(255) NOT NULL,
      URL_ARQUIVO VARCHAR2(1000),
      REFERENCIA_ARQUIVO VARCHAR2(1000),
      MIME_TYPE VARCHAR2(120),
      TAMANHO_ARQUIVO NUMBER(12),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MOLA_MAQUINA",
    ddl: `CREATE TABLE INS_MOLA_MAQUINA (
      ID VARCHAR2(40) PRIMARY KEY,
      CODIGO VARCHAR2(20) NOT NULL,
      DESCRICAO VARCHAR2(255),
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MOLA_PADRAO",
    ddl: `CREATE TABLE INS_MOLA_PADRAO (
      ID VARCHAR2(40) PRIMARY KEY,
      ALTURA_TIPO VARCHAR2(40) NOT NULL,
      ITEM VARCHAR2(40) NOT NULL,
      DESCRICAO VARCHAR2(500) NOT NULL,
      PADRAO VARCHAR2(120),
      MINIMO NUMBER(14,4),
      MAXIMO NUMBER(14,4),
      UNIDADE VARCHAR2(60),
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MOLA_INSPECAO",
    ddl: `CREATE TABLE INS_MOLA_INSPECAO (
      ID VARCHAR2(40) PRIMARY KEY,
      CODIGO VARCHAR2(80) NOT NULL,
      MAQUINA_ID VARCHAR2(40) NOT NULL,
      MAQUINA_CODIGO VARCHAR2(20) NOT NULL,
      STATUS_MAQUINA VARCHAR2(40) NOT NULL,
      ALTURA_TIPO VARCHAR2(40),
      LINHA_POCKET VARCHAR2(200),
      OPERADOR_USUARIO_ID VARCHAR2(80),
      OPERADOR_NOME VARCHAR2(200),
      DATA_HORA TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      OBSERVACAO_GERAL VARCHAR2(2000),
      RESULTADO VARCHAR2(40) NOT NULL,
      MOTIVO_PARADA VARCHAR2(2000),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_MOLA_INSPECAO_AMOSTRA",
    ddl: `CREATE TABLE INS_MOLA_INSPECAO_AMOSTRA (
      ID VARCHAR2(40) PRIMARY KEY,
      INSPECAO_ID VARCHAR2(40) NOT NULL,
      PADRAO_ID VARCHAR2(40) NOT NULL,
      ITEM VARCHAR2(40),
      DESCRICAO VARCHAR2(500),
      PADRAO VARCHAR2(120),
      MINIMO NUMBER(14,4),
      MAXIMO NUMBER(14,4),
      UNIDADE VARCHAR2(60),
      VALOR_MEDIDO NUMBER(14,4),
      CONFORME NUMBER(1),
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_AUDITORIA_IMPORTACAO",
    ddl: `CREATE TABLE INS_AUDITORIA_IMPORTACAO (
      ID VARCHAR2(40) PRIMARY KEY,
      FONTE_ARQUIVO VARCHAR2(1000) NOT NULL,
      STATUS VARCHAR2(30) NOT NULL,
      SETORES_IMPORTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      MODELOS_IMPORTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      ITENS_IMPORTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      TIPOS_NC_IMPORTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      PADROES_MOLA_IMPORTADOS NUMBER(10) DEFAULT 0 NOT NULL,
      VINCULOS_USUARIO_SETOR NUMBER(10) DEFAULT 0 NOT NULL,
      LINHAS_IGNORADAS NUMBER(10) DEFAULT 0 NOT NULL,
      LOG_RESUMO CLOB,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "INS_AUDITORIA",
    ddl: `CREATE TABLE INS_AUDITORIA (
      ID VARCHAR2(40) PRIMARY KEY,
      ENTIDADE VARCHAR2(120) NOT NULL,
      ENTIDADE_ID VARCHAR2(120),
      ACAO VARCHAR2(60) NOT NULL,
      USUARIO_ID VARCHAR2(80),
      USUARIO_NOME VARCHAR2(200),
      DETALHES CLOB,
      CRIADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
];

const REQUIRED_COLUMNS: EnsureColumn[] = [
  { table: "INS_SETOR", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_USUARIO_SETOR", column: "USUARIO_ID", ddl: "VARCHAR2(80)" },
  { table: "INS_USUARIO_SETOR", column: "ATIVO", ddl: "NUMBER(1) DEFAULT 1" },
  { table: "INS_USUARIO_SETOR", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_USUARIO_SETOR", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MODELO_CHECKLIST", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MODELO_CHECKLIST", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MODELO_CHECKLIST_ITEM", column: "SETOR_ID", ddl: "VARCHAR2(40)" },
  { table: "INS_MODELO_CHECKLIST_ITEM", column: "CODIGO_ITEM", ddl: "VARCHAR2(40)" },
  { table: "INS_MODELO_CHECKLIST_ITEM", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MODELO_CHECKLIST_ITEM", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_TIPO_NC", column: "OBSERVACAO", ddl: "VARCHAR2(2000)" },
  { table: "INS_TIPO_NC", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_TIPO_NC", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO", column: "CODIGO", ddl: "VARCHAR2(80)" },
  { table: "INS_EXECUCAO", column: "EXECUTOR_USUARIO_ID", ddl: "VARCHAR2(80)" },
  { table: "INS_EXECUCAO", column: "EXECUTOR_NOME", ddl: "VARCHAR2(200)" },
  { table: "INS_EXECUCAO", column: "DATA_HORA", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO", column: "TOTAL_ITENS", ddl: "NUMBER(8) DEFAULT 0" },
  { table: "INS_EXECUCAO", column: "CONFORMES", ddl: "NUMBER(8) DEFAULT 0" },
  { table: "INS_EXECUCAO", column: "NAO_CONFORMES", ddl: "NUMBER(8) DEFAULT 0" },
  { table: "INS_EXECUCAO", column: "NAO_APLICA", ddl: "NUMBER(8) DEFAULT 0" },
  { table: "INS_EXECUCAO", column: "TAXA_CONFORMIDADE", ddl: "NUMBER(6,2) DEFAULT 0" },
  { table: "INS_EXECUCAO", column: "OBSERVACAO_GERAL", ddl: "VARCHAR2(2000)" },
  { table: "INS_EXECUCAO", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO_ITEM", column: "MODELO_ITEM_ID", ddl: "VARCHAR2(40)" },
  { table: "INS_EXECUCAO_ITEM", column: "CODIGO_ITEM", ddl: "VARCHAR2(40)" },
  { table: "INS_EXECUCAO_ITEM", column: "ORDEM", ddl: "NUMBER(6)" },
  { table: "INS_EXECUCAO_ITEM", column: "DESCRICAO", ddl: "VARCHAR2(1500)" },
  { table: "INS_EXECUCAO_ITEM", column: "RESULTADO", ddl: "VARCHAR2(30)" },
  { table: "INS_EXECUCAO_ITEM", column: "TIPO_NC_NOME", ddl: "VARCHAR2(300)" },
  { table: "INS_EXECUCAO_ITEM", column: "OUTRA_NC", ddl: "VARCHAR2(1000)" },
  { table: "INS_EXECUCAO_ITEM", column: "TIMESTAMP_RESPOSTA", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO_ITEM", column: "USUARIO", ddl: "VARCHAR2(80)" },
  { table: "INS_EXECUCAO_ITEM", column: "NOME", ddl: "VARCHAR2(200)" },
  { table: "INS_EXECUCAO_ITEM", column: "SETOR", ddl: "VARCHAR2(120)" },
  { table: "INS_EXECUCAO_ITEM", column: "FOTO_URL", ddl: "VARCHAR2(1000)" },
  { table: "INS_EXECUCAO_ITEM", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO_ITEM", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "EXECUCAO_ITEM_ID", ddl: "VARCHAR2(40)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "ORDEM_ARQUIVO", ddl: "NUMBER(4) DEFAULT 1" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "NOME_ARQUIVO", ddl: "VARCHAR2(255)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "URL_ARQUIVO", ddl: "VARCHAR2(1000)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "REFERENCIA_ARQUIVO", ddl: "VARCHAR2(1000)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "MIME_TYPE", ddl: "VARCHAR2(120)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "TAMANHO_ARQUIVO", ddl: "NUMBER(12)" },
  { table: "INS_EXECUCAO_ITEM_EVIDENCIA", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_MAQUINA", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_MAQUINA", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_PADRAO", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_PADRAO", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_INSPECAO", column: "CODIGO", ddl: "VARCHAR2(80)" },
  { table: "INS_MOLA_INSPECAO", column: "MAQUINA_CODIGO", ddl: "VARCHAR2(20)" },
  { table: "INS_MOLA_INSPECAO", column: "STATUS_MAQUINA", ddl: "VARCHAR2(40)" },
  { table: "INS_MOLA_INSPECAO", column: "ALTURA_TIPO", ddl: "VARCHAR2(40)" },
  { table: "INS_MOLA_INSPECAO", column: "LINHA_POCKET", ddl: "VARCHAR2(200)" },
  { table: "INS_MOLA_INSPECAO", column: "OPERADOR_USUARIO_ID", ddl: "VARCHAR2(80)" },
  { table: "INS_MOLA_INSPECAO", column: "OPERADOR_NOME", ddl: "VARCHAR2(200)" },
  { table: "INS_MOLA_INSPECAO", column: "DATA_HORA", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_INSPECAO", column: "OBSERVACAO_GERAL", ddl: "VARCHAR2(2000)" },
  { table: "INS_MOLA_INSPECAO", column: "RESULTADO", ddl: "VARCHAR2(40)" },
  { table: "INS_MOLA_INSPECAO", column: "MOTIVO_PARADA", ddl: "VARCHAR2(2000)" },
  { table: "INS_MOLA_INSPECAO", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_INSPECAO", column: "ATUALIZADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "ITEM", ddl: "VARCHAR2(40)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "DESCRICAO", ddl: "VARCHAR2(500)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "PADRAO", ddl: "VARCHAR2(120)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "MINIMO", ddl: "NUMBER(14,4)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "MAXIMO", ddl: "NUMBER(14,4)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "UNIDADE", ddl: "VARCHAR2(60)" },
  { table: "INS_MOLA_INSPECAO_AMOSTRA", column: "CRIADO_EM", ddl: "TIMESTAMP DEFAULT SYSTIMESTAMP" },
];

const INDEXES: EnsureIndex[] = [
  { name: "UX_INS_SETOR_NOME", table: "INS_SETOR", columns: "NOME", unique: true },
  { name: "UX_INS_USUARIO_SETOR_UNQ", table: "INS_USUARIO_SETOR", columns: "USUARIO_ID, SETOR_ID", unique: true },
  { name: "IDX_INS_USUARIO_SETOR_USUARIO", table: "INS_USUARIO_SETOR", columns: "USUARIO_ID" },
  { name: "IDX_INS_MODELO_SETOR", table: "INS_MODELO_CHECKLIST", columns: "SETOR_ID, ATIVO, ORDEM" },
  { name: "UX_INS_MCI_MODELO_CODIGO", table: "INS_MODELO_CHECKLIST_ITEM", columns: "MODELO_ID, CODIGO_ITEM", unique: true },
  { name: "IDX_INS_MCI_MODELO_ORDEM", table: "INS_MODELO_CHECKLIST_ITEM", columns: "MODELO_ID, ORDEM" },
  { name: "UX_INS_TIPO_NC_SETOR_NOME", table: "INS_TIPO_NC", columns: "SETOR_ID, NOME", unique: true },
  { name: "UX_INS_EXEC_CODIGO", table: "INS_EXECUCAO", columns: "CODIGO", unique: true },
  { name: "IDX_INS_EXEC_SETOR_DATA", table: "INS_EXECUCAO", columns: "SETOR_ID, DATA_HORA" },
  { name: "IDX_INS_EI_EXEC_ORDEM", table: "INS_EXECUCAO_ITEM", columns: "EXECUCAO_ID, ORDEM" },
  { name: "UX_INS_EIE_ITEM_ORDEM", table: "INS_EXECUCAO_ITEM_EVIDENCIA", columns: "EXECUCAO_ITEM_ID, ORDEM_ARQUIVO", unique: true },
  { name: "UX_INS_MOLA_MAQUINA_CODIGO", table: "INS_MOLA_MAQUINA", columns: "CODIGO", unique: true },
  { name: "UX_INS_MOLA_PADRAO_UNQ", table: "INS_MOLA_PADRAO", columns: "ALTURA_TIPO, ITEM", unique: true },
  { name: "UX_INS_MI_CODIGO", table: "INS_MOLA_INSPECAO", columns: "CODIGO", unique: true },
  { name: "IDX_INS_MI_MAQUINA_DATA", table: "INS_MOLA_INSPECAO", columns: "MAQUINA_ID, DATA_HORA" },
  { name: "IDX_INS_MIA_INSPECAO", table: "INS_MOLA_INSPECAO_AMOSTRA", columns: "INSPECAO_ID" },
  { name: "IDX_INS_AUDITORIA_ENTIDADE", table: "INS_AUDITORIA", columns: "ENTIDADE, CRIADO_EM" },
];

async function tableExists(tableName: string): Promise<boolean> {
  const normalized = tableName.toUpperCase();
  try {
    await executeOracle(`SELECT * FROM ${normalized} WHERE 1 = 0`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ORA-00942")) return false;
    throw error;
  }
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const normalizedTable = tableName.toUpperCase();
  const normalizedColumn = columnName.toUpperCase();
  try {
    const result = (await executeOracle(`SELECT * FROM ${normalizedTable} WHERE 1 = 0`)) as any;
    const metaData = Array.isArray(result?.metaData) ? result.metaData : [];
    return metaData.some((item: any) => String(item?.name ?? "").toUpperCase() === normalizedColumn);
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

async function addColumnIfMissing(def: EnsureColumn): Promise<void> {
  if (!(await tableExists(def.table))) return;
  if (await columnExists(def.table, def.column)) return;
  try {
    await execDml(`ALTER TABLE ${def.table} ADD (${def.column} ${def.ddl})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("ORA-01430")
      || message.includes("ORA-01031")
      || message.includes("ORA-39726")
    ) return;
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
    if (
      message.includes("ORA-00955") ||
      message.includes("ORA-01408") ||
      message.includes("ORA-01031") ||
      message.includes("ORA-00904")
    ) return;
    throw error;
  }
}

async function runBackfillMigrations(): Promise<void> {
  if (await tableExists("INS_USUARIO_SETOR")) {
    const hasUserId = await columnExists("INS_USUARIO_SETOR", "USER_ID");
    const hasUsuarioId = await columnExists("INS_USUARIO_SETOR", "USUARIO_ID");
    if (hasUserId && hasUsuarioId) {
      await execDml(`UPDATE INS_USUARIO_SETOR SET USUARIO_ID = COALESCE(USUARIO_ID, USER_ID)`);
    }
  }

  if (await tableExists("INS_MODELO_CHECKLIST_ITEM")) {
    const hasItemId = await columnExists("INS_MODELO_CHECKLIST_ITEM", "ID");
    const hasCodigo = await columnExists("INS_MODELO_CHECKLIST_ITEM", "CODIGO_ITEM");
    if (hasItemId && hasCodigo) {
      await execDml(`UPDATE INS_MODELO_CHECKLIST_ITEM SET CODIGO_ITEM = COALESCE(CODIGO_ITEM, ID)`);
    }

    const hasSetor = await columnExists("INS_MODELO_CHECKLIST_ITEM", "SETOR_ID");
    if (hasSetor) {
      await execDml(`
        UPDATE INS_MODELO_CHECKLIST_ITEM i
           SET SETOR_ID = (
             SELECT m.SETOR_ID
               FROM INS_MODELO_CHECKLIST m
              WHERE m.ID = i.MODELO_ID
           )
         WHERE SETOR_ID IS NULL
      `);
    }
  }

  if (await tableExists("INS_EXECUCAO")) {
    const hasDataInicio = await columnExists("INS_EXECUCAO", "DATA_INICIO");
    const hasDataHora = await columnExists("INS_EXECUCAO", "DATA_HORA");
    if (hasDataInicio && hasDataHora) {
      await execDml(`UPDATE INS_EXECUCAO SET DATA_HORA = COALESCE(DATA_HORA, DATA_INICIO)`);
    }

    const hasInspetor = await columnExists("INS_EXECUCAO", "INSPETOR");
    const hasExecutor = await columnExists("INS_EXECUCAO", "EXECUTOR_NOME");
    if (hasInspetor && hasExecutor) {
      await execDml(`UPDATE INS_EXECUCAO SET EXECUTOR_NOME = COALESCE(EXECUTOR_NOME, INSPETOR)`);
    }

    const hasObs = await columnExists("INS_EXECUCAO", "OBSERVACOES");
    const hasObsGeral = await columnExists("INS_EXECUCAO", "OBSERVACAO_GERAL");
    if (hasObs && hasObsGeral) {
      await execDml(`UPDATE INS_EXECUCAO SET OBSERVACAO_GERAL = COALESCE(OBSERVACAO_GERAL, OBSERVACOES)`);
    }
  }

  if (await tableExists("INS_EXECUCAO_ITEM")) {
    const hasItemId = await columnExists("INS_EXECUCAO_ITEM", "ITEM_ID");
    const hasModeloItemId = await columnExists("INS_EXECUCAO_ITEM", "MODELO_ITEM_ID");
    if (hasItemId && hasModeloItemId) {
      await execDml(`UPDATE INS_EXECUCAO_ITEM SET MODELO_ITEM_ID = COALESCE(MODELO_ITEM_ID, ITEM_ID)`);
    }

    const hasStatus = await columnExists("INS_EXECUCAO_ITEM", "STATUS");
    const hasResultado = await columnExists("INS_EXECUCAO_ITEM", "RESULTADO");
    if (hasStatus && hasResultado) {
      await execDml(`UPDATE INS_EXECUCAO_ITEM SET RESULTADO = COALESCE(RESULTADO, STATUS)`);
    }

    const hasOrdem = await columnExists("INS_EXECUCAO_ITEM", "ORDEM");
    if (hasOrdem) {
      await execDml(`
        UPDATE INS_EXECUCAO_ITEM ei
           SET ORDEM = COALESCE(
             ORDEM,
             (SELECT mi.ORDEM FROM INS_MODELO_CHECKLIST_ITEM mi WHERE mi.ID = ei.MODELO_ITEM_ID),
             0
           )
      `);
    }

    const hasDesc = await columnExists("INS_EXECUCAO_ITEM", "DESCRICAO");
    if (hasDesc) {
      await execDml(`
        UPDATE INS_EXECUCAO_ITEM ei
           SET DESCRICAO = COALESCE(
             DESCRICAO,
             (SELECT mi.DESCRICAO FROM INS_MODELO_CHECKLIST_ITEM mi WHERE mi.ID = ei.MODELO_ITEM_ID),
             'Item sem descricao'
           )
      `);
    }

    const hasCodigo = await columnExists("INS_EXECUCAO_ITEM", "CODIGO_ITEM");
    if (hasCodigo) {
      await execDml(`
        UPDATE INS_EXECUCAO_ITEM ei
           SET CODIGO_ITEM = COALESCE(
             CODIGO_ITEM,
             (SELECT mi.CODIGO_ITEM FROM INS_MODELO_CHECKLIST_ITEM mi WHERE mi.ID = ei.MODELO_ITEM_ID),
             MODELO_ITEM_ID
           )
      `);
    }
  }

  if (await tableExists("INS_EXECUCAO_ITEM_EVIDENCIA")) {
    const hasExecItemOld = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", "EXEC_ITEM_ID");
    const hasExecItemNew = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", "EXECUCAO_ITEM_ID");
    if (hasExecItemOld && hasExecItemNew) {
      await execDml(`UPDATE INS_EXECUCAO_ITEM_EVIDENCIA SET EXECUCAO_ITEM_ID = COALESCE(EXECUCAO_ITEM_ID, EXEC_ITEM_ID)`);
    }

    const mapPairs: Array<[string, string]> = [
      ["ARQUIVO_NOME", "NOME_ARQUIVO"],
      ["ARQUIVO_URL", "URL_ARQUIVO"],
      ["TIPO_MIME", "MIME_TYPE"],
    ];
    for (const [oldCol, newCol] of mapPairs) {
      const hasOld = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", oldCol);
      const hasNew = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", newCol);
      if (hasOld && hasNew) {
        await execDml(`UPDATE INS_EXECUCAO_ITEM_EVIDENCIA SET ${newCol} = COALESCE(${newCol}, ${oldCol})`);
      }
    }

    const hasOrder = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", "ORDEM_ARQUIVO");
    const hasExecItem = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", "EXECUCAO_ITEM_ID");
    if (hasOrder && hasExecItem) {
      const hasCriadoEm = await columnExists("INS_EXECUCAO_ITEM_EVIDENCIA", "CRIADO_EM");
      const orderByExpr = hasCriadoEm ? "CRIADO_EM, ID" : "ID";
      await execDml(`
        MERGE INTO INS_EXECUCAO_ITEM_EVIDENCIA t
        USING (
          SELECT ID,
                 ROW_NUMBER() OVER (
                   PARTITION BY EXECUCAO_ITEM_ID
                   ORDER BY ${orderByExpr}
                 ) AS RN
            FROM INS_EXECUCAO_ITEM_EVIDENCIA
           WHERE ORDEM_ARQUIVO IS NULL
        ) s
        ON (t.ID = s.ID)
        WHEN MATCHED THEN UPDATE SET t.ORDEM_ARQUIVO = s.RN
      `);
    }
  }

  if (await tableExists("INS_MOLA_INSPECAO")) {
    const hasInspetor = await columnExists("INS_MOLA_INSPECAO", "INSPETOR");
    const hasOperadorNome = await columnExists("INS_MOLA_INSPECAO", "OPERADOR_NOME");
    if (hasInspetor && hasOperadorNome) {
      await execDml(`UPDATE INS_MOLA_INSPECAO SET OPERADOR_NOME = COALESCE(OPERADOR_NOME, INSPETOR)`);
    }

    const hasObs = await columnExists("INS_MOLA_INSPECAO", "OBSERVACOES");
    const hasObsGeral = await columnExists("INS_MOLA_INSPECAO", "OBSERVACAO_GERAL");
    if (hasObs && hasObsGeral) {
      await execDml(`UPDATE INS_MOLA_INSPECAO SET OBSERVACAO_GERAL = COALESCE(OBSERVACAO_GERAL, OBSERVACOES)`);
    }

    const hasDataInspecao = await columnExists("INS_MOLA_INSPECAO", "DATA_INSPECAO");
    const hasDataHora = await columnExists("INS_MOLA_INSPECAO", "DATA_HORA");
    if (hasDataInspecao && hasDataHora) {
      await execDml(`UPDATE INS_MOLA_INSPECAO SET DATA_HORA = COALESCE(DATA_HORA, DATA_INSPECAO)`);
    }
  }

  // Keep legacy import table mirrored when present.
  if (await tableExists("INS_AUDITORIA_IMPORTACAO") && await tableExists("INS_IMPORT_LOG")) {
    await execDml(`
      INSERT INTO INS_AUDITORIA_IMPORTACAO (
        ID,
        FONTE_ARQUIVO,
        STATUS,
        SETORES_IMPORTADOS,
        MODELOS_IMPORTADOS,
        ITENS_IMPORTADOS,
        TIPOS_NC_IMPORTADOS,
        PADROES_MOLA_IMPORTADOS,
        VINCULOS_USUARIO_SETOR,
        LINHAS_IGNORADAS,
        LOG_RESUMO,
        CRIADO_EM
      )
      SELECT
        l.ID,
        'LEGACY_LOG',
        'MIGRADO',
        NVL(l.SETORES, 0),
        NVL(l.MODELOS, 0),
        NVL(l.ITENS, 0),
        NVL(l.TIPOS_NC, 0),
        NVL(l.PADROES_MOLA, 0),
        NVL(l.VINCULOS_SETOR, 0),
        0,
        l.ALERTAS,
        l.DATA_IMPORTACAO
      FROM INS_IMPORT_LOG l
      WHERE NOT EXISTS (
        SELECT 1 FROM INS_AUDITORIA_IMPORTACAO a WHERE a.ID = l.ID
      )
    `);
  }
}

async function ensureForeignKeys(): Promise<void> {
  // Using dynamic blocks avoids errors when FK already exists.
  const blocks = [
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_USUARIO_SETOR ADD CONSTRAINT FK_INS_USUARIO_SETOR_SETOR FOREIGN KEY (SETOR_ID) REFERENCES INS_SETOR(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MODELO_CHECKLIST ADD CONSTRAINT FK_INS_MODELO_SETOR FOREIGN KEY (SETOR_ID) REFERENCES INS_SETOR(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MODELO_CHECKLIST_ITEM ADD CONSTRAINT FK_INS_MCI_MODELO FOREIGN KEY (MODELO_ID) REFERENCES INS_MODELO_CHECKLIST(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MODELO_CHECKLIST_ITEM ADD CONSTRAINT FK_INS_MCI_SETOR FOREIGN KEY (SETOR_ID) REFERENCES INS_SETOR(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_TIPO_NC ADD CONSTRAINT FK_INS_TIPO_NC_SETOR FOREIGN KEY (SETOR_ID) REFERENCES INS_SETOR(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO ADD CONSTRAINT FK_INS_EXEC_MODELO FOREIGN KEY (MODELO_ID) REFERENCES INS_MODELO_CHECKLIST(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO ADD CONSTRAINT FK_INS_EXEC_SETOR FOREIGN KEY (SETOR_ID) REFERENCES INS_SETOR(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO_ITEM ADD CONSTRAINT FK_INS_EI_EXECUCAO FOREIGN KEY (EXECUCAO_ID) REFERENCES INS_EXECUCAO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO_ITEM ADD CONSTRAINT FK_INS_EI_MODELO_ITEM FOREIGN KEY (MODELO_ITEM_ID) REFERENCES INS_MODELO_CHECKLIST_ITEM(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO_ITEM ADD CONSTRAINT FK_INS_EI_TIPO_NC FOREIGN KEY (TIPO_NC_ID) REFERENCES INS_TIPO_NC(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_EXECUCAO_ITEM_EVIDENCIA ADD CONSTRAINT FK_INS_EIE_EXEC_ITEM FOREIGN KEY (EXECUCAO_ITEM_ID) REFERENCES INS_EXECUCAO_ITEM(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MOLA_INSPECAO ADD CONSTRAINT FK_INS_MI_MAQUINA FOREIGN KEY (MAQUINA_ID) REFERENCES INS_MOLA_MAQUINA(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MOLA_INSPECAO_AMOSTRA ADD CONSTRAINT FK_INS_MIA_INSPECAO FOREIGN KEY (INSPECAO_ID) REFERENCES INS_MOLA_INSPECAO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
    `BEGIN EXECUTE IMMEDIATE 'ALTER TABLE INS_MOLA_INSPECAO_AMOSTRA ADD CONSTRAINT FK_INS_MIA_PADRAO FOREIGN KEY (PADRAO_ID) REFERENCES INS_MOLA_PADRAO(ID)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-2261,-2275,-2270,-2291,-2443) THEN RAISE; END IF; END;`,
  ];

  for (const sql of blocks) {
    try {
      await execDml(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ORA-01031")) {
        continue;
      }
      throw error;
    }
  }
}

export async function ensureInspecoesTables(): Promise<void> {
  if (!isOracleEnabled() || initialized) return;

  for (const def of TABLE_DDL) {
    await createTableIfMissing(def.name, def.ddl);
  }

  for (const col of REQUIRED_COLUMNS) {
    await addColumnIfMissing(col);
  }

  await runBackfillMigrations();

  for (const idx of INDEXES) {
    await createIndexIfMissing(idx);
  }

  await ensureForeignKeys();

  initialized = true;
}
