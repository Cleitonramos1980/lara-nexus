/**
 * Seed data for Phase 1-3: Torre de Controle, Agendamento, Custódia
 */
import { db } from "./dataStore.js";
import { mockExcecoesTorre, mockTorreKPIs } from "./seedTorreData.js";
import { mockAgendamentosSlots, mockDockCapacity, mockAgendamentoKPIs } from "./seedAgendamentoData.js";
import { mockCustodias, mockCustodiaKPIs } from "./seedCustodiaData.js";

export function seedPhasesData(): void {
  if ((db.torreExcecoes as any[]).length > 0) return;
  db.torreExcecoes = mockExcecoesTorre as any;
  db.torreKPIs = mockTorreKPIs as any;
  db.agendamentosSlots = mockAgendamentosSlots as any;
  db.agendamentoDockCapacity = mockDockCapacity as any;
  db.agendamentoKPIs = mockAgendamentoKPIs as any;
  db.custodias = mockCustodias as any;
  db.custodiaKPIs = mockCustodiaKPIs as any;
}
