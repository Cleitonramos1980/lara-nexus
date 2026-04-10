import { db } from "../dataStore.js";
import { execDml, queryOne, queryRows } from "../baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import {
  asBool,
  asNumber,
  findSetorIdByNome,
  getAuditTimestampColumns,
  pickOptionalColumn,
  toIso,
  uid,
} from "./shared.js";

interface ModeloRow {
  ID: string;
  NOME: string;
  DESCRICAO: string | null;
  SETOR: string;
  ATIVO: number;
  ORDEM: number;
  CRIADO_EM: string;
  ATUALIZADO_EM: string;
}

interface ModeloItemRow {
  ID: string;
  CODIGO_ITEM: string | null;
  DESCRICAO: string;
  ORDEM: number | null;
  OBRIGATORIO: number;
  EXIGE_EVIDENCIA: number;
  EXIGE_TIPO_NC: number;
  ATIVO: number;
}

type ChecklistSchema = {
  modeloAtivoColumn: string | null;
  itemAtivoColumn: string | null;
  modeloCreatedAtColumn: string | null;
  modeloUpdatedAtColumn: string | null;
  itemCreatedAtColumn: string | null;
  itemUpdatedAtColumn: string | null;
  itemSetorIdColumn: string | null;
  itemCodigoItemColumn: string | null;
  itemOrdemColumn: string | null;
};

let schemaPromise: Promise<ChecklistSchema> | null = null;

async function getChecklistSchema(): Promise<ChecklistSchema> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const modeloAudit = await getAuditTimestampColumns("INS_MODELO_CHECKLIST");
      const itemAudit = await getAuditTimestampColumns("INS_MODELO_CHECKLIST_ITEM");
      return {
        modeloAtivoColumn: await pickOptionalColumn("INS_MODELO_CHECKLIST", ["ATIVO"]),
        itemAtivoColumn: await pickOptionalColumn("INS_MODELO_CHECKLIST_ITEM", ["ATIVO"]),
        modeloCreatedAtColumn: modeloAudit.createdAtColumn,
        modeloUpdatedAtColumn: modeloAudit.updatedAtColumn,
        itemCreatedAtColumn: itemAudit.createdAtColumn,
        itemUpdatedAtColumn: itemAudit.updatedAtColumn,
        itemSetorIdColumn: await pickOptionalColumn("INS_MODELO_CHECKLIST_ITEM", ["SETOR_ID"]),
        itemCodigoItemColumn: await pickOptionalColumn("INS_MODELO_CHECKLIST_ITEM", ["CODIGO_ITEM"]),
        itemOrdemColumn: await pickOptionalColumn("INS_MODELO_CHECKLIST_ITEM", ["ORDEM"]),
      };
    })();
  }
  return schemaPromise;
}

function columnOrNull(columnName: string | null, alias: string): string {
  return columnName ? `${columnName} AS ${alias}` : `NULL AS ${alias}`;
}

function columnOrDefault(columnName: string | null, alias: string, fallback: string): string {
  return columnName ? `${columnName} AS ${alias}` : `${fallback} AS ${alias}`;
}

function pushColumnBinding(
  columns: string[],
  values: string[],
  binds: Record<string, unknown>,
  column: string | null,
  bindKey: string,
  bindValue: unknown,
): void {
  if (!column) return;
  columns.push(column);
  values.push(`:${bindKey}`);
  binds[bindKey] = bindValue;
}

function mapModelFallback(input: any): any {
  return {
    id: input.id,
    nome: input.nome,
    setor: input.setor,
    descricao: input.descricao ?? "",
    ativo: input.ativo !== false,
    ordem: asNumber(input.ordem, 0),
    itens: Array.isArray(input.itens)
      ? input.itens.map((item: any, idx: number) => ({
          id: item.id,
          codigoItem: item.codigoItem ?? `ITEM-${String(asNumber(item.ordem, idx + 1)).padStart(4, "0")}`,
          descricao: item.descricao,
          ordem: asNumber(item.ordem, idx + 1),
          obrigatorio: item.obrigatorio !== false,
          exigeEvidenciaNc: item.exigeEvidenciaNc === true,
          exigeTipoNc: item.exigeTipoNc !== false,
          ativo: item.ativo !== false,
        }))
      : [],
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

async function mapModelFromOracle(row: ModeloRow): Promise<any> {
  const schema = await getChecklistSchema();
  const orderByItems = schema.itemOrdemColumn
    ? (schema.itemCodigoItemColumn ? `${schema.itemOrdemColumn}, ${schema.itemCodigoItemColumn}` : schema.itemOrdemColumn)
    : (schema.itemCodigoItemColumn ? schema.itemCodigoItemColumn : "ID");

  const items = await queryRows<ModeloItemRow>(
    `SELECT ID,
            ${columnOrNull(schema.itemCodigoItemColumn, "CODIGO_ITEM")},
            DESCRICAO,
            ${columnOrNull(schema.itemOrdemColumn, "ORDEM")},
            OBRIGATORIO,
            EXIGE_EVIDENCIA,
            EXIGE_TIPO_NC,
            ${columnOrDefault(schema.itemAtivoColumn, "ATIVO", "1")}
       FROM INS_MODELO_CHECKLIST_ITEM
      WHERE MODELO_ID = :modeloId
      ${schema.itemAtivoColumn ? `AND ${schema.itemAtivoColumn} = 1` : ""}
      ORDER BY ${orderByItems}`,
    { modeloId: row.ID },
  );

  return {
    id: row.ID,
    nome: row.NOME,
    setor: row.SETOR,
    descricao: row.DESCRICAO ?? "",
    ativo: asBool(row.ATIVO),
    ordem: asNumber(row.ORDEM, 0),
    itens: items.map((item) => ({
      id: item.ID,
      codigoItem: item.CODIGO_ITEM ?? item.ID,
      descricao: item.DESCRICAO,
      ordem: asNumber(item.ORDEM, 0),
      obrigatorio: asBool(item.OBRIGATORIO),
      exigeEvidenciaNc: asBool(item.EXIGE_EVIDENCIA),
      exigeTipoNc: asBool(item.EXIGE_TIPO_NC),
      ativo: asBool(item.ATIVO),
    })),
    createdAt: toIso(row.CRIADO_EM),
    updatedAt: toIso(row.ATUALIZADO_EM),
  };
}

export async function listModelos(): Promise<any[]> {
  if (!isOracleEnabled()) {
    return db.inspecoesModelos.map((item: any) => mapModelFallback(item));
  }

  const schema = await getChecklistSchema();
  const createdExpr = schema.modeloCreatedAtColumn
    ? `TO_CHAR(m.${schema.modeloCreatedAtColumn}, 'YYYY-MM-DD"T"HH24:MI:SS')`
    : `TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS')`;
  const updatedExpr = schema.modeloUpdatedAtColumn
    ? `TO_CHAR(m.${schema.modeloUpdatedAtColumn}, 'YYYY-MM-DD"T"HH24:MI:SS')`
    : createdExpr;

  const rows = await queryRows<ModeloRow>(
    `SELECT m.ID,
            m.NOME,
            m.DESCRICAO,
            s.NOME AS SETOR,
            ${schema.modeloAtivoColumn ? `m.${schema.modeloAtivoColumn} AS ATIVO` : "1 AS ATIVO"},
            m.ORDEM,
            ${createdExpr} AS CRIADO_EM,
            ${updatedExpr} AS ATUALIZADO_EM
       FROM INS_MODELO_CHECKLIST m
       JOIN INS_SETOR s ON s.ID = m.SETOR_ID
      ${schema.modeloAtivoColumn ? `WHERE m.${schema.modeloAtivoColumn} = 1` : ""}
      ORDER BY m.ORDEM, m.NOME`,
  );

  const mapped: any[] = [];
  for (const row of rows) {
    mapped.push(await mapModelFromOracle(row));
  }
  return mapped;
}

export async function getModeloById(id: string): Promise<any | null> {
  if (!isOracleEnabled()) {
    const found = db.inspecoesModelos.find((item: any) => item.id === id);
    return found ? mapModelFallback(found) : null;
  }

  const schema = await getChecklistSchema();
  const createdExpr = schema.modeloCreatedAtColumn
    ? `TO_CHAR(m.${schema.modeloCreatedAtColumn}, 'YYYY-MM-DD"T"HH24:MI:SS')`
    : `TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS')`;
  const updatedExpr = schema.modeloUpdatedAtColumn
    ? `TO_CHAR(m.${schema.modeloUpdatedAtColumn}, 'YYYY-MM-DD"T"HH24:MI:SS')`
    : createdExpr;

  const row = await queryOne<ModeloRow>(
    `SELECT m.ID,
            m.NOME,
            m.DESCRICAO,
            s.NOME AS SETOR,
            ${schema.modeloAtivoColumn ? `m.${schema.modeloAtivoColumn} AS ATIVO` : "1 AS ATIVO"},
            m.ORDEM,
            ${createdExpr} AS CRIADO_EM,
            ${updatedExpr} AS ATUALIZADO_EM
       FROM INS_MODELO_CHECKLIST m
       JOIN INS_SETOR s ON s.ID = m.SETOR_ID
      WHERE m.ID = :id`,
    { id },
  );

  return row ? mapModelFromOracle(row) : null;
}

async function upsertModelItems(modeloId: string, setorId: string, items: any[]): Promise<void> {
  const schema = await getChecklistSchema();
  const activeIds = new Set<string>();

  for (const [index, item] of items.entries()) {
    const itemId = item.id ?? uid("ITEM");
    activeIds.add(itemId);

    const ordem = asNumber(item.ordem, index + 1);
    const codigoItem = item.codigoItem ?? `ITEM-${String(ordem).padStart(4, "0")}`;

    const existsRow = await queryOne<{ CNT: number }>(
      `SELECT COUNT(*) AS CNT FROM INS_MODELO_CHECKLIST_ITEM WHERE ID = :id`,
      { id: itemId },
    );
    const exists = asNumber(existsRow?.CNT, 0) > 0;

    if (exists) {
      const updateClauses = [
        "MODELO_ID = :modeloId",
        "DESCRICAO = :descricao",
        "OBRIGATORIO = :obrigatorio",
        "EXIGE_EVIDENCIA = :exigeEvidencia",
        "EXIGE_TIPO_NC = :exigeTipoNc",
        "ATIVO = :ativo",
      ];
      const updateBinds: Record<string, unknown> = {
        id: itemId,
        modeloId,
        descricao: item.descricao,
        obrigatorio: item.obrigatorio === false ? 0 : 1,
        exigeEvidencia: item.exigeEvidenciaNc === true ? 1 : 0,
        exigeTipoNc: item.exigeTipoNc === false ? 0 : 1,
        ativo: item.ativo === false ? 0 : 1,
      };

      if (schema.itemSetorIdColumn) {
        updateClauses.push(`${schema.itemSetorIdColumn} = :setorId`);
        updateBinds.setorId = setorId;
      }
      if (schema.itemCodigoItemColumn) {
        updateClauses.push(`${schema.itemCodigoItemColumn} = :codigoItem`);
        updateBinds.codigoItem = codigoItem;
      }
      if (schema.itemOrdemColumn) {
        updateClauses.push(`${schema.itemOrdemColumn} = :ordem`);
        updateBinds.ordem = ordem;
      }
      if (schema.itemUpdatedAtColumn) {
        updateClauses.push(`${schema.itemUpdatedAtColumn} = SYSTIMESTAMP`);
      }

      await execDml(
        `UPDATE INS_MODELO_CHECKLIST_ITEM
            SET ${updateClauses.join(", ")}
          WHERE ID = :id`,
        updateBinds,
      );
    } else {
      const insertColumns = [
        "ID",
        "MODELO_ID",
        "DESCRICAO",
        "OBRIGATORIO",
        "EXIGE_EVIDENCIA",
        "EXIGE_TIPO_NC",
        "ATIVO",
      ];
      const insertValues = [
        ":id",
        ":modeloId",
        ":descricao",
        ":obrigatorio",
        ":exigeEvidencia",
        ":exigeTipoNc",
        ":ativo",
      ];
      const insertBinds: Record<string, unknown> = {
        id: itemId,
        modeloId,
        descricao: item.descricao,
        obrigatorio: item.obrigatorio === false ? 0 : 1,
        exigeEvidencia: item.exigeEvidenciaNc === true ? 1 : 0,
        exigeTipoNc: item.exigeTipoNc === false ? 0 : 1,
        ativo: item.ativo === false ? 0 : 1,
      };

      pushColumnBinding(insertColumns, insertValues, insertBinds, schema.itemSetorIdColumn, "setorId", setorId);
      pushColumnBinding(insertColumns, insertValues, insertBinds, schema.itemCodigoItemColumn, "codigoItem", codigoItem);
      pushColumnBinding(insertColumns, insertValues, insertBinds, schema.itemOrdemColumn, "ordem", ordem);

      if (schema.itemCreatedAtColumn) {
        insertColumns.push(schema.itemCreatedAtColumn);
        insertValues.push("SYSTIMESTAMP");
      }
      if (schema.itemUpdatedAtColumn) {
        insertColumns.push(schema.itemUpdatedAtColumn);
        insertValues.push("SYSTIMESTAMP");
      }

      await execDml(
        `INSERT INTO INS_MODELO_CHECKLIST_ITEM (${insertColumns.join(", ")})
         VALUES (${insertValues.join(", ")})`,
        insertBinds,
      );
    }
  }

  if (activeIds.size > 0) {
    const deactivateClauses = ["ATIVO = 0"];
    if (schema.itemUpdatedAtColumn) {
      deactivateClauses.push(`${schema.itemUpdatedAtColumn} = SYSTIMESTAMP`);
    }

    await execDml(
      `UPDATE INS_MODELO_CHECKLIST_ITEM
          SET ${deactivateClauses.join(", ")}
        WHERE MODELO_ID = :modeloId
          AND ID NOT IN (${Array.from(activeIds).map((_, i) => `:item_${i}`).join(",")})`,
      {
        modeloId,
        ...Object.fromEntries(Array.from(activeIds).map((activeId, i) => [`item_${i}`, activeId])),
      },
    );
  }
}

export async function createModelo(data: any): Promise<any> {
  const id = data.id ?? uid("MOD");

  if (!isOracleEnabled()) {
    const model = mapModelFallback({
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    db.inspecoesModelos.push(model as any);
    return model;
  }

  const setorId = await findSetorIdByNome(data.setor);
  if (!setorId) throw new Error(`Setor nao encontrado: ${data.setor}`);

  const schema = await getChecklistSchema();
  const columns = ["ID", "NOME", "DESCRICAO", "SETOR_ID", "ORDEM", "ATIVO"];
  const values = [":id", ":nome", ":descricao", ":setorId", ":ordem", ":ativo"];
  if (schema.modeloCreatedAtColumn) {
    columns.push(schema.modeloCreatedAtColumn);
    values.push("SYSTIMESTAMP");
  }
  if (schema.modeloUpdatedAtColumn) {
    columns.push(schema.modeloUpdatedAtColumn);
    values.push("SYSTIMESTAMP");
  }

  await execDml(
    `INSERT INTO INS_MODELO_CHECKLIST (${columns.join(", ")})
     VALUES (${values.join(", ")})`,
    {
      id,
      nome: data.nome,
      descricao: data.descricao ?? "",
      setorId,
      ordem: asNumber(data.ordem, 0),
      ativo: data.ativo === false ? 0 : 1,
    },
  );

  if (Array.isArray(data.itens) && data.itens.length > 0) {
    await upsertModelItems(id, setorId, data.itens);
  }

  const created = await getModeloById(id);
  if (!created) throw new Error("Falha ao carregar modelo criado");
  return created;
}

export async function updateModelo(id: string, data: any): Promise<any | null> {
  if (!isOracleEnabled()) {
    const index = db.inspecoesModelos.findIndex((item: any) => item.id === id);
    if (index < 0) return null;
    const merged = mapModelFallback({
      ...db.inspecoesModelos[index],
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    });
    db.inspecoesModelos[index] = merged;
    return merged;
  }

  const current = await getModeloById(id);
  if (!current) return null;

  const setorName = data.setor ?? current.setor;
  const setorId = await findSetorIdByNome(setorName);
  if (!setorId) throw new Error(`Setor nao encontrado: ${setorName}`);

  const schema = await getChecklistSchema();
  const updateClauses = [
    "NOME = :nome",
    "DESCRICAO = :descricao",
    "SETOR_ID = :setorId",
    "ORDEM = :ordem",
    "ATIVO = :ativo",
  ];
  if (schema.modeloUpdatedAtColumn) {
    updateClauses.push(`${schema.modeloUpdatedAtColumn} = SYSTIMESTAMP`);
  }

  await execDml(
    `UPDATE INS_MODELO_CHECKLIST
        SET ${updateClauses.join(", ")}
      WHERE ID = :id`,
    {
      id,
      nome: data.nome ?? current.nome,
      descricao: data.descricao ?? current.descricao ?? "",
      setorId,
      ordem: asNumber(data.ordem, current.ordem ?? 0),
      ativo: data.ativo === false ? 0 : 1,
    },
  );

  if (Array.isArray(data.itens)) {
    await upsertModelItems(id, setorId, data.itens);
  }

  return getModeloById(id);
}
