import { palabrasDe } from "@/lib/catalogo/puntaje";
import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * Cuánto se parece la categoría del ERP (`BOMBA DE AGUA`) a lo que pidió el
 * cliente.
 *
 * OBSERVACION: "una bomba de agua para el Rio 18" ofrecía como piezas los
 * manguitos del radiador y la bomba de combustible. CAUSA RAIZ: la búsqueda de
 * texto acepta CUALQUIER palabra (`agua` en `MANG PASO AGUA`, `bomba` en `BOMBA
 * COMPLETA COMBUST INYEC`) y `diferencias` tomaba cada categoría entre los
 * candidatos como una opción de pieza. Una categoría que solo comparte una
 * palabra con una frase de dos no es una alternativa: es ruido.
 *
 * Espeja el `nivel_cat` de `buscar_productos` (20261007140000), que usa los
 * niveles 0, 1 y 2; el 3 solo existe acá.
 */

/**
 * Palabras que dicen "el conjunto" y no cuál es la pieza: se resuelven con la
 * lógica de subpiezas (`etiquetaDePieza`), no contra el texto de la categoría.
 * `BOMBA COMPLETA COMBUST INYEC` no es "la bomba completa" que pidió el cliente.
 */
const CALIFICADORES = new Set([
  "completa",
  "completo",
  "completas",
  "completos",
  "conjunto",
  "armado",
  "armada",
  "kit",
  "original",
  "originales",
]);

/** Los calificadores que piden el conjunto entero y no una parte. */
const PIDEN_CONJUNTO = new Set([
  "completa",
  "completo",
  "completas",
  "completos",
  "conjunto",
  "armado",
  "armada",
  "kit",
]);

export interface ConsultaDePieza {
  query: string;
  marca?: string | undefined;
  modelo?: string | undefined;
}

const palabrasPlegadas = (t: string | undefined): string[] =>
  plegarTexto(t ?? "")
    .split(/[^0-9a-z/.*-]+/)
    .filter((p) => p.length > 0);

/** Las palabras de la consulta que dicen QUÉ pieza es: sin relleno, calificadores ni vehículo. */
export function palabrasDePieza(c: ConsultaDePieza): string[] {
  const vehiculo = new Set([...palabrasPlegadas(c.marca), ...palabrasPlegadas(c.modelo)]);
  return [...new Set(palabrasDe(c.query))].filter((p) => !CALIFICADORES.has(p) && !vehiculo.has(p));
}

/** ¿El cliente pidió el conjunto entero ("completa", "conjunto", "kit")? */
export function pideConjunto(c: ConsultaDePieza): boolean {
  return palabrasDe(c.query).some((p) => PIDEN_CONJUNTO.has(p));
}

/**
 * 3: la categoría ES lo pedido (todas sus palabras están en la consulta).
 * 2: contiene todas las palabras de la pieza pedida.
 * 1: comparte algunas. 0: ninguna (el producto entró por el nombre).
 * `null`: no hay nada que comparar (sin categoría, o menos de dos palabras útiles).
 */
export function nivelDeCategoria(
  categoria: string | null | undefined,
  c: ConsultaDePieza,
): 0 | 1 | 2 | 3 | null {
  const cat = plegarTexto((categoria ?? "").trim());
  if (cat === "") return null;
  const palabras = palabrasDePieza(c);
  if (palabras.length < 2) return null;

  const coinciden = palabras.filter((p) => cat.includes(p)).length;
  if (coinciden === 0) return 0;
  if (coinciden < palabras.length) return 1;

  const dichas = new Set(palabrasDe(c.query));
  const deLaCategoria = palabrasDe(cat);
  return deLaCategoria.every((p) => dichas.has(p)) ? 3 : 2;
}

/**
 * Descarta los candidatos cuya categoría solo roza la pieza pedida, siempre que
 * alguno la contenga entera. Si el cliente pidió el conjunto ("la bomba de agua
 * completa") y hay una categoría que ES esa pieza, quedan solo esas: la polea de
 * la bomba ya no es una opción. Sin categoría que la contenga, no toca nada: más
 * vale ofrecer algo que decir "no tenemos".
 */
export function filtrarPorCategoria<T extends { categoria?: string | null | undefined }>(
  hits: readonly T[],
  c: ConsultaDePieza,
): T[] {
  const niveles = hits.map((h) => nivelDeCategoria(h.categoria, c));
  if (!niveles.some((n) => n !== null && n >= 2)) return [...hits];

  const exactas = niveles.some((n) => n === 3);
  const minimo = pideConjunto(c) && exactas ? 3 : 2;
  return hits.filter((_, i) => {
    const n = niveles[i] ?? null;
    return n === null || n >= minimo;
  });
}
