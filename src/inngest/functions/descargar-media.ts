import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { mediaPorDescargar } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import type { Logger } from "@/lib/observability/logger";
import type {
  DescargarMediaService,
  ResultadoDescarga,
} from "@/server/services/media/descargar-media.service";
import type { UUID } from "@/types/entities";

/**
 * Baja en segundo plano el archivo de un mensaje de WhatsApp (docs/meta/media.md).
 * Sólo orquesta: la lógica y la idempotencia viven en `DescargarMediaService`.
 *
 * Reintentos: Inngest reintenta con espera creciente lo que el servicio deja
 * propagar (Meta caída, límite de tasa, URL que no sirvió ni renovada, Storage).
 * Lo que no se arregla reintentando —id de media vencido, archivo muy grande— el
 * servicio lo resuelve solo y queda visible en el hilo, sin gastar reintentos. Si
 * se agotan, `onFailure` deja el mensaje en `fallido`.
 */
export const REINTENTOS_DESCARGA_MEDIA = 5;

export interface DescargarMediaFnDeps {
  servicio: DescargarMediaService;
  logger?: Logger;
}

export interface DescargarMediaEventData {
  mensajeId: UUID;
  phoneNumberId: string | null;
  fecha: string;
}

/** Aparte de la función para poder probarla sin el runtime de Inngest. */
export async function descargarMediaHandler(
  data: DescargarMediaEventData,
  deps: Pick<DescargarMediaFnDeps, "servicio">,
): Promise<ResultadoDescarga> {
  try {
    return await deps.servicio.descargar({
      mensajeId: data.mensajeId,
      phoneNumberId: data.phoneNumberId,
    });
  } catch (error) {
    if (isNonRetriable(error)) {
      throw new NonRetriableError((error as Error).message, { cause: error });
    }
    throw error;
  }
}

export function makeDescargarMediaFn(deps: DescargarMediaFnDeps) {
  return inngest.createFunction(
    {
      id: "descargar-media-mensaje",
      retries: REINTENTOS_DESCARGA_MEDIA,
      // Cada descarga mantiene un archivo (hasta 50 MB) en memoria: se acota para
      // que una ráfaga —el historial de un chat con cientos de fotos— no agote la
      // función.
      concurrency: { limit: 5 },
      triggers: [{ event: mediaPorDescargar }],
      onFailure: async ({ event }) => {
        const original = event.data.event.data as DescargarMediaEventData;
        await deps.servicio.marcarFallida(original.mensajeId, "reintentos_agotados");
        deps.logger?.error("media.descarga.agoto_reintentos", { mensaje_id: original.mensajeId });
      },
    },
    async ({ event, step }) => {
      const { mensajeId, fecha } = event.data;
      // Clave explícita (AGENTS.md §0.9): función, día del mensaje, entidad.
      return step.run(`descargar-media-mensaje-${fecha}-${mensajeId}`, () =>
        descargarMediaHandler(event.data, deps),
      );
    },
  );
}
