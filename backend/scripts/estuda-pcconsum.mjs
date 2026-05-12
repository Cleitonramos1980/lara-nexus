/**
 * Estudo da PCCONSUM — estrutura, valores atuais e colunas disponíveis.
 * Execução: node scripts/estuda-pcconsum.mjs
 */
import oracledb from "oracledb";

const S = "U_CC4UJM_WI";
const CONN = {
  user: "U_CC4UJM_WI",
  password: "AFT5L44D2Z56IZ3E65",
  connectString: "201.157.196.196:1521/CC4UJM_204716_W_high.paas.oracle.com",
};

async function run() {
  const conn = await oracledb.getConnection(CONN);
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

  try {
    // 1. Colunas da PCCONSUM
    console.log("=== COLUNAS DE PCCONSUM ===");
    const cols = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE
         FROM ALL_TAB_COLUMNS
        WHERE OWNER = :owner AND TABLE_NAME = 'PCCONSUM'
        ORDER BY COLUMN_ID`,
      { owner: S },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of cols.rows) {
      console.log(
        `  ${String(r.COLUMN_NAME).padEnd(30)} ${String(r.DATA_TYPE).padEnd(15)} len=${r.DATA_LENGTH ?? "-"} prec=${r.DATA_PRECISION ?? "-"} scale=${r.DATA_SCALE ?? "-"} null=${r.NULLABLE}`
      );
    }

    // 2. Conteúdo atual (todas as linhas — costuma ter 1 linha só)
    console.log("\n=== CONTEÚDO ATUAL DE PCCONSUM ===");
    const data = await conn.execute(
      `SELECT * FROM ${S}.PCCONSUM`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log(JSON.stringify(data.rows, null, 2));

    // 3. Colunas da PCMOVCR
    console.log("\n=== COLUNAS DE PCMOVCR ===");
    const movCols = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE
         FROM ALL_TAB_COLUMNS
        WHERE OWNER = :owner AND TABLE_NAME = 'PCMOVCR'
        ORDER BY COLUMN_ID`,
      { owner: S },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of movCols.rows) {
      console.log(
        `  ${String(r.COLUMN_NAME).padEnd(30)} ${String(r.DATA_TYPE).padEnd(15)} len=${r.DATA_LENGTH ?? "-"} prec=${r.DATA_PRECISION ?? "-"} scale=${r.DATA_SCALE ?? "-"} null=${r.NULLABLE}`
      );
    }

    // 4. Amostra de 3 linhas da PCMOVCR com CODBANCO=1007 (Bradesco)
    console.log("\n=== PCMOVCR — AMOSTRAS CODBANCO=1007 (últimas 5) ===");
    try {
      const sample = await conn.execute(
        `SELECT * FROM ${S}.PCMOVCR WHERE CODBANCO = 1007
           ORDER BY NUMTRANS DESC FETCH FIRST 5 ROWS ONLY`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log(JSON.stringify(sample.rows, null, 2));
    } catch (e) {
      console.log("  erro ao buscar amostras PCMOVCR:", e.message);
    }

    // 5. Amostra de qualquer lançamento recente na PCMOVCR
    console.log("\n=== PCMOVCR — ÚLTIMOS 5 LANÇAMENTOS (qualquer banco) ===");
    try {
      const recent = await conn.execute(
        `SELECT * FROM ${S}.PCMOVCR ORDER BY NUMTRANS DESC FETCH FIRST 5 ROWS ONLY`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log(JSON.stringify(recent.rows, null, 2));
    } catch (e) {
      console.log("  erro ao buscar recentes PCMOVCR:", e.message);
    }

    // 6. Colunas da PCPREST que existem (para confirmar DTBAIXA, CODBANCOBAIXA etc.)
    console.log("\n=== COLUNAS DE PCPREST (verificar DTBAIXA, CODBANCOBAIXA, NUMTRANS, STATUS) ===");
    const prestCols = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
         FROM ALL_TAB_COLUMNS
        WHERE OWNER = :owner AND TABLE_NAME = 'PCPREST'
          AND COLUMN_NAME IN (
            'DTPAG','DTBAIXA','VPAGO','CODBANCO','CODBANCOBAIXA',
            'NUMTRANS','ROTINAPAG','ROTINAFECHA','STATUS',
            'DTULTALTER','OBS','OBS2','FUNCLANC','EQUIPLANC','TIPOPREST'
          )
        ORDER BY COLUMN_ID`,
      { owner: S },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of prestCols.rows) {
      console.log(`  ${String(r.COLUMN_NAME).padEnd(20)} ${String(r.DATA_TYPE).padEnd(15)} null=${r.NULLABLE}`);
    }

    // 7. Verificar constraints/triggers na PCPREST para entender o que elas preenchem
    console.log("\n=== TRIGGERS NA PCPREST ===");
    try {
      const triggers = await conn.execute(
        `SELECT TRIGGER_NAME, TRIGGER_TYPE, TRIGGERING_EVENT, STATUS
           FROM ALL_TRIGGERS
          WHERE OWNER = :owner AND TABLE_NAME = 'PCPREST'`,
        { owner: S },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log(JSON.stringify(triggers.rows, null, 2));
    } catch (e) {
      console.log("  erro ao buscar triggers:", e.message);
    }

  } finally {
    await conn.close();
  }
}

run().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
