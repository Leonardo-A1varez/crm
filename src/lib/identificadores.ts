import type { IdentificadorTipo } from "@/types/domain";

/**
 * Reglas de los datos que identifican a un lead: cómo se normalizan para
 * comparar y hasta dónde se les cree.
 *
 * Vive en `lib/` y no en el repositorio porque la misma regla la necesitan tres
 * capas que no se pueden importar entre sí: el schema Zod de la Server Action
 * (`lib/validation`), el repositorio que escribe la fila y el detector de
 * duplicados. `eslint-plugin-boundaries` prohíbe `lib → server-repositories`, y
 * la alternativa —una copia en cada lado— es exactamente lo que rompe la
 * detección: basta que una copia deje de sacar los guiones para que dos filas
 * del mismo teléfono dejen de matchear.
 */

/**
 * Normaliza para comparar: sin espacios ni separadores, y en minúscula.
 *
 * La comparación del detector se hace contra `valor`, y dos formas del mismo
 * teléfono —"+54 9 11 5555-0002" y "5491155550002"— tienen que caer en la misma
 * cadena o el duplicado no se detecta. `valor_original` conserva lo que la
 * persona escribió.
 */
export function normalizarIdentificador(tipo: IdentificadorTipo, crudo: string): string {
  const limpio = crudo.trim();
  if (tipo === "email") return limpio.toLowerCase();
  if (tipo === "telefono") return limpio.replace(/[^0-9+]/g, "");
  // RUC, placa y VIN: alfanuméricos. Los guiones y espacios de "AB-123-CD" o
  // "AB 123 CD" son decoración de quien escribe, no parte del identificador.
  return limpio.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

/**
 * Un VIN tiene 17 caracteres alfanuméricos (ISO 3779). Es el único de los cinco
 * tipos con un largo fijo en todo el mundo, y por eso el único que se puede
 * rechazar por forma sin riesgo de tirar un dato legítimo.
 */
export const LARGO_VIN = 17;

/**
 * Tope de cada tipo, medido sobre el valor **normalizado**.
 *
 * Son cotas defensivas contra un pegado accidental, no validadores de formato:
 * el producto vende en seis países y el documento fiscal se llama RUC, CUIT,
 * CNPJ, RFC, RUT o NIT según dónde, con largos de 9 a 14 dígitos. Un validador
 * estricto por país rechazaría clientes reales; un tope holgado no rechaza a
 * nadie y sigue frenando el copy-paste de un párrafo entero.
 */
export const LARGO_MAX_IDENTIFICADOR: Record<IdentificadorTipo, number> = {
  // E.164 admite 15 dígitos más el `+`; el resto es margen para prefijos raros.
  telefono: 20,
  // Largo máximo de una dirección de correo según RFC 5321.
  email: 254,
  // El más largo de la región es el CNPJ brasileño, de 14 dígitos.
  ruc: 20,
  // Las patentes de la región van de 6 a 8 caracteres una vez sacados los guiones.
  placa: 12,
  vin: LARGO_VIN,
};

/**
 * Tope de lo que se acepta tipear, antes de normalizar.
 *
 * Es más grande que cualquier tope por tipo porque los separadores que la
 * persona escribe —espacios, guiones, paréntesis— se van en la normalización y
 * no deberían gastar cupo. Existe para que el schema no tenga que normalizar un
 * texto de un megabyte antes de poder rechazarlo.
 */
export const LARGO_MAX_CRUDO = 300;

/** `true` si el valor ya normalizado tiene forma de VIN. */
export function esVinValido(valorNormalizado: string): boolean {
  return new RegExp(`^[0-9A-Z]{${LARGO_VIN}}$`).test(valorNormalizado);
}
