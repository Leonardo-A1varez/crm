"use server";

import { revalidatePath } from "next/cache";
import { AgregarIdentificadorSchema } from "@/lib/validation/leads.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Carga un identificador en el lead desde la ficha.
 *
 * No es admin-only: las policies de `lead_identificadores` habilitan a admin y
 * a vendedor, y es el vendedor el que tiene el RUC o la placa a mano mientras
 * habla con el cliente. El gate real es la RLS del client autenticado —el mismo
 * criterio que `update-lead-profile`—, no un `if` en esta capa.
 *
 * Tampoco escribe `admin_actions`: la policy de INSERT de esa tabla es
 * admin-only (migración `20260716001443`), así que auditar acá rompería la
 * acción justamente para el rol que más la va a usar.
 */
export async function agregarIdentificadorAction(raw: unknown): Promise<ActionResult> {
  const parsed = AgregarIdentificadorSchema.safeParse(raw);
  if (!parsed.success) {
    // El mensaje del primer issue, no un genérico: los del schema están
    // escritos para leerse en el toast y dicen qué corregir.
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos. Refrescá la página.",
    };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getLeadsServiceForRequest();
    await svc.agregarIdentificador(parsed.data);
  } catch (e) {
    return toActionError(e, "agregar-identificador", {
      permisoDenegado: "No tenés permiso para cargar identificadores de este lead.",
      conflicto: "Ese identificador ya está cargado en este lead.",
    });
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
