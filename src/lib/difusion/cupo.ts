import { ValidationError } from "@/lib/errors";
import type { CupoDisponible } from "./planificador";

/**
 * El cupo de la ventana móvil de 24 h, en la forma que pide el planificador.
 *
 * El tope es el escalón que Meta devuelve por API (`whatsapp_business_manager_messaging_limit`,
 * vía `SaludWhatsAppService`). Lo usado NO lo expone Meta: se cuenta con los
 * registros de este CRM (`difusion_uso_cupo_24h()`), y quien lo muestre tiene
 * que decirlo, porque el cupo es del portfolio y otro sistema del mismo
 * portfolio también lo consume.
 */

/**
 * Lo que se aparta del tope para conversaciones vivas.
 *
 * Confirmado por el dueño 2026-09-24. El PRD (§7.4, §7.5) y el diseño muestran
 * una reserva de 300 sobre un tope de 2.000 —15 %—. Se toma la proporción y no
 * el absoluto porque 300 fijo con el escalón inicial de 250 dejaría la difusión
 * sin un solo mensaje.
 */
export const RESERVA_CONVERSACIONES_PCT = 15;

/** El restante de un escalón ilimitado: un entero que el planificador acepta. */
export const SIN_TECHO = Number.MAX_SAFE_INTEGER;

export type TopeMensajeria = number | "ilimitado";

export function reservaDelTope(tope: TopeMensajeria): number {
  if (tope === "ilimitado") return 0;
  exigirEnteroNoNegativo(tope, "tope");
  // Hacia arriba: la reserva protege conversaciones en curso, se redondea a su favor.
  return Math.ceil((tope * RESERVA_CONVERSACIONES_PCT) / 100);
}

export function cupoParaPlanificar(input: {
  tope: TopeMensajeria;
  usado24h: number;
}): CupoDisponible {
  exigirEnteroNoNegativo(input.usado24h, "usado24h");
  if (input.tope === "ilimitado") return { restante: SIN_TECHO, reserva: 0 };
  exigirEnteroNoNegativo(input.tope, "tope");
  return {
    restante: Math.max(0, input.tope - input.usado24h),
    reserva: reservaDelTope(input.tope),
  };
}

function exigirEnteroNoNegativo(n: number, nombre: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError(`${nombre} del cupo tiene que ser un entero ≥ 0 (llegó ${n})`);
  }
}
