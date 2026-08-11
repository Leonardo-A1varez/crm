"use server";

import { revalidatePath } from "next/cache";
import { CancelarRecordatorioSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Apaga el recordatorio de seguimiento desde el Twin.
 *
 * Cancelar uno que ya no está vivo termina bien: pudo apagarlo otra pestaña, o
 * el cliente pudo escribir entre que se pintó la ficha y se hizo click —y en
 * ese caso el pipeline ya lo canceló solo—.
 */
export async function cancelarRecordatorioAction(raw: unknown): Promise<ActionResult> {
  const parsed = CancelarRecordatorioSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Recordatorio inválido." };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Iniciá sesión para cancelar el recordatorio." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    await svc.cancelarRecordatorio({ recordatorioId: parsed.data.recordatorioId });
  } catch (e) {
    return toActionError(e, "cancelar-recordatorio", {
      // El copy por defecto habla de la Graph API, que acá no interviene: un
      // permiso denegado es RLS diciendo que no.
      permisoDenegado: "No tenés permiso para tocar los recordatorios de esta conversación.",
    });
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
