"use server";

import { revalidatePath } from "next/cache";
import { SendMessageSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function sendMessageAction(raw: unknown): Promise<ActionResult> {
  const parsed = SendMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Mensaje inválido: revisá el contenido (1-4096 caracteres)." };
  }

  try {
    // Sin esto el mensaje queda anónimo: `mensajes.sender_user_id` es la única
    // fuente de "qué vendedor atendió esta conversación", y las métricas por
    // vendedor (handoff §3.3) no existen si acá se pierde el usuario.
    const user = await getAuthenticatedUser();
    const svc = await getInboxServiceForRequest();
    await svc.sendMessage({
      leadId: parsed.data.leadId,
      sessionId: parsed.data.sessionId,
      canal: parsed.data.canal,
      body: parsed.data.body,
      userId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "send-message");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
