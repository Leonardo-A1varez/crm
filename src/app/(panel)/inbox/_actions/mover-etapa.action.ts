"use server";

import { revalidatePath } from "next/cache";
import { MoverEtapaSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Mueve la etapa del embudo a mano desde el rail del Twin.
 *
 * Queda anotada como corrección humana, así que el extractor deja de tocar la
 * etapa de esa sesión: sin eso el rail sería un control decorativo que el
 * próximo mensaje del cliente revierte.
 */
export async function moverEtapaAction(raw: unknown): Promise<ActionResult> {
  const parsed = MoverEtapaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Etapa inválida: refrescá la página." };
  }

  try {
    const user = await getAuthenticatedUser();
    const svc = await getInboxServiceForRequest();
    await svc.moverEtapa({
      sessionId: parsed.data.sessionId,
      etapa: parsed.data.etapa,
      userId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "mover-etapa");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
