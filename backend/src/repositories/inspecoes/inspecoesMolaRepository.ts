import { db } from "../dataStore.js";
import { execDml, queryOne, queryRows } from "../baseRepository.js";
import { isOracleEnabled } from "../../db/oracle.js";
import {
  asBool,
  asNumber,
  getAuditTimestampColumns,
  pickFirstExistingColumn,
  pickOptionalColumn,
  toIso,
  uid,
} from "./shared.js";

type PadraoRow = {
  ID: string;
  ALTURA_TIPO: string;
  ITEM: string;
  DESCRICAO: string;
  PADRAO: string | null;
  MINIMO: number | null;
  MAXIMO: number | null;
  UNIDADE: string | null;
  ATIVO: number;
};

type MolaRow = {
  ID: string;
  CODIGO: string;
  MAQUINA_CODIGO: string;
  STATUS_MAQUINA: string;
  ALTURA_TIPO: string | null;
  LINHA_POCKET: string | null;
  OPERADOR_NOME: string | null;
  DATA_HORA: string;
  OBSERVACAO_GERAL: string | null;
  RESULTADO: string;
  MOTIVO_PARADA: string | null;
};

type MolaAmostraRow = {
  ID: string;
  PADRAO_ID: string;
  ITEM: string | null;
  DESCRICAO: string | null;
  PADRAO: string | null;
  MINIMO: number | null;
  MAXIMO: number | null;
  UNIDADE: string | null;
  VALOR_MEDIDO: number | null;
  CONFORME: number | null;
};

type MolaSchema = {
  padraoUpdatedAtColumn: string | null;
  padraoCreatedAtColumn: string | null;
  inspecaoCodigoColumn: string | null;
  inspecaoDateColumn: string;
  inspecaoOperadorNomeColumn: string;
  inspecaoOperadorUsuarioIdColumn: string | null;
  inspecaoObsColumn: string;
  inspecaoUpdatedAtColumn: string | null;
  inspecaoCreatedAtColumn: string | null;
  amostraCreatedAtColumn: string | null;
};

let schemaPromise: Promise<MolaSchema> | null = null;

async function getMolaSchema(): Promise<MolaSchema> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const padraoAudit = await getAuditTimestampColumns("INS_MOLA_PADRAO");
      const inspecaoAudit = await getAuditTimestampColumns("INS_MOLA_INSPECAO");
      const amostraAudit = await getAuditTimestampColumns("INS_MOLA_INSPECAO_AMOSTRA");

      return {
        padraoUpdatedAtColumn: padraoAudit.updatedAtColumn,
        padraoCreatedAtColumn: padraoAudit.createdAtColumn,
        inspecaoCodigoColumn: await pickOptionalColumn("INS_MOLA_INSPECAO", ["CODIGO"]),
        inspecaoDateColumn: await pickFirstExistingColumn("INS_MOLA_INSPECAO", ["DATA_HORA", "DATA_INSPECAO"]),
        inspecaoOperadorNomeColumn: await pickFirstExistingColumn("INS_MOLA_INSPECAO", ["OPERADOR_NOME", "INSPETOR"]),
        inspecaoOperadorUsuarioIdColumn: await pickOptionalColumn("INS_MOLA_INSPECAO", ["OPERADOR_USUARIO_ID"]),
        inspecaoObsColumn: await pickFirstExistingColumn("INS_MOLA_INSPECAO", ["OBSERVACAO_GERAL", "OBSERVACOES"]),
        inspecaoUpdatedAtColumn: inspecaoAudit.updatedAtColumn,
        inspecaoCreatedAtColumn: inspecaoAudit.createdAtColumn,
        amostraCreatedAtColumn: amostraAudit.createdAtColumn,
      };
    })();
  }
  return schemaPromise;
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

function mapFallbackPadrao(item: any): any {
  return {
    id: item.id,
    alturaTipo: item.alturaTipo,
    item: item.item,
    descricao: item.descricao,
    padrao: item.padrao ?? "",
    minimo: asNumber(item.minimo, 0),
    maximo: asNumber(item.maximo, 0),
    unidade: item.unidade ?? "",
    ativo: item.ativo !== false,
  };
}

function mapFallbackInspecao(item: any): any {
  return {
    id: item.id,
    maquina: item.maquina,
    statusMaquina: item.statusMaquina ?? "Operando",
    alturaTipo: item.alturaTipo ?? "",
    linhaPocket: item.linhaPocket ?? "",
    operador: item.operador ?? item.inspetor ?? "",
    dataHora: item.dataHora ?? new Date().toISOString(),
    observacaoGeral: item.observacaoGeral ?? item.observacoes,
    resultado: item.resultado ?? "APROVADO",
    motivoParada: item.motivoParada,
    medicoes: Array.isArray(item.medicoes)
      ? item.medicoes
      : Array.isArray(item.amostras)
        ? item.amostras
        : [],
  };
}

export async function listPadroesMola(): Promise<any[]> {
  if (!isOracleEnabled()) {
    return db.inspecoesPadroesMola.map((item: any) => mapFallbackPadrao(item));
  }

  const rows = await queryRows<PadraoRow>(
    `SELECT ID,
            ALTURA_TIPO,
            ITEM,
            DESCRICAO,
            PADRAO,
            MINIMO,
            MAXIMO,
            UNIDADE,
            ATIVO
       FROM INS_MOLA_PADRAO
      ORDER BY ALTURA_TIPO, ITEM`,
  );

  return rows.map((row) => ({
    id: row.ID,
    alturaTipo: row.ALTURA_TIPO,
    item: row.ITEM,
    descricao: row.DESCRICAO,
    padrao: row.PADRAO ?? "",
    minimo: asNumber(row.MINIMO, 0),
    maximo: asNumber(row.MAXIMO, 0),
    unidade: row.UNIDADE ?? "",
    ativo: asBool(row.ATIVO),
  }));
}

export async function createPadraoMola(data: any): Promise<any> {
  const id = data.id ?? uid("PM");

  if (!isOracleEnabled()) {
    const payload = mapFallbackPadrao({ ...data, id });
    db.inspecoesPadroesMola.push(payload as any);
    return payload;
  }

  const schema = await getMolaSchema();
  const columns = ["ID", "ALTURA_TIPO", "ITEM", "DESCRICAO", "PADRAO", "MINIMO", "MAXIMO", "UNIDADE", "ATIVO"];
  const values = [":id", ":alturaTipo", ":item", ":descricao", ":padrao", ":minimo", ":maximo", ":unidade", ":ativo"];
  const binds: Record<string, unknown> = {
    id,
    alturaTipo: data.alturaTipo,
    item: data.item,
    descricao: data.descricao,
    padrao: data.padrao ?? "",
    minimo: data.minimo ?? 0,
    maximo: data.maximo ?? 0,
    unidade: data.unidade ?? "",
    ativo: data.ativo === false ? 0 : 1,
  };

  if (schema.padraoCreatedAtColumn) {
    columns.push(schema.padraoCreatedAtColumn);
    values.push("SYSTIMESTAMP");
  }
  if (schema.padraoUpdatedAtColumn) {
    columns.push(schema.padraoUpdatedAtColumn);
    values.push("SYSTIMESTAMP");
  }

  await execDml(
    `INSERT INTO INS_MOLA_PADRAO (${columns.join(", ")})
     VALUES (${values.join(", ")})`,
    binds,
  );

  return {
    id,
    alturaTipo: data.alturaTipo,
    item: data.item,
    descricao: data.descricao,
    padrao: data.padrao ?? "",
    minimo: data.minimo ?? 0,
    maximo: data.maximo ?? 0,
    unidade: data.unidade ?? "",
    ativo: data.ativo !== false,
  };
}

export async function updatePadraoMola(id: string, data: any): Promise<any | null> {
  if (!isOracleEnabled()) {
    const idx = db.inspecoesPadroesMola.findIndex((item: any) => item.id === id);
    if (idx < 0) return null;
    const merged = mapFallbackPadrao({ ...db.inspecoesPadroesMola[idx], ...data, id });
    db.inspecoesPadroesMola[idx] = merged;
    return merged;
  }

  const current = await queryOne<PadraoRow>(
    `SELECT ID, ALTURA_TIPO, ITEM, DESCRICAO, PADRAO, MINIMO, MAXIMO, UNIDADE, ATIVO
       FROM INS_MOLA_PADRAO
      WHERE ID = :id`,
    { id },
  );
  if (!current) return null;

  const schema = await getMolaSchema();
  const updateClauses = [
    "ALTURA_TIPO = :alturaTipo",
    "ITEM = :item",
    "DESCRICAO = :descricao",
    "PADRAO = :padrao",
    "MINIMO = :minimo",
    "MAXIMO = :maximo",
    "UNIDADE = :unidade",
    "ATIVO = :ativo",
  ];
  if (schema.padraoUpdatedAtColumn) {
    updateClauses.push(`${schema.padraoUpdatedAtColumn} = SYSTIMESTAMP`);
  }

  await execDml(
    `UPDATE INS_MOLA_PADRAO
        SET ${updateClauses.join(", ")}
      WHERE ID = :id`,
    {
      id,
      alturaTipo: data.alturaTipo ?? current.ALTURA_TIPO,
      item: data.item ?? current.ITEM,
      descricao: data.descricao ?? current.DESCRICAO,
      padrao: data.padrao ?? current.PADRAO ?? "",
      minimo: data.minimo ?? current.MINIMO ?? 0,
      maximo: data.maximo ?? current.MAXIMO ?? 0,
      unidade: data.unidade ?? current.UNIDADE ?? "",
      ativo: data.ativo === undefined ? current.ATIVO : data.ativo ? 1 : 0,
    },
  );

  return {
    id,
    alturaTipo: data.alturaTipo ?? current.ALTURA_TIPO,
    item: data.item ?? current.ITEM,
    descricao: data.descricao ?? current.DESCRICAO,
    padrao: data.padrao ?? current.PADRAO ?? "",
    minimo: data.minimo ?? current.MINIMO ?? 0,
    maximo: data.maximo ?? current.MAXIMO ?? 0,
    unidade: data.unidade ?? current.UNIDADE ?? "",
    ativo: data.ativo === undefined ? asBool(current.ATIVO) : Boolean(data.ativo),
  };
}

async function loadMedicoes(inspecaoId: string): Promise<any[]> {
  const rows = await queryRows<MolaAmostraRow>(
    `SELECT ID,
            PADRAO_ID,
            ITEM,
            DESCRICAO,
            PADRAO,
            MINIMO,
            MAXIMO,
            UNIDADE,
            VALOR_MEDIDO,
            CONFORME
       FROM INS_MOLA_INSPECAO_AMOSTRA
      WHERE INSPECAO_ID = :inspecaoId
      ORDER BY ITEM, ID`,
    { inspecaoId },
  );

  return rows.map((row) => ({
    id: row.ID,
    padraoId: row.PADRAO_ID,
    item: row.ITEM ?? "",
    descricao: row.DESCRICAO ?? "",
    padrao: row.PADRAO ?? "",
    minimo: asNumber(row.MINIMO, 0),
    maximo: asNumber(row.MAXIMO, 0),
    unidade: row.UNIDADE ?? "",
    valorMedido: asNumber(row.VALOR_MEDIDO, 0),
    conforme: asBool(row.CONFORME),
  }));
}

async function loadInspecao(id: string): Promise<any | null> {
  const schema = await getMolaSchema();
  const row = await queryOne<MolaRow>(
    `SELECT ID,
            ${schema.inspecaoCodigoColumn ?? "ID"} AS CODIGO,
            MAQUINA_CODIGO,
            STATUS_MAQUINA,
            ALTURA_TIPO,
            LINHA_POCKET,
            ${schema.inspecaoOperadorNomeColumn} AS OPERADOR_NOME,
            TO_CHAR(${schema.inspecaoDateColumn}, 'YYYY-MM-DD"T"HH24:MI:SS') AS DATA_HORA,
            ${schema.inspecaoObsColumn} AS OBSERVACAO_GERAL,
            RESULTADO,
            MOTIVO_PARADA
       FROM INS_MOLA_INSPECAO
      WHERE ID = :id`,
    { id },
  );

  if (!row) return null;

  return {
    id: row.ID,
    maquina: row.MAQUINA_CODIGO,
    statusMaquina: row.STATUS_MAQUINA as any,
    alturaTipo: row.ALTURA_TIPO ?? "",
    linhaPocket: row.LINHA_POCKET ?? "",
    operador: row.OPERADOR_NOME ?? "",
    dataHora: toIso(row.DATA_HORA),
    observacaoGeral: row.OBSERVACAO_GERAL ?? undefined,
    resultado: row.RESULTADO as any,
    motivoParada: row.MOTIVO_PARADA ?? undefined,
    medicoes: await loadMedicoes(row.ID),
  };
}

export async function listInspecoesMola(): Promise<any[]> {
  if (!isOracleEnabled()) {
    return db.inspecoesMola.map((item: any) => mapFallbackInspecao(item));
  }

  const schema = await getMolaSchema();
  const rows = await queryRows<{ ID: string }>(
    `SELECT ID
       FROM INS_MOLA_INSPECAO
      ORDER BY ${schema.inspecaoDateColumn} DESC, ID DESC`,
  );

  const output: any[] = [];
  for (const row of rows) {
    const loaded = await loadInspecao(row.ID);
    if (loaded) output.push(loaded);
  }
  return output;
}

export async function getInspecaoMolaById(id: string): Promise<any | null> {
  if (!isOracleEnabled()) {
    const found = db.inspecoesMola.find((item: any) => item.id === id);
    return found ? mapFallbackInspecao(found) : null;
  }

  return loadInspecao(id);
}

export async function createInspecaoMola(data: any): Promise<any> {
  const id = data.id ?? uid("MOLA");

  if (!isOracleEnabled()) {
    const payload = mapFallbackInspecao({ ...data, id });
    const idx = db.inspecoesMola.findIndex((item: any) => item.id === id);
    if (idx >= 0) db.inspecoesMola[idx] = payload as any;
    else db.inspecoesMola.push(payload as any);
    return payload;
  }

  const schema = await getMolaSchema();
  const maquina = await queryOne<{ ID: string; CODIGO: string }>(
    `SELECT ID, CODIGO FROM INS_MOLA_MAQUINA WHERE CODIGO = :codigo AND ATIVO = 1`,
    { codigo: data.maquina },
  );

  if (!maquina) {
    throw new Error(`Maquina nao encontrada: ${data.maquina}`);
  }

  const dataHora = new Date(data.dataHora ?? new Date().toISOString());
  const codigo = data.codigo ?? id;
  const existsRow = await queryOne<{ CNT: number }>(`SELECT COUNT(*) AS CNT FROM INS_MOLA_INSPECAO WHERE ID = :id`, { id });
  const exists = asNumber(existsRow?.CNT, 0) > 0;

  if (exists) {
    const updateClauses = [
      "MAQUINA_ID = :maquinaId",
      "MAQUINA_CODIGO = :maquinaCodigo",
      "STATUS_MAQUINA = :statusMaquina",
      "ALTURA_TIPO = :alturaTipo",
      "LINHA_POCKET = :linhaPocket",
      `${schema.inspecaoOperadorNomeColumn} = :operadorNome`,
      `${schema.inspecaoDateColumn} = :dataHora`,
      `${schema.inspecaoObsColumn} = :observacaoGeral`,
      "RESULTADO = :resultado",
      "MOTIVO_PARADA = :motivoParada",
    ];
    const updateBinds: Record<string, unknown> = {
      id,
      maquinaId: maquina.ID,
      maquinaCodigo: maquina.CODIGO,
      statusMaquina: data.statusMaquina,
      alturaTipo: data.alturaTipo ?? null,
      linhaPocket: data.linhaPocket ?? null,
      operadorNome: data.operador ?? null,
      dataHora,
      observacaoGeral: data.observacaoGeral ?? null,
      resultado: data.resultado,
      motivoParada: data.motivoParada ?? null,
    };

    if (schema.inspecaoCodigoColumn) {
      updateClauses.push(`${schema.inspecaoCodigoColumn} = :codigo`);
      updateBinds.codigo = codigo;
    }
    if (schema.inspecaoOperadorUsuarioIdColumn) {
      updateClauses.push(`${schema.inspecaoOperadorUsuarioIdColumn} = :operadorUsuarioId`);
      updateBinds.operadorUsuarioId = data.operadorUsuarioId ?? null;
    }
    if (schema.inspecaoUpdatedAtColumn) {
      updateClauses.push(`${schema.inspecaoUpdatedAtColumn} = SYSTIMESTAMP`);
    }

    await execDml(
      `UPDATE INS_MOLA_INSPECAO
          SET ${updateClauses.join(", ")}
        WHERE ID = :id`,
      updateBinds,
    );
  } else {
    const columns = ["ID", "MAQUINA_ID", "MAQUINA_CODIGO", "STATUS_MAQUINA", "ALTURA_TIPO", "LINHA_POCKET", schema.inspecaoOperadorNomeColumn, schema.inspecaoDateColumn, schema.inspecaoObsColumn, "RESULTADO", "MOTIVO_PARADA"];
    const values = [":id", ":maquinaId", ":maquinaCodigo", ":statusMaquina", ":alturaTipo", ":linhaPocket", ":operadorNome", ":dataHora", ":observacaoGeral", ":resultado", ":motivoParada"];
    const binds: Record<string, unknown> = {
      id,
      maquinaId: maquina.ID,
      maquinaCodigo: maquina.CODIGO,
      statusMaquina: data.statusMaquina,
      alturaTipo: data.alturaTipo ?? null,
      linhaPocket: data.linhaPocket ?? null,
      operadorNome: data.operador ?? null,
      dataHora,
      observacaoGeral: data.observacaoGeral ?? null,
      resultado: data.resultado,
      motivoParada: data.motivoParada ?? null,
    };

    pushColumnBinding(columns, values, binds, schema.inspecaoCodigoColumn, "codigo", codigo);
    pushColumnBinding(columns, values, binds, schema.inspecaoOperadorUsuarioIdColumn, "operadorUsuarioId", data.operadorUsuarioId ?? null);

    if (schema.inspecaoCreatedAtColumn) {
      columns.push(schema.inspecaoCreatedAtColumn);
      values.push("SYSTIMESTAMP");
    }
    if (schema.inspecaoUpdatedAtColumn) {
      columns.push(schema.inspecaoUpdatedAtColumn);
      values.push("SYSTIMESTAMP");
    }

    await execDml(
      `INSERT INTO INS_MOLA_INSPECAO (${columns.join(", ")})
       VALUES (${values.join(", ")})`,
      binds,
    );
  }

  await execDml(`DELETE FROM INS_MOLA_INSPECAO_AMOSTRA WHERE INSPECAO_ID = :inspecaoId`, { inspecaoId: id });

  const medicoes = Array.isArray(data.medicoes) ? data.medicoes : [];
  for (const [idx, medicao] of medicoes.entries()) {
    const columns = ["ID", "INSPECAO_ID", "PADRAO_ID", "ITEM", "DESCRICAO", "PADRAO", "MINIMO", "MAXIMO", "UNIDADE", "VALOR_MEDIDO", "CONFORME"];
    const values = [":id", ":inspecaoId", ":padraoId", ":item", ":descricao", ":padrao", ":minimo", ":maximo", ":unidade", ":valorMedido", ":conforme"];
    const binds: Record<string, unknown> = {
      id: medicao.id ?? uid(`AMS${idx + 1}`),
      inspecaoId: id,
      padraoId: medicao.padraoId,
      item: medicao.item ?? null,
      descricao: medicao.descricao ?? null,
      padrao: medicao.padrao ?? null,
      minimo: medicao.minimo ?? null,
      maximo: medicao.maximo ?? null,
      unidade: medicao.unidade ?? null,
      valorMedido: medicao.valorMedido ?? null,
      conforme: medicao.conforme === undefined ? null : medicao.conforme ? 1 : 0,
    };

    if (schema.amostraCreatedAtColumn) {
      columns.push(schema.amostraCreatedAtColumn);
      values.push("SYSTIMESTAMP");
    }

    await execDml(
      `INSERT INTO INS_MOLA_INSPECAO_AMOSTRA (${columns.join(", ")})
       VALUES (${values.join(", ")})`,
      binds,
    );
  }

  const created = await getInspecaoMolaById(id);
  if (!created) {
    throw new Error("Falha ao carregar inspecao de mola criada");
  }

  return created;
}

export async function listMaquinasMola(): Promise<any[]> {
  if (!isOracleEnabled()) {
    return [
      { id: "MAQ-01", codigo: "01", descricao: "MAQUINA 01", ativo: true },
      { id: "MAQ-02", codigo: "02", descricao: "MAQUINA 02", ativo: true },
      { id: "MAQ-03", codigo: "03", descricao: "MAQUINA 03", ativo: true },
      { id: "MAQ-04", codigo: "04", descricao: "MAQUINA 04", ativo: true },
    ];
  }

  const rows = await queryRows<{ ID: string; CODIGO: string; DESCRICAO: string | null; ATIVO: number }>(
    `SELECT ID, CODIGO, DESCRICAO, ATIVO
       FROM INS_MOLA_MAQUINA
      ORDER BY CODIGO`,
  );

  return rows.map((row) => ({
    id: row.ID,
    codigo: row.CODIGO,
    descricao: row.DESCRICAO ?? `MAQUINA ${row.CODIGO}`,
    ativo: asBool(row.ATIVO),
  }));
}
