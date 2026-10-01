"use server";

import { revalidatePath } from "next/cache";
import { RegenerarBorradorSchema } from "@/lib/validation/copiloto.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * "Regenerar" (borrador listo) y "Reintentar" (borrador en error). No ejecuta el
 * LLM acá: encola el pedido y la función `copiloto-borrador` redacta; la tarjeta
 * vuelve a "Redactando…" cuando la función arranca el borrador nuevo.
 */
export async function regenerarBorradorAction(raw: unknown): Promise<ActionResult> {
  const parsed = RegenerarBorradorSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Borrador inválido: refrescá la página." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
    const svc = await getCopilotoServiceForRequest();
    await svc.solicitarRegeneracion({ borradorId: parsed.data.borradorId, userId: user.id });
  } catch (e) {
    return toActionError(e, "regenerar-borrador", {
      permisoDenegado: "No tenés permiso para usar los borradores de esta conversación.",
      conflicto: "Ese borrador ya no se puede regenerar. Refrescá la página.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
