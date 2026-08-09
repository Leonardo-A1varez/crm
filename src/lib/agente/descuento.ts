/** Porcentaje con coma o punto decimal y espacio opcional antes del simbolo. */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/**
 * Senales de que el porcentaje SI es un descuento ofrecido. La guarda exige una
 * de estas cerca del numero.
 *
 * Sin senal positiva, un "te lo garantizo 100%" o un "bateria cargada al 80%"
 * disparaban y mandaban a un cliente sano a la cola humana. Una lista negra
 * tiene la asimetria al reves: un falso negativo cuesta margen, un falso
 * positivo cuesta un cliente.
 */
const ES_DESCUENTO =
  /\b(descuento|descuentos|dto|off|rebaja|rebajas|bonificacion|bonificaci[oó]n|promo|promocion|promoci[oó]n)\b|\b(te|le|les)\s+(hago|dejo|doy)\b|\b(hacemos|dejamos|ofrecemos|aplicamos)\b/i;

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
 * Red parcial y documentada como tal: exige una senal explicita de descuento
 * cerca del numero ("descuento", "te hago un 15%", "off", etc.). Un descuento
 * insinuado sin esa senal, o expresado en pesos sin porcentaje, no se detecta.
 * Es deliberado: la alternativa (marcar cualquier porcentaje alto) disparaba
 * con "te lo garantizo 100%" o "bateria cargada al 80%" y pausaba conversaciones
 * sanas por nada. El valor esta en atajar el desvio comun, no en resistir a
 * alguien que quiera evadirla.
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
    if (!ES_DESCUENTO.test(contexto)) continue;
    if (NO_ES_DESCUENTO.test(contexto)) continue;

    if (mayor === null || valor > mayor) mayor = valor;
  }

  return mayor;
}
