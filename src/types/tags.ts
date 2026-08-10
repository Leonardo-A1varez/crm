import type { UUID } from "./entities";

/**
 * Formas derivadas para la vista `/tags` (fase 12). Viven en types/ porque UI
 * (components/) y service (server-services/) las comparten — boundaries no
 * permite components→server-services.
 */
export interface TagListItem {
  id: UUID;
  nombre: string;
  color: string;
  descripcion: string | null;
  /** En cuántos leads está colgada hoy: es lo que la baja se lleva puesta. */
  leadsUsando: number;
}

/**
 * El borrado no alcanza con `ActionResult`: la confirmación muestra un conteo
 * leído en el último render y el toast tiene que poder corregirlo con el que
 * valía al momento de borrar.
 */
export type BorrarTagResult =
  | { ok: true; leadsAfectados: number; nombre: string }
  | { ok: false; error: string };
