"use server";

import { revalidatePath } from "next/cache";
import { EnviarAdjuntoSchema } from "@/lib/validation/media.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getEnviarAdjuntoServiceForRequest } from "@/server/bootstrap/media-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Paso 2: el archivo ya está en Storage. Se revalida todo (tipo real por los
 * bytes, tamaño, ventana), se sube a Meta con el token del número de la
 * conversación y se manda. Con `sender_user_id` del vendedor, como el texto.
 */
export async function enviarAdjuntoAction(raw: unknown): Promise<ActionResult> {
  const parsed = EnviarAdjuntoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Archivo inválido: adjuntalo de nuevo." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
    const svc = await getEnviarAdjuntoServiceForRequest();
    await svc.enviar({ ...parsed.data, userId: user.id });
  } catch (e) {
    return toActionError(e, "enviar-adjunto");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
