"use server";

import { revalidatePath } from "next/cache";
import { QuitarIdentificadorSchema } from "@/lib/validation/leads.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Saca un identificador del lead.
 *
 * Mismo permiso que cargarlo: admin y vendedor, resuelto por la RLS del client
 * autenticado. La comprobación de que la fila sea de ese lead la hace el
 * service, no esta capa.
 */
export async function quitarIdentificadorAction(raw: unknown): Promise<ActionResult> {
  const parsed = QuitarIdentificadorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getLeadsServiceForRequest();
    await svc.quitarIdentificador(parsed.data);
  } catch (e) {
    return toActionError(e, "quitar-identificador", {
      permisoDenegado: "No tenés permiso para sacar identificadores de este lead.",
      noEncontrado: "Ese identificador ya no está. Refrescá la página.",
    });
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
