import { isOracleEnabled } from "../db/oracle.js";
import { execDml, queryOne } from "./baseRepository.js";
import { db } from "./dataStore.js";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type DbShape = typeof db;
type DbKey = keyof DbShape;

const TABLE_NAME = "SGQ_COLLECTION_STORE";
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_STORE_PATH = resolve(__dirname, "../../data/sgq_collection_store.local.json");
const LOCAL_STORE_TEMP_PATH = `${LOCAL_STORE_PATH}.tmp`;
const LOCAL_STORE_BACKUP_PATH = `${LOCAL_STORE_PATH}.bak`;
type LocalStoreShape = Partial<Record<DbKey, DbShape[DbKey]>>;

const COLLECTION_KEYS: DbKey[] = [
  "usuarios",
  "auditLog",
  "parametros",
  "atendimentos",
  "sacAtendimentoAnexos",
  "requisicoesSac",
  "garantias",
  "ncs",
  "capas",
  "auditorias",
  "auditoriaTemplates",
  "auditoriaTemplateItems",
  "documentosQualidade",
  "treinamentosQualidade",
  "treinamentoParticipantes",
  "mudancasQualidade",
  "fornecedoresQualidade",
  "scarsFornecedores",
  "metrologiaInstrumentos",
  "metrologiaMsa",
  "indicadoresIndustriais",
  "regrasRiscoSla",
  "avaliacoesRiscoSla",
  "auditoriasCamadas",
  "gatesFornecedores",
  "isoReadiness",
  "osAssistencia",
  "reqMaterial",
  "consumoPeca",
  "osTransitionLog",
  "uxMetrics",
  "sacAvaliacoes",
  "inventarioLojas",
  "inventarioDepartamentos",
  "inventarioFrequencias",
  "inventarioTarefas",
  "inventarioContagens",
  "inventarioDivergencias",
  "inventarioChecklists",
  "operacionalAcessos",
  "operacionalVisitantes",
  "operacionalVeiculosVisitantes",
  "operacionalFrota",
  "operacionalDeslocamentos",
  "operacionalTransportadoras",
  "operacionalMotoristasTerceiros",
  "operacionalVeiculosTerceiros",
  "operacionalOperacoes",
  "operacionalAgendamentos",
  "operacionalDocas",
  "operacionalFilaPatio",
  "operacionalAlertas",
  "operacionalExcecoes",
  "operacionalNFsTransito",
  "operacionalExcecoesFiscais",
  "operacionalMovimentacoesFrota",
  "operacionalTimeline",
  "operacionalDashboard",
  "operacionalSolicitacoesAcesso",
  "frotaChecklists",
  "frotaChecklistAvarias",
  "frotaChecklistAcessorios",
  "frotaChecklistFotos",
  "frotaChecklistAssinaturas",
  "frotaChecklistHistorico",
  "auditoriaCartaoImportacoes",
  "auditoriaCartaoImportacaoItens",
  "auditoriaCartaoMatches",
  "auditoriaCartaoDivergencias",
  "auditoriaCartaoRegras",
  "auditoriaCartaoLogs",
  "auditoriaCartaoAjustesManuais",
  "auditoriaCartaoConsolidadoDia",
  "torreExcecoes",
  "torreKPIs",
  "agendamentosSlots",
  "agendamentoDockCapacity",
  "agendamentoKPIs",
  "custodias",
  "custodiaKPIs",
  "sesmt",
  // Inspeções module now uses dedicated INS_* Oracle tables.
  // These collections are NO LONGER persisted via SGQ_COLLECTION_STORE.
  // They remain in dataStore only as in-memory fallback for local dev.
];

let ensured = false;
let localStoreCache: LocalStoreShape | null = null;
let localStoreWriteQueue: Promise<void> = Promise.resolve();

type LocalStoreReadResult =
  | { status: "ok"; data: LocalStoreShape }
  | { status: "missing" }
  | { status: "invalid"; error: unknown };

function isLocalStoreObject(value: unknown): value is LocalStoreShape {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readLocalStoreFile(path: string): Promise<LocalStoreReadResult> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isLocalStoreObject(parsed)) {
      return { status: "invalid", error: new Error("Formato invalido para store local") };
    }
    return { status: "ok", data: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "invalid", error };
  }
}

async function writeLocalStoreAtomic(value: LocalStoreShape): Promise<void> {
  await mkdir(dirname(LOCAL_STORE_PATH), { recursive: true });
  await writeFile(LOCAL_STORE_TEMP_PATH, JSON.stringify(value), "utf-8");
  try {
    await copyFile(LOCAL_STORE_PATH, LOCAL_STORE_BACKUP_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await rename(LOCAL_STORE_TEMP_PATH, LOCAL_STORE_PATH);
}

function queueLocalStoreWrite(task: () => Promise<void>): Promise<void> {
  const next = localStoreWriteQueue.then(task);
  localStoreWriteQueue = next.catch((error) => {
    console.error("Falha na fila de persistencia local.", error);
  });
  return next;
}

async function ensureLocalStoreCache(): Promise<LocalStoreShape> {
  if (localStoreCache) return localStoreCache;

  const primary = await readLocalStoreFile(LOCAL_STORE_PATH);
  if (primary.status === "ok") {
    localStoreCache = primary.data;
    return localStoreCache;
  }

  if (primary.status === "invalid") {
    console.error("Store local principal corrompido. Tentando backup...", primary.error);
  }

  const backup = await readLocalStoreFile(LOCAL_STORE_BACKUP_PATH);
  if (backup.status === "ok") {
    localStoreCache = backup.data;
    await writeLocalStoreAtomic(localStoreCache);
    console.info("Store local restaurado a partir do backup.");
    return localStoreCache;
  }

  if (primary.status === "invalid") {
    const corruptedPath = `${LOCAL_STORE_PATH}.corrupt.${Date.now()}`;
    try {
      await rename(LOCAL_STORE_PATH, corruptedPath);
      console.error(`Store local corrompido foi movido para: ${corruptedPath}`);
    } catch {
      // Ignora falha de rename para seguir com fallback vazio.
    }
  }

  localStoreCache = {};
  return localStoreCache;
}

async function ensureTable(): Promise<void> {
  if (!isOracleEnabled() || ensured) return;
  await execDml(`
    BEGIN
      EXECUTE IMMEDIATE '
        CREATE TABLE ${TABLE_NAME} (
          COLLECTION_KEY VARCHAR2(80) PRIMARY KEY,
          PAYLOAD CLOB NOT NULL,
          UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
        )
      ';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN
          RAISE;
        END IF;
    END;
  `);
  ensured = true;
}

async function loadCollectionFromOracle<K extends DbKey>(key: K): Promise<DbShape[K] | null> {
  const row = await queryOne<{ PAYLOAD?: string }>(
    `SELECT PAYLOAD FROM ${TABLE_NAME} WHERE COLLECTION_KEY = :collectionKey`,
    { collectionKey: key },
  );
  if (!row?.PAYLOAD) return null;
  try {
    return JSON.parse(row.PAYLOAD) as DbShape[K];
  } catch {
    return null;
  }
}

async function saveCollectionToOracle<K extends DbKey>(key: K, value: DbShape[K]): Promise<void> {
  const payload = JSON.stringify(value);
  await execDml(
    `MERGE INTO ${TABLE_NAME} t
      USING (SELECT :collectionKey AS COLLECTION_KEY, :payload AS PAYLOAD FROM DUAL) s
      ON (t.COLLECTION_KEY = s.COLLECTION_KEY)
     WHEN MATCHED THEN
      UPDATE SET t.PAYLOAD = s.PAYLOAD, t.UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN
      INSERT (COLLECTION_KEY, PAYLOAD, UPDATED_AT)
      VALUES (s.COLLECTION_KEY, s.PAYLOAD, SYSTIMESTAMP)`,
    { collectionKey: key, payload },
  );
}

export async function initPersistentCollections(): Promise<void> {
  if (!isOracleEnabled()) {
    try {
      const localStore = await ensureLocalStoreCache();
      let updated = false;
      for (const key of COLLECTION_KEYS) {
        const loaded = localStore[key];
        if (loaded !== undefined) {
          (db[key] as unknown) = loaded as unknown;
        } else {
          localStore[key] = db[key];
          updated = true;
        }
      }
      if (updated) {
        await queueLocalStoreWrite(async () => {
          await writeLocalStoreAtomic(localStore);
        });
      }
    } catch (error) {
      console.error("Falha ao inicializar persistencia local. Mantendo store em memoria.", error);
    }
    return;
  }

  try {
    await ensureTable();
    for (const key of COLLECTION_KEYS) {
      const loaded = await loadCollectionFromOracle(key);
      if (loaded == null) {
        await saveCollectionToOracle(key, db[key]);
      } else {
        (db[key] as unknown) = loaded as unknown;
      }
    }
  } catch (error) {
    console.error("Falha ao inicializar SGQ_COLLECTION_STORE no Oracle. Mantendo store em memoria.", error);
  }
}

export async function persistCollection<K extends DbKey>(key: K): Promise<void> {
  if (!isOracleEnabled()) {
    try {
      const localStore = await ensureLocalStoreCache();
      localStore[key] = db[key];
      await queueLocalStoreWrite(async () => {
        await writeLocalStoreAtomic(localStore);
      });
    } catch (error) {
      console.error(`Falha ao persistir colecao ${String(key)} no arquivo local.`, error);
    }
    return;
  }
  try {
    await ensureTable();
    await saveCollectionToOracle(key, db[key]);
  } catch (error) {
    console.error(`Falha ao persistir colecao ${String(key)} no Oracle.`, error);
  }
}

export async function persistCollections(keys: DbKey[]): Promise<void> {
  if (!isOracleEnabled()) {
    try {
      const localStore = await ensureLocalStoreCache();
      for (const key of keys) {
        localStore[key] = db[key];
      }
      await queueLocalStoreWrite(async () => {
        await writeLocalStoreAtomic(localStore);
      });
    } catch (error) {
      console.error("Falha ao persistir colecoes no arquivo local.", error);
    }
    return;
  }
  for (const key of keys) {
    await persistCollection(key);
  }
}

export async function persistAllCollections(): Promise<void> {
  await persistCollections(COLLECTION_KEYS);
}
