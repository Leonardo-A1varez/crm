import { LISTA_VARIABLES_DE_TEXTO } from "./config-nodos";

/**
 * El texto de un mensaje como una lista de segmentos: texto suelto y
 * variables.
 *
 * Es el modelo del editor con chips. La nota 01 del diseño pide que ningún
 * campo acepte `{{ }}` escrito a mano: las variables se eligen de una lista y
 * se ven como chips. Lo que se guarda en `config` sigue siendo el formato que
 * resuelve `interpolarVariables` (`{{namespace.campo}}`), así que el motor no
 * se entera del cambio.
 *
 * Para que ese formato no se pueda escribir a mano, el texto suelto se sanea:
 * toda secuencia de dos o más llaves se reduce a una. Una variable sólo puede
 * nacer de un segmento `variable`, es decir, de la lista.
 */

export type Segmento =
  | { tipo: "texto"; texto: string }
  /**
   * `conocida: false` = una clave que el motor no carga (quedó de un flujo
   * viejo). Se conserva para no borrar lo que alguien escribió, y el editor
   * la marca: el motor la reemplaza por un hueco.
   */
  | { tipo: "variable"; clave: string; conocida: boolean };

/** El mismo patrón que `interpolarVariables` (`variables.ts`). */
const VARIABLE = /\{\{(\w+)\.(\w+)\}\}/g;

const CONOCIDAS: ReadonlySet<string> = new Set(LISTA_VARIABLES_DE_TEXTO);

export function esVariableConocida(clave: string): boolean {
  return CONOCIDAS.has(clave);
}

/** Reduce toda secuencia de llaves dobles (o más) a una sola. */
export function sanearTexto(texto: string): string {
  return texto.replace(/\{{2,}/g, "{").replace(/\}{2,}/g, "}");
}

/** Un texto guardado, partido en segmentos. Los textos vacíos no generan segmento. */
export function parsearTexto(guardado: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let desde = 0;
  for (const m of guardado.matchAll(VARIABLE)) {
    const antes = guardado.slice(desde, m.index);
    if (antes) segmentos.push({ tipo: "texto", texto: sanearTexto(antes) });
    const clave = `${m[1]}.${m[2]}`;
    segmentos.push({ tipo: "variable", clave, conocida: esVariableConocida(clave) });
    desde = m.index + m[0].length;
  }
  const resto = guardado.slice(desde);
  if (resto) segmentos.push({ tipo: "texto", texto: sanearTexto(resto) });
  return segmentos;
}

/** Los segmentos en el formato del motor. El texto suelto sale saneado. */
export function serializarSegmentos(segmentos: readonly Segmento[]): string {
  return segmentos
    .map((s) => (s.tipo === "texto" ? sanearTexto(s.texto) : `{{${s.clave}}}`))
    .join("");
}
