"use server";

import { revalidatePath } from "next/cache";
import { ToggleHandoffSchema } from "@/lib/validation/inbox.schema";
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function toggleHandoffAction(raw: unknown): Promise<ActionResult> {
  const parsed = ToggleHandoffSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Acción de handoff inválida." };
  }

  try {
    await getInboxService().toggleHandoff({
      sessionId: parsed.data.sessionId,
      action: parsed.data.action,
    });
  } catch (e) {
    return toActionError(e, "toggle-handoff");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
