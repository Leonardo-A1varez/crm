"use server";

import { revalidatePath } from "next/cache";
import { CloseSessionSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Cierra la sesión con el resultado que eligió el vendedor en el rail del Twin.
 *
 * Queda anotada como decisión humana en `procedencia.current_stage`, igual que
 * un movimiento de etapa: la etapa final la puso una persona y el panel tiene
 * que poder decirlo.
 *
 * El motivo obligatorio del cierre perdido lo garantiza el schema —la unión
 * discriminada no deja expresar un perdido sin motivo— y lo vuelve a comprobar
 * el service.
 */
export async function closeSessionAction(raw: unknown): Promise<ActionResult> {
  const parsed = CloseSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos de cierre inválidos." };
  }

  try {
    const user = await getAuthenticatedUser();
    const svc = await getInboxServiceForRequest();
    await svc.closeSession({
      sessionId: parsed.data.sessionId,
      resultado: parsed.data.resultado,
      motivoPerdida: parsed.data.resultado === "perdido" ? parsed.data.motivoPerdida : null,
      userId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "close-session");
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.leadId}`);
  // Navegación a /inbox la hace el client (router.push) tras ok: mantiene el
  // contrato ActionResult sin NEXT_REDIRECT colándose en el await.
  return { ok: true };
}
