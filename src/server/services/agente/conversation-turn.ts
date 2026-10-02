import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { AgentTurnInput, AgentVehiculo } from "@/server/services/ai-agent.service";
import type { IntentClassification } from "@/lib/validation/ai";
import type { LeadVehiculo, UUID } from "@/types/entities";

/**
 * El contexto que ve el agente: el resumen previo (si hay) y los últimos
 * mensajes de la conversación, del más viejo al más nuevo. Lo comparten el
 * pipeline y "Regenerar" del copiloto, que tiene que reconstruir el mismo turno.
 */
export async function buildConversationTurn(
  conversacionId: UUID,
  messages: Pick<MessagesRepository, "listByConversacion">,
  contextSummary: string | null,
  limit: number,
): Promise<string[]> {
  const recent = await messages.listByConversacion(conversacionId, { limit });
  const formatted = recent
    .slice()
    .reverse()
    .map((m) => `${m.sender}: ${m.contenido ?? ""}`);
  if (contextSummary) {
    return [`[Resumen previo]: ${contextSummary}`, ...formatted];
  }
  return formatted;
}

/**
 * El input de `aiAgent.respond` de un turno. Lo comparten el pipeline y
 * "Regenerar" para que los dos le pasen al agente exactamente los mismos campos:
 * si uno gana un campo y el otro no, regenerar contesta distinto de lo que
 * habría contestado el pipeline (así faltaba `instruccionesTramo`).
 *
 * `instruccionesTramo` solo viaja si algún tramo delegado vivo trae
 * instrucciones; sin ellas la clave no existe.
 */
export function buildRespondInput(turno: {
  leadSessionId: UUID;
  conversationTurn: string[];
  classification: IntentClassification;
  mensajeOrigenId: UUID;
  tramos: ReadonlyArray<{ instrucciones: string | null }>;
  /** Ver `AgentTurnInput.vehiculos`. Sin ellos la clave no existe. */
  vehiculos?: AgentVehiculo[];
  /** Ver `AgentTurnInput.soloRedactar`: lo pide "Regenerar", nunca el pipeline. */
  soloRedactar?: boolean;
}): AgentTurnInput {
  const instruccionesTramo = turno.tramos.flatMap((t) =>
    t.instrucciones !== null ? [t.instrucciones] : [],
  );
  return {
    leadSessionId: turno.leadSessionId,
    conversationTurn: turno.conversationTurn,
    classification: turno.classification,
    mensajeOrigenId: turno.mensajeOrigenId,
    ...(instruccionesTramo.length > 0 ? { instruccionesTramo } : {}),
    ...(turno.vehiculos ? { vehiculos: turno.vehiculos } : {}),
    ...(turno.soloRedactar ? { soloRedactar: true } : {}),
  };
}

/**
 * Los autos del lead como los ve el agente: solo marca/modelo/año/motor (placa
 * y VIN no viajan al LLM), el principal primero y después el más nuevo, con el
 * primero marcado como el vigente. Lo comparten el pipeline, "Regenerar" y el
 * preview, para que los tres le den al agente el mismo dato.
 */
export function vehiculosParaAgente(filas: readonly LeadVehiculo[]): AgentVehiculo[] {
  return filas
    .slice()
    .sort((a, b) =>
      a.principal !== b.principal
        ? a.principal
          ? -1
          : 1
        : b.created_at.getTime() - a.created_at.getTime(),
    )
    .map((v, i) => ({
      marca: v.marca,
      modelo: v.modelo,
      anio: v.anio,
      motor: v.motor,
      actual: i === 0,
    }));
}
