import oracledb from "oracledb";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const conn = await oracledb.getConnection({
  user: "U_CC4UJM_WI",
  password: "AFT5L44D2Z56IZ3E65",
  connectString: "201.157.196.196:1521/CC4UJM_204716_W_high.paas.oracle.com",
});

const S = "U_CC4UJM_WI";

// 1. STATUS possíveis em PCPREST e quantidade
console.log("=== STATUS em PCPREST ===");
const s1 = await conn.execute(
  `SELECT STATUS, COUNT(*) QTD, SUM(VALOR) TOTAL_VALOR
   FROM ${S}.PCPREST
   GROUP BY STATUS ORDER BY QTD DESC`
);
for (const r of s1.rows) console.log("  STATUS='" + r.STATUS + "'  QTD=" + r.QTD + "  TOTAL=" + (r.TOTAL_VALOR||0).toFixed(2));

// 2. Títulos em aberto (não pagos) — STATUS A = aberto
console.log("\n=== TITULOS EM ABERTO (STATUS='A') ===");
const s2 = await conn.execute(
  `SELECT COUNT(*) QTD, SUM(VALOR) TOTAL, MIN(DTVENC) MAIS_ANTIGO, MAX(DTVENC) MAIS_NOVO
   FROM ${S}.PCPREST WHERE STATUS = 'A'`
);
console.log("  " + JSON.stringify(s2.rows[0]));

// 3. Amostra de títulos em aberto com dados do cliente
console.log("\n=== AMOSTRA TITULOS EM ABERTO (10 linhas) ===");
const s3 = await conn.execute(
  `SELECT p.CODCLI, p.NUMTRANSVENDA, p.DUPLIC, p.PREST, p.VALOR, p.DTVENC, p.DTEMISSAO,
          p.CODCOB, p.CODFILIAL, p.STATUS, p.DTDESD,
          TRUNC(SYSDATE - p.DTVENC) DIAS_ATRASO,
          c.CLIENTE, c.TELCOB, c.TELENT1, c.EMAIL
   FROM ${S}.PCPREST p
   JOIN ${S}.PCCLIENT c ON c.CODCLI = p.CODCLI
   WHERE p.STATUS = 'A' AND p.DTVENC < SYSDATE
   ORDER BY p.DTVENC ASC
   FETCH FIRST 10 ROWS ONLY`
).catch(e => ({ rows: [], error: e.message }));
if (s3.error) console.log("Erro:", s3.error);
else for (const r of s3.rows) console.log("  " + JSON.stringify(r));

// 4. Campos de telefone/contato em PCCLIENT com dados reais
console.log("\n=== CLIENTES COM TELEFONE (amostra 5) ===");
const s4 = await conn.execute(
  `SELECT CODCLI, CLIENTE, CGCENT, TELCOB, TELENT1, TELENT, FAXCLI, EMAIL, EMAILCOB,
          DTULTCOMP, BLOQUEIO, LIMCRED, CODCOB
   FROM ${S}.PCCLIENT
   WHERE TELENT1 IS NOT NULL OR TELCOB IS NOT NULL
   FETCH FIRST 5 ROWS ONLY`
).catch(e => ({ rows: [], error: e.message }));
if (s4.error) console.log("Erro:", s4.error);
else for (const r of s4.rows) console.log("  " + JSON.stringify(r));

// 5. Verificar se PCCLIENT tem campo WHATSAPP ou celular
console.log("\n=== CAMPOS TELEFONE/CELULAR/WHATSAPP EM PCCLIENT ===");
const s5 = await conn.execute(
  `SELECT column_name, data_type, data_length
   FROM all_tab_columns
   WHERE table_name = 'PCCLIENT' AND owner = :s
   AND (UPPER(column_name) LIKE '%WHATS%' OR UPPER(column_name) LIKE '%CEL%'
        OR UPPER(column_name) LIKE '%FONE%' OR UPPER(column_name) LIKE '%TEL%'
        OR UPPER(column_name) LIKE '%CELULAR%')
   ORDER BY column_id`,
  { s: S }
);
for (const r of s5.rows) console.log("  " + r.COLUMN_NAME.padEnd(30) + " " + r.DATA_TYPE + "(" + r.DATA_LENGTH + ")");

// 6. Títulos em aberto por filial
console.log("\n=== TITULOS EM ABERTO POR FILIAL ===");
const s6 = await conn.execute(
  `SELECT CODFILIAL, COUNT(*) QTD, SUM(VALOR) TOTAL
   FROM ${S}.PCPREST WHERE STATUS = 'A'
   GROUP BY CODFILIAL ORDER BY TOTAL DESC FETCH FIRST 10 ROWS ONLY`
).catch(e => ({ rows: [], error: e.message }));
if (s6.error) console.log("Erro:", s6.error);
else for (const r of s6.rows) console.log("  FILIAL=" + r.CODFILIAL + "  QTD=" + r.QTD + "  TOTAL=" + (r.TOTAL||0).toFixed(2));

// 7. Como a Lara atual busca — verificar query em oracleRepository
// PCMOVCR é de movimentos de caixa, não de cobrança. Confirmar se PCPREST é a tabela correta
console.log("\n=== CONFIRMAR: PCMOVCR é caixa (não cobrança direta) ===");
const s7 = await conn.execute(
  `SELECT TIPO, CODCOB, COUNT(*) QTD
   FROM ${S}.PCMOVCR
   GROUP BY TIPO, CODCOB ORDER BY QTD DESC FETCH FIRST 10 ROWS ONLY`
);
for (const r of s7.rows) console.log("  TIPO=" + r.TIPO + " CODCOB=" + r.CODCOB + " QTD=" + r.QTD);

// 8. Total de clientes com algum título em aberto
console.log("\n=== CLIENTES COM TITULOS EM ABERTO ===");
const s8 = await conn.execute(
  `SELECT COUNT(DISTINCT CODCLI) QTD_CLIENTES,
          SUM(VALOR) TOTAL_CARTEIRA
   FROM ${S}.PCPREST WHERE STATUS = 'A'`
);
console.log("  " + JSON.stringify(s8.rows[0]));

// 9. Distribuição por faixa de atraso
console.log("\n=== DISTRIBUICAO POR DIAS DE ATRASO (titulos em aberto) ===");
const s9 = await conn.execute(
  `SELECT
     CASE
       WHEN DTVENC >= SYSDATE THEN 'A vencer'
       WHEN DTVENC >= SYSDATE - 30 THEN '1-30 dias'
       WHEN DTVENC >= SYSDATE - 60 THEN '31-60 dias'
       WHEN DTVENC >= SYSDATE - 90 THEN '61-90 dias'
       WHEN DTVENC >= SYSDATE - 180 THEN '91-180 dias'
       ELSE 'Mais de 180 dias'
     END FAIXA,
     COUNT(*) QTD, SUM(VALOR) TOTAL
   FROM ${S}.PCPREST WHERE STATUS = 'A'
   GROUP BY
     CASE
       WHEN DTVENC >= SYSDATE THEN 'A vencer'
       WHEN DTVENC >= SYSDATE - 30 THEN '1-30 dias'
       WHEN DTVENC >= SYSDATE - 60 THEN '31-60 dias'
       WHEN DTVENC >= SYSDATE - 90 THEN '61-90 dias'
       WHEN DTVENC >= SYSDATE - 180 THEN '91-180 dias'
       ELSE 'Mais de 180 dias'
     END
   ORDER BY MIN(DTVENC)`
).catch(e => ({ rows: [], error: e.message }));
if (s9.error) console.log("Erro:", s9.error);
else for (const r of s9.rows) console.log("  " + r.FAIXA.padEnd(18) + " QTD=" + r.QTD + "  TOTAL=" + (r.TOTAL||0).toFixed(2));

await conn.close();
console.log("\n>>> Consultas concluidas.");
