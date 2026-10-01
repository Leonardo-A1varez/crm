import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { AgentTurnInput } from "@/server/services/ai-agent.service";
import type { IntentClassification } from "@/lib/validation/ai";
import type { UUID } from "@/types/entities";

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
  };
}
