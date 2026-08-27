/**
 * Registro central de handlers para tipos de nodo.
 *
 * Cada handler recibe la config interpolada y el contexto de ejecución,
 * y devuelve el resultado con el puerto de salida y opcionalmente nuevas
 * variables para el contexto.
 */

import type { Puerto } from "@/types/workflows";
import type { ContextoEjecucion } from "../contexto-ejecucion";

/**
 * Lo que devuelve un handler tras ejecutarse.
 */
export interface ResultadoHandler {
  /** Puerto de salida. La mayoría usan "salida"; condición usa "verdadero"/"falso". */
  puerto: Puerto;
  /** Variables a mergear en el contexto para nodos siguientes. */
  contexto?: Record<string, unknown>;
  /** Datos de salida para observabilidad. */
  salida?: Record<string, unknown>;
  /**
   * Si el paso requiere esperar antes de continuar.
   * El motor corta el segmento y programa la reanudación.
   */
  esperar?: {
    tipo: "tiempo" | "respuesta" | "evento";
    hasta: Date;
    /** Si hay que reanudar en el mismo nodo o en el siguiente. */
    timeout?: boolean;
  };
  /**
   * Diferir la ejecución a otra hora (ej: fuera de horario).
   * El motor corta y reanuda EN ESTE MISMO NODO a la hora indicada.
   */
  diferirHasta?: Date;
}

/**
 * Firma de un handler de nodo.
 */
export type Handler = (
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
) => Promise<ResultadoHandler>;

/**
 * Registro de handlers por tipo de nodo.
 */
const handlers: Map<string, Handler> = new Map();

/**
 * Registra un handler para un tipo de nodo.
 */
export function registrarHandler(tipo: string, handler: Handler): void {
  handlers.set(tipo, handler);
}

/**
 * Obtiene el handler para un tipo de nodo.
 * Devuelve undefined si no hay handler registrado.
 */
export function obtenerHandler(tipo: string): Handler | undefined {
  return handlers.get(tipo);
}

/**
 * Lista los tipos de nodo con handler registrado.
 * Útil para validación y debugging.
 */
export function tiposConHandler(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Verifica si hay handler para un tipo.
 */
export function tieneHandler(tipo: string): boolean {
  return handlers.has(tipo);
}
