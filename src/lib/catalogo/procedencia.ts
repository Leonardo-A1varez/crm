/**
 * La procedencia de un producto: de dónde viene la pieza (MOBIS, KOREA, CHINA,
 * GM…). El dueño la llama así; en el ERP vive en `descripcion_auxiliar`, que en
 * la tabla es `productos.descripcion`.
 *
 * Esa columna es un campo libre: junto a las procedencias trae medidas
 * (`52*88C`, `54*88°`), sobremedidas (`+20`, `STD`), cantidades (`555`, `0`) y
 * restos (`C/U`). Cotizar "52*88C $11,23" sería inventarle una procedencia a la
 * pieza, así que solo cuenta como procedencia un texto de letras: sin dígitos ni
 * símbolos de medida.
 */

/** Marcadores de sobremedida que son solo letras y se colarían como procedencia. */
const NO_ES_PROCEDENCIA = new Set(["STD"]);

const SOLO_LETRAS = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .-]*$/;

/** La procedencia en mayúsculas, o `null` si el texto no es una (vacío o basura). */
export function procedenciaDe(descripcion: string | null | undefined): string | null {
  const t = (descripcion ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (t === "" || t.length > 24) return null;
  if (!SOLO_LETRAS.test(t)) return null;
  if (NO_ES_PROCEDENCIA.has(t)) return null;
  return t;
}
