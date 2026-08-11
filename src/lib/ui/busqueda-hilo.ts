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
export interface IndiceHilo {
  /**
   * Por cada texto, cuántas coincidencias quedaron antes que él. Es el
   * `ordinalInicial` que hay que pasarle a `partirTexto` para que la numeración
   * de los tramos sea global al hilo y no local al mensaje.
   */
  ordinalInicial: number[];
  total: number;
}

/**
 * Numera las coincidencias de todo el hilo de una sola pasada.
 *
 * Recibe textos y no mensajes: lo que se resalta es el contenido, y el llamador
 * es quien sabe cuáles se dibujan resaltados y cuáles no. Un mensaje que no
 * pasa por el resaltado —el separador de sistema, por ejemplo— entra como
 * cadena vacía; contarlo acá inventaría ordinales sin ancla en el DOM y el
 * contador diría "5/8" con tres coincidencias imposibles de alcanzar.
 *
 * El orden de `textos` es el orden de la numeración. El hilo lo pasa en
 * cronológico (viejo→nuevo), que es el mismo orden en el que se leen en
 * pantalla pese al `flex-col-reverse`.
 */
export function indexarHilo(textos: readonly string[], consulta: string): IndiceHilo {
  const ordinalInicial: number[] = [];
  let total = 0;
  for (const texto of textos) {
    ordinalInicial.push(total);
    total += contarCoincidencias(texto, consulta);
  }
  return { ordinalInicial, total };
}

/** Un pedazo de mensaje que contiene la coincidencia, listo para mostrar. */
export interface Recorte {
  texto: string;
  /** Se comió texto por delante: quien dibuja pone el "…". */
  recortadoInicio: boolean;
  recortadoFin: boolean;
}

/** Cuánto contexto dejar antes de la coincidencia, y cuánto medir en total. */
const CONTEXTO_PREVIO = 32;
const LARGO_RECORTE = 140;

/**
 * El pedazo del mensaje que rodea a la primera coincidencia.
 *
 * Existe porque el resultado de búsqueda es una línea y un mensaje de WhatsApp
 * puede tener 4096 caracteres: mandar el mensaje entero al cliente para que
 * `truncate` lo corte a los 40 primeros dejaría afuera justo la palabra que se
 * buscó. El recorte se hace acá —sobre los mismos índices que devuelve
 * `buscarCoincidencias`— para que el `partirTexto` del cliente siga encontrando
 * la coincidencia adentro del pedazo que recibe.
 *
 * Sin coincidencia devuelve el principio del texto: el mensaje sigue siendo lo
 * que se muestra aunque el match haya sido por el nombre del lead.
 */
export function recorteConCoincidencia(texto: string, consulta: string): Recorte {
  const [primera] = buscarCoincidencias(texto, consulta);
  // El recorte nunca puede empezar después de la coincidencia: si la palabra
  // aparece en el caracter 5, el contexto previo se achica, no se corre.
  const inicio = primera ? Math.max(0, primera.inicio - CONTEXTO_PREVIO) : 0;
  const fin = Math.min(texto.length, inicio + LARGO_RECORTE);
  return {
    texto: texto.slice(inicio, fin),
    recortadoInicio: inicio > 0,
    recortadoFin: fin < texto.length,
  };
}

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
