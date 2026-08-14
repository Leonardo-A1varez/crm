"use server";

import { revalidatePath } from "next/cache";
import { ToggleHandoffSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Saca el aviso de "Requiere humano" desde la ficha del lead.
 *
 * Es exactamente el `resume` del toggle de IA del Inbox —mismo service, misma
 * transición, mismo registro en `handoff_events`—, solo que alcanzable desde la
 * pantalla de Leads. Devuelve la sesión a `stage_before_handoff` y reanuda la
 * IA; no existe una fila de etiqueta que borrar porque el aviso nunca fue una
 * etiqueta, sino `current_stage`.
 *
 * Reusa `ToggleHandoffSchema` en vez de declarar uno propio: los campos son los
 * mismos y dos schemas para la misma operación es cómo se separan con el
 * tiempo. La acción queda fija en `resume` — desde acá todavía no se pone el
 * aviso a mano.
 */
export async function quitarRequiereHumanoAction(raw: unknown): Promise<ActionResult> {
  const parsed = ToggleHandoffSchema.safeParse(raw);
  if (!parsed.success || parsed.data.action !== "resume") {
    return { ok: false, error: "Acción inválida." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.toggleHandoff({ sessionId: parsed.data.sessionId, action: "resume" });
  } catch (e) {
    return toActionError(e, "quitar-requiere-humano", {
      permisoDenegado: "No tenés permiso para reanudar la IA de este lead.",
    });
  }

  // Las dos pantallas que muestran el aviso: la ficha y la lista.
  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath("/leads");
  return { ok: true };
}
