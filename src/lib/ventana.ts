export const VENTANA_MS = 24 * 60 * 60 * 1000;

/** Debajo de esto la ventana se muestra como "por vencer". */
export const AVISO_MS = 2 * 60 * 60 * 1000;

export type EstadoVentana = "sin-mensajes" | "abierta" | "por-vencer" | "cerrada";

export interface Ventana {
  estado: EstadoVentana;
  /** Momento en que se cierra. `null` si el cliente nunca escribió. */
  vence: Date | null;
  /** Milisegundos que faltan; 0 si está cerrada o no hay mensajes. */
  restanteMs: number;
}

/**
 * Ventana de servicio de 24 h de WhatsApp: fuera de ella Meta rechaza el texto
 * libre y solo acepta plantillas aprobadas.
 *
 * Se mide desde el **último mensaje del cliente**, no desde el inicio de la
 * sesión ni desde nuestra última respuesta: cada mensaje entrante reabre la
 * ventana completa. Contarla desde otro lado la cerraría antes de tiempo y el
 * vendedor no entendería por qué no puede escribir.
 */
export function estadoVentana(ultimoEntranteAt: Date | null, ahora: Date): Ventana {
  if (ultimoEntranteAt === null) {
    return { estado: "sin-mensajes", vence: null, restanteMs: 0 };
  }

  const vence = new Date(ultimoEntranteAt.getTime() + VENTANA_MS);
  const restanteMs = vence.getTime() - ahora.getTime();

  if (restanteMs <= 0) return { estado: "cerrada", vence, restanteMs: 0 };
  if (restanteMs <= AVISO_MS) return { estado: "por-vencer", vence, restanteMs };
  return { estado: "abierta", vence, restanteMs };
}

/** "3 h 20 min" / "45 min". Para el aviso de cuánto queda. */
export function restanteLegible(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
