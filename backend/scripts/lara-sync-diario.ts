import { initOraclePool, closeOraclePool } from "../src/db/oracle.js";
import { ensureLaraTables } from "../src/repositories/lara/initTables.js";
import { laraService } from "../src/modules/lara/service.js";
import { env } from "../src/config/env.js";

async function main() {
  await initOraclePool();
  await ensureLaraTables();

  const resultado = await laraService.recarregarTitulosOracle({
    limit: env.LARA_SYNC_DAILY_LIMIT,
    includeDesd: env.LARA_SYNC_DAILY_INCLUDE_DESD,
  });

  // Output simples para uso em agendador externo (Task Scheduler/cron)
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    executadoEm: new Date().toISOString(),
    resultado,
  })}\n`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      status: "erro",
      executadoEm: new Date().toISOString(),
      erro: message,
    })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeOraclePool();
  });
