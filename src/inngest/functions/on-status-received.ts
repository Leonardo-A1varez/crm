import { inngest } from "@/inngest/client";
import { statusReceived } from "@/inngest/events";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { WorkflowPlantillasSinSesionRepository } from "@/server/repositories/workflow-plantillas-sin-sesion.repo";
import type { MotorDifusionService } from "@/server/services/difusion/motor.service";
import type { EstadoEntrega } from "@/types/domain";

export interface OnStatusReceivedDeps {
  messages: MessagesRepository;
  /**
   * El estado de los envíos de difusión vive en `difusion_envios` (en
   * `mensajes` sólo aparecen si el lead respondió), y un fallido puede frenar la difusión o registrar una
   * baja. Obligatorio: sin él, una difusión quedaría en "aceptado" para
   * siempre y un 131050 no daría de baja a nadie.
   */
  difusion: Pick<MotorDifusionService, "aplicarEstadoWebhook">;
  /**
   * Las plantillas que un flujo mandó a un lead sin sesión: viven en su propia
   * tabla hasta que el lead responde (y ahí también en `mensajes`, con el
   * mismo wamid). Obligatorio por lo mismo que `difusion`.
   */
  plantillasSinSesion: Pick<WorkflowPlantillasSinSesionRepository, "aplicarEstadoMeta">;
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
  motivo: "ok" | "difusion" | "plantilla_sin_sesion" | "mensaje_desconocido";
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

  // Siempre, y no sólo cuando no hubo mensaje: la plantilla de una difusión
  // vive en `difusion_envios`, y cuando el lead responde se anota además en el
  // hilo con el mismo wamid (`respuesta.service.ts`). Desde ahí un "leído" o un
  // 131050 tardío tiene que llegar igual al envío. Un wamid que no es de una
  // difusión no hace nada del otro lado.
  const deDifusion = await deps.difusion.aplicarEstadoWebhook({
    wamid: input.meta_message_id,
    estado: input.estado,
    codigo: input.error_codigo ?? null,
    detalle: input.error_detalle ?? null,
  });
  if (deDifusion) return { aplicado: true, motivo: "difusion" };
  // `enviado` es el 200 que ya quedó como aceptado al mandar.
  if (input.estado !== "enviado") {
    const deFlujo = await deps.plantillasSinSesion.aplicarEstadoMeta(
      input.meta_message_id,
      input.estado,
      new Date(input.at),
      input.estado === "fallido"
        ? { codigo: input.error_codigo ?? null, detalle: input.error_detalle ?? null }
        : undefined,
    );
    if (deFlujo) return { aplicado: true, motivo: "plantilla_sin_sesion" };
  }
  if (actualizado) return { aplicado: true, motivo: "ok" };

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
