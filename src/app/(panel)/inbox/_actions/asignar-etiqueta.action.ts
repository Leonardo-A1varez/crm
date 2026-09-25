"use server";

import { revalidatePath } from "next/cache";
import { AsignarEtiquetaSchema } from "@/lib/validation/inbox.schema";
import { disparoEtiquetaManual } from "@/lib/workflows/disparos";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import { avisarAFlujos, fuenteDelDisparo } from "./avisar-flujos";
import type { ActionResult } from "@/types/inbox";

/**
 * Cuelga del lead una etiqueta que ya existe en el catálogo, y si el lead no la
 * tenía, dispara los flujos "Etiqueta asignada". Reasignar una que ya estaba no
 * es ponerle una etiqueta: no dispara.
 */
export async function asignarEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = AsignarEtiquetaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Etiqueta inválida." };
  }
  const { leadId, tagId } = parsed.data;

  let avisado = true;
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    }
    const svc = await getInboxServiceForRequest();
    const antes = await svc.getConversation(leadId);
    const laTenia = antes.tags.some((t) => t.id === tagId);
    await svc.asignarEtiqueta({ leadId, tagId, userId: user.id });

    if (!laTenia) {
      avisado = await avisarAFlujos(
        disparoEtiquetaManual({
          ...fuenteDelDisparo(antes),
          tagId,
          cambio: "asignada",
          marca: new Date().toISOString(),
        }),
      );
    }
  } catch (e) {
    return toActionError(e, "asignar-etiqueta", {
      permisoDenegado: "No tenés permiso para etiquetar leads.",
    });
  }

  revalidatePath(`/inbox/${leadId}`);
  if (!avisado) {
    return {
      ok: false,
      error: "La etiqueta quedó puesta, pero los flujos no se enteraron. Avisá al administrador.",
    };
  }
  return { ok: true };
}
