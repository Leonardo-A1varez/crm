/**
 * Normalización de códigos de repuesto.
 *
 * El catálogo del negocio escribe el número de fábrica y le pega encima dos
 * cosas que no son parte del número: la MEDIDA de la pieza (`/STD`, `/0.50`,
 * `/1.00` — sobremedida de rectificación) y el ORIGEN (`/ORG` genuino, `/K`
 * Corea, `/CH` China, `/JP` Japón). El taller que llama dicta lo que está
 * grabado en la pieza vieja: `96389106`. Sin pelar los sufijos esa búsqueda
 * —la que cierra la venta más rápido— no machea.
 */

/** Sobremedida: `STD`, `0`, `2`, `0.50`, `1.00`. Los enteros sueltos son la
 *  notación corta de la casa (`/0` es STD, `/2` es 0.50). */
const MEDIDA = /^(STD|\d{1,2}(\.\d{1,2})?)$/i;

/** Procedencia o marca de la pieza, nunca parte del número de fábrica. */
const ORIGEN = /^(ORG|OEM|K|KR|CH|JP|JAPON|C|TW|USA|BR|IND|PLS|X|NPR|IZU|MET|NP)$/i;

/** Los guiones y espacios colgados los dejó la carga a mano: `.../0.75-`. */
const COLGADO = /[-\s]+$/;

/**
 * Devuelve el número de fábrica sin los sufijos que le agrega la casa.
 * Conserva los separadores internos: `8-97037-801-0` se muestra así en la
 * cotización y en pantalla.
 */
export function normalizarCodigo(codigo: string): string {
  const crudo = String(codigo ?? "").trim();
  if (crudo === "") return "";

  // La medida separada por espacio solo se pela si es inequívoca (`STD` o un
  // decimal). Un entero suelto detrás de un espacio puede ser parte del
  // número —`6PK2005 25212-37112` es un código real— y pelarlo perdería la fila.
  const sinEspacio = crudo.replace(/\s+(STD|\d{1,2}\.\d{1,2})$/i, "");

  const segmentos = sinEspacio.split("/").map((s) => s.trim().replace(COLGADO, ""));

  // Se pela SOLO desde el final, y se corta apenas aparece algo que no es
  // sufijo. Filtrar segmentos del medio obligaría a la función gemela en SQL
  // (`public.plegar_codigo`) a hacer lo mismo, y ahí se vuelve ilegible: dos
  // espejos que divergen mienten, que es la trampa que advierte la migración
  // de `buscar_productos`. Medido sobre el catálogo real: 9 códigos sobre
  // 25.429 quedan sin pelar del todo, y son basura de carga a mano.
  while (segmentos.length > 1) {
    const ultimo = segmentos[segmentos.length - 1] ?? "";
    if (ultimo !== "" && !MEDIDA.test(ultimo) && !ORIGEN.test(ultimo)) break;
    segmentos.pop();
  }

  return segmentos.join("/").replace(COLGADO, "").toUpperCase();
}

/**
 * Clave de búsqueda e indexado: el código normalizado sin ningún separador.
 *
 * Medido sobre las 21.009 filas reales del catálogo: plegar produce 16
 * colisiones sobre 16.995 claves, y las 16 son el mismo código escrito de dos
 * formas (`D-905` contra `D905`, `12860-82600` contra `1286082600`). No
 * confunde piezas distintas — unifica el tipeo inconsistente de la carga.
 */
export function plegarCodigo(codigo: string): string {
  return normalizarCodigo(codigo).replace(/[^A-Z0-9]/g, "");
}
