import { statusVendaDeveSerIgnorado } from "../src/modules/auditoriaCartao/normalization.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const ignorar = [
    "negada",
    "expirada",
    "cancelada",
    "cancelado",
    "estornada",
    "estornado",
  ];

  const manter = [
    "aprovada",
    "pago",
    "autorizada",
    "capturada",
    "",
  ];

  for (const status of ignorar) {
    assert(
      statusVendaDeveSerIgnorado(status) === true,
      `Status deveria ser ignorado: ${status}`,
    );
  }

  for (const status of manter) {
    assert(
      statusVendaDeveSerIgnorado(status) === false,
      `Status nao deveria ser ignorado: ${status}`,
    );
  }

  console.log("- Filtro de status (coluna C) atualizado: negada/expirada/cancelada/estornada ignoradas: OK");
}

run();

