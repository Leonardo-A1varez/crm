"use server";

import { revalidatePath } from "next/cache";
import { ApproveMergeSchema } from "@/lib/validation/leads.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function approveMergeAction(raw: unknown): Promise<ActionResult> {
  const parsed = ApproveMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }
  // Un solo round-trip a Supabase Auth: el mismo user sirve para gate y actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }

  let ganadorId: string;
  try {
    const svc = await getMergeExecutorForRequest();
    const r = await svc.approveMerge({
      candidateId: parsed.data.candidateId,
      keepLeadId: parsed.data.keepLeadId,
      actorUserId: user?.id ?? null,
    });
    ganadorId = r.ganadorId;
  } catch (e) {
    return toActionError(e, "approve-merge");
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${ganadorId}`);
  return { ok: true };
}
