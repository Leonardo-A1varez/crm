/**
 * Dónde va un envío: en qué tanda está, a qué ritmo sale y cuándo termina.
 *
 * Todo sale de dos fuentes reales: el plan que escribió el planificador (las
 * tandas, con su hora de salida y lo que les queda en cola) y el avance
 * medido (cuántos envíos se reservaron en la ventana reciente). Sin ritmo
 * medido no se estima el fin: un número inventado en la pantalla de envío es
 * el que alguien usa para decidir si detiene.
 */

export interface TandaAvance {
  tanda: number;
  /** La salida más temprana de la tanda (`programado_para`). */
  desde: Date;
  total: number;
  enCola: number;
}

/** "Tanda N de M": la primera que todavía tiene algo en cola; la última si ya no queda nada. */
export function tandaActual(tandas: readonly TandaAvance[]): { numero: number; de: number } | null {
  if (tandas.length === 0) return null;
  const orden = [...tandas].sort((a, b) => a.tanda - b.tanda);
  const i = orden.findIndex((t) => t.enCola > 0);
  return { numero: i === -1 ? orden.length : i + 1, de: orden.length };
}

/** Mensajes por segundo reservados en la ventana. `null` si no salió nada en ella. */
export function ritmoMedido(reservados: number, ventanaMs: number): number | null {
  if (reservados <= 0 || ventanaMs <= 0) return null;
  return reservados / (ventanaMs / 1000);
}

/**
 * Cuándo termina, recorriendo el plan: cada tanda pendiente empieza a su hora
 * (o cuando termina la anterior, si ya pasó) y sale al ritmo medido.
 *
 * Supone que el ritmo de ahora se sostiene. Es lo que la pantalla dice al
 * lado del número.
 */
export function estimarFin(input: {
  tandas: readonly TandaAvance[];
  ahora: Date;
  ritmoPorSeg: number | null;
}): Date | null {
  const { ritmoPorSeg } = input;
  if (ritmoPorSeg === null || ritmoPorSeg <= 0) return null;
  const pendientes = [...input.tandas]
    .filter((t) => t.enCola > 0)
    .sort((a, b) => a.tanda - b.tanda);
  if (pendientes.length === 0) return null;

  let t = input.ahora.getTime();
  for (const tanda of pendientes) {
    t = Math.max(t, tanda.desde.getTime()) + (tanda.enCola / ritmoPorSeg) * 1000;
  }
  return new Date(t);
}
