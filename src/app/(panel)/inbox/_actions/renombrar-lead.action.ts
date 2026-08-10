"use server";

import { revalidatePath } from "next/cache";
import { RenombrarLeadSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Le pone al lead el nombre con el que lo identifica la casa.
 *
 * El pipeline crea los leads con `nombre: ""` y nunca copia el de Meta, porque
 * el alias de WhatsApp o de Instagram no distingue a una persona. Este campo es
 * el único nombre real que tiene el lead, y lo escribe el vendedor.
 */
export async function renombrarLeadAction(raw: unknown): Promise<ActionResult> {
  const parsed = RenombrarLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Nombre inválido: máximo 80 caracteres." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.renombrarLead({ leadId: parsed.data.leadId, nombre: parsed.data.nombre });
  } catch (e) {
    return toActionError(e, "renombrar-lead", {
      permisoDenegado: "No tenés permiso para editar este lead.",
    });
  }

  // "layout" y no la página sola: el nombre también encabeza la fila del panel
  // de lista, que lo carga el layout de /inbox.
  revalidatePath("/inbox", "layout");
  return { ok: true };
}
