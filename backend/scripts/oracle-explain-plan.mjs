import dotenv from "dotenv";
import oracledb from "oracledb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function getConnectString() {
  if (process.env.ORACLE_CONNECT_STRING) return process.env.ORACLE_CONNECT_STRING;
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const service = process.env.ORACLE_SERVICE_NAME;
  if (!host || !port || !service) {
    throw new Error("Configuração Oracle incompleta no .env");
  }
  return `${host}:${port}/${service}`;
}

const queries = [
  {
    name: "cliente-por-codcli",
    sql: `select
  pcclient.codcli,
  pcclient.cliente,
  pcclient.cgcent,
  pccidade.nomecidade,
  pcclient.telent as telefone
from pcclient, pccidade
where pccidade.codcidade = pcclient.codcidade
  and pcclient.codcli = :codcli`,
    binds: { codcli: 362811 },
  },
  {
    name: "pedidos-por-codcli",
    sql: `select
  pcpedc.numped,
  pcpedc.numnota,
  pcpedc.data,
  pcpedc.vltotal,
  pcpedc.posicao,
  pcpedc.origemped
from pcpedc
where codcli = :codcli`,
    binds: { codcli: 362811 },
  },
  {
    name: "itens-por-numped",
    sql: `select
  pcpedi.codprod,
  pcprodut.descricao,
  pcprodut.embalagem,
  pcpedi.qt,
  pcpedi.pvenda,
  (pcpedi.qt * pcpedi.pvenda) as valor_total
from pcpedi, pcprodut
where pcpedi.codprod = pcprodut.codprod
  and pcpedi.numped = :numped`,
    binds: { numped: 121000060 },
  },
];

async function explainQuery(connection, query) {
  const base = query.name.replace(/[^A-Z0-9]/gi, "_").toUpperCase().slice(0, 12);
  const tail = String(Date.now()).slice(-10);
  const statementId = `SGQ_${base}_${tail}`.slice(0, 30);
  const escapedStatementId = statementId.replace(/'/g, "''");
  await connection.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${escapedStatementId}' FOR ${query.sql}`, query.binds);
  const planResult = await connection.execute(
    `SELECT PLAN_TABLE_OUTPUT
       FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, :id, 'BASIC +COST +PREDICATE +BYTES'))`,
    { id: statementId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const lines = (planResult.rows || []).map((row) => row.PLAN_TABLE_OUTPUT);
  try {
    await connection.execute("DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = :id", { id: statementId }, { autoCommit: true });
  } catch {
    // no-op: alguns ambientes não permitem DELETE na PLAN_TABLE compartilhada
  }
  return lines;
}

async function listIndexes(connection) {
  const result = await connection.execute(
    `SELECT table_owner AS owner, table_name, index_name, column_name, column_position
       FROM all_ind_columns
      WHERE table_name IN ('PCCLIENT', 'PCCIDADE', 'PCPEDC', 'PCPEDI', 'PCPRODUT')
        AND column_name IN ('CODCLI', 'CODCIDADE', 'NUMPED', 'CODPROD', 'CGCENT', 'TELENT')
      ORDER BY table_name, index_name, column_position`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows || [];
}

async function main() {
  const connection = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: getConnectString(),
  });

  try {
    const plans = [];
    for (const query of queries) {
      // eslint-disable-next-line no-console
      console.log(`[explain] ${query.name}`);
      const lines = await explainQuery(connection, query);
      plans.push({ query: query.name, lines });
    }

    let indexes = [];
    try {
      indexes = await listIndexes(connection);
    } catch (error) {
      indexes = [{ error: String(error) }];
    }

    const output = {
      generatedAt: new Date().toISOString(),
      queryPlans: plans,
      indexes,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
