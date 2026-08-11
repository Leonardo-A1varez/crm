import { MOTIVO_PERDIDA } from "@/types/domain";
import type { MotivoPerdida } from "@/types/domain";

/**
 * Cómo se lee cada motivo de pérdida. Fuente única: el rótulo estaba copiado en
 * el diálogo de cierre, en el historial de sesiones y en los filtros de leads, y
 * las tres copias tenían que decir lo mismo para que un filtro y una fila
 * coincidieran. Ahora hay un solo lugar donde cambiarlo.
 */
export const MOTIVO_LABEL: Record<MotivoPerdida, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

export function motivoPerdidaLabel(motivo: MotivoPerdida): string {
  return MOTIVO_LABEL[motivo];
}

/**
 * Clave con la que el extractor deja **propuesto** un motivo de pérdida en
 * `lead_session.extras`.
 *
 * Vive en `extras` y no en la columna `motivo_perdida` a propósito: esa columna
 * es el motivo *decidido*, y escribirla implica que la sesión está cerrada
 * —`resultado` y `motivo_perdida` se escriben juntos y `LeadSessionUpdate` los
 * prohíbe justamente para eso—. Una propuesta de la IA no cierra nada: espera a
 * que una persona la confirme en el popover del rail. Mientras tanto es un dato
 * suelto de la sesión, que es exactamente lo que `extras` guarda.
 */
export const CLAVE_MOTIVO_SUGERIDO = "motivo_perdida_sugerido";

/**
 * El motivo que propuso la IA, si propuso alguno válido.
 *
 * `extras` es jsonb que llenó un LLM: lo que haya ahí no está tipado ni
 * validado por nadie más. Cualquier cosa que no sea uno de los cinco motivos
 * del enum se descarta en silencio —una sugerencia mal formada no es un error
 * que el vendedor tenga que resolver, es una sugerencia que no existe—.
 */
export function motivoSugerido(extras: Record<string, unknown>): MotivoPerdida | null {
  const crudo = extras[CLAVE_MOTIVO_SUGERIDO];
  return (MOTIVO_PERDIDA as readonly string[]).includes(crudo as string)
    ? (crudo as MotivoPerdida)
    : null;
}
