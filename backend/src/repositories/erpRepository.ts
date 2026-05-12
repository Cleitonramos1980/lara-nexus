import { queryRows } from "./baseRepository.js";

type AnyRow = Record<string, unknown>;

const fallback = {
  clientes: [
    { codcli: "1042", nome: "Magazine Luiza", cgcent: "47.960.950/0001-21", telefones: "(92) 3232-1010", cidade: "Manaus", uf: "AM" },
    { codcli: "2081", nome: "Casas Bahia", cgcent: "33.041.260/0001-65", telefones: "(91) 3344-5566", cidade: "Belem", uf: "PA" },
  ],
  pedidos: [
    { numped: "PED-88421", numnf: "NF-112340", codcli: "1042", dtPedido: "2026-01-10", vlrPedido: 1890, status: "FATURADO", canal: "LOJA" },
    { numped: "PED-77312", numnf: "NF-109877", codcli: "2081", dtPedido: "2026-01-15", vlrPedido: 2450, status: "FATURADO", canal: "ECOMMERCE" },
  ],
  itens: [
    { numped: "PED-88421", numnf: "NF-112340", codprod: "COL-QN-001", descricao: "Colchao Queen Premium", un: "UN", qtd: 2, vlrUnit: 789, vlrTotal: 1578 },
    { numped: "PED-77312", numnf: "NF-109877", codprod: "COL-KG-004", descricao: "Colchao King Luxo", un: "UN", qtd: 1, vlrUnit: 2450, vlrTotal: 2450 },
  ],
  nfVenda: [
    { numnf: "NF-112340", serie: "1", chaveNfe: "35260247960950000121550010001123401001123400", dtEmissao: "2026-01-12", codcli: "1042", numped: "PED-88421", vlrTotal: 1890 },
  ],
  nfTroca: [],
  materiais: [
    { codmat: "MAT-001", descricao: "Mola ensacada D33", un: "UN", categoria: "Molas", estoqueDisponivel: 150 },
    { codmat: "MAT-002", descricao: "Espuma D45", un: "M2", categoria: "Espumas", estoqueDisponivel: 320 },
  ],
  estoquePlanta: [
    { codmat: "MAT-001", planta: "MAO", qtdDisponivel: 80 },
    { codmat: "MAT-001", planta: "BEL", qtdDisponivel: 40 },
    { codmat: "MAT-001", planta: "AGR", qtdDisponivel: 30 },
  ],
};

function normalize(rows: AnyRow[]): any[] {
  return rows.map((r) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = k.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      obj[key] = v;
    }
    return obj;
  });
}

export async function getClientes(filters: { nome?: string; cgcent?: string; telefone?: string }) {
  const rows = await queryRows<AnyRow>(
    `SELECT CODCLI, NOME, CGCENT, TELEFONES, CIDADE, UF
       FROM VW_SGQ_CLIENTE
      WHERE (:nome IS NULL OR UPPER(NOME) LIKE '%' || UPPER(:nome) || '%')
        AND (:cgcent IS NULL OR CGCENT LIKE '%' || :cgcent || '%')
        AND (:telefone IS NULL OR TELEFONES LIKE '%' || :telefone || '%')
      FETCH FIRST 100 ROWS ONLY`,
    {
      nome: filters.nome || null,
      cgcent: filters.cgcent || null,
      telefone: filters.telefone || null,
    },
  );
  return rows.length ? normalize(rows) : fallback.clientes;
}

export async function getPedidos(codcli?: string) {
  const rows = await queryRows<AnyRow>(
    `SELECT NUMPED, NUMNF, CODCLI, DT_PEDIDO, VLR_PEDIDO, STATUS, CANAL
       FROM VW_SGQ_PEDIDO
      WHERE (:codcli IS NULL OR CODCLI = :codcli)
      FETCH FIRST 200 ROWS ONLY`,
    { codcli: codcli || null },
  );
  if (rows.length) return normalize(rows).map((r) => ({ ...r, dtPedido: String(r.dtPedido).slice(0, 10) }));
  return codcli ? fallback.pedidos.filter((p) => p.codcli === codcli) : fallback.pedidos;
}

export async function getNfVenda(filters: { codcli?: string; numnf?: string }) {
  const rows = await queryRows<AnyRow>(
    `SELECT NUMNF, SERIE, CHAVE_NFE, DT_EMISSAO, CODCLI, NUMPED, VLR_TOTAL
       FROM VW_SGQ_NF_VENDA
      WHERE (:codcli IS NULL OR CODCLI = :codcli)
        AND (:numnf IS NULL OR NUMNF = :numnf)
      FETCH FIRST 200 ROWS ONLY`,
    { codcli: filters.codcli || null, numnf: filters.numnf || null },
  );
  if (rows.length) return normalize(rows).map((r) => ({ ...r, dtEmissao: String(r.dtEmissao).slice(0, 10) }));
  return fallback.nfVenda;
}

export async function getNfTroca(filters: { codcli?: string; numnf?: string }) {
  const rows = await queryRows<AnyRow>(
    `SELECT NUMNF, SERIE, CHAVE_NFE, DT_EMISSAO, CODCLI, REFERENCIA_TROCA, VLR_TOTAL
       FROM VW_SGQ_NF_TROCA
      WHERE (:codcli IS NULL OR CODCLI = :codcli)
        AND (:numnf IS NULL OR NUMNF = :numnf)
      FETCH FIRST 200 ROWS ONLY`,
    { codcli: filters.codcli || null, numnf: filters.numnf || null },
  );
  if (rows.length) return normalize(rows).map((r) => ({ ...r, dtEmissao: String(r.dtEmissao).slice(0, 10) }));
  return fallback.nfTroca;
}

export async function getPedidoItens(numped?: string) {
  const rows = await queryRows<AnyRow>(
    `SELECT NUMPED, NUMNF, CODPROD, DESCRICAO, UN, QTD, VLR_UNIT, VLR_TOTAL
       FROM VW_SGQ_PEDIDO_ITENS
      WHERE (:numped IS NULL OR NUMPED = :numped)
      FETCH FIRST 500 ROWS ONLY`,
    { numped: numped || null },
  );
  if (rows.length) return normalize(rows);
  return numped ? fallback.itens.filter((i) => i.numped === numped) : fallback.itens;
}

export async function getMateriais(filters: { codigo?: string; descricao?: string; categoria?: string }) {
  const rows = await queryRows<AnyRow>(
    `SELECT CODMAT, DESCRICAO, UN, CATEGORIA, ESTOQUE_DISPONIVEL
       FROM VW_SGQ_MATERIAL
      WHERE (:codigo IS NULL OR CODMAT LIKE '%' || :codigo || '%')
        AND (:descricao IS NULL OR UPPER(DESCRICAO) LIKE '%' || UPPER(:descricao) || '%')
        AND (:categoria IS NULL OR CATEGORIA = :categoria)
      FETCH FIRST 500 ROWS ONLY`,
    {
      codigo: filters.codigo || null,
      descricao: filters.descricao || null,
      categoria: filters.categoria || null,
    },
  );
  return rows.length ? normalize(rows) : fallback.materiais;
}

export async function getEstoquePlanta(codmat?: string) {
  const rows = await queryRows<AnyRow>(
    `SELECT CODMAT, PLANTA, QTD_DISPONIVEL
       FROM VW_SGQ_ESTOQUE_PLANTA
      WHERE (:codmat IS NULL OR CODMAT = :codmat)
      FETCH FIRST 500 ROWS ONLY`,
    { codmat: codmat || null },
  );
  if (rows.length) return normalize(rows);
  return codmat ? fallback.estoquePlanta.filter((e) => e.codmat === codmat) : fallback.estoquePlanta;
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

type SacClienteBuscaParams = {
  codcli?: string;
  cgcent?: string;
  telent?: string;
};

export async function searchSacClientesDirectOracle(params: SacClienteBuscaParams) {
  const codcliRaw = params.codcli?.trim();
  const cgcent = params.cgcent?.trim();
  const telent = params.telent?.trim();
  const codcli = codcliRaw ? Number(codcliRaw) : null;

  if (!codcliRaw && !cgcent && !telent) {
    return [];
  }

  let sql = "";
  const binds: Record<string, unknown> = {};

  if (codcliRaw) {
    if (!Number.isFinite(codcli)) {
      return [];
    }

    sql = `SELECT
             pcclient.codcli AS codcli,
             pcclient.cliente AS cliente,
             pcclient.cgcent AS cgcent,
             pccidade.nomecidade AS nomecidade,
             pcclient.telent AS telefone
           FROM pcclient, pccidade
           WHERE pccidade.codcidade = pcclient.codcidade
             AND pcclient.codcli = :codcli
           FETCH FIRST 100 ROWS ONLY`;
    binds.codcli = codcli;
  } else if (cgcent) {
    sql = `SELECT
             pcclient.codcli AS codcli,
             pcclient.cliente AS cliente,
             pcclient.cgcent AS cgcent,
             pccidade.nomecidade AS nomecidade,
             pcclient.telent AS telefone
           FROM pcclient, pccidade
           WHERE pccidade.codcidade = pcclient.codcidade
             AND pcclient.cgcent = :cgcent
           FETCH FIRST 100 ROWS ONLY`;
    binds.cgcent = cgcent;
  } else {
    sql = `SELECT
             pcclient.codcli AS codcli,
             pcclient.cliente AS cliente,
             pcclient.cgcent AS cgcent,
             pccidade.nomecidade AS nomecidade,
             pcclient.telent AS telefone
           FROM pcclient, pccidade
           WHERE pccidade.codcidade = pcclient.codcidade
             AND pcclient.telent = :telent
           FETCH FIRST 100 ROWS ONLY`;
    binds.telent = telent;
  }

  const rows = await queryRows<AnyRow>(sql, binds);
  return normalize(rows);
}

export async function getPedidosByCodcli(codcli?: string) {
  const cleaned = codcli?.trim();
  if (!cleaned) return [];
  const codcliNumber = Number(cleaned);
  if (!Number.isFinite(codcliNumber)) return [];

  const rows = await queryRows<AnyRow>(
    `SELECT
       pcpedc.numped AS numped,
       pcpedc.numnota AS numnf,
       pcpedc.data AS dt_pedido,
       pcpedc.vltotal AS vlr_pedido,
       pcpedc.posicao AS status,
       pcpedc.origemped AS canal
     FROM pcpedc
     WHERE pcpedc.codcli = :codcli
     FETCH FIRST 500 ROWS ONLY`,
    { codcli: codcliNumber },
  );

  return normalize(rows).map((row) => ({
    numped: row.numped,
    numnf: row.numnf,
    dtPedido: toDateOnly(row.dtPedido),
    vlrPedido: row.vlrPedido,
    status: row.status,
    canal: row.canal,
  }));
}

export async function getItensPedidoByNumped(numped?: string) {
  const cleaned = numped?.trim();
  if (!cleaned) return [];
  const numpedNumber = Number(cleaned);
  if (!Number.isFinite(numpedNumber)) return [];

  const rows = await queryRows<AnyRow>(
    `SELECT
       pcpedi.codprod AS codprod,
       pcprodut.descricao AS descricao,
       pcprodut.embalagem AS un,
       pcpedi.qt AS qtd,
       pcpedi.pvenda AS vlr_unit,
       (pcpedi.qt * pcpedi.pvenda) AS vlr_total
     FROM pcpedi, pcprodut
     WHERE pcpedi.codprod = pcprodut.codprod
       AND pcpedi.numped = :numped
     FETCH FIRST 1000 ROWS ONLY`,
    { numped: numpedNumber },
  );

  return normalize(rows).map((row) => ({
    codprod: row.codprod,
    descricao: row.descricao,
    un: row.un,
    qtd: row.qtd,
    vlrUnit: row.vlrUnit,
    vlrTotal: row.vlrTotal,
  }));
}
