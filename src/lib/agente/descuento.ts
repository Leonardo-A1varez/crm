/** Porcentaje con coma o punto decimal y espacio opcional antes del simbolo. */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/** Sustantivos que solo significan descuento. */
const SUSTANTIVO_DESCUENTO =
  /\b(descuento|descuentos|dto|rebaja|rebajas|bonificaci[oó]n|bonificacion|promo|promoci[oó]n|promocion)\b/i;

/**
 * Ofrecimiento donde el porcentaje es el objeto directo: "te hago un 15%",
 * "te lo dejo en 15%", "les damos un 10%".
 *
 * El porcentaje va DENTRO del patron a proposito. Antes se buscaba el verbo y
 * el porcentaje por separado en la misma ventana, y eso disparaba con
 * ofrecimientos de informacion: "te doy el filtro que rinde 20% mas" no ofrece
 * ningun descuento.
 */
const OFRECIMIENTO_CON_PORCENTAJE =
  /\b(te|le|les)\s+(lo|la|los|las)?\s*(hago|hacemos|dejo|dejamos|doy|damos)\s+(un|una|el|la|en|de)?\s*\d{1,3}(?:[.,]\d{1,2})?\s*%/i;

/**
 * Bajar el precio, con la palabra `precio` pegada al verbo y solo en formas de
 * presente o infinitivo. El comodin `baj\w*` incluia el pasado, y
 * "los precios bajaron 20% el año pasado" es una respuesta sobre historia de
 * precios, no una oferta vigente.
 */
const BAJA_DE_PRECIO =
  /\b(bajo|bajamos|baja|bajan|bajar|bajarlo|bajarte|rebajo|rebajamos|rebajar|rebajo)\s+(el\s+|los\s+|un\s+)?precios?\b|\bprecios?\s+(baja|bajan|bajo|bajamos)\b/i;

/** "20% off" — el anglicismo es inequivoco en contexto comercial. */
const OFF = /\d{1,3}(?:[.,]\d{1,2})?\s*%\s*off\b/i;

/**
 * `X% mas/menos de <atributo>` describe una prestacion del producto, no un
 * descuento: "te doy 20% mas de potencia", "te hago 20% menos de consumo".
 * Se exceptua cuando el atributo es el precio —"15% menos del precio de
 * lista"— que si es una oferta.
 *
 * Este veto existe porque el porcentaje puede ser objeto directo de un
 * ofrecimiento sin ser un descuento: la diferencia no esta en el verbo sino en
 * a que se aplica el numero.
 */
const PORCENTAJE_DE_ATRIBUTO =
  /\d{1,3}(?:[.,]\d{1,2})?\s*%\s*(mas|menos|m[aá]s)\s+(de|del|en)\s+(?!precio|precios|lista|valor|costo)/i;

/**
 * "si el precio baja 20%", "cuando el precio baja 20%": habla de un movimiento
 * hipotetico o futuro del precio, no de una oferta que el agente esta haciendo.
 */
const PRECIO_HIPOTETICO = /\b(si|cuando|cuanto|apenas)\s+(el\s+|los\s+)?precios?\s+(baja|bajan)\b/i;

/**
 * Vetos: aunque haya senal de descuento cerca, esto no es un descuento
 * ofrecido. El IVA es el caso que importa — se nombra en casi toda respuesta
 * de precio. Plurales incluidos: `\bimpuesto\b` no matchea "impuestos".
 */
const NO_ES_DESCUENTO = /\b(iva|impuestos?|recargos?|inter[eé]s|intereses|cuotas?)\b/i;

/** Cuantos caracteres alrededor del porcentaje se miran para clasificarlo. */
const VENTANA = 40;

/**
 * Busca descuentos ofrecidos por encima del maximo permitido.
 *
 * Tres rondas de ajuste mostraron que un matcher lexico no puede separar de
 * forma confiable "20% de descuento" de "20% menos de peso" en español: cada
 * ampliacion de las senales reabria falsos positivos, cada acotamiento volvia
 * a dejar pasar parafrasis. Por eso la guarda solo dispara cuando el
 * porcentaje es el objeto directo de un ofrecimiento ("te hago un 15%"), o
 * cuando aparece junto a una senal lexica inequivoca ("descuento", "bajamos
 * el precio", "% off"), y acepta las parafrasis como falso negativo: bloquear
 * una respuesta sana le cuesta un cliente a la empresa, no detectar una parafrasis le cuesta margen,
 * y esa asimetria es la que define el diseño. No es el control del margen —
 * eso lo resuelve la arquitectura, no el texto: el agente no puede inventar
 * precios, porque salen de `buscar_repuesto` contra el catalogo. La solucion
 * de fondo, que un descuento exija una llamada a herramienta y deje de ser un
 * problema de parseo de texto, queda para una tarea posterior.
 *
 * @returns el mayor porcentaje que excede `maximoPct`, o `null` si ninguno lo hace.
 */
export function excedeDescuento(texto: string, maximoPct: number): number | null {
  let mayor: number | null = null;

  for (const match of texto.matchAll(PORCENTAJE)) {
    const crudo = match[1];
    if (crudo === undefined) continue;

    const valor = Number(crudo.replace(",", "."));
    if (Number.isNaN(valor) || valor <= maximoPct) continue;

    const inicio = Math.max(0, (match.index ?? 0) - VENTANA);
    const contexto = texto.slice(inicio, (match.index ?? 0) + match[0].length + VENTANA);
    const esDescuento =
      SUSTANTIVO_DESCUENTO.test(contexto) ||
      OFRECIMIENTO_CON_PORCENTAJE.test(contexto) ||
      BAJA_DE_PRECIO.test(contexto) ||
      OFF.test(contexto);
    if (!esDescuento) continue;
    if (NO_ES_DESCUENTO.test(contexto)) continue;
    if (PORCENTAJE_DE_ATRIBUTO.test(contexto)) continue;
    if (PRECIO_HIPOTETICO.test(contexto)) continue;

    if (mayor === null || valor > mayor) mayor = valor;
  }

  return mayor;
}
