import { getLogger } from "@/lib/observability/get-logger";
import type { DisparoWorkflow, SesionDelDisparo } from "@/lib/workflows/disparos";
import { emitirDisparoWorkflow } from "@/server/bootstrap/workflows-bootstrap";
import type { ConversationView } from "@/types/inbox";

const logger = getLogger({ scope: "inbox-disparos" });

/**
 * Les avisa a los flujos de un cambio que una persona hizo a mano. Los cambios
 * que hace un flujo con sus propias acciones no pasan por acá, y así un flujo
 * no se dispara a sí mismo en bucle.
 *
 * Devuelve si Inngest recibió el disparo. Cuando no, el cambio ya quedó hecho
 * en la base y no se deshace; la action lo dice en vez de responder "listo",
 * porque un flujo que no arranca en silencio es justo lo que no se ve nunca.
 */
export async function avisarAFlujos(disparo: DisparoWorkflow): Promise<boolean> {
  try {
    await emitirDisparoWorkflow(disparo);
    return true;
  } catch (e) {
    // Solo el disparador y el lead: el `id` y el contexto no suman y el
    // mensaje de un error de red puede traer la URL con la clave.
    logger.error("disparo-manual-no-enviado", {
      disparador: disparo.data.disparador,
      lead_id: disparo.data.leadId,
      error_name: e instanceof Error ? e.name : typeof e,
    });
    return false;
  }
}

/** Lo que un disparo necesita de la vista del Twin, sacado de `getConversation`. */
export function fuenteDelDisparo(vista: ConversationView) {
  return {
    lead: vista.lead,
    sesion: vista.session satisfies SesionDelDisparo | null,
    canal: vista.canalActivo,
  };
}
