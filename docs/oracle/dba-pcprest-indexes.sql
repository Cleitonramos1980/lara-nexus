-- ============================================================
-- ÍNDICES ORACLE PARA PERFORMANCE DO SISTEMA LARA
-- Execute como DBA (usuário com CREATE INDEX em PCPREST/PCCLIENT)
-- Todos os índices são criados com NOPARALLEL e ONLINE quando possível
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. PCPREST — Tabela de Títulos/Prestações (mais crítica)
-- ────────────────────────────────────────────────────────────
-- A Lara busca títulos por cliente com filtros em DTPAG, CODCOB e DTVENC.
-- Sem este índice: full scan em toda PCPREST a cada query de cliente.

-- Índice principal: cobre a maioria das queries da Lara
CREATE INDEX IDX_PCPREST_LARA_CODCLI
  ON PCPREST (CODCLI, DTPAG, CODCOB, DTVENC)
  TABLESPACE INDX
  NOPARALLEL;

-- Índice por CODCOB (filtra carteiras da Lara: 422, 756, BK, etc.)
CREATE INDEX IDX_PCPREST_LARA_CODCOB
  ON PCPREST (CODCOB, DTPAG, DTVENC, CODCLI)
  TABLESPACE INDX
  NOPARALLEL;

-- ────────────────────────────────────────────────────────────
-- 2. PCCLIENT — Tabela de Clientes
-- ────────────────────────────────────────────────────────────
-- Busca por telefone para identificar clientes de inbound WhatsApp

CREATE INDEX IDX_PCCLIENT_LARA_FONE
  ON PCCLIENT (FONE, CODCLI)
  TABLESPACE INDX
  NOPARALLEL;

CREATE INDEX IDX_PCCLIENT_LARA_FONE2
  ON PCCLIENT (FONE2, CODCLI)
  TABLESPACE INDX
  NOPARALLEL;

-- ────────────────────────────────────────────────────────────
-- 3. Verificar se os índices foram criados corretamente
-- ────────────────────────────────────────────────────────────
SELECT INDEX_NAME, TABLE_NAME, STATUS, LAST_ANALYZED
FROM USER_INDEXES
WHERE TABLE_NAME IN ('PCPREST', 'PCCLIENT')
  AND INDEX_NAME LIKE 'IDX_PCPREST_LARA%'
     OR INDEX_NAME LIKE 'IDX_PCCLIENT_LARA%'
ORDER BY TABLE_NAME, INDEX_NAME;

-- ────────────────────────────────────────────────────────────
-- 4. Coletar estatísticas após criar os índices
-- (Necessário para o otimizador Oracle usar os índices)
-- ────────────────────────────────────────────────────────────
BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname          => USER,
    tabname          => 'PCPREST',
    estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE,
    cascade          => TRUE,
    degree           => 4
  );
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname          => USER,
    tabname          => 'PCCLIENT',
    estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE,
    cascade          => TRUE,
    degree           => 4
  );
END;
/

-- ────────────────────────────────────────────────────────────
-- 5. Verificar plano de execução ANTES e DEPOIS (opcional)
-- Rode antes de criar os índices para comparar
-- ────────────────────────────────────────────────────────────
EXPLAIN PLAN FOR
  SELECT CODCLI, NUMTRANSVENDA, DTVENC, VALOR, DTPAG, DUPLICATA, PRESTACAO
  FROM PCPREST
  WHERE CODCLI = 12345
    AND DTPAG IS NULL
    AND CODCOB IN ('422', '756', 'BK')
  ORDER BY DTVENC;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
-- Esperado após índice: "INDEX RANGE SCAN" em vez de "TABLE ACCESS FULL"
