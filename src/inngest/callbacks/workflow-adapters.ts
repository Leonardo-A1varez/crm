/**
 * Adaptadores que cierran los puertos angostos de la acción `enviar_mensaje`
 * (Task 9, `server/services/workflows/acciones/enviar-mensaje.ts`) contra los
 * repositorios reales. El doc comment de `ConversacionActivaParaEnvio` en ese
 * archivo explica por qué esos puertos NO son `ConversationsRepository` /
 * `AgentConfigProvider` directos y deja explícitamente a Task 10 (este
 * archivo) la responsabilidad de conectarlos.
 */

import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { ConversationsParaEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import type { Conversacion, UUID } from "@/types/entities";

export interface ConversationsParaEnviarMensajeDeps {
  conversations: Pick<ConversationsRepository, "findByLeadId">;
  messages: Pick<MessagesRepository, "findUltimoEntranteAt">;
}

/** Mismo criterio que `latest()` en `handoff-notification.ts`: la de actividad más reciente. */
function masReciente(conversaciones: Conversacion[]): Conversacion | null {
  return conversaciones.reduce<Conversacion | null>(
    (elegida, item) =>
      elegida === null || item.ultima_actividad_at > elegida.ultima_actividad_at ? item : elegida,
    null,
  );
}

/**
 * `ultimo_entrante_at` viene de `findUltimoEntranteAt`, NO de
 * `conversacion.ultima_actividad_at`. Ese campo se toca con cualquier
 * mensaje, saliente incluido -- si se usara acá, el mensaje que
 * `enviar_mensaje` está a punto de mandar refrescaría su propio reloj y la
 * ventana de 24 h de Meta jamás se cerraría, dejando el guard inerte sin que
 * ningún test lo note (el mock más obvio de un `ConversationsRepository`
 * fake tiene ese campo a mano y es tentador reusarlo).
 */
export function makeConversationsParaEnviarMensaje(
  deps: ConversationsParaEnviarMensajeDeps,
): ConversationsParaEnviarMensaje {
  return {
    async findActivaByLead(leadId: UUID) {
      const conversacion = masReciente(await deps.conversations.findByLeadId(leadId));
      if (!conversacion) return null;
      const ultimo_entrante_at = await deps.messages.findUltimoEntranteAt(conversacion.id);
      return { id: conversacion.id, canal: conversacion.canal, ultimo_entrante_at };
    },
  };
}
