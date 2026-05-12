import { db } from "../dataStore.js";
import { execDml, queryRows } from "../baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import { findSetorIdByNome, getAuditTimestampColumns, pickFirstExistingColumn, pickOptionalColumn, uid } from "./shared.js";

type SetorSchema = {
  userIdColumn: string;
  ativoColumn: string | null;
  createdAtColumn: string | null;
  updatedAtColumn: string | null;
};

let schemaPromise: Promise<SetorSchema> | null = null;

async function getSetorSchema(): Promise<SetorSchema> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const audit = await getAuditTimestampColumns("INS_USUARIO_SETOR");
      return {
        userIdColumn: await pickFirstExistingColumn("INS_USUARIO_SETOR", ["USUARIO_ID", "USER_ID"]),
        ativoColumn: await pickOptionalColumn("INS_USUARIO_SETOR", ["ATIVO"]),
        createdAtColumn: audit.createdAtColumn,
        updatedAtColumn: audit.updatedAtColumn,
      };
    })();
  }
  return schemaPromise;
}

export async function listSetores(): Promise<string[]> {
  if (!isOracleEnabled()) {
    const seen = new Set<string>();
    for (const model of db.inspecoesModelos) {
      if ((model as any).setor) seen.add((model as any).setor);
    }
    return Array.from(seen).sort();
  }

  const rows = await queryRows<{ NOME: string }>(
    `SELECT NOME
       FROM INS_SETOR
      WHERE ATIVO = 1
      ORDER BY ORDEM, NOME`,
  );
  return rows.map((row) => row.NOME);
}

export async function listUsuarioSetor(): Promise<Array<{ id: string; userId: string; setor: string; ativo: boolean }>> {
  if (!isOracleEnabled()) {
    return db.inspecoesUsuarioSetor.map((item: any) => ({
      id: item.id,
      userId: item.userId,
      setor: item.setor,
      ativo: item.ativo !== false,
    }));
  }

  const schema = await getSetorSchema();
  const rows = await queryRows<{
    ID: string;
    USUARIO_ID: string;
    SETOR: string;
    ATIVO: number;
  }>(
    `SELECT us.ID,
            us.${schema.userIdColumn} AS USUARIO_ID,
            s.NOME AS SETOR,
            ${schema.ativoColumn ? `us.${schema.ativoColumn}` : "1"} AS ATIVO
       FROM INS_USUARIO_SETOR us
       JOIN INS_SETOR s ON s.ID = us.SETOR_ID
      ORDER BY us.${schema.userIdColumn}, s.ORDEM, s.NOME`,
  );

  return rows.map((row) => ({
    id: row.ID,
    userId: row.USUARIO_ID,
    setor: row.SETOR,
    ativo: row.ATIVO === 1,
  }));
}

export async function getSetoresByUserId(userId: string, perfil?: string): Promise<string[]> {
  const perfilNormalizado = (perfil || "").trim().toUpperCase();
  if (perfilNormalizado === "ADMIN" || perfilNormalizado === "DIRETORIA") {
    return listSetores();
  }

  if (!isOracleEnabled()) {
    return db.inspecoesUsuarioSetor
      .filter((item: any) => item.userId === userId && item.ativo !== false)
      .map((item: any) => item.setor);
  }

  const schema = await getSetorSchema();
  const ativoWhere = schema.ativoColumn ? `AND us.${schema.ativoColumn} = 1` : "";
  const rows = await queryRows<{ NOME: string }>(
    `SELECT s.NOME
       FROM INS_USUARIO_SETOR us
       JOIN INS_SETOR s ON s.ID = us.SETOR_ID
      WHERE us.${schema.userIdColumn} = :userId
        ${ativoWhere}
        AND s.ATIVO = 1
      ORDER BY s.ORDEM, s.NOME`,
    { userId },
  );

  return rows.map((row) => row.NOME);
}

export async function addUsuarioSetor(data: {
  id?: string;
  userId: string;
  setor: string;
  ativo?: boolean;
}): Promise<{ id: string; userId: string; setor: string; ativo: boolean }> {
  const id = data.id ?? uid("US");
  const ativo = data.ativo !== false;

  if (!isOracleEnabled()) {
    const payload = { id, userId: data.userId, setor: data.setor, ativo };
    const idx = db.inspecoesUsuarioSetor.findIndex((item: any) => item.id === id);
    if (idx >= 0) db.inspecoesUsuarioSetor[idx] = payload;
    else db.inspecoesUsuarioSetor.push(payload as any);
    return payload;
  }

  const setorId = await findSetorIdByNome(data.setor);
  if (!setorId) {
    throw new Error(`Setor nao encontrado: ${data.setor}`);
  }

  const schema = await getSetorSchema();
  const updateClauses = [
    `t.${schema.userIdColumn} = s.${schema.userIdColumn}`,
    "t.SETOR_ID = s.SETOR_ID",
  ];
  if (schema.ativoColumn) {
    updateClauses.push(`t.${schema.ativoColumn} = s.${schema.ativoColumn}`);
  }
  if (schema.updatedAtColumn) {
    updateClauses.push(`t.${schema.updatedAtColumn} = SYSTIMESTAMP`);
  }

  const insertColumns = ["ID", schema.userIdColumn, "SETOR_ID"];
  const insertValues = [`s.ID`, `s.${schema.userIdColumn}`, "s.SETOR_ID"];
  if (schema.ativoColumn) {
    insertColumns.push(schema.ativoColumn);
    insertValues.push(`s.${schema.ativoColumn}`);
  }
  if (schema.createdAtColumn) {
    insertColumns.push(schema.createdAtColumn);
    insertValues.push("SYSTIMESTAMP");
  }
  if (schema.updatedAtColumn) {
    insertColumns.push(schema.updatedAtColumn);
    insertValues.push("SYSTIMESTAMP");
  }

  const sourceSelect = schema.ativoColumn
    ? `SELECT :id ID, :userId ${schema.userIdColumn}, :setorId SETOR_ID, :ativo ${schema.ativoColumn} FROM dual`
    : `SELECT :id ID, :userId ${schema.userIdColumn}, :setorId SETOR_ID FROM dual`;

  const binds: Record<string, unknown> = {
    id,
    userId: data.userId,
    setorId,
  };
  if (schema.ativoColumn) {
    binds.ativo = ativo ? 1 : 0;
  }

  await execDml(
    `MERGE INTO INS_USUARIO_SETOR t
     USING (${sourceSelect}) s
        ON (t.ID = s.ID)
      WHEN MATCHED THEN UPDATE SET
        ${updateClauses.join(", ")}
      WHEN NOT MATCHED THEN INSERT (
        ${insertColumns.join(", ")}
      ) VALUES (
        ${insertValues.join(", ")}
      )`,
    binds,
  );

  return { id, userId: data.userId, setor: data.setor, ativo };
}

export async function removeUsuarioSetor(id: string): Promise<boolean> {
  if (!isOracleEnabled()) {
    const idx = db.inspecoesUsuarioSetor.findIndex((item: any) => item.id === id);
    if (idx < 0) return false;
    db.inspecoesUsuarioSetor.splice(idx, 1);
    return true;
  }

  await execDml(`DELETE FROM INS_USUARIO_SETOR WHERE ID = :id`, { id });
  return true;
}
