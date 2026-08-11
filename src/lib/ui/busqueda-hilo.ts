/**
 * Búsqueda dentro del hilo de una conversación.
 *
 * Vive acá y no en el componente porque el plegado de acentos y el mapeo de
 * índices es lo único delicado de todo el buscador: el resaltado corta el texto
 * original con los índices que se encuentran acá, así que un solo caracter de
 * corrimiento marca la palabra equivocada. Eso se prueba con tests, no mirando
 * la pantalla.
 */

/**
 * Minúsculas y sin tildes, **conservando la longitud en unidades UTF-16**.
 *
 * `"á".normalize("NFD")` mide dos unidades donde el original medía una: plegar
 * la cadena entera correría todos los índices posteriores. Por eso se pliega
 * caracter por caracter y se descarta el plegado cuando no mide lo mismo que el
 * original — pasa con emojis y con casos como `"İ".toLowerCase()`.
 */
export function plegar(texto: string): string {
  let plegado = "";
  for (const caracter of texto) {
    const sinTilde = caracter.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const candidato = sinTilde.toLowerCase();
    plegado += candidato.length === caracter.length ? candidato : caracter;
  }
  return plegado;
}

/** Rango `[inicio, fin)` sobre el texto original. */
export interface Coincidencia {
  inicio: number;
  fin: number;
}

/** Todas las apariciones de `consulta` en `texto`, sin solaparse. */
export function buscarCoincidencias(texto: string, consulta: string): Coincidencia[] {
  const aguja = plegar(consulta.trim());
  if (aguja.length === 0) return [];

  const pajar = plegar(texto);
  const coincidencias: Coincidencia[] = [];
  let desde = 0;
  for (;;) {
    const inicio = pajar.indexOf(aguja, desde);
    if (inicio === -1) break;
    const fin = inicio + aguja.length;
    coincidencias.push({ inicio, fin });
    desde = fin;
  }
  return coincidencias;
}

export function contarCoincidencias(texto: string, consulta: string): number {
  return buscarCoincidencias(texto, consulta).length;
}

export interface Tramo {
  texto: string;
  /**
   * Posición de la coincidencia dentro del hilo entero, o `null` si el tramo es
   * texto suelto. Es global y no local al mensaje porque el contador y las
   * flechas navegan el hilo, no el mensaje.
   */
  ordinal: number | null;
}

/**
 * Parte el texto en tramos alternados para renderizarlo como nodos.
 *
 * El contenido viene de un tercero por WhatsApp: nunca se inyecta como HTML.
 * Quien dibuja recibe strings y decide qué etiqueta usa para cada tramo.
 */
export function partirTexto(texto: string, consulta: string, ordinalInicial: number): Tramo[] {
  const coincidencias = buscarCoincidencias(texto, consulta);
  if (coincidencias.length === 0) return [{ texto, ordinal: null }];

  const tramos: Tramo[] = [];
  let cursor = 0;
  coincidencias.forEach((coincidencia, i) => {
    if (coincidencia.inicio > cursor) {
      tramos.push({ texto: texto.slice(cursor, coincidencia.inicio), ordinal: null });
    }
    tramos.push({
      texto: texto.slice(coincidencia.inicio, coincidencia.fin),
      ordinal: ordinalInicial + i,
    });
    cursor = coincidencia.fin;
  });
  if (cursor < texto.length) tramos.push({ texto: texto.slice(cursor), ordinal: null });
  return tramos;
}
