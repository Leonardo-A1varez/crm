import type { EstadoEntrega } from "@/types/domain";

/**
 * Los escalones de entrega en orden. `fallido` no es el escalón 4: es una
 * salida, y por eso vale más que todos.
 */
const ORDEN: Record<EstadoEntrega, number> = {
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 4,
};

/**
 * Si `siguiente` puede pisar a `actual`.
 *
 * Meta no garantiza el orden de los webhooks de status: es normal que `read`
 * llegue antes que `delivered`. Sin esta guarda, el reintento de un webhook
 * viejo haría retroceder el estado y la UI mostraría "enviado" en un mensaje
 * que el cliente ya leyó.
 */
export function esAvance(actual: EstadoEntrega | null, siguiente: EstadoEntrega): boolean {
  if (actual === null) return true;
  return ORDEN[siguiente] > ORDEN[actual];
}

/**
 * Los estados desde los que `siguiente` avanza, en orden. Es `esAvance` dado
 * vuelta para meterlo en el WHERE del UPDATE: la guarda tiene que vivir en la
 * misma sentencia que escribe. Con la comparación en JS, "entregado" y "leído"
 * concurrentes leían los dos `enviado`, escribían los dos, y si el UPDATE de
 * "entregado" llegaba último el mensaje retrocedía.
 */
export function estadosQueAvanzanA(siguiente: EstadoEntrega): EstadoEntrega[] {
  return (Object.keys(ORDEN) as EstadoEntrega[]).filter((desde) => esAvance(desde, siguiente));
}
