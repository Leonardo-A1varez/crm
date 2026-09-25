import type { Canal, CurrentStage } from "@/types/domain";
import type { ContextoRun } from "@/types/workflows";

/**
 * De dónde sale el contexto con que arranca una corrida. Cada disparo pasa lo
 * que sabe: el de mensaje conoce el lead, la sesión y el canal; el de etapa,
 * sólo la sesión.
 */
export interface FuenteContexto {
  lead?: { nombre: string } | null;
  sesion?: {
    current_stage: CurrentStage;
    producto_cotizado_id: string | null;
    precio_cotizado: number | null;
  } | null;
  canal?: Canal;
  /** El lead acaba de escribir. Sólo lo sabe el disparo por mensaje. */
  respondio?: boolean;
}

/**
 * Lo que un disparo siembra en `workflow_runs.contexto`: los campos que las
 * condiciones pueden mirar (`CAMPOS_CONDICION` en `condiciones.ts`). El W2 lo
 * dejó dicho —"lo siembra el disparador y lo amplían las acciones"— pero hasta
 * la Fase 0 ningún disparo existía, así que nadie lo sembraba y toda condición
 * leía un campo ausente y daba `false`.
 *
 * Un campo que el disparo no conoce **no se inventa**: queda ausente, y una
 * condición sobre un campo ausente da `false` (`evaluarCondicion`).
 *
 * - `lead.etapa` es la etapa de la sesión: el lead no tiene etapa propia.
 * - `sesion.tiene_cotizacion` es "hay un producto o un precio cotizado".
 * - `sesion.respondio` sólo lo siembra el disparo por mensaje (`true`).
 *
 * El texto del mensaje no entra: `workflow_runs` no lo alcanza la purga de 29
 * días de las sesiones, y copiarlo ahí lo dejaría vivo después de borrado.
 */
export function contextoDeDisparo(fuente: FuenteContexto): ContextoRun {
  const lead: Record<string, unknown> = {};
  const sesion: Record<string, unknown> = {};

  if (fuente.sesion) {
    lead["etapa"] = fuente.sesion.current_stage;
    sesion["tiene_cotizacion"] =
      fuente.sesion.producto_cotizado_id !== null || fuente.sesion.precio_cotizado !== null;
  }
  if (fuente.lead) lead["nombre"] = fuente.lead.nombre;
  if (fuente.canal) lead["canal"] = fuente.canal;
  if (fuente.respondio !== undefined) sesion["respondio"] = fuente.respondio;

  return { lead, sesion };
}
