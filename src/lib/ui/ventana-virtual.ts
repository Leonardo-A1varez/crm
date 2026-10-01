/**
 * La cuenta de la virtualización de la tabla de `/productos`: de las 21.000 filas en
 * memoria, cuáles se dibujan.
 *
 * Alto fijo por fila. Eso es lo que permite no medir nada: la fila `i` está en
 * `i · ALTO_FILA` píxeles, el alto total es `total · ALTO_FILA` y el DOM solo lleva las
 * filas cercanas al área visible más una sobrelectura, con dos filas espaciadoras
 * (arriba y abajo) que ocupan el alto de las que no se dibujan. Así la barra de
 * desplazamiento es la de la lista entera y no salta.
 */

/** Alto de cada fila en px. Lo fija `style={{ height }}` en la fila, no el contenido. */
export const ALTO_FILA = 38;
/** Filas extra que se dibujan por encima y por debajo del área visible. */
export const SOBRELECTURA = 8;

export interface Ventana {
  /** Índice (0-based) de la primera fila que se dibuja. */
  inicio: number;
  /** Índice, exclusivo, de la última fila que se dibuja. */
  fin: number;
  /** Alto del espaciador de arriba: lo que ocupan las filas que quedaron antes de `inicio`. */
  altoAntes: number;
  /** Alto del espaciador de abajo. */
  altoDespues: number;
}

export function calcularVentana(
  total: number,
  scrollTop: number,
  altoVisible: number,
  altoFila: number = ALTO_FILA,
  sobrelectura: number = SOBRELECTURA,
): Ventana {
  const n = Math.max(0, Math.floor(total));
  const primera = Math.floor(Math.max(0, scrollTop) / altoFila);
  const inicio = Math.min(n, Math.max(0, primera - sobrelectura));
  const cantidad = Math.ceil(Math.max(0, altoVisible) / altoFila) + sobrelectura * 2;
  const fin = Math.min(n, inicio + cantidad);
  return {
    inicio,
    fin,
    altoAntes: inicio * altoFila,
    altoDespues: (n - fin) * altoFila,
  };
}

/** `aria-rowindex` de la fila de datos `i` (0-based): la 1 es el encabezado. */
export function indiceAriaDeFila(i: number): number {
  return i + 2;
}
