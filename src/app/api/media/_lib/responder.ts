import { NotFoundError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { MediaMensajeParamsSchema } from "@/lib/validation/media.schema";
import type { AccesoMediaService } from "@/server/services/media/acceso-media.service";

const logger = getLogger({ scope: "api-media" });

const SIN_CACHE = { "Cache-Control": "no-store" };

/**
 * El navegador guarda el redirect un rato para no volver a firmar cada vez que el
 * hilo se refresca (el Inbox se actualiza cada pocos segundos), pero menos de lo
 * que dura la firma (`SEGUNDOS_DE_FIRMA`, 300): una URL firmada ya vencida no se
 * reusa. `private`: nunca en un caché compartido.
 */
const CACHE_DEL_REDIRECT = "private, max-age=240";

export interface DepsMedia {
  usuario: () => Promise<{ id: string } | null>;
  servicio: () => Promise<AccesoMediaService>;
}

/**
 * `GET /api/media/<mensajeId>[?descargar=1]` -> 302 a una URL firmada de pocos
 * minutos del archivo del mensaje.
 *
 * **Route handler y no Server Action**: es una lectura idempotente, la dispara un
 * `<img src>` / `<video src>` / un link, y un hilo tiene decenas de archivos que no
 * pueden esperar en la cola de las acciones. `/api` queda fuera del proxy de sesión
 * (`src/proxy.ts`), así que la sesión se exige acá. El service lee con el cliente
 * de ESA sesión: si la RLS no deja ver el mensaje, es un 404 igual que si no
 * existiera (no se distingue "no hay" de "no es tuyo").
 */
export async function responderMedia(
  req: Request,
  mensajeIdCrudo: string,
  deps: DepsMedia,
): Promise<Response> {
  if ((await deps.usuario()) === null) {
    return Response.json({ error: "Sin sesión." }, { status: 401, headers: SIN_CACHE });
  }
  const params = MediaMensajeParamsSchema.safeParse({ mensajeId: mensajeIdCrudo });
  if (!params.success) {
    return Response.json({ error: "Mensaje inválido." }, { status: 400, headers: SIN_CACHE });
  }

  const descargar = new URL(req.url).searchParams.get("descargar") === "1";
  try {
    const servicio = await deps.servicio();
    const url = await servicio.urlDe(params.data.mensajeId, { descargar });
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": CACHE_DEL_REDIRECT },
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return Response.json(
        { error: "Archivo no disponible." },
        { status: 404, headers: SIN_CACHE },
      );
    }
    logger.error("media: no se pudo firmar", {
      error: e instanceof Error ? e.name : "desconocido",
    });
    return Response.json(
      { error: "No se pudo abrir el archivo." },
      { status: 500, headers: SIN_CACHE },
    );
  }
}
