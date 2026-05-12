import { closeOraclePool, executeOracle, initOraclePool, isOracleEnabled } from "../src/db/oracle.js";

type TableSpec = {
  table: string;
  required: string[];
};

type CompatSpec = Record<string, string[]>;

const SPECS: TableSpec[] = [
  {
    table: "INS_SETOR",
    required: ["ID", "NOME", "ORDEM", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  },
  {
    table: "INS_USUARIO_SETOR",
    required: ["ID", "USUARIO_ID", "SETOR_ID", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  },
  {
    table: "INS_MODELO_CHECKLIST",
    required: ["ID", "NOME", "DESCRICAO", "SETOR_ID", "ORDEM", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  },
  {
    table: "INS_MODELO_CHECKLIST_ITEM",
    required: [
      "ID",
      "MODELO_ID",
      "SETOR_ID",
      "CODIGO_ITEM",
      "ORDEM",
      "DESCRICAO",
      "OBRIGATORIO",
      "EXIGE_EVIDENCIA",
      "EXIGE_TIPO_NC",
      "ATIVO",
      "CRIADO_EM",
      "ATUALIZADO_EM",
    ],
  },
  {
    table: "INS_TIPO_NC",
    required: ["ID", "SETOR_ID", "NOME", "CATEGORIA", "OBSERVACAO", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  },
  {
    table: "INS_EXECUCAO",
    required: [
      "ID",
      "CODIGO",
      "MODELO_ID",
      "SETOR_ID",
      "EXECUTOR_USUARIO_ID",
      "EXECUTOR_NOME",
      "DATA_HORA",
      "STATUS",
      "TOTAL_ITENS",
      "CONFORMES",
      "NAO_CONFORMES",
      "NAO_APLICA",
      "TAXA_CONFORMIDADE",
      "OBSERVACAO_GERAL",
      "CRIADO_EM",
      "ATUALIZADO_EM",
    ],
  },
  {
    table: "INS_EXECUCAO_ITEM",
    required: [
      "ID",
      "EXECUCAO_ID",
      "MODELO_ITEM_ID",
      "CODIGO_ITEM",
      "ORDEM",
      "DESCRICAO",
      "RESULTADO",
      "TIPO_NC_ID",
      "TIPO_NC_NOME",
      "OUTRA_NC",
      "OBSERVACAO",
      "TIMESTAMP_RESPOSTA",
      "USUARIO",
      "NOME",
      "SETOR",
      "FOTO_URL",
      "CRIADO_EM",
      "ATUALIZADO_EM",
    ],
  },
  {
    table: "INS_EXECUCAO_ITEM_EVIDENCIA",
    required: [
      "ID",
      "EXECUCAO_ITEM_ID",
      "ORDEM_ARQUIVO",
      "NOME_ARQUIVO",
      "URL_ARQUIVO",
      "REFERENCIA_ARQUIVO",
      "MIME_TYPE",
      "TAMANHO_ARQUIVO",
      "CRIADO_EM",
    ],
  },
  {
    table: "INS_MOLA_MAQUINA",
    required: ["ID", "CODIGO", "DESCRICAO", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  },
  {
    table: "INS_MOLA_PADRAO",
    required: [
      "ID",
      "ALTURA_TIPO",
      "ITEM",
      "DESCRICAO",
      "PADRAO",
      "MINIMO",
      "MAXIMO",
      "UNIDADE",
      "ATIVO",
      "CRIADO_EM",
      "ATUALIZADO_EM",
    ],
  },
  {
    table: "INS_MOLA_INSPECAO",
    required: [
      "ID",
      "CODIGO",
      "MAQUINA_ID",
      "MAQUINA_CODIGO",
      "STATUS_MAQUINA",
      "ALTURA_TIPO",
      "LINHA_POCKET",
      "OPERADOR_USUARIO_ID",
      "OPERADOR_NOME",
      "DATA_HORA",
      "OBSERVACAO_GERAL",
      "RESULTADO",
      "MOTIVO_PARADA",
      "CRIADO_EM",
      "ATUALIZADO_EM",
    ],
  },
  {
    table: "INS_MOLA_INSPECAO_AMOSTRA",
    required: [
      "ID",
      "INSPECAO_ID",
      "PADRAO_ID",
      "ITEM",
      "DESCRICAO",
      "PADRAO",
      "MINIMO",
      "MAXIMO",
      "UNIDADE",
      "VALOR_MEDIDO",
      "CONFORME",
      "CRIADO_EM",
    ],
  },
  {
    table: "INS_AUDITORIA_IMPORTACAO",
    required: [
      "ID",
      "FONTE_ARQUIVO",
      "STATUS",
      "SETORES_IMPORTADOS",
      "MODELOS_IMPORTADOS",
      "ITENS_IMPORTADOS",
      "TIPOS_NC_IMPORTADOS",
      "PADROES_MOLA_IMPORTADOS",
      "VINCULOS_USUARIO_SETOR",
      "LINHAS_IGNORADAS",
      "LOG_RESUMO",
      "CRIADO_EM",
    ],
  },
  {
    table: "INS_AUDITORIA",
    required: [
      "ID",
      "ENTIDADE",
      "ENTIDADE_ID",
      "ACAO",
      "USUARIO_ID",
      "USUARIO_NOME",
      "DETALHES",
      "CRIADO_EM",
    ],
  },
];

const COMPATIBILITY: Record<string, CompatSpec> = {
  INS_USUARIO_SETOR: {
    USUARIO_ID: ["USER_ID"],
  },
  INS_EXECUCAO: {
    DATA_HORA: ["DATA_INICIO"],
    EXECUTOR_NOME: ["INSPETOR"],
    OBSERVACAO_GERAL: ["OBSERVACOES"],
    CRIADO_EM: ["CREATED_AT"],
    ATUALIZADO_EM: ["UPDATED_AT"],
  },
  INS_EXECUCAO_ITEM: {
    MODELO_ITEM_ID: ["ITEM_ID"],
    RESULTADO: ["STATUS"],
    DESCRICAO: ["ITEM", "DESCRICAO_ITEM"],
    TIMESTAMP_RESPOSTA: ["DATA_HORA_RESPOSTA"],
    USUARIO: ["USUARIO_ID"],
    NOME: ["USUARIO_NOME"],
    SETOR: ["SETOR_NOME"],
    CRIADO_EM: ["CREATED_AT"],
    ATUALIZADO_EM: ["UPDATED_AT"],
  },
  INS_EXECUCAO_ITEM_EVIDENCIA: {
    EXECUCAO_ITEM_ID: ["EXEC_ITEM_ID"],
    NOME_ARQUIVO: ["ARQUIVO_NOME"],
    URL_ARQUIVO: ["ARQUIVO_URL"],
    MIME_TYPE: ["TIPO_MIME"],
    CRIADO_EM: ["CREATED_AT"],
  },
  INS_MOLA_INSPECAO: {
    DATA_HORA: ["DATA_INSPECAO"],
    OPERADOR_NOME: ["INSPETOR"],
    OBSERVACAO_GERAL: ["OBSERVACOES"],
    CRIADO_EM: ["CREATED_AT"],
    ATUALIZADO_EM: ["UPDATED_AT"],
  },
  INS_TIPO_NC: {
    CRIADO_EM: ["CREATED_AT"],
    ATUALIZADO_EM: ["UPDATED_AT"],
  },
};

async function getTableColumns(tableName: string): Promise<Set<string> | null> {
  try {
    const result = (await executeOracle(`SELECT * FROM ${tableName} WHERE 1 = 0`)) as any;
    const metaData = Array.isArray(result?.metaData) ? result.metaData : [];
    return new Set<string>(
      metaData
        .map((item: any) => item?.name)
        .filter(Boolean)
        .map((name: string) => String(name).toUpperCase()),
    );
  } catch {
    return null;
  }
}

function resolveMissingColumns(
  table: string,
  required: string[],
  columns: Set<string>,
): { present: string[]; legacyFallback: Array<{ official: string; fallback: string }>; missing: string[] } {
  const compat = COMPATIBILITY[table] ?? {};
  const present: string[] = [];
  const legacyFallback: Array<{ official: string; fallback: string }> = [];
  const missing: string[] = [];

  for (const col of required) {
    if (columns.has(col)) {
      present.push(col);
      continue;
    }
    const fallback = (compat[col] ?? []).find((candidate) => columns.has(candidate));
    if (fallback) {
      legacyFallback.push({ official: col, fallback });
      continue;
    }
    missing.push(col);
  }
  return { present, legacyFallback, missing };
}

async function main(): Promise<void> {
  if (!isOracleEnabled()) {
    console.log("Oracle desativado no ambiente atual. Nada para validar.");
    return;
  }

  await initOraclePool();

  let criticalMissing = 0;
  let totalOfficial = 0;
  let totalPresent = 0;
  let totalLegacyCovered = 0;

  console.log("=== VALIDACAO DE CORRESPONDENCIA INSPECOES x ORACLE ===");
  for (const spec of SPECS) {
    totalOfficial += spec.required.length;
    const columns = await getTableColumns(spec.table);
    if (!columns) {
      criticalMissing += spec.required.length;
      console.log(`\n[ERRO] ${spec.table}: tabela inacessivel ou inexistente.`);
      continue;
    }

    const report = resolveMissingColumns(spec.table, spec.required, columns);
    totalPresent += report.present.length;
    totalLegacyCovered += report.legacyFallback.length;
    criticalMissing += report.missing.length;

    console.log(`\n[TABELA] ${spec.table}`);
    console.log(`- oficiais presentes: ${report.present.length}/${spec.required.length}`);
    if (report.legacyFallback.length > 0) {
      console.log(`- cobertos por legado: ${report.legacyFallback.length}`);
      for (const item of report.legacyFallback) {
        console.log(`  * ${item.official} <= ${item.fallback}`);
      }
    }
    if (report.missing.length > 0) {
      console.log(`- ausentes sem fallback: ${report.missing.length}`);
      for (const item of report.missing) {
        console.log(`  * ${item}`);
      }
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(`- campos oficiais esperados: ${totalOfficial}`);
  console.log(`- campos oficiais presentes: ${totalPresent}`);
  console.log(`- campos cobertos por fallback legado: ${totalLegacyCovered}`);
  console.log(`- campos ausentes sem fallback: ${criticalMissing}`);

  await closeOraclePool();

  if (criticalMissing > 0) {
    process.exitCode = 2;
  }
}

main().catch(async (error) => {
  console.error("Falha na validacao de schema:", error instanceof Error ? error.message : String(error));
  try {
    await closeOraclePool();
  } catch {
    // noop
  }
  process.exitCode = 1;
});
