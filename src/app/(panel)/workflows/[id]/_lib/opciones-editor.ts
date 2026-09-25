import { stageLabel } from "@/lib/ui/stage";
import { CURRENT_STAGE } from "@/types/domain";
import type { Intent, Usuario } from "@/types/entities";

/** Una opción de los selectores de `canvas/config/`: el id que se guarda y el nombre que se ve. */
export interface OpcionSelect {
  id: string;
  nombre: string;
}

const MARCA_INACTIVO = " (inactivo)";

/**
 * Las ocho etapas en el orden del dominio: las seis del embudo y después los
 * dos desvíos. Los desvíos entran porque mover una sesión a `requiere_humano`
 * es cómo un flujo escala, y a `perdido`, cómo cierra un seguimiento sin
 * respuesta.
 */
export function opcionesDeEtapas(): OpcionSelect[] {
  return CURRENT_STAGE.map((etapa) => ({ id: etapa, nombre: stageLabel(etapa) }));
}

/**
 * Activos primero y por nombre. Los inactivos se listan marcados en vez de
 * filtrarse: los formularios de `canvas/config/` dibujan una selección guardada
 * sólo si su id está entre las opciones, así que filtrar haría desaparecer del
 * panel un intent o un vendedor que el flujo sigue usando.
 */
function activosPrimero(
  items: readonly { id: string; nombre: string; activo: boolean }[],
): OpcionSelect[] {
  return [...items]
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es"))
    .map((i) => ({ id: i.id, nombre: i.activo ? i.nombre : `${i.nombre}${MARCA_INACTIVO}` }));
}

export function opcionesDeIntents(intents: readonly Intent[]): OpcionSelect[] {
  return activosPrimero(intents);
}

/** Todo el equipo, admins incluidos: en una casa chica el dueño también vende. */
export function opcionesDeVendedores(usuarios: readonly Usuario[]): OpcionSelect[] {
  return activosPrimero(usuarios);
}
