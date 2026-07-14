"use server";

import { revalidatePath } from "next/cache";
import { CloseSessionSchema } from "@/lib/validation/inbox.schema";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function closeSessionAction(raw: unknown): Promise<ActionResult> {
  const parsed = CloseSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos de cierre inválidos." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    await svc.closeSession({
      sessionId: parsed.data.sessionId,
      resultado: parsed.data.resultado,
      motivoPerdida: parsed.data.motivoPerdida ?? null,
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
