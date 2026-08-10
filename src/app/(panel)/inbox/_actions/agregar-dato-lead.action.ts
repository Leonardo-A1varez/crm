"use server";

import { revalidatePath } from "next/cache";
import { MAX_LARGO_CLAVE, MAX_LARGO_VALOR } from "@/lib/datos-extra";
import { AgregarDatoLeadSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Carga un dato de contacto del lead desde el `+` de la ficha.
 *
 * Dos caminos en una sola action porque para quien la usa es un solo gesto:
 * elegir un campo de la lista o inventar uno. El schema decide cuál es y el
 * service escribe en la columna o en `datos_extra` según corresponda.
 */
export async function agregarDatoLeadAction(raw: unknown): Promise<ActionResult> {
  const parsed = AgregarDatoLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Dato inválido: el nombre admite hasta ${MAX_LARGO_CLAVE} caracteres, el valor hasta ${MAX_LARGO_VALOR}, y no puede llamarse igual que un campo que ya existe.`,
    };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.agregarDato(parsed.data);
  } catch (e) {
    return toActionError(e, "agregar-dato-lead", {
      permisoDenegado: "No tenés permiso para editar este lead.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
