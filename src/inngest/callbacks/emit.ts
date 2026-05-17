/**
 * Emit callbacks que wrappean `inngest.send()` con shapes específicos.
 *
 * Slice 1 7.8: usado por bootstrap para construir CrmInngestDeps. Inngest
 * client.send acepta `{ name, data }` ⇒ wrap delgado adapta nuestros
 * union types (EmittedEvent, PublishedEvent) a la signature requerida.
 */

import type { CrmInngestClient } from "@/inngest/client";
import type { EmittedEvent } from "@/inngest/functions/on-message-received";
import type { PublishedEvent, InngestEmitFn } from "@/server/services/event-bus.service";

/**
 * Para `OnMessageReceivedDeps.emit` — union de 3 events específicos
 * (turn.completed, auto-handoff.evaluate, lead/created).
 */
export function makeEmitForOnMessageReceived(
  client: CrmInngestClient,
): (event: EmittedEvent) => Promise<void> {
  return async (event) => {
    await client.send({ name: event.name, data: event.data });
  };
}

/**
 * Para `DispatchOutboxEventsDeps.inngestEmit` — generic PublishedEvent
 * (cualquier name + data registrado). Outbox dispatcher emite por nombre
 * leído de DB → must aceptar string + Record<string, unknown> sin enum.
 */
export function makeInngestEmitForOutbox(client: CrmInngestClient): InngestEmitFn {
  return async (event: PublishedEvent) => {
    await client.send({
      name: event.name,
      data: event.data,
      ...(event.id ? { id: event.id } : {}),
    });
  };
}
