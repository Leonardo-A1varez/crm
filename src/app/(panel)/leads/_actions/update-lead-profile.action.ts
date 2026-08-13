"use server";

import { revalidatePath } from "next/cache";
import { UpdateLeadProfileSchema } from "@/lib/validation/leads.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function updateLeadProfileAction(formData: FormData): Promise<ActionResult> {
  const input = UpdateLeadProfileSchema.parse(formData);
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const service = await getLeadsServiceForRequest();
    await service.updateLeadProfile({ ...input, actorUserId: user.id });
    revalidatePath("/leads");
    revalidatePath(`/leads/${input.leadId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error, "update-lead-profile");
  }
}
