import { excedeDescuento } from "@/lib/agente/descuento";
import type { OrigenBorrador } from "@/types/copiloto";

/**
 * Lo mínimo que este módulo necesita de `AgentTurnResult`. Es estructural a
 * propósito: `lib/**` no puede importar de `server/services/**` (boundaries) y
 * `AgentTurnResult` es asignable a esto.
 */
export interface RespuestaDelAgente {
  source: "rule" | "llm" | "handoff";
  respuesta_contenido: string;
  regla_id?: string;
  /** El turno escalaría (`soloRedactar`): no es "IA no disponible", es una escalada. */
  escalada?: true;
}

export type ResultadoRegenerado =
  | { tipo: "listo"; contenido: string; origen: OrigenBorrador; reglaId: string | null }
  | { tipo: "error"; codigo: "ia_no_disponible" | "descuento_excedido" | "escalado" };

/**
 * Qué hace "Regenerar" / "Reintentar" con lo que devolvió `respond`.
 *
 * En el pipeline, un `handoff` o un descuento excedido **descartan** el borrador
 * (la persona no pidió nada). Acá la persona sí pidió redactar: si no hay
 * borrador tiene que verse por qué, así que queda en `error` con un código
 * corto que la tarjeta traduce. No se pausa la IA por un descuento: quien
 * revisa el borrador es una persona.
 */
export function resolverResultadoRegenerado(
  respuesta: RespuestaDelAgente,
  descuentoMaxPct: number,
): ResultadoRegenerado {
  if (respuesta.source === "handoff" && respuesta.escalada) {
    return { tipo: "error", codigo: "escalado" };
  }
  if (respuesta.source === "handoff") return { tipo: "error", codigo: "ia_no_disponible" };
  if (excedeDescuento(respuesta.respuesta_contenido, descuentoMaxPct) !== null) {
    return { tipo: "error", codigo: "descuento_excedido" };
  }
  return {
    tipo: "listo",
    contenido: respuesta.respuesta_contenido,
    origen: respuesta.source === "rule" ? "regla" : "ia",
    reglaId: respuesta.regla_id ?? null,
  };
}
