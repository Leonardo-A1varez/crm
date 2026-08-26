import type { WorkflowEstado } from "@/types/entities";

/**
 * `estado` de una card de `/workflows`. Pura: no toca la base, sólo combina
 * lo que el service ya leyó.
 *
 * Orden de prioridad, de más a menos determinante:
 *   1. sin versión publicada -> `borrador`, sin importar `activo` ni corridas.
 *      Un workflow que nunca publicó nada no puede haber corrido.
 *   2. apagado -> `pausado`. Es la decisión deliberada del admin y pisa
 *      cualquier fallo viejo: un flujo que se apagó porque fallaba no necesita
 *      seguir gritando error mientras está apagado.
 *   3. la corrida más reciente (de los últimos 30 días) falló -> `error`.
 *   4. si no, `activo`.
 */
export function calcularEstadoWorkflow(input: {
  activo: boolean;
  tieneVersionPublicada: boolean;
  ultimoRunFallado: boolean;
}): WorkflowEstado {
  if (!input.tieneVersionPublicada) return "borrador";
  if (!input.activo) return "pausado";
  if (input.ultimoRunFallado) return "error";
  return "activo";
}

export const ESTADO_WORKFLOW_LABEL: Record<WorkflowEstado, string> = {
  activo: "Activo",
  borrador: "Borrador",
  pausado: "Pausado",
  error: "Error",
};

/**
 * Clases del punto/badge de estado. Usa los colores de estado del handoff, no
 * tokens semánticos genéricos: acá el color ES la información (semáforo).
 */
export const ESTADO_WORKFLOW_DOT: Record<WorkflowEstado, string> = {
  activo: "bg-emerald-500",
  borrador: "bg-amber-500",
  pausado: "bg-gray-400 dark:bg-gray-500",
  error: "bg-red-500",
};

export const ESTADO_WORKFLOW_BADGE: Record<WorkflowEstado, string> = {
  activo: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-500",
  borrador: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
  pausado: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  error: "bg-red-600/10 text-red-700 dark:text-red-500",
};
