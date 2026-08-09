/** Porcentaje con coma o punto decimal y espacio opcional antes del simbolo. */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/**
 * Senales lexicas de descuento. La guarda exige una cerca del numero: sin senal
 * positiva, un "te lo garantizo 100%" o un "bateria cargada al 80%" disparaban
 * y mandaban a un cliente sano a la cola humana.
 *
 * El clitico opcional (`te LO dejo`) esta contemplado a proposito: exigir
 * pronombre y verbo adyacentes dejaba afuera una construccion tan comun como
 * la que si matcheaba.
 */
const ES_DESCUENTO =
  /\b(descuento|descuentos|dto|off|rebaja|rebajas|rebajo|rebajamos|bonificacion|bonificaci[oó]n|promo|promocion|promoci[oó]n)\b|\b(te|le|les|lo|la)\s+(lo|la|los|las)?\s*(hago|dejo|doy|bajo|bajamos|bajarlo|rebajo)\b|\b(hacemos|dejamos|ofrecemos|aplicamos|restamos|bonificamos|bajamos|bajarlo|baja)\b/i;

/**
 * "X% menos" y "X% mas barato" solo cuentan como descuento si hay una palabra
 * de precio cerca. Sin ese ancla, "tiene 30% menos de peso" —una especificacion
 * de producto— volveria a disparar, que es justo el falso positivo que este
 * modulo dejo de tener.
 */
const RECORTE_DE_PRECIO = /\b(menos|mas barato|m[aá]s barato)\b/i;
const PALABRA_DE_PRECIO =
  /\b(precio|precios|sale|cuesta|queda|quedan|pagas|pag[aá]s|abonas|abon[aá]s|total|lista|efectivo)\b/i;

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
 * Reconoce las formas frecuentes de ofrecer un descuento ("te hago un 15%",
 * "te lo dejo en 20% menos del precio", "restamos un 10%", etc.), no todas
 * las posibles: un LLM puede expresar un descuento con una frase fuera de esta
 * lista, o en pesos sin porcentaje, y esta guarda no lo va a ver. Es una red
 * que reduce la exposicion, no un control que la elimina. El control real
 * sobre el margen esta en otro lado: el agente no puede inventar precios,
 * porque salen de `buscar_repuesto` contra el catalogo.
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
      ES_DESCUENTO.test(contexto) ||
      (RECORTE_DE_PRECIO.test(contexto) && PALABRA_DE_PRECIO.test(contexto));
    if (!esDescuento) continue;
    if (NO_ES_DESCUENTO.test(contexto)) continue;

    if (mayor === null || valor > mayor) mayor = valor;
  }

  return mayor;
}
