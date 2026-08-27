/**
 * Estado durante la ejecución de un workflow.
 *
 * Combina los datos del trigger (lead, sesión, mensaje) con las variables que
 * van acumulando los nodos. Se persiste en `workflow_runs.contexto` para
 * permitir recovery: si un segmento corta por espera o falla transitoria, el
 * siguiente arranca con el estado correcto.
 */

import type { Lead, LeadSession, Mensaje, Usuario, UUID } from "@/types/entities";

/**
 * Lo que produjo un paso ya ejecutado. Alimenta la observabilidad de W4.
 */
export interface PasoEjecutado {
  nodoId: string;
  tipo: string;
  entrada: Record<string, unknown>;
  salida: Record<string, unknown>;
  duracionMs: number;
  estado: "ok" | "error" | "skipped";
  error?: string;
  timestamp: Date;
}

/**
 * Estado de una corrida en vuelo.
 *
 * El motor lo construye al arrancar y lo actualiza tras cada paso. Los campos
 * que viajan a `workflow_runs.contexto` son `variables` y nada más: el resto
 * (lead, sesión, etc.) se carga desde la base al reanudar.
 */
export interface ContextoEjecucion {
  workflowId: UUID;
  runId: UUID;
  versionId: UUID;

  /** Datos del trigger que arrancó la corrida. */
  trigger: {
    tipo: string;
    datos: Record<string, unknown>;
  };

  /** Entidades relacionadas, cargadas al arrancar/reanudar. */
  lead?: Lead;
  sesion?: LeadSession;
  vendedor?: Usuario;
  mensaje?: Mensaje;

  /**
   * Variables acumuladas durante la ejecución.
   *
   * Los handlers escriben acá con `ctx.variables.set('nombre', valor)` y los
   * nodos siguientes lo leen vía interpolación `{{var.nombre}}`.
   */
  variables: Map<string, unknown>;

  /** Id del nodo que se está ejecutando. */
  nodoActual: string;

  /** Nodos por los que ya pasó esta corrida. Para detectar ciclos infinitos. */
  nodosEjecutados: Set<string>;

  /** Historial de pasos ejecutados. Se persiste en `workflow_run_pasos`. */
  historialPasos: PasoEjecutado[];

  /** Estado actual de la corrida. */
  estado: "ejecutando" | "esperando" | "completado" | "error" | "cancelado";

  /** Mensaje de error cuando `estado === 'error'`. */
  error?: string;

  /** Cuándo arrancó la corrida. */
  iniciadoEn: Date;

  /** Última actualización. */
  actualizadoEn: Date;
}

/**
 * Serializa las variables del contexto para persistirlas en jsonb.
 *
 * El Map no es serializable a JSON directamente; lo convertimos a objeto plano.
 */
export function serializarVariables(variables: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(variables);
}

/**
 * Reconstruye el Map de variables desde el jsonb de `workflow_runs.contexto`.
 */
export function deserializarVariables(obj: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(obj));
}

/**
 * Crea un contexto vacío para una corrida nueva.
 */
export function crearContextoVacio(params: {
  workflowId: UUID;
  runId: UUID;
  versionId: UUID;
  trigger: { tipo: string; datos: Record<string, unknown> };
  lead?: Lead;
  sesion?: LeadSession;
  vendedor?: Usuario;
  mensaje?: Mensaje;
}): ContextoEjecucion {
  return {
    workflowId: params.workflowId,
    runId: params.runId,
    versionId: params.versionId,
    trigger: params.trigger,
    lead: params.lead,
    sesion: params.sesion,
    vendedor: params.vendedor,
    mensaje: params.mensaje,
    variables: new Map(),
    nodoActual: "",
    nodosEjecutados: new Set(),
    historialPasos: [],
    estado: "ejecutando",
    iniciadoEn: new Date(),
    actualizadoEn: new Date(),
  };
}
