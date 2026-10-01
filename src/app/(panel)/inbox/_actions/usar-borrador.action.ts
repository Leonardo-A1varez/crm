"use server";

import { revalidatePath } from "next/cache";
import { UsarBorradorSchema } from "@/lib/validation/copiloto.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * La persona usó el borrador (Insertar / Copiar / Abrir en WhatsApp Web / Al
 * composer). Guarda el texto final en el hilo como "enviado por WhatsApp Web,
 * sin confirmar" (salvo "Al composer", que envía `sendMessageAction`) y marca el
 * borrador usado una sola vez.
 */
export async function usarBorradorAction(raw: unknown): Promise<ActionResult> {
  const parsed = UsarBorradorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Borrador inválido: revisá el texto (1-4096 caracteres)." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
    const svc = await getCopilotoServiceForRequest();
    await svc.usar({
      borradorId: parsed.data.borradorId,
      via: parsed.data.via,
      texto: parsed.data.texto,
      userId: user.id,
    });
  } catch (e) {
    return toActionError(e, "usar-borrador", {
      conflicto: "El borrador ya no está disponible. Refrescá la página.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
