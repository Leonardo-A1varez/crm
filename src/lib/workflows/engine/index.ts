/**
 * Motor de ejecución de workflows.
 *
 * Exporta las funciones y tipos necesarios para ejecutar workflows:
 * - ejecutarWorkflow: ejecuta un workflow desde el inicio
 * - reanudarWorkflow: reanuda un workflow que estaba esperando
 * - interpolar: reemplaza {{variables}} en texto
 * - evaluarCondicion: evalúa una condición contra el contexto
 */

// Ejecutor principal
export {
  ejecutarWorkflow,
  reanudarWorkflow,
  serializarVariables,
  deserializarVariables,
  type ResultadoEjecucion,
  type EjecucionCallbacks,
} from "./ejecutar-workflow";

// Contexto de ejecución
export {
  crearContextoVacio,
  type ContextoEjecucion,
  type PasoEjecutado,
} from "./contexto-ejecucion";

// Interpolador de variables
export {
  interpolar,
  interpolarTexto,
  interpolarValor,
  type ResultadoInterpolacion,
} from "./interpolador-variables";

// Evaluador de condiciones
export {
  evaluarCondicion,
  evaluarCondiciones,
  evaluarGrupo,
  OPERADORES_CONDICION,
  type Condicion,
  type GrupoCondiciones,
  type OperadorCondicion,
} from "./evaluador-condicion";

// Ejecutor de paso individual
export { ejecutarPaso, crearPasoSkipped, type ResultadoPaso } from "./ejecutar-paso";

// Handlers
export {
  inicializarHandlers,
  registrarHandler,
  obtenerHandler,
  tieneHandler,
  tiposConHandler,
  type Handler,
  type ResultadoHandler,
} from "./handlers";
