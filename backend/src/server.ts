import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { initOraclePool, closeOraclePool } from "./db/oracle.js";
import { setErrorHandler } from "./utils/error.js";
import { healthRoutes } from "./routes/health.js";
import { erpRoutes } from "./routes/erp.js";
import { adminRoutes } from "./routes/admin.js";
import { sacRoutes } from "./routes/sac.js";
import { sacReqRoutes } from "./routes/sacRequisicoes.js";
import { sacAvaliacoesRoutes } from "./routes/sacAvaliacoes.js";
import { qualidadeRoutes } from "./routes/qualidade.js";
import { auditoriasRoutes } from "./routes/auditorias.js";
import { auditoriaCartaoRoutes } from "./routes/auditoriaCartao.js";
import { assistenciaRoutes } from "./routes/assistencia.js";
import { governancaQualidadeRoutes } from "./routes/governancaQualidade.js";
import { authRoutes } from "./routes/auth.js";
import { uxMetricsRoutes } from "./routes/uxMetrics.js";
import { inventarioRoutes } from "./routes/inventario.js";
import { operacionalRoutes } from "./routes/operacional.js";
import { frotaChecklistsRoutes } from "./routes/frotaChecklists.js";
import { torreAgendaCustodiaRoutes } from "./routes/torreAgendaCustodia.js";
import { inspecoesRoutes } from "./routes/inspecoes.js";
import { sesmtRoutes } from "./routes/sesmt.js";
import { assistenciaTerceirizadaRoutes } from "./routes/assistenciaTerceirizada.js";
import { laraRoutes } from "./routes/lara.js";
import {
  initPersistentCollections,
  persistAllCollections,
} from "./repositories/persistentCollectionStore.js";
import { verifyAuthToken } from "./utils/jwt.js";
import { trackHttpRequestMetric } from "./utils/observability.js";
import { db } from "./repositories/dataStore.js";
import { persistCollection } from "./repositories/persistentCollectionStore.js";
import { seedInventarioData, seedOperacionalData } from "./repositories/seedData.js";
import { seedPhasesData } from "./repositories/seedPhases.js";
import { seedInspecoesData } from "./repositories/seedInspecoesData.js";
import { seedSesmtData } from "./repositories/seedSesmtData.js";
import { ensureInspecoesTables } from "./repositories/inspecoes/initTables.js";
import { isOracleEnabled } from "./db/oracle.js";
import { ensureInventarioTables } from "./repositories/inventario/initTables.js";
import { ensureSesmtTables } from "./repositories/sesmt/initTables.js";
import { ensureLaraTables } from "./repositories/lara/initTables.js";
import { startLaraDailySyncScheduler } from "./modules/lara/dailySyncScheduler.js";
import { startLaraPromiseFollowupScheduler } from "./modules/lara/promiseFollowupScheduler.js";
import { startFeedbackAggregatorScheduler } from "./modules/lara/feedbackAggregator.js";
import { startLearningEngineScheduler } from "./modules/lara/learningEngine.js";
import { startWhatsAppTemplateMonitor } from "./modules/lara/whatsappTemplateMonitor.js";
import { startLaraReguaScheduler } from "./modules/lara/reguaScheduler.js";
import { startBanditEngine } from "./modules/lara/banditsEngine.js";
import { initPropensityModel } from "./modules/lara/propensityModel.js";
import { initUpliftModel } from "./modules/lara/upliftModel.js";
import { runNightlyRetraining } from "./modules/lara/onlineLearner.js";

const app = Fastify({
  bodyLimit: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  logger: {
    level: env.LOG_LEVEL,
  },
});

// Preserve raw body (as string) so webhook handlers can validate HMAC signatures
// (e.g., Meta X-Hub-Signature-256). Replaces the built-in JSON parser transparently.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, function (_req, body, done) {
  try {
    const raw = (body as Buffer).toString("utf8");
    (_req as any).rawBody = raw;
    done(null, JSON.parse(raw));
  } catch {
    const err: any = new Error("Invalid JSON body");
    err.statusCode = 400;
    done(err, undefined);
  }
});

app.addHook("onRequest", async (request, reply) => {
  const incoming = request.headers["x-request-id"];
  const correlationId =
    typeof incoming === "string" && incoming.trim().length > 0
      ? incoming.trim()
      : randomUUID();
  (request as any).correlationId = correlationId;
  (request as any).startedAtMs = Date.now();
  reply.header("x-request-id", correlationId);
});

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api")) return;
  if (request.method === "OPTIONS") return;

  const path = request.url.split("?")[0];
  const laraApiKeyConfigured = String(env.LARA_API_KEY ?? "").trim();
  if (path.startsWith("/api/lara/") && laraApiKeyConfigured) {
    const rawHeader = request.headers["x-lara-api-key"];
    const providedKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (String(providedKey ?? "").trim() !== laraApiKeyConfigured) {
      return reply.status(401).send({ error: { message: "Nao autorizado para modulo Lara." } });
    }
  }

  const publicPaths = new Set<string>([
    "/api/health",
    "/api/health/oracle",
    "/api/auth/login",
    "/api/sac/avaliacoes/public",
    "/api/sac/avaliacoes/public/responder",
  ]);
  const publicPathPrefixes = [
    "/api/operacional/solicitacoes-acesso/public/",
    "/api/lara/",
  ];

  if (publicPaths.has(path) || publicPathPrefixes.some((prefix) => path.startsWith(prefix))) return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: { message: "Nao autenticado." } });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return reply.status(401).send({ error: { message: "Token ausente." } });
  }

  try {
    const authUser = verifyAuthToken(token);
    (request as any).authUser = authUser;
  } catch {
    return reply.status(401).send({ error: { message: "Token invalido ou expirado." } });
  }
});

app.addHook("onResponse", async (request, reply) => {
  const startedAtMs = Number((request as any).startedAtMs ?? Date.now());
  const durationMs = Date.now() - startedAtMs;
  const routePath =
    ((request as any).routeOptions?.url as string | undefined) ??
    request.url.split("?")[0];

  trackHttpRequestMetric({
    method: request.method,
    route: routePath,
    statusCode: reply.statusCode,
    durationMs,
  });

  request.log.info(
    {
      requestId: (request as any).correlationId ?? request.id,
      method: request.method,
      route: routePath,
      statusCode: reply.statusCode,
      durationMs,
    },
    "request completed",
  );

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.url.startsWith("/api")) {
    try {
      await persistAllCollections();
    } catch (error) {
      request.log.error(
        {
          requestId: (request as any).correlationId ?? request.id,
          route: routePath,
          err: error,
        },
        "persistAllCollections failed after API mutation",
      );
    }
  }
});

await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-request-id",
    "x-lara-api-key",
    "x-bradesco-webhook-secret",
    "x-webhook-secret",
  ],
  exposedHeaders: ["x-request-id"],
});

let stopLaraDailySync: (() => void) | null = null;
let stopLaraPromiseFollowup: (() => void) | null = null;
let stopFeedbackAggregator: (() => void) | null = null;
let stopLearningEngine: (() => void) | null = null;
let stopWaTemplateMonitor: (() => void) | null = null;
let stopReguaScheduler: (() => void) | null = null;
let stopBanditEngine: (() => void) | null = null;
await app.register(multipart, {
  limits: {
    files: env.UPLOAD_MAX_FILES,
    fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  },
});
setErrorHandler(app);

await healthRoutes(app);
await authRoutes(app);
await erpRoutes(app);
await adminRoutes(app);
await sacRoutes(app);
await sacReqRoutes(app);
await sacAvaliacoesRoutes(app);
await qualidadeRoutes(app);
await auditoriasRoutes(app);
await auditoriaCartaoRoutes(app);
await assistenciaRoutes(app);
await governancaQualidadeRoutes(app);
await uxMetricsRoutes(app);
await inventarioRoutes(app);
await operacionalRoutes(app);
await frotaChecklistsRoutes(app);
await torreAgendaCustodiaRoutes(app);
await inspecoesRoutes(app);
await sesmtRoutes(app);
await assistenciaTerceirizadaRoutes(app);
await laraRoutes(app);

async function start() {
  await initOraclePool();
  await initPersistentCollections();
  if (env.ORACLE_AUTO_ENSURE_AUX_TABLES) {
    await ensureInspecoesTables();
    await ensureInventarioTables();
    await ensureSesmtTables();
  } else if (isOracleEnabled()) {
    app.log.warn(
      "Criacao automatica de tabelas auxiliares INS/Inventario/SESMT ignorada; usando Oracle somente para modulos ja homologados.",
    );
  }
  await ensureLaraTables().catch((err) => {
    app.log.warn({ err }, "[lara] ensureLaraTables falhou — tabelas auxiliares serao criadas na proxima conexao bem-sucedida.");
  });
  stopLaraDailySync = startLaraDailySyncScheduler(app.log);
  stopLaraPromiseFollowup = startLaraPromiseFollowupScheduler(app.log);
  stopFeedbackAggregator = startFeedbackAggregatorScheduler(app.log);
  stopLearningEngine = startLearningEngineScheduler(app.log);
  stopWaTemplateMonitor = startWhatsAppTemplateMonitor(app.log);
  stopReguaScheduler = startLaraReguaScheduler(app.log);
  stopBanditEngine = startBanditEngine();
  void initPropensityModel().catch(() => {});
  void initUpliftModel().catch(() => {});
  // Retreino noturno completo às 4h (além do ciclo do learningEngine às 3h)
  const nightlyMs = (() => {
    const now = new Date();
    const next4am = new Date(now);
    next4am.setHours(4, 0, 0, 0);
    if (next4am <= now) next4am.setDate(next4am.getDate() + 1);
    return next4am.getTime() - now.getTime();
  })();
  setTimeout(() => {
    void runNightlyRetraining().catch(() => {});
    setInterval(() => void runNightlyRetraining().catch(() => {}), 24 * 60 * 60 * 1000);
  }, nightlyMs);

  // Seed operational and inventory data if empty
  seedInventarioData();
  seedOperacionalData();
  seedPhasesData();
  // Inspeções: when Oracle is enabled, data comes from real INS_* tables (imported via planilha script).
  // Only seed in-memory fallback when Oracle is NOT available (local dev).
  if (!isOracleEnabled()) {
    seedInspecoesData();
  }
  seedSesmtData();

  const seedUsers = [
    { nome: "Cleiton Ramos", email: "cleiton.ramos@hotmail.com", perfil: "ADMIN" },
    { nome: "Teste", email: "teste@admin.com", perfil: "ADMIN" },
    { nome: "Ana SESMT", email: "ana.sesmt@admin.com", perfil: "SESMT" },
    { nome: "Bruno Medico", email: "bruno.medico@admin.com", perfil: "MEDICO_TRABALHO" },
    { nome: "Carla Diretoria SST", email: "carla.sst@admin.com", perfil: "DIRETOR_EXECUTIVO_SST" },
  ] as const;
  for (const su of seedUsers) {
    const exists = db.usuarios.some(
      (u) => u.email.toLowerCase() === su.email.toLowerCase(),
    );
    if (!exists) {
      db.usuarios.push({
        id: `USR-${String(db.usuarios.length + 1).padStart(3, "0")}`,
        nome: su.nome,
        email: su.email,
        perfil: su.perfil,
        ativo: true,
      });
    }
  }
  await persistCollection("usuarios");

  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  if (stopLaraDailySync) {
    stopLaraDailySync();
    stopLaraDailySync = null;
  }
  if (stopLaraPromiseFollowup) {
    stopLaraPromiseFollowup();
    stopLaraPromiseFollowup = null;
  }
  if (stopFeedbackAggregator) {
    stopFeedbackAggregator();
    stopFeedbackAggregator = null;
  }
  if (stopLearningEngine) {
    stopLearningEngine();
    stopLearningEngine = null;
  }
  if (stopWaTemplateMonitor) {
    stopWaTemplateMonitor();
    stopWaTemplateMonitor = null;
  }
  if (stopReguaScheduler) {
    stopReguaScheduler();
    stopReguaScheduler = null;
  }
  if (stopBanditEngine) {
    stopBanditEngine();
    stopBanditEngine = null;
  }
  await persistAllCollections();
  await closeOraclePool();
  process.exit(0);
});
