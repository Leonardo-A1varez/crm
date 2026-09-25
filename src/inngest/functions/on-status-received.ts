import { inngest } from "@/inngest/client";
import { statusReceived } from "@/inngest/events";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { MotorDifusionService } from "@/server/services/difusion/motor.service";
import type { EstadoEntrega } from "@/types/domain";

export interface OnStatusReceivedDeps {
  messages: MessagesRepository;
  /**
   * Los envíos de difusión no están en `mensajes`: su estado vive en
   * `difusion_envios` y un fallido puede frenar la difusión o registrar una
   * baja. Obligatorio: sin él, una difusión quedaría en "aceptado" para
   * siempre y un 131050 no daría de baja a nadie.
   */
  difusion: Pick<MotorDifusionService, "aplicarEstadoWebhook">;
}

export interface OnStatusReceivedInput {
  meta_message_id: string;
  estado: EstadoEntrega;
  /** ISO: el evento viaja por Inngest y una `Date` no sobrevive el JSON. */
  at: string;
  error: string | null;
  /** Ausentes en eventos encolados antes de que el parser los leyera. */
  error_codigo?: string | null;
  error_detalle?: string | null;
}

export interface OnStatusReceivedResult {
  aplicado: boolean;
  motivo: "ok" | "difusion" | "mensaje_desconocido";
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
  if (actualizado) return { aplicado: true, motivo: "ok" };

  // Una plantilla de difusión no tiene fila en `mensajes`: se busca su envío.
  const deDifusion = await deps.difusion.aplicarEstadoWebhook({
    wamid: input.meta_message_id,
    estado: input.estado,
    codigo: input.error_codigo ?? null,
    detalle: input.error_detalle ?? null,
  });
  if (deDifusion) return { aplicado: true, motivo: "difusion" };

  // Meta reporta estados de mensajes que no salieron de acá —plantillas
  // disparadas desde su consola, por ejemplo—. No es un error ni algo para
  // reintentar: se responde ok y el evento muere.
  return { aplicado: false, motivo: "mensaje_desconocido" };
}

export function makeOnStatusReceivedFn(deps: OnStatusReceivedDeps) {
  return inngest.createFunction(
    { id: "on-status-received", triggers: [{ event: statusReceived }] },
    async ({ event }) => onStatusReceivedHandler(event.data.parsed, deps),
  );
}
