import { randomUUID } from "node:crypto";
import { executeOracle, isOracleEnabled } from "../../db/oracle.js";
import { execDml, queryOne } from "../baseRepository.js";

type EnsureIndex = {
  name: string;
  table: string;
  columns: string;
  unique?: boolean;
};

let initialized = false;

const TABLES: Array<{ name: string; ddl: string }> = [
  {
    name: "LARA_CLIENTES_CACHE",
    ddl: `CREATE TABLE LARA_CLIENTES_CACHE (
      ID VARCHAR2(64) PRIMARY KEY,
      CODCLI NUMBER(12) NOT NULL,
      CLIENTE VARCHAR2(255) NOT NULL,
      CPF_CNPJ_MASK VARCHAR2(30),
      TELEFONE VARCHAR2(40),
      WA_ID VARCHAR2(40),
      FILIAL VARCHAR2(40),
      STATUS_RELACIONAMENTO VARCHAR2(60),
      TOTAL_ABERTO NUMBER(14,2) DEFAULT 0 NOT NULL,
      QTD_TITULOS NUMBER(10) DEFAULT 0 NOT NULL,
      RISCO VARCHAR2(20),
      ETAPA_REGUA VARCHAR2(20),
      TITULO_MAIS_ANTIGO DATE,
      PROXIMO_VENCIMENTO DATE,
      ULTIMA_ACAO VARCHAR2(120),
      PROXIMA_ACAO VARCHAR2(120),
      RESPONSAVEL VARCHAR2(120),
      ULTIMO_CONTATO_EM TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_TITULOS_CACHE",
    ddl: `CREATE TABLE LARA_TITULOS_CACHE (
      ID VARCHAR2(120) PRIMARY KEY,
      CODCLI NUMBER(12) NOT NULL,
      DUPLICATA VARCHAR2(80) NOT NULL,
      PRESTACAO VARCHAR2(20) NOT NULL,
      VALOR NUMBER(14,2) DEFAULT 0 NOT NULL,
      VENCIMENTO DATE,
      DIAS_ATRASO NUMBER(10) DEFAULT 0 NOT NULL,
      CODCOB VARCHAR2(20),
      STATUS_TITULO VARCHAR2(40),
      BOLETO_DISPONIVEL NUMBER(1) DEFAULT 0 NOT NULL,
      PIX_DISPONIVEL NUMBER(1) DEFAULT 0 NOT NULL,
      FILIAL VARCHAR2(40),
      CLIENTE VARCHAR2(255),
      TELEFONE VARCHAR2(40),
      ETAPA_REGUA VARCHAR2(20),
      ULTIMA_ACAO VARCHAR2(120),
      RESPONSAVEL VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_COB_MSG_LOG",
    ddl: `CREATE TABLE LARA_COB_MSG_LOG (
      ID VARCHAR2(64) PRIMARY KEY,
      WA_ID VARCHAR2(40),
      CODCLI NUMBER(12),
      CLIENTE VARCHAR2(255),
      TELEFONE VARCHAR2(40),
      MESSAGE_TEXT VARCHAR2(4000),
      DIRECTION VARCHAR2(20) NOT NULL,
      ORIGEM VARCHAR2(80),
      ETAPA VARCHAR2(20),
      DUPLICS VARCHAR2(500),
      VALOR_TOTAL NUMBER(14,2),
      PAYLOAD_JSON CLOB,
      STATUS VARCHAR2(40),
      SENT_AT TIMESTAMP,
      RECEIVED_AT TIMESTAMP,
      MESSAGE_TYPE VARCHAR2(30),
      OPERATOR_NAME VARCHAR2(120),
      IDEMPOTENCY_KEY VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_CASES",
    ddl: `CREATE TABLE LARA_CASES (
      ID VARCHAR2(64) PRIMARY KEY,
      WA_ID VARCHAR2(40),
      CODCLI NUMBER(12),
      CLIENTE VARCHAR2(255),
      TIPO_CASE VARCHAR2(80) NOT NULL,
      ETAPA VARCHAR2(20),
      DUPLICATAS VARCHAR2(500),
      VALOR_TOTAL NUMBER(14,2),
      FORMA_PAGAMENTO VARCHAR2(60),
      DETALHE VARCHAR2(4000),
      ORIGEM VARCHAR2(80),
      RESPONSAVEL VARCHAR2(120),
      STATUS VARCHAR2(40),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_PROMESSAS_PAGAMENTO",
    ddl: `CREATE TABLE LARA_PROMESSAS_PAGAMENTO (
      ID VARCHAR2(64) PRIMARY KEY,
      WA_ID VARCHAR2(40),
      CODCLI NUMBER(12),
      CLIENTE VARCHAR2(255),
      DUPLICATAS VARCHAR2(500),
      VALOR_TOTAL NUMBER(14,2),
      DATA_PROMETIDA DATE,
      OBSERVACAO VARCHAR2(2000),
      STATUS VARCHAR2(40),
      ORIGEM VARCHAR2(80),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_NEGOCIACOES",
    ddl: `CREATE TABLE LARA_NEGOCIACOES (
      ID VARCHAR2(64) PRIMARY KEY,
      CODCLI NUMBER(12),
      WA_ID VARCHAR2(40),
      FILIAL VARCHAR2(40),
      DUPLICATA VARCHAR2(80),
      PRESTACAO VARCHAR2(20),
      NUMTRANSVENDA NUMBER(12),
      DTVENC_ORIGINAL DATE,
      DTVENC_PRORROGADA DATE,
      VALOR_ORIGINAL NUMBER(14,2),
      VALOR_NEGOCIADO NUMBER(14,2),
      TIPO_NEGOCIACAO VARCHAR2(60),
      STATUS_NEGOCIACAO VARCHAR2(40),
      PROXIMA_COBRANCA_EM TIMESTAMP,
      ORIGEM VARCHAR2(80),
      OBSERVACAO VARCHAR2(2000),
      IDEMPOTENCY_KEY VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_OPTOUT",
    ddl: `CREATE TABLE LARA_OPTOUT (
      ID VARCHAR2(64) PRIMARY KEY,
      WA_ID VARCHAR2(40),
      CODCLI NUMBER(12),
      CLIENTE VARCHAR2(255),
      MOTIVO VARCHAR2(300),
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      ORIGEM VARCHAR2(80),
      OBSERVACAO VARCHAR2(2000),
      DATA_CRIACAO TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      DATA_ATUALIZACAO TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_REGUA_TEMPLATES",
    ddl: `CREATE TABLE LARA_REGUA_TEMPLATES (
      ID VARCHAR2(64) PRIMARY KEY,
      ETAPA VARCHAR2(20) NOT NULL,
      NOME_TEMPLATE VARCHAR2(120) NOT NULL,
      CANAL VARCHAR2(40) NOT NULL,
      MENSAGEM_TEMPLATE CLOB NOT NULL,
      ATIVO NUMBER(1) DEFAULT 1 NOT NULL,
      ORDEM_EXECUCAO NUMBER(6) DEFAULT 0 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_REGUA_EXECUCOES",
    ddl: `CREATE TABLE LARA_REGUA_EXECUCOES (
      ID VARCHAR2(64) PRIMARY KEY,
      ETAPA VARCHAR2(20) NOT NULL,
      DATA_HORA_EXECUCAO TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ELEGIVEL NUMBER(10) DEFAULT 0 NOT NULL,
      DISPARADA NUMBER(10) DEFAULT 0 NOT NULL,
      RESPONDIDA NUMBER(10) DEFAULT 0 NOT NULL,
      CONVERTIDA NUMBER(10) DEFAULT 0 NOT NULL,
      ERRO NUMBER(10) DEFAULT 0 NOT NULL,
      BLOQUEADO_OPTOUT NUMBER(10) DEFAULT 0 NOT NULL,
      VALOR_IMPACTADO NUMBER(14,2) DEFAULT 0 NOT NULL,
      STATUS VARCHAR2(40),
      DETALHES_JSON CLOB,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_INTEGRACOES_LOG",
    ddl: `CREATE TABLE LARA_INTEGRACOES_LOG (
      ID VARCHAR2(64) PRIMARY KEY,
      INTEGRACAO VARCHAR2(80) NOT NULL,
      TIPO VARCHAR2(80) NOT NULL,
      REQUEST_JSON CLOB,
      RESPONSE_JSON CLOB,
      STATUS_HTTP NUMBER(5),
      STATUS_OPERACAO VARCHAR2(40),
      ERRO_RESUMO VARCHAR2(1000),
      IDEMPOTENCY_KEY VARCHAR2(120),
      CORRELATION_ID VARCHAR2(120),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "LARA_CONFIGURACOES",
    ddl: `CREATE TABLE LARA_CONFIGURACOES (
      ID VARCHAR2(64) PRIMARY KEY,
      CHAVE VARCHAR2(120) NOT NULL,
      VALOR CLOB,
      DESCRICAO VARCHAR2(400),
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
];

const INDEXES: EnsureIndex[] = [
  { name: "UX_LARA_CLIENTES_CODCLI", table: "LARA_CLIENTES_CACHE", columns: "CODCLI", unique: true },
  { name: "IDX_LARA_CLIENTES_WA", table: "LARA_CLIENTES_CACHE", columns: "WA_ID" },
  { name: "IDX_LARA_CLIENTES_TELEFONE", table: "LARA_CLIENTES_CACHE", columns: "TELEFONE" },
  { name: "IDX_LARA_CLIENTES_ATUALIZ", table: "LARA_CLIENTES_CACHE", columns: "UPDATED_AT" },
  { name: "IDX_LARA_CLIENTES_PROX_VENC", table: "LARA_CLIENTES_CACHE", columns: "PROXIMO_VENCIMENTO" },
  { name: "IDX_LARA_TITULOS_CODCLI", table: "LARA_TITULOS_CACHE", columns: "CODCLI, VENCIMENTO" },
  { name: "IDX_LARA_TITULOS_DUP", table: "LARA_TITULOS_CACHE", columns: "DUPLICATA, PRESTACAO" },
  { name: "IDX_LARA_TITULOS_VENC", table: "LARA_TITULOS_CACHE", columns: "VENCIMENTO" },
  { name: "IDX_LARA_TITULOS_ETAPA", table: "LARA_TITULOS_CACHE", columns: "ETAPA_REGUA" },
  { name: "IDX_LARA_MSG_WA", table: "LARA_COB_MSG_LOG", columns: "WA_ID, CREATED_AT" },
  { name: "IDX_LARA_MSG_CODCLI", table: "LARA_COB_MSG_LOG", columns: "CODCLI, CREATED_AT" },
  { name: "IDX_LARA_MSG_SENT", table: "LARA_COB_MSG_LOG", columns: "SENT_AT" },
  { name: "IDX_LARA_MSG_IDEMP", table: "LARA_COB_MSG_LOG", columns: "IDEMPOTENCY_KEY" },
  { name: "IDX_LARA_CASES_WA", table: "LARA_CASES", columns: "WA_ID, CREATED_AT" },
  { name: "IDX_LARA_CASES_CODCLI", table: "LARA_CASES", columns: "CODCLI, CREATED_AT" },
  { name: "IDX_LARA_PROM_WA", table: "LARA_PROMESSAS_PAGAMENTO", columns: "WA_ID, DATA_PROMETIDA" },
  { name: "IDX_LARA_PROM_CODCLI", table: "LARA_PROMESSAS_PAGAMENTO", columns: "CODCLI, DATA_PROMETIDA" },
  { name: "IDX_LARA_NEG_CODCLI", table: "LARA_NEGOCIACOES", columns: "CODCLI, STATUS_NEGOCIACAO, PROXIMA_COBRANCA_EM" },
  { name: "IDX_LARA_NEG_TRANS", table: "LARA_NEGOCIACOES", columns: "NUMTRANSVENDA, PRESTACAO" },
  { name: "IDX_LARA_NEG_IDEMP", table: "LARA_NEGOCIACOES", columns: "IDEMPOTENCY_KEY" },
  { name: "IDX_LARA_OPTOUT_WA", table: "LARA_OPTOUT", columns: "WA_ID, ATIVO" },
  { name: "IDX_LARA_OPTOUT_CODCLI", table: "LARA_OPTOUT", columns: "CODCLI, ATIVO" },
  { name: "UX_LARA_REGUA_TEMPLATE", table: "LARA_REGUA_TEMPLATES", columns: "ETAPA, ORDEM_EXECUCAO", unique: true },
  { name: "IDX_LARA_REGUA_EXEC", table: "LARA_REGUA_EXECUCOES", columns: "ETAPA, DATA_HORA_EXECUCAO" },
  { name: "UX_LARA_CFG_CHAVE", table: "LARA_CONFIGURACOES", columns: "CHAVE", unique: true },
  { name: "IDX_LARA_INT_IDEMP", table: "LARA_INTEGRACOES_LOG", columns: "IDEMPOTENCY_KEY" },
  { name: "IDX_LARA_INT_CREATED", table: "LARA_INTEGRACOES_LOG", columns: "CREATED_AT" },
];

const REQUIRED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "LARA_CLIENTES_CACHE", column: "TITULO_MAIS_ANTIGO", definition: "DATE" },
  { table: "LARA_CLIENTES_CACHE", column: "PROXIMO_VENCIMENTO", definition: "DATE" },
  { table: "LARA_CLIENTES_CACHE", column: "ULTIMA_ACAO", definition: "VARCHAR2(120)" },
  { table: "LARA_CLIENTES_CACHE", column: "PROXIMA_ACAO", definition: "VARCHAR2(120)" },
  { table: "LARA_CLIENTES_CACHE", column: "RESPONSAVEL", definition: "VARCHAR2(120)" },
  { table: "LARA_TITULOS_CACHE", column: "CLIENTE", definition: "VARCHAR2(255)" },
  { table: "LARA_TITULOS_CACHE", column: "TELEFONE", definition: "VARCHAR2(40)" },
  { table: "LARA_TITULOS_CACHE", column: "ETAPA_REGUA", definition: "VARCHAR2(20)" },
  { table: "LARA_TITULOS_CACHE", column: "ULTIMA_ACAO", definition: "VARCHAR2(120)" },
  { table: "LARA_TITULOS_CACHE", column: "RESPONSAVEL", definition: "VARCHAR2(120)" },
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

async function indexExists(indexName: string): Promise<boolean> {
  const row = await queryOne<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_INDEXES WHERE INDEX_NAME = :indexName`,
    { indexName: indexName.toUpperCase() },
  );
  return Number((row as any)?.CNT ?? 0) > 0;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const row = await queryOne<{ CNT: number }>(
    `
    SELECT COUNT(*) AS CNT
    FROM USER_TAB_COLUMNS
    WHERE TABLE_NAME = :tableName
      AND COLUMN_NAME = :columnName
    `,
    {
      tableName: tableName.toUpperCase(),
      columnName: columnName.toUpperCase(),
    },
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
    if (
      message.includes("ORA-00955")
      || message.includes("ORA-01408")
      || message.includes("ORA-01031")
      || message.includes("ORA-00904")
    ) return;
    throw error;
  }
}

async function createColumnIfMissing(def: { table: string; column: string; definition: string }): Promise<void> {
  if (!(await tableExists(def.table))) return;
  if (await columnExists(def.table, def.column)) return;
  try {
    await execDml(`ALTER TABLE ${def.table} ADD (${def.column} ${def.definition})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("ORA-01430")
      || message.includes("ORA-01442")
      || message.includes("ORA-01031")
      || message.includes("ORA-00942")
      || message.includes("ORA-00904")
    ) return;
    throw error;
  }
}

async function countRows(tableName: string): Promise<number> {
  const row = await queryOne<{ CNT: number }>(`SELECT COUNT(*) AS CNT FROM ${tableName}`);
  return Number((row as any)?.CNT ?? 0);
}

async function seedDefaultReguaTemplates(): Promise<void> {
  if ((await countRows("LARA_REGUA_TEMPLATES")) > 0) return;

  const templates = [
    {
      etapa: "D-3",
      nome: "Preventivo D-3",
      canal: "WHATSAPP",
      ordem: 1,
      msg: "Olá {cliente}, lembramos que o título {duplicata} vence em {vencimento}. Deseja boleto ou PIX?",
    },
    {
      etapa: "D0",
      nome: "Vencimento D0",
      canal: "WHATSAPP",
      ordem: 2,
      msg: "Olá {cliente}, o título {duplicata} vence hoje no valor de {valor}. Posso enviar o pagamento?",
    },
    {
      etapa: "D+3",
      nome: "Cobrança D+3",
      canal: "WHATSAPP",
      ordem: 3,
      msg: "Olá {cliente}, identificamos título vencido há 3 dias. Posso enviar boleto ou PIX?",
    },
    {
      etapa: "D+7",
      nome: "Cobrança D+7",
      canal: "WHATSAPP",
      ordem: 4,
      msg: "Olá {cliente}, ainda consta pendência em aberto. Quer receber o pagamento agora?",
    },
    {
      etapa: "D+15",
      nome: "Cobrança D+15",
      canal: "WHATSAPP",
      ordem: 5,
      msg: "Olá {cliente}, temos títulos em atraso e precisamos da regularização. Posso enviar as opções de pagamento?",
    },
    {
      etapa: "D+30",
      nome: "Cobrança D+30",
      canal: "WHATSAPP",
      ordem: 6,
      msg: "Olá {cliente}, a pendência segue em aberto há mais de 30 dias. Podemos tratar com prioridade?",
    },
  ] as const;

  for (const item of templates) {
    await execDml(
      `INSERT INTO LARA_REGUA_TEMPLATES
       (ID, ETAPA, NOME_TEMPLATE, CANAL, MENSAGEM_TEMPLATE, ATIVO, ORDEM_EXECUCAO)
       VALUES
       (:id, :etapa, :nome, :canal, :msg, 1, :ordem)`,
      {
        id: randomUUID(),
        etapa: item.etapa,
        nome: item.nome,
        canal: item.canal,
        msg: item.msg,
        ordem: item.ordem,
      },
    );
  }
}

async function upsertConfig(chave: string, valor: string, descricao: string): Promise<void> {
  await execDml(
    `INSERT INTO LARA_CONFIGURACOES (ID, CHAVE, VALOR, DESCRICAO, UPDATED_AT)
     SELECT :id, :chave, :valor, :descricao, SYSTIMESTAMP
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1
       FROM LARA_CONFIGURACOES t
       WHERE t.CHAVE = :chave
     )`,
    {
      id: randomUUID(),
      chave,
      valor,
      descricao,
    },
  );
}

async function seedDefaultConfig(): Promise<void> {
  await upsertConfig("JANELA_CONTEXTO_HORAS", "72", "Janela para reaproveitar contexto de régua ativa.");
  await upsertConfig("JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN", "120", "Janela para não pedir identificação novamente.");
  await upsertConfig("RATE_LIMIT_WEBHOOK_POR_MIN", "60", "Limite de requisições por minuto para webhooks.");
  await upsertConfig("LARA_BASE_BOLETO_URL", "https://pagamentos.exemplo.local/boleto", "URL base para boleto.");
  await upsertConfig("LARA_PIX_CHAVE", "financeiro@empresa.com.br", "Chave PIX padrão.");
  await upsertConfig("LARA_SYNC_DAILY_ATIVO", "false", "Ativa a sincronizacao diaria dos titulos em aberto.");
  await upsertConfig("LARA_SYNC_DAILY_HORA", "6", "Hora da sincronizacao diaria (0-23).");
  await upsertConfig("LARA_SYNC_DAILY_MINUTO", "0", "Minuto da sincronizacao diaria (0-59).");
  await upsertConfig("LARA_SYNC_DAILY_TIMEZONE", "America/Sao_Paulo", "Fuso horario da sincronizacao diaria.");
  await upsertConfig("LARA_SYNC_DAILY_LIMIT", "30000", "Limite maximo de titulos na carga diaria.");
  await upsertConfig("LARA_SYNC_DAILY_INCLUDE_DESD", "false", "Inclui codcob DESD na carga diaria.");
  await upsertConfig("LARA_SYNC_STARTUP_RUN", "true", "Executa sincronizacao ao subir o backend.");
  await upsertConfig("LARA_NEGOCIACAO_OFFSET_DIAS", "3", "Dias antes do novo vencimento para reiniciar a cobranca da negociacao.");
}

export async function ensureLaraTables(): Promise<void> {
  if (!isOracleEnabled() || initialized) return;
  for (const table of TABLES) {
    await createTableIfMissing(table.name, table.ddl);
  }
  for (const column of REQUIRED_COLUMNS) {
    await createColumnIfMissing(column);
  }
  for (const index of INDEXES) {
    await createIndexIfMissing(index);
  }
  await seedDefaultReguaTemplates();
  await seedDefaultConfig();
  initialized = true;
}
