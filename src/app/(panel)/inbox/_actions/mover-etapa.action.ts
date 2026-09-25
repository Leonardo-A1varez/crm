"use server";

import { revalidatePath } from "next/cache";
import { MoverEtapaSchema } from "@/lib/validation/inbox.schema";
import { disparoEtapaManual } from "@/lib/workflows/disparos";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import { avisarAFlujos, fuenteDelDisparo } from "./avisar-flujos";
import type { ActionResult } from "@/types/inbox";

/**
 * Mueve la etapa del embudo a mano desde el rail del Twin.
 *
 * Queda anotada como corrección humana, así que el extractor deja de tocar la
 * etapa de esa sesión: sin eso el rail sería un control decorativo que el
 * próximo mensaje del cliente revierte.
 *
 * Si la etapa cambió de verdad, dispara los flujos "Etapa cambiada" igual que
 * cuando la mueve el extractor. Dejarla donde estaba no dispara.
 */
export async function moverEtapaAction(raw: unknown): Promise<ActionResult> {
  const parsed = MoverEtapaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Etapa inválida: refrescá la página." };
  }
  const { leadId, sessionId, etapa } = parsed.data;

  let avisado = true;
  try {
    const user = await getAuthenticatedUser();
    const svc = await getInboxServiceForRequest();
    const antes = await svc.getConversation(leadId);
    const despues = await svc.moverEtapa({ sessionId, etapa, userId: user?.id ?? null });

    // La etapa de antes sale de la sesión activa del lead, y sólo vale si es la
    // misma que se movió: sin eso, el disparo diría una etapa de origen ajena.
    const previa = antes.session?.id === sessionId ? antes.session.current_stage : null;
    if (previa !== null && previa !== despues.current_stage) {
      avisado = await avisarAFlujos(
        disparoEtapaManual({
          ...fuenteDelDisparo(antes),
          sesion: despues,
          etapaAnterior: previa,
          marca: new Date().toISOString(),
        }),
      );
    }
  } catch (e) {
    return toActionError(e, "mover-etapa");
  }

  revalidatePath(`/inbox/${leadId}`);
  if (!avisado) {
    return {
      ok: false,
      error: "La etapa se movió, pero los flujos no se enteraron. Avisá al administrador.",
    };
  }
  return { ok: true };
}
