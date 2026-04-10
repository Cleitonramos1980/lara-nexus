import { isOracleEnabled } from "../db/oracle.js";
import { queryRows } from "./baseRepository.js";

export interface AuditoriaCartaoErpVenda {
  referenciaErpId: string;
  dataVenda: string;
  horaVenda: string;
  dataHoraVenda: string;
  valorBruto: number;
  valorLiquido: number;
  parcelas: number;
  codfilial: string;
  nsuCv: string;
  autorizacao: string;
  tid: string;
  numeroPedido: string;
  bandeira: string;
  modalidade: string;
  statusVenda: string;
  codCobranca?: string;
  origemConsulta: "VW_AUDITORIA_CARTAO_ERP" | "PCPREST";
}

interface BuscarVendasErpParams {
  periodoInicial: string;
  periodoFinal: string;
  limite?: number;
}

const CODCOB_EXCLUIDOS_CARTAO = [
  "DESD",
  "ESTR",
  "CANC",
  "D",
  "SF",
  "2025",
  "CRED",
  "UMER",
  "CONV",
  "BMLC",
  "756",
  "DEVT",
  "DEVP",
  "UME",
  "BK",
  "C",
  "AFZ",
  "ANTC",
];
const CODCOB_EXCLUIDOS_CARTAO_SQL = CODCOB_EXCLUIDOS_CARTAO.map((item) => `'${item}'`).join(", ");

function normalizarLimite(limite?: number): number {
  const base = Number.isFinite(limite) ? Number(limite) : 250000;
  return Math.max(5000, Math.min(base, 500000));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return "";
}

function toIsoTime(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const hhmm = raw.match(/^(\d{2}):(\d{2})/);
  if (hhmm) return `${hhmm[1]}:${hhmm[2]}`;

  if (/^\d{1,2}$/.test(raw)) return `${pad2(Number(raw))}:00`;

  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const sanitized = raw
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;

  const commaIndex = sanitized.lastIndexOf(",");
  const dotIndex = sanitized.lastIndexOf(".");
  let normalized = sanitized;

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      normalized = sanitized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    const decimalDigits = sanitized.length - commaIndex - 1;
    if (decimalDigits > 0 && decimalDigits <= 2) {
      normalized = sanitized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (dotIndex >= 0) {
    const decimalDigits = sanitized.length - dotIndex - 1;
    if (decimalDigits > 0 && decimalDigits <= 2) {
      normalized = sanitized.replace(/,/g, "");
    } else {
      normalized = sanitized.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.toUpperCase()] = value;
  }
  return normalized;
}

function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const candidate of candidates) {
    if (candidate in row) return row[candidate];
  }
  return undefined;
}

function mapOracleRow(row: Record<string, unknown>, origem: AuditoriaCartaoErpVenda["origemConsulta"]): AuditoriaCartaoErpVenda {
  const normalized = normalizeRow(row);

  const dataVenda =
    toIsoDate(pick(normalized, ["DATA_VENDA", "DTVENDA", "DTFECHA", "DT_EMISSAO", "DTEMISSAO", "DTPAG", "DTMOV"])) ||
    toIsoDate(new Date());

  const horaVenda = toIsoTime(
    pick(normalized, ["HORA_VENDA", "HORA", "HRVENDA", "HORARIO", "DTHORA"]),
  );

  const dataHoraVenda = `${dataVenda}T${horaVenda || "00:00"}:00`;

  const referenciaBase = toText(pick(normalized, ["REFERENCIA_ERP_ID", "ID", "NUMTRANSVENDA", "NUMTRANSACAO", "NUMPED", "IDPREST", "DUPLIC"]));
  const parcelaReferencia = toText(pick(normalized, ["PREST", "PRESTTEF"]));
  const referenciaErpId = referenciaBase
    ? `${referenciaBase}${parcelaReferencia ? `-${parcelaReferencia}` : ""}`
    : `ERP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  return {
    referenciaErpId,
    dataVenda,
    horaVenda,
    dataHoraVenda,
    valorBruto: toNumber(pick(normalized, ["VALOR_BRUTO", "VLRVENDA", "VLR_TOTAL", "VALOR", "VLRPREST"])),
    valorLiquido: toNumber(pick(normalized, ["VALOR_LIQUIDO", "VLRLIQUIDO", "VALOR_RECEBIDO", "VLPAGO"])),
    parcelas: Math.max(0, Math.round(toNumber(pick(normalized, [
      "PARCELAS",
      "NUMPARCELAS",
      "QTDPARC",
      "PARCELA",
      "QTPARCELASPOS",
      "PRESTTEF",
      "PREST",
    ]))),),
    codfilial: toText(pick(normalized, ["CODFILIAL", "FILIAL", "CODFILIALNF", "CODFILIAL_ERP"])),
    nsuCv: toText(pick(normalized, ["NSU_CV", "NSU", "NSUCV", "NUMNSU", "NSUTEF", "NSUHOST"])),
    autorizacao: toText(pick(normalized, ["AUTORIZACAO", "NUM_AUTORIZACAO", "NUMAUT", "AUTO", "CODAUTORIZACAOTEF"])),
    tid: toText(pick(normalized, ["TID"])),
    numeroPedido: toText(pick(normalized, [
      "NUMERO_PEDIDO",
      "NUMPEDIDO",
      "DUPLIC",
      "NUMPED",
      "PEDIDO",
      "NUMTRANSVENDA",
      "NUMTRANSACAO",
      "NUMNOTA",
      "N_NOTA",
    ])),
    bandeira: toText(pick(normalized, ["BANDEIRA", "BANDEIRACARTAO"])),
    modalidade: toText(pick(normalized, ["MODALIDADE", "TIPOPGTO", "TIPO_PAGAMENTO"])),
    statusVenda: toText(pick(normalized, ["STATUS_VENDA", "STATUS", "SITUACAO"])),
    codCobranca: toText(pick(normalized, ["COD_COB", "CODCOB", "COD_COBRANCA"])),
    origemConsulta: origem,
  };
}

function dateInPeriod(dateIso: string, startIso: string, endIso: string): boolean {
  if (!dateIso) return false;
  return dateIso >= startIso && dateIso <= endIso;
}

function dedupe(rows: AuditoriaCartaoErpVenda[]): AuditoriaCartaoErpVenda[] {
  const uniqueByKey = new Map<string, AuditoriaCartaoErpVenda>();

  const rowQualityScore = (row: AuditoriaCartaoErpVenda): number => {
    let score = 0;
    if (row.origemConsulta === "PCPREST") score += 100;
    if (row.codCobranca) score += 20;
    if (row.numeroPedido) score += 10;
    if (row.nsuCv) score += 8;
    if (row.autorizacao) score += 8;
    if (row.tid) score += 6;
    if (row.codfilial) score += 4;
    return score;
  };

  for (const row of rows) {
    const key = [
      row.referenciaErpId,
      row.dataVenda,
      row.valorBruto.toFixed(2),
      String(row.parcelas),
      row.codfilial,
      row.numeroPedido,
      row.nsuCv,
      row.autorizacao,
      row.tid,
    ].join("|");

    const atual = uniqueByKey.get(key);
    if (!atual) {
      uniqueByKey.set(key, row);
      continue;
    }

    if (rowQualityScore(row) > rowQualityScore(atual)) {
      uniqueByKey.set(key, row);
    }
  }

  return Array.from(uniqueByKey.values());
}

function deveIgnorarCodCobranca(row: AuditoriaCartaoErpVenda): boolean {
  return normalizeComparable(row.codCobranca || "") === "DESD";
}

async function buscarPorView(periodoInicial: string, periodoFinal: string): Promise<AuditoriaCartaoErpVenda[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT
      REFERENCIA_ERP_ID,
      DATA_VENDA,
      HORA_VENDA,
      VALOR_BRUTO,
      VALOR_LIQUIDO,
      PARCELAS,
      CODFILIAL,
      NSU_CV,
      AUTORIZACAO,
      TID,
      NUMERO_PEDIDO,
      BANDEIRA,
      MODALIDADE,
      STATUS_VENDA
    FROM VW_AUDITORIA_CARTAO_ERP
    WHERE TRUNC(DATA_VENDA) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')`,
    { periodoInicial, periodoFinal },
  );

  return rows
    .map((row) => mapOracleRow(row, "VW_AUDITORIA_CARTAO_ERP"))
    .filter((row) => dateInPeriod(row.dataVenda, periodoInicial, periodoFinal))
    .filter((row) => !deveIgnorarCodCobranca(row));
}

async function buscarPorPcprest(periodoInicial: string, periodoFinal: string, limite: number): Promise<AuditoriaCartaoErpVenda[]> {
  let rows: Record<string, unknown>[] = [];

  try {
    rows = await queryRows<Record<string, unknown>>(
      `SELECT *
        FROM (
          SELECT p.*
            FROM PCPREST p
            JOIN PCCOB c ON p.CODCOB = c.CODCOB
           WHERE NVL(p.NUMCHECKOUT, 0) <> 0
             AND NVL(p.VALOR, 0) <> 0
             AND p.DTESTORNO IS NULL
             AND p.CODCOB NOT IN (${CODCOB_EXCLUIDOS_CARTAO_SQL})
             AND UPPER(TRIM(p.CODCOB)) NOT LIKE 'PIX%'
             AND (p.DTEMISSAOORIG = p.DTEMISSAO OR p.DTEMISSAOORIG IS NULL)
             AND TRUNC(p.DTFECHA) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')
             AND p.CODFILIAL IN (SELECT f.CODIGO FROM PCFILIAL f)
             AND p.DTCANCEL IS NULL
           ORDER BY p.DTFECHA ASC, p.DUPLIC ASC, p.PREST ASC
        )
       WHERE ROWNUM <= :limite`,
      { periodoInicial, periodoFinal, limite },
    );
  } catch {
    try {
      // Fallback de compatibilidade: alguns ambientes nao possuem DTFECHA.
      rows = await queryRows<Record<string, unknown>>(
        `SELECT *
          FROM (
            SELECT p.*
              FROM PCPREST p
              JOIN PCCOB c ON p.CODCOB = c.CODCOB
             WHERE NVL(p.NUMCHECKOUT, 0) <> 0
               AND NVL(p.VALOR, 0) <> 0
               AND p.DTESTORNO IS NULL
               AND p.CODCOB NOT IN (${CODCOB_EXCLUIDOS_CARTAO_SQL})
               AND UPPER(TRIM(p.CODCOB)) NOT LIKE 'PIX%'
               AND (p.DTEMISSAOORIG = p.DTEMISSAO OR p.DTEMISSAOORIG IS NULL)
               AND TRUNC(p.DTEMISSAO) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')
               AND p.CODFILIAL IN (SELECT f.CODIGO FROM PCFILIAL f)
               AND p.DTCANCEL IS NULL
             ORDER BY p.DTEMISSAO ASC, p.DUPLIC ASC, p.PREST ASC
          )
         WHERE ROWNUM <= :limite`,
        { periodoInicial, periodoFinal, limite },
      );
    } catch {
      // Fallback final: preserva funcionamento com dicionarios legados.
      rows = await queryRows<Record<string, unknown>>(
        `SELECT *
          FROM (
            SELECT p.*
              FROM PCPREST p
              JOIN PCCOB c ON p.CODCOB = c.CODCOB
             WHERE p.CODCOB NOT IN (${CODCOB_EXCLUIDOS_CARTAO_SQL})
               AND TRUNC(p.DTEMISSAO) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')
             ORDER BY p.DTEMISSAO ASC, p.DUPLIC ASC, p.PREST ASC
          )
         WHERE ROWNUM <= :limite`,
        { periodoInicial, periodoFinal, limite },
      );
    }
  }

  return rows
    .map((row) => mapOracleRow(row, "PCPREST"))
    .filter((row) => dateInPeriod(row.dataVenda, periodoInicial, periodoFinal))
    .filter((row) => !deveIgnorarCodCobranca(row));
}

export async function buscarVendasErpConsolidacao(params: BuscarVendasErpParams): Promise<AuditoriaCartaoErpVenda[]> {
  if (!isOracleEnabled()) return [];

  const limite = normalizarLimite(params.limite);
  let viaView: AuditoriaCartaoErpVenda[] = [];
  let viaPcprest: AuditoriaCartaoErpVenda[] = [];
  let erroView: unknown = null;
  let erroPcprest: unknown = null;

  try {
    viaView = await buscarPorView(params.periodoInicial, params.periodoFinal);
  } catch (error) {
    erroView = error;
    viaView = [];
  }

  try {
    viaPcprest = await buscarPorPcprest(params.periodoInicial, params.periodoFinal, limite);
  } catch (error) {
    erroPcprest = error;
    viaPcprest = [];
  }

  if (viaView.length === 0 && viaPcprest.length === 0 && (erroView || erroPcprest)) {
    const viewMsg = erroView instanceof Error ? erroView.message : "falha desconhecida";
    const pcprestMsg = erroPcprest instanceof Error ? erroPcprest.message : "falha desconhecida";
    throw new Error(
      `Falha na consulta Oracle para auditoria de cartao. VIEW: ${viewMsg}. PCPREST: ${pcprestMsg}.`,
    );
  }

  return dedupe([...viaView, ...viaPcprest]);
}

export async function contarVendasErpPcprestPeriodo(periodoInicial: string, periodoFinal: string): Promise<number> {
  if (!isOracleEnabled()) return 0;

  try {
    const rows = await queryRows<Record<string, unknown>>(
      `SELECT COUNT(1) AS TOTAL
         FROM PCPREST p
         JOIN PCCOB c ON p.CODCOB = c.CODCOB
        WHERE NVL(p.NUMCHECKOUT, 0) <> 0
          AND NVL(p.VALOR, 0) <> 0
          AND p.DTESTORNO IS NULL
          AND p.CODCOB NOT IN (${CODCOB_EXCLUIDOS_CARTAO_SQL})
          AND UPPER(TRIM(p.CODCOB)) NOT LIKE 'PIX%'
          AND (p.DTEMISSAOORIG = p.DTEMISSAO OR p.DTEMISSAOORIG IS NULL)
          AND TRUNC(p.DTFECHA) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')
          AND p.CODFILIAL IN (SELECT f.CODIGO FROM PCFILIAL f)
          AND p.DTCANCEL IS NULL`,
      { periodoInicial, periodoFinal },
    );

    const total = Number(rows[0]?.TOTAL ?? rows[0]?.total ?? 0);
    return Number.isFinite(total) ? total : 0;
  } catch {
    try {
      const rows = await queryRows<Record<string, unknown>>(
        `SELECT COUNT(1) AS TOTAL
           FROM PCPREST p
           JOIN PCCOB c ON p.CODCOB = c.CODCOB
          WHERE NVL(p.NUMCHECKOUT, 0) <> 0
            AND NVL(p.VALOR, 0) <> 0
            AND p.DTESTORNO IS NULL
            AND p.CODCOB NOT IN (${CODCOB_EXCLUIDOS_CARTAO_SQL})
            AND UPPER(TRIM(p.CODCOB)) NOT LIKE 'PIX%'
            AND (p.DTEMISSAOORIG = p.DTEMISSAO OR p.DTEMISSAOORIG IS NULL)
            AND TRUNC(p.DTEMISSAO) BETWEEN TO_DATE(:periodoInicial, 'YYYY-MM-DD') AND TO_DATE(:periodoFinal, 'YYYY-MM-DD')
            AND p.CODFILIAL IN (SELECT f.CODIGO FROM PCFILIAL f)
            AND p.DTCANCEL IS NULL`,
        { periodoInicial, periodoFinal },
      );
      const total = Number(rows[0]?.TOTAL ?? rows[0]?.total ?? 0);
      return Number.isFinite(total) ? total : 0;
    } catch {
      return 0;
    }
  }
}
