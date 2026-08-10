import { inngest } from "@/inngest/client";
import { statusReceived } from "@/inngest/events";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { EstadoEntrega } from "@/types/domain";

export interface OnStatusReceivedDeps {
  messages: MessagesRepository;
}

export interface OnStatusReceivedInput {
  meta_message_id: string;
  estado: EstadoEntrega;
  /** ISO: el evento viaja por Inngest y una `Date` no sobrevive el JSON. */
  at: string;
  error: string | null;
}

export interface OnStatusReceivedResult {
  aplicado: boolean;
  motivo: "ok" | "mensaje_desconocido";
}

export async function onStatusReceivedHandler(
  input: OnStatusReceivedInput,
  deps: OnStatusReceivedDeps,
): Promise<OnStatusReceivedResult> {
  const actualizado = await deps.messages.aplicarEstadoEntrega(input.meta_message_id, {
    estado: input.estado,
    at: new Date(input.at),
    error: input.error,
  });

  // Meta reporta estados de mensajes que no salieron de acá —plantillas
  // disparadas desde su consola, por ejemplo—. No es un error ni algo para
  // reintentar: se responde ok y el evento muere.
  if (!actualizado) return { aplicado: false, motivo: "mensaje_desconocido" };

  return { aplicado: true, motivo: "ok" };
}

export function makeOnStatusReceivedFn(deps: OnStatusReceivedDeps) {
  return inngest.createFunction(
    { id: "on-status-received", triggers: [{ event: statusReceived }] },
    async ({ event }) => onStatusReceivedHandler(event.data.parsed, deps),
  );
}
