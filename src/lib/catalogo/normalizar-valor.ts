/**
 * Espacios que se quitan de los bordes de un valor de filtro: espacio, tab, CR,
 * LF y NBSP. Es EXACTAMENTE el conjunto de `btrim(x, E' \t\r\n ')` en
 * `productos_filtrados` (migración 20261001120000).
 *
 * No es `String.prototype.trim()`: ese quita además `\f`, `\v`, BOM y los
 * espacios Unicode (U+2003…), y `btrim` de SQL no. Con dos criterios, un valor
 * que la faceta devuelve de una forma no es el que el filtro compara, y la
 * casilla marcada no encuentra nada. Un solo conjunto en las dos capas.
 */
const BORDES = /^[ \t\r\n ]+|[ \t\r\n ]+$/g;

export function normalizarValor(t: string): string {
  return t.replace(BORDES, "");
}
