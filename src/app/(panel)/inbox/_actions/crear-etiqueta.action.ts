"use server";

import { revalidatePath } from "next/cache";
import { CrearEtiquetaSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Crea la etiqueta al vuelo y se la cuelga al lead.
 *
 * Es el camino de "escribí algo que no está en la lista": obligar a salir a la
 * pantalla de administración para volver después haría que nadie etiquete.
 * `tags` es de escritura reservada al admin (policy `tags_insert_admin`), así
 * que a un vendedor esto le vuelve como permiso denegado y con ese texto.
 */
export async function crearEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearEtiquetaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "El nombre de la etiqueta va entre 1 y 40 caracteres." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    await svc.crearYAsignarEtiqueta({
      leadId: parsed.data.leadId,
      nombre: parsed.data.nombre,
      userId: user.id,
    });
  } catch (e) {
    return toActionError(e, "crear-etiqueta", {
      permisoDenegado: "Crear etiquetas nuevas es cosa de un administrador.",
      conflicto: "Ya existe una etiqueta con ese nombre. Refrescá la página.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
