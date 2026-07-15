"use server";

import { revalidatePath } from "next/cache";
import { CreateManualCandidateSchema } from "@/lib/validation/leads.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function createManualCandidateAction(raw: unknown): Promise<ActionResult> {
  const parsed = CreateManualCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    // El refine self-pair (código "custom") trae mensaje curado accionable
    // (addendum fase 10 §2.C) — se muestra tal cual, igual que ValidationError
    // de dominio sin cause en toActionError. Otros issues (uuid inválido) = dato
    // stale/malformado del cliente → mensaje genérico.
    const selfPair = parsed.error.issues.find((i) => i.code === "custom");
    return { ok: false, error: selfPair?.message ?? "Datos inválidos. Refrescá la página." };
  }
  if ((await getCurrentRol()) !== "admin") {
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }

  try {
    const svc = await getMergeExecutorForRequest();
    await svc.createManualCandidate({
      leadId: parsed.data.leadId,
      otherLeadId: parsed.data.otherLeadId,
    });
  } catch (e) {
    return toActionError(e, "create-manual-candidate");
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
