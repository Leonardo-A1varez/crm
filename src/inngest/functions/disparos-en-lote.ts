import { workflowDisparoRecibido } from "@/inngest/events";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";

/**
 * Cuántos disparos viajan en un solo `step.sendEvent`. Inngest acepta lotes;
 * se parten para que un envío que falla repita a lo sumo 500, y para que cada
 * lote sea un step con nombre propio (la clave de idempotencia de AGENTS.md).
 */
export const DISPAROS_POR_LOTE = 500;

export function enLotes<T>(items: readonly T[], tamano = DISPAROS_POR_LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

/** Lo que recibe `step.sendEvent`: el nombre del evento, sus datos y el `id` que deduplica. */
export function comoEventos(disparos: readonly DisparoWorkflow[]) {
  return disparos.map((d) => ({ name: workflowDisparoRecibido.name, data: d.data, id: d.id }));
}

/** La hora de un tick del cron, al minuto: nombra los steps de esa corrida. */
export function claveDeTick(ahora: Date): string {
  return ahora.toISOString().slice(0, 16);
}
