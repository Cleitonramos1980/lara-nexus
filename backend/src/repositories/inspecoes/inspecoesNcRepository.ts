import { db } from "../dataStore.js";
import { execDml, queryOne, queryRows } from "../baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import { asBool, findSetorIdByNome, getAuditTimestampColumns, pickOptionalColumn, uid } from "./shared.js";

type NcSchema = {
  createdAtColumn: string | null;
  updatedAtColumn: string | null;
  observacaoColumn: string | null;
  ativoColumn: string | null;
};

let schemaPromise: Promise<NcSchema> | null = null;

async function getNcSchema(): Promise<NcSchema> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const audit = await getAuditTimestampColumns("INS_TIPO_NC");
      return {
        createdAtColumn: audit.createdAtColumn,
        updatedAtColumn: audit.updatedAtColumn,
        observacaoColumn: await pickOptionalColumn("INS_TIPO_NC", ["OBSERVACAO"]),
        ativoColumn: await pickOptionalColumn("INS_TIPO_NC", ["ATIVO"]),
      };
    })();
  }
  return schemaPromise;
}

export async function listTiposNc(): Promise<any[]> {
  if (!isOracleEnabled()) {
    return db.inspecoesTiposNc.map((item: any) => ({
      id: item.id,
      setor: item.setor,
      nome: item.nome,
      categoria: item.categoria ?? "Processo",
      observacao: item.observacao,
      ativo: item.ativo !== false,
    }));
  }

  const schema = await getNcSchema();
  const rows = await queryRows<{
    ID: string;
    SETOR: string;
    NOME: string;
    CATEGORIA: string | null;
    OBSERVACAO: string | null;
    ATIVO: number;
  }>(
    `SELECT t.ID,
            s.NOME AS SETOR,
            t.NOME,
            t.CATEGORIA,
            ${schema.observacaoColumn ? `t.${schema.observacaoColumn}` : "NULL"} AS OBSERVACAO,
            ${schema.ativoColumn ? `t.${schema.ativoColumn}` : "1"} AS ATIVO
       FROM INS_TIPO_NC t
       JOIN INS_SETOR s ON s.ID = t.SETOR_ID
      ORDER BY s.ORDEM, s.NOME, t.NOME`,
  );

  return rows.map((row) => ({
    id: row.ID,
    setor: row.SETOR,
    nome: row.NOME,
    categoria: row.CATEGORIA ?? "Processo",
    observacao: row.OBSERVACAO ?? undefined,
    ativo: asBool(row.ATIVO),
  }));
}

export async function createTipoNc(data: any): Promise<any> {
  const id = data.id ?? uid("TNC");

  if (!isOracleEnabled()) {
    const payload = {
      id,
      setor: data.setor,
      nome: data.nome,
      categoria: data.categoria ?? "Processo",
      observacao: data.observacao,
      ativo: data.ativo !== false,
    };
    db.inspecoesTiposNc.push(payload as any);
    return payload;
  }

  const setorId = await findSetorIdByNome(data.setor);
  if (!setorId) throw new Error(`Setor nao encontrado: ${data.setor}`);

  const schema = await getNcSchema();
  const columns = ["ID", "SETOR_ID", "NOME", "CATEGORIA"];
  const values = [":id", ":setorId", ":nome", ":categoria"];
  const binds: Record<string, unknown> = {
    id,
    setorId,
    nome: data.nome,
    categoria: data.categoria ?? "Processo",
  };
  if (schema.observacaoColumn) {
    columns.push(schema.observacaoColumn);
    values.push(":observacao");
    binds.observacao = data.observacao ?? null;
  }
  if (schema.ativoColumn) {
    columns.push(schema.ativoColumn);
    values.push(":ativo");
    binds.ativo = data.ativo === false ? 0 : 1;
  }
  if (schema.createdAtColumn) {
    columns.push(schema.createdAtColumn);
    values.push("SYSTIMESTAMP");
  }
  if (schema.updatedAtColumn) {
    columns.push(schema.updatedAtColumn);
    values.push("SYSTIMESTAMP");
  }

  await execDml(
    `INSERT INTO INS_TIPO_NC (${columns.join(", ")})
     VALUES (${values.join(", ")})`,
    binds,
  );

  return {
    id,
    setor: data.setor,
    nome: data.nome,
    categoria: data.categoria ?? "Processo",
    observacao: data.observacao,
    ativo: data.ativo !== false,
  };
}

export async function updateTipoNc(id: string, data: any): Promise<any | null> {
  if (!isOracleEnabled()) {
    const idx = db.inspecoesTiposNc.findIndex((item: any) => item.id === id);
    if (idx < 0) return null;
    const merged = {
      ...db.inspecoesTiposNc[idx],
      ...data,
      id,
      ativo: data.ativo ?? db.inspecoesTiposNc[idx].ativo ?? true,
    };
    db.inspecoesTiposNc[idx] = merged;
    return merged;
  }

  const schema = await getNcSchema();
  const current = await queryOne<{
    ID: string;
    SETOR_ID: string;
    NOME: string;
    CATEGORIA: string | null;
    OBSERVACAO: string | null;
    ATIVO: number;
  }>(
    `SELECT ID,
            SETOR_ID,
            NOME,
            CATEGORIA,
            ${schema.observacaoColumn ? schema.observacaoColumn : "NULL"} AS OBSERVACAO,
            ${schema.ativoColumn ? schema.ativoColumn : "1"} AS ATIVO
       FROM INS_TIPO_NC
      WHERE ID = :id`,
    { id },
  );

  if (!current) return null;

  const setorId = data.setor
    ? await findSetorIdByNome(data.setor)
    : current.SETOR_ID;

  if (!setorId) throw new Error(`Setor nao encontrado: ${data.setor}`);

  const updateClauses = [
    "SETOR_ID = :setorId",
    "NOME = :nome",
    "CATEGORIA = :categoria",
  ];
  if (schema.observacaoColumn) {
    updateClauses.push(`${schema.observacaoColumn} = :observacao`);
  }
  if (schema.ativoColumn) {
    updateClauses.push(`${schema.ativoColumn} = :ativo`);
  }
  if (schema.updatedAtColumn) {
    updateClauses.push(`${schema.updatedAtColumn} = SYSTIMESTAMP`);
  }

  await execDml(
    `UPDATE INS_TIPO_NC
        SET ${updateClauses.join(", ")}
      WHERE ID = :id`,
    {
      id,
      setorId,
      nome: data.nome ?? current.NOME,
      categoria: data.categoria ?? current.CATEGORIA ?? "Processo",
      observacao: data.observacao ?? current.OBSERVACAO,
      ativo: data.ativo === undefined ? current.ATIVO : data.ativo ? 1 : 0,
    },
  );

  const setorNomeRow = await queryOne<{ NOME: string }>(`SELECT NOME FROM INS_SETOR WHERE ID = :id`, { id: setorId });
  return {
    id,
    setor: setorNomeRow?.NOME ?? data.setor,
    nome: data.nome ?? current.NOME,
    categoria: data.categoria ?? current.CATEGORIA ?? "Processo",
    observacao: data.observacao ?? current.OBSERVACAO ?? undefined,
    ativo: schema.ativoColumn
      ? (data.ativo === undefined ? asBool(current.ATIVO) : Boolean(data.ativo))
      : true,
  };
}
