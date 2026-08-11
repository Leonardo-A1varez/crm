"use server";

import { revalidatePath } from "next/cache";
import { ConflictError } from "@/lib/errors";
import { ReprogramarRecordatorioSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Le mueve la fecha —y, si se pidió, la nota— al recordatorio de seguimiento,
 * sin cancelarlo.
 *
 * Antes había que apagarlo y poner otro: dos clicks, dos confirmaciones y una
 * ventana en el medio donde la conversación no tenía ninguna cita. Acá es un
 * paso y la misma fila.
 *
 * La nota **no se borra por venir vacía**: sólo un `null` explícito la saca.
 * Ver `ReprogramarRecordatorioSchema`.
 *
 * Al vencer sigue sin mandarle nada al cliente: enciende el motivo
 * `seguimiento` en el triage y la conversación sube en el Inbox.
 */
export async function reprogramarRecordatorioAction(raw: unknown): Promise<ActionResult> {
  const parsed = ReprogramarRecordatorioSchema.safeParse(raw);
  if (!parsed.success) {
    // El mensaje del primer issue y no uno genérico: las guardas de fecha
    // —pasado y tope de 180 días— son accionables y el vendedor puede corregir.
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Recordatorio inválido." };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Iniciá sesión para mover el recordatorio." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    await svc.reprogramarRecordatorio({
      recordatorioId: parsed.data.recordatorioId,
      recordarAt: new Date(parsed.data.recordarAt),
      nota: parsed.data.nota,
    });
  } catch (e) {
    // "Ya no está activo" es el caso real de dos pestañas o de un cliente que
    // contestó mientras se elegía la fecha: el texto del service dice qué
    // hacer, y el copy común de `toActionError` no lo diría.
    if (e instanceof ConflictError && e.conflictType === "recordatorio_no_vivo") {
      return { ok: false, error: e.message };
    }
    return toActionError(e, "reprogramar-recordatorio", {
      // El copy por defecto habla de la Graph API, que acá no interviene: un
      // permiso denegado es RLS diciendo que no.
      permisoDenegado: "No tenés permiso para tocar los recordatorios de esta conversación.",
    });
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
