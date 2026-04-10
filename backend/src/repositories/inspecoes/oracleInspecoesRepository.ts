export {
  listSetores,
  listUsuarioSetor,
  getSetoresByUserId,
  addUsuarioSetor,
  removeUsuarioSetor,
} from "./inspecoesSetorRepository.js";

export {
  listModelos,
  getModeloById,
  createModelo,
  updateModelo,
} from "./inspecoesChecklistRepository.js";

export {
  listTiposNc,
  createTipoNc,
  updateTipoNc,
} from "./inspecoesNcRepository.js";

export {
  listExecucoes,
  getExecucaoById,
  createExecucao,
} from "./inspecoesExecucaoRepository.js";

export {
  listPadroesMola,
  createPadraoMola,
  updatePadraoMola,
  listInspecoesMola,
  getInspecaoMolaById,
  createInspecaoMola,
  listMaquinasMola,
} from "./inspecoesMolaRepository.js";
