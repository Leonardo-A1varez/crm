"use server";

import { revalidatePath } from "next/cache";
import { QuitarEtiquetaSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/** Saca la etiqueta del lead. La etiqueta sigue existiendo en el catálogo. */
export async function quitarEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = QuitarEtiquetaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Etiqueta inválida." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.quitarEtiqueta({ leadId: parsed.data.leadId, tagId: parsed.data.tagId });
  } catch (e) {
    return toActionError(e, "quitar-etiqueta", {
      permisoDenegado: "No tenés permiso para sacarle etiquetas a este lead.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
