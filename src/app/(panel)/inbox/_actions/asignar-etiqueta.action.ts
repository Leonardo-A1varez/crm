"use server";

import { revalidatePath } from "next/cache";
import { AsignarEtiquetaSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/** Cuelga del lead una etiqueta que ya existe en el catálogo. */
export async function asignarEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = AsignarEtiquetaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Etiqueta inválida." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.asignarEtiqueta({
      leadId: parsed.data.leadId,
      tagId: parsed.data.tagId,
      userId: user.id,
    });
  } catch (e) {
    return toActionError(e, "asignar-etiqueta", {
      permisoDenegado: "No tenés permiso para etiquetar leads.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
