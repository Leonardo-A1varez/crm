/**
 * La espera de una opción: el estado que viaja en `workflow_runs.contexto`
 * entre que "Mensaje con botones" o "Mensaje de lista" manda y el lead elige.
 *
 * El nodo corre dos veces. La primera manda y deja acá qué nodo espera y a qué
 * mensaje (el wamid, que Meta devuelve en `context.id` de la respuesta). El
 * segmento corta, `workflow-segmento` espera el evento de la respuesta y, al
 * reanudar en el MISMO nodo, anota la opción elegida (o nada, si venció). La
 * segunda pasada la lee y sale por su línea.
 *
 * Clave con `$`, como la marca de Probar: ninguna variable de texto ni campo de
 * condición la alcanza.
 */

import type { ContextoRun } from "@/types/workflows";

export const CLAVE_ESPERA_OPCION = "$espera_opcion";

export interface OpcionElegida {
  id: string;
  titulo: string;
}

export interface EsperaDeOpcion {
  nodoId: string;
  /** wamid del mensaje mandado. `null` si Meta no lo devolvió. */
  respondeA: string | null;
  /** La opción que eligió el lead; ausente mientras espera o si venció. */
  respuesta?: OpcionElegida;
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** La espera anotada en el contexto, si es de este nodo. */
export function esperaDeOpcionDe(contexto: ContextoRun, nodoId: string): EsperaDeOpcion | null {
  const v = contexto[CLAVE_ESPERA_OPCION];
  if (!esObjeto(v) || v["nodoId"] !== nodoId) return null;
  const respondeA = typeof v["respondeA"] === "string" ? v["respondeA"] : null;
  const r = v["respuesta"];
  const respuesta =
    esObjeto(r) && typeof r["id"] === "string" && typeof r["titulo"] === "string"
      ? { id: r["id"], titulo: r["titulo"] }
      : undefined;
  return { nodoId, respondeA, ...(respuesta ? { respuesta } : {}) };
}

/** Lo que deja la primera pasada: qué nodo espera y a qué mensaje. */
export function marcarEsperaDeOpcion(nodoId: string, respondeA: string | null): ContextoRun {
  return { [CLAVE_ESPERA_OPCION]: { nodoId, respondeA } };
}

/**
 * El contexto con la opción elegida anotada en la espera en curso. Sin espera
 * anotada, igual: una respuesta que llega a una corrida que ya no espera no se
 * inventa a qué nodo pertenece.
 */
export function conOpcionElegida(contexto: ContextoRun, respuesta: OpcionElegida): ContextoRun {
  const v = contexto[CLAVE_ESPERA_OPCION];
  if (!esObjeto(v)) return contexto;
  return { ...contexto, [CLAVE_ESPERA_OPCION]: { ...v, respuesta } };
}

/** Lo que deja la segunda pasada: la espera ya se resolvió. */
export const ESPERA_DE_OPCION_RESUELTA: ContextoRun = { [CLAVE_ESPERA_OPCION]: null };
