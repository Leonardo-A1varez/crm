/** Porcentaje con coma o punto decimal y espacio opcional antes del simbolo. */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/** Sustantivos que solo significan descuento. */
const SUSTANTIVO_DESCUENTO =
  /\b(descuento|descuentos|dto|rebaja|rebajas|bonificaci[oó]n|bonificacion|promo|promoci[oó]n|promocion)\b/i;

/**
 * Ofrecimiento en primera persona hacia el cliente: "te hago un 15%",
 * "te lo dejo en 15%", "les damos un 10%". El clitico opcional esta
 * contemplado —"te LO dejo"— porque exigir adyacencia dejaba afuera una
 * construccion tan comun como la que si matcheaba.
 */
const OFRECIMIENTO = /\b(te|le|les)\s+(lo|la|los|las)?\s*(hago|hacemos|dejo|dejamos|doy|damos)\b/i;

/**
 * Bajar el precio, con la palabra `precio` pegada al verbo. El ancla es
 * obligatoria: sin ella, "la bateria baja 20% en invierno" disparaba, y
 * "bajar" es de los verbos mas genericos del idioma.
 */
const BAJA_DE_PRECIO =
  /\b(baj|rebaj)\w*\s+(el\s+|los\s+|un\s+)?precios?\b|\bprecios?\s+(baj|rebaj)\w*/i;

/** "20% off" — el anglicismo es inequivoco en contexto comercial. */
const OFF = /\d{1,3}(?:[.,]\d{1,2})?\s*%\s*off\b/i;

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
 * a dejar pasar parafrasis. Por eso la guarda solo dispara con lenguaje
 * inequivoco ("descuento", "te hago un 15%", "bajamos el precio", "% off") y
 * acepta las parafrasis como falso negativo: bloquear una respuesta sana le
 * cuesta un cliente a la empresa, no detectar una parafrasis le cuesta margen,
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
      OFRECIMIENTO.test(contexto) ||
      BAJA_DE_PRECIO.test(contexto) ||
      OFF.test(contexto);
    if (!esDescuento) continue;
    if (NO_ES_DESCUENTO.test(contexto)) continue;

    if (mayor === null || valor > mayor) mayor = valor;
  }

  return mayor;
}
