/**
 * La clave con la que Difusión compara teléfonos: dígitos E.164, sin `+`.
 *
 * Es la misma clave para las tres cosas que dependen de reconocer a una
 * persona por su número —la deduplicación ("dos leads que comparten teléfono
 * reciben uno"), la lista de bajas y la saturación de Meta—, así que tiene que
 * ser una sola función. Si una copia dejara pasar el `+` y otra no, "+5939…" y
 * "5939…" serían dos personas y la baja de una no alcanzaría a la otra.
 *
 * No reusa `normalizarIdentificador("telefono", …)` de `lib/identificadores`:
 * esa conserva el `+` y acepta cualquier cosa que tenga dígitos. Para el
 * detector de duplicados alcanza; para decidir a quién se le manda un mensaje,
 * no.
 */

/**
 * E.164 sin `+`: ningún código de país empieza con 0, y el total no pasa de 15
 * dígitos. Lo mismo exige la base en `difusion_envios_telefono_e164`. Las
 * bajas no guardan el número: guardan el HMAC de esta forma normalizada
 * (`server/repositories/difusion-supresiones.hash.ts`).
 */
export const TELEFONO_WHATSAPP = /^[1-9][0-9]{6,14}$/;

/** Lo que una persona escribe alrededor de un número y no es parte de él. */
const SEPARADORES = /[\s().-]/g;

/**
 * El número listo para comparar, o `null` si no es un teléfono al que
 * WhatsApp pueda mandar.
 *
 * `null` no es sólo "vacío": los leads de Instagram y Messenger guardan
 * `ig:<id>` en `leads.telefono` para llenar la columna, y quitarle las letras a
 * eso dejaría un número de 17 dígitos que parece de verdad. Un número local sin
 * código de país tampoco sirve: la Cloud API no tiene cómo saber de qué país es.
 */
export function normalizarTelefonoWhatsApp(crudo: string | null | undefined): string | null {
  if (crudo === null || crudo === undefined) return null;
  const limpio = crudo.trim().replace(SEPARADORES, "");
  const digitos = limpio.startsWith("+") ? limpio.slice(1) : limpio;
  return TELEFONO_WHATSAPP.test(digitos) ? digitos : null;
}
