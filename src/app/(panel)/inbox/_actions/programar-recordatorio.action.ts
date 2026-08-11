"use server";

import { revalidatePath } from "next/cache";
import { ConflictError } from "@/lib/errors";
import { ProgramarRecordatorioSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Programa el "volver a contactar en 2 días" sobre la conversación.
 *
 * Al vencer NO se le manda nada al cliente: la conversación sube al grupo
 * "Requieren tu atención" del Inbox con su chip, y la decide una persona. El
 * saliente automático es otra cosa y vive en la reactivación.
 */
export async function programarRecordatorioAction(raw: unknown): Promise<ActionResult> {
  const parsed = ProgramarRecordatorioSchema.safeParse(raw);
  if (!parsed.success) {
    // El mensaje del primer issue y no uno genérico: las dos guardas de fecha
    // —pasado y tope de 180 días— son accionables y el vendedor puede corregir.
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Recordatorio inválido." };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Iniciá sesión para programar un recordatorio." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    await svc.programarRecordatorio({
      sessionId: parsed.data.sessionId,
      recordarAt: new Date(parsed.data.recordarAt),
      nota: parsed.data.nota,
      userId: user.id,
    });
  } catch (e) {
    // El duplicado se contesta con el texto del service, que dice qué hacer
    // ("cancelalo antes de poner otro"). El resto de los conflictos —sesión
    // cerrada— caen en el copy común de `toActionError`.
    if (e instanceof ConflictError && e.conflictType === "recordatorio_duplicado") {
      return { ok: false, error: e.message };
    }
    return toActionError(e, "programar-recordatorio", {
      // El copy por defecto habla de la Graph API, que acá no interviene: un
      // permiso denegado es RLS diciendo que no.
      permisoDenegado: "No tenés permiso para tocar los recordatorios de esta conversación.",
    });
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
