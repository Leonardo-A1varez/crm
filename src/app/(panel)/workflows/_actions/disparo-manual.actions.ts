"use server";

import { z } from "zod";
import { NotFoundError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { disparoManual } from "@/lib/workflows/disparos";
import { disparadorMatch } from "@/lib/workflows/recorrer";
import { getCurrentRol } from "@/server/auth/guards";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import {
  emitirDisparoWorkflow,
  getWorkflowsAdminServiceForRequest,
} from "@/server/bootstrap/workflows-bootstrap";
import type { ActionResult } from "@/types/inbox";

const logger = getLogger({ scope: "workflows-disparo-manual" });

/**
 * Sin exportar: un archivo `"use server"` sólo puede exportar funciones async.
 *
 * `solicitudId` lo genera la pantalla por cada click (`crypto.randomUUID()`):
 * es la clave de deduplicación del disparo, así que el mismo click reenviado
 * arranca una sola corrida y dos clicks arrancan dos.
 */
const DispararManualSchema = z.object({
  workflowId: z.string().uuid(),
  leadId: z.string().uuid(),
  solicitudId: z.string().uuid(),
});

/**
 * El emisor del trigger "Manual": arranca un flujo puntual para un lead
 * puntual. Todavía no tiene pantalla.
 *
 * Todo lo que haría que el disparo no arranque nada se chequea acá y se dice
 * con palabras —el flujo pausado, sin publicar, con otro disparador—: la
 * corrida arranca en Inngest, después de que esta action ya respondió, y un
 * "listo" que no arranca nada es exactamente el silencio que se quiere evitar.
 * Lo único que no se puede saber acá es si el lead ya tiene una corrida viva de
 * ese flujo (`arrancar_workflow_run` la ignora): eso se ve en el historial.
 *
 * Sólo admin, como el resto de `/workflows`: el disparo lo procesa Inngest con
 * service-role, así que RLS no protege nada después de este punto.
 */
export async function dispararWorkflowManualAction(raw: unknown): Promise<ActionResult> {
  const parsed = DispararManualSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }
  const { workflowId, leadId, solicitudId } = parsed.data;

  try {
    if ((await getCurrentRol()) !== "admin") {
      throw new PermissionDeniedError("solo un admin dispara flujos a mano");
    }

    const admin = await getWorkflowsAdminServiceForRequest();
    const detalle = await admin.detalle(workflowId);
    if (!detalle) return { ok: false, error: "El flujo no existe." };
    if (!detalle.workflow.activo) {
      return { ok: false, error: "El flujo está pausado: reanudalo para dispararlo." };
    }
    const publicada = detalle.versiones.find((v) => v.publicada);
    if (!publicada) return { ok: false, error: "El flujo no tiene una versión publicada." };
    if (!disparadorMatch(publicada.grafo, "manual")) {
      return { ok: false, error: "Este flujo no se dispara a mano: su disparador es otro." };
    }

    const inbox = await getInboxServiceForRequest();
    const vista = await inbox.getConversation(leadId);
    await emitirDisparoWorkflow(
      disparoManual({
        workflowId,
        solicitudId,
        lead: vista.lead,
        sesion: vista.session,
        canal: vista.canalActivo,
      }),
    );
  } catch (e) {
    return fallo(e, workflowId);
  }

  return { ok: true };
}

function fallo(e: unknown, workflowId: string): ActionResult {
  if (e instanceof PermissionDeniedError) {
    return { ok: false, error: "Solo un administrador puede hacer esto." };
  }
  if (e instanceof NotFoundError) return { ok: false, error: "El lead no existe." };
  if (e instanceof ValidationError) return { ok: false, error: e.message };
  // Solo ids: el mensaje de un error de red o de Postgres no llega a la pantalla.
  logger.error("disparo-manual-fallo", {
    workflow_id: workflowId,
    error_name: e instanceof Error ? e.name : typeof e,
  });
  return { ok: false, error: "No se pudo disparar el flujo." };
}
