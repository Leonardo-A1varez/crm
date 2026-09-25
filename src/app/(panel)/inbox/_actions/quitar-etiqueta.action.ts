"use server";

import { revalidatePath } from "next/cache";
import { QuitarEtiquetaSchema } from "@/lib/validation/inbox.schema";
import { disparoEtiquetaManual } from "@/lib/workflows/disparos";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import { avisarAFlujos, fuenteDelDisparo } from "./avisar-flujos";
import type { ActionResult } from "@/types/inbox";

/**
 * Saca la etiqueta del lead —la etiqueta sigue existiendo en el catálogo— y, si
 * el lead la tenía, dispara los flujos "Etiqueta removida". Es el único emisor
 * de ese disparo: una etiqueta que saca un flujo no dispara a nadie.
 */
export async function quitarEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = QuitarEtiquetaSchema.safeParse(raw);
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
    await svc.quitarEtiqueta({ leadId, tagId });

    if (laTenia) {
      avisado = await avisarAFlujos(
        disparoEtiquetaManual({
          ...fuenteDelDisparo(antes),
          tagId,
          cambio: "removida",
          marca: new Date().toISOString(),
        }),
      );
    }
  } catch (e) {
    return toActionError(e, "quitar-etiqueta", {
      permisoDenegado: "No tenés permiso para sacarle etiquetas a este lead.",
    });
  }

  revalidatePath(`/inbox/${leadId}`);
  if (!avisado) {
    return {
      ok: false,
      error: "La etiqueta se sacó, pero los flujos no se enteraron. Avisá al administrador.",
    };
  }
  return { ok: true };
}
