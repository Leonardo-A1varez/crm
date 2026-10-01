import { getLogger } from "@/lib/observability/get-logger";
import type { Logger } from "@/lib/observability/logger";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import type { CopilotoService } from "@/server/services/copiloto/copiloto.service";
import type { EstadoCopiloto } from "@/types/copiloto";
import type { ConversationView } from "@/types/inbox";

/**
 * El estado del copiloto para la página del lead, o `null` si no corresponde o no
 * se pudo leer.
 *
 * El copiloto es de WhatsApp: en Instagram y Messenger, o sin sesión activa, no
 * hay interruptor ni tarjeta y ni siquiera se consulta el servicio.
 *
 * Si la lectura falla (la conversación no existe, la base no contesta) se degrada
 * a `null` y se avisa en el log: el copiloto es un agregado, y que falle no puede
 * tirar abajo la ficha entera del lead. Solo se registra el id de la conversación
 * y el tipo de error, nunca su mensaje (puede traer datos del cliente).
 */
export async function cargarEstadoCopiloto(
  view: Pick<ConversationView, "session" | "conversacionId" | "canalActivo">,
  ultimoEntranteId: string | null,
  deps: {
    servicio?: () => Promise<Pick<CopilotoService, "estado">>;
    logger?: Logger;
  } = {},
): Promise<EstadoCopiloto | null> {
  if (!view.session || !view.conversacionId || view.canalActivo !== "wa") return null;
  try {
    const servicio = await (deps.servicio ?? getCopilotoServiceForRequest)();
    return await servicio.estado({
      conversacionId: view.conversacionId,
      ultimoEntranteId,
    });
  } catch (e) {
    (deps.logger ?? getLogger({ scope: "inbox-lead" })).warn("copiloto.estado.degradado", {
      conversacionId: view.conversacionId,
      error: e instanceof Error ? e.name : "desconocido",
    });
    return null;
  }
}
