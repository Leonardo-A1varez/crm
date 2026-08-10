"use server";

import { revalidatePath } from "next/cache";
import { BorrarDatoExtraSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Saca un campo libre de la ficha desde el `×` de su fila.
 *
 * Solo alcanza a `datos_extra`: las columnas de contacto no tienen `×` y esta
 * action no sabe escribirlas. Vaciar un teléfono o un email se hace desde la
 * edición en el lugar, que es donde se ve lo que se está borrando.
 */
export async function borrarDatoLeadAction(raw: unknown): Promise<ActionResult> {
  const parsed = BorrarDatoExtraSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "No se pudo identificar el campo a borrar. Refrescá la página." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.borrarDatoExtra(parsed.data);
  } catch (e) {
    return toActionError(e, "borrar-dato-lead", {
      permisoDenegado: "No tenés permiso para editar este lead.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
