import {
  NIVELES_ORDEN_MAX,
  type CampoOrden,
  type DireccionOrden,
  type NivelOrden,
} from "@/lib/catalogo/columnas-productos";
import { leerOrden } from "@/lib/ui/filtros-productos";

/**
 * El orden multinivel de `/productos`, acumulativo como el «Ordenar > Agregar nivel» de
 * Excel. Vive en la URL como `orden=campo&dir=asc|desc`, repetido: el primero es el
 * principal y cada uno de los siguientes solo desempata dentro de los empates de los
 * anteriores. Hasta `NIVELES_ORDEN_MAX` niveles.
 *
 * Las reglas del clic en "Ordenar" de una columna (`alternarOrden`):
 *
 * 1. Una columna que todavía no ordena se AGREGA como el siguiente nivel, sin desplazar a
 *    ninguno.
 * 2. Una columna que ya ordena y recibe el sentido OPUESTO invierte su sentido y conserva
 *    su nivel.
 * 3. Una columna que ya ordena y recibe el sentido que YA tiene sale del orden: el botón
 *    activo es un interruptor.
 * 4. Una cuarta columna distinta no entra: el orden se reinicia y esa columna queda sola,
 *    como nivel 1. Sin aviso.
 *
 * El orden por defecto (descripción) NO es un nivel elegido: mientras nadie eligió
 * ninguno, el primer clic empieza un orden nuevo con esa columna como nivel 1 en vez de
 * colgarse de él, y ningún botón del panel ni encabezado figura como activo.
 *
 * Puro y sin React. Las funciones de URL devuelven una `URLSearchParams` nueva: quien
 * las llama decide cómo navegar.
 */

/** Escribe `niveles` en la URL, en lugar de los que hubiera. Sin niveles queda el orden por defecto. */
export function escribirOrden(
  actual: URLSearchParams | string,
  niveles: readonly NivelOrden[],
): URLSearchParams {
  const params = new URLSearchParams(actual);
  params.delete("orden");
  params.delete("dir");
  for (const n of niveles.slice(0, NIVELES_ORDEN_MAX)) {
    params.append("orden", n.campo);
    params.append("dir", n.dir);
  }
  return params;
}

/**
 * Los niveles que quedan tras un clic en "Ordenar `dir`" de `campo`, a partir de los
 * niveles elegidos hasta ahora (`[]` si nadie eligió ninguno). Ver las cuatro reglas arriba.
 */
export function alternarOrden(
  elegidos: readonly NivelOrden[],
  campo: CampoOrden,
  dir: DireccionOrden,
): NivelOrden[] {
  const propio = elegidos.find((n) => n.campo === campo);
  if (propio !== undefined && propio.dir === dir) return quitarNivel(elegidos, campo);
  if (propio !== undefined) return elegidos.map((n) => (n.campo === campo ? { campo, dir } : n));
  if (elegidos.length >= NIVELES_ORDEN_MAX) return [{ campo, dir }];
  return [...elegidos, { campo, dir }];
}

/** Saca solo el nivel de esta columna; los demás conservan su orden relativo. */
export function quitarNivel(elegidos: readonly NivelOrden[], campo: CampoOrden): NivelOrden[] {
  return elegidos.filter((n) => n.campo !== campo);
}

/** La URL tras un clic en "Ordenar `dir`" de `campo`. */
export function ordenarColumna(
  actual: URLSearchParams | string,
  campo: CampoOrden,
  dir: DireccionOrden,
): URLSearchParams {
  const params = new URLSearchParams(actual);
  return escribirOrden(params, alternarOrden(leerOrden(params), campo, dir));
}

/** La URL tras "Quitar orden de esta columna". */
export function quitarOrdenDeColumna(
  actual: URLSearchParams | string,
  campo: CampoOrden,
): URLSearchParams {
  const params = new URLSearchParams(actual);
  return escribirOrden(params, quitarNivel(leerOrden(params), campo));
}

/** La URL tras "Quitar todo el orden": vuelve el orden por defecto. */
export function quitarTodoElOrden(actual: URLSearchParams | string): URLSearchParams {
  return escribirOrden(actual, []);
}

/** Cómo está ordenada una columna, para su encabezado, su panel y el aria-sort. */
export interface OrdenDeColumna {
  /** Posición entre los niveles elegidos (1 a 3), o `null` si la columna no ordena. */
  nivel: number | null;
  dir: DireccionOrden | null;
  /** Cuántos niveles hay elegidos. El número de nivel solo se dibuja con 2 o más. */
  niveles: number;
}

export function ordenDeColumna(elegidos: readonly NivelOrden[], campo: CampoOrden): OrdenDeColumna {
  const i = elegidos.findIndex((n) => n.campo === campo);
  return {
    nivel: i === -1 ? null : i + 1,
    dir: i === -1 ? null : (elegidos[i]?.dir ?? null),
    niveles: elegidos.length,
  };
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

/** Cómo se lee el sentido de cada campo: letras, números o estado. */
const TIPO_ORDEN: Record<CampoOrden, "texto" | "numero" | "estado"> = {
  codigo: "numero",
  codigoFabrica: "texto",
  otrosCodigos: "texto",
  categoria: "texto",
  descripcion: "texto",
  marca: "texto",
  precio: "numero",
  stock: "numero",
  estado: "estado",
};

export function rotulosDeOrden(campo: CampoOrden): { asc: string; desc: string } {
  switch (TIPO_ORDEN[campo]) {
    case "numero":
      return { asc: "Menor a mayor", desc: "Mayor a menor" };
    case "estado":
      return { asc: "Activos primero", desc: "Inactivos primero" };
    case "texto":
      return { asc: "A → Z", desc: "Z → A" };
  }
}
