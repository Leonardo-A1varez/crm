/** Porcentaje con coma o punto decimal y espacio opcional antes del simbolo. */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/**
 * Palabras que, cerca de un porcentaje, indican que NO es un descuento. El IVA
 * es el caso que importa: se nombra en casi toda respuesta de precio, y tratarlo
 * como descuento pausaria conversaciones sanas.
 */
const NO_ES_DESCUENTO = /\b(iva|impuesto|recargo|interes|intereses|cuotas?)\b/i;

/** Cuantos caracteres alrededor del porcentaje se miran para clasificarlo. */
const VENTANA = 30;

/**
 * Busca descuentos ofrecidos por encima del maximo permitido.
 *
 * Red parcial y documentada como tal: detecta el caso frecuente y explicito
 * ("te hago un 15%"), no el adversarial. Un descuento expresado en pesos, sin
 * porcentaje, no se detecta. El valor esta en atajar el desvio comun, no en
 * resistir a alguien que quiera evadirla.
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
    if (NO_ES_DESCUENTO.test(contexto)) continue;

    if (mayor === null || valor > mayor) mayor = valor;
  }

  return mayor;
}
