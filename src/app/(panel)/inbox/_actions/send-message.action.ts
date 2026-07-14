"use server";

import { revalidatePath } from "next/cache";
import { SendMessageSchema } from "@/lib/validation/inbox.schema";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function sendMessageAction(raw: unknown): Promise<ActionResult> {
  const parsed = SendMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Mensaje inválido: revisá el contenido (1-4096 caracteres)." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    await svc.sendMessage({
      leadId: parsed.data.leadId,
      sessionId: parsed.data.sessionId,
      canal: parsed.data.canal,
      body: parsed.data.body,
    });
  } catch (e) {
    return toActionError(e, "send-message");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
