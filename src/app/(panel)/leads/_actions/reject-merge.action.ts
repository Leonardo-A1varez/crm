"use server";

import { revalidatePath } from "next/cache";
import { RejectMergeSchema } from "@/lib/validation/leads.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function rejectMergeAction(raw: unknown): Promise<ActionResult> {
  const parsed = RejectMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }
  // Un solo round-trip a Supabase Auth: el mismo user sirve para gate y actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }

  try {
    const svc = await getMergeExecutorForRequest();
    await svc.rejectMerge({
      candidateId: parsed.data.candidateId,
      actorUserId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "reject-merge");
  }

  // Sin path de detalle: ambos leads del par siguen existiendo (nada que refrescar ahí).
  revalidatePath("/leads");
  return { ok: true };
}
