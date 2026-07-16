"use server";

import { revalidatePath } from "next/cache";
import { ConflictError } from "@/lib/errors";
import { CreateManualCandidateSchema } from "@/lib/validation/leads.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function createManualCandidateAction(raw: unknown): Promise<ActionResult> {
  const parsed = CreateManualCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    // El copy self-pair (addendum fase 10 §2.C) solo vale si el refine es el
    // ÚNICO issue: en Zod 4 el refine corre aunque fallen los campos, así que
    // un input malformado con leadId === otherLeadId (p.ej. "" y "") también
    // trae el issue "custom". Con length === 1 los dos UUIDs son válidos y el
    // único problema real es el self-pair; cualquier otra mezcla = dato
    // stale/malformado del cliente → mensaje genérico.
    const soloSelfPair =
      parsed.error.issues.length === 1 && parsed.error.issues[0]?.code === "custom";
    return {
      ok: false,
      error: soloSelfPair
        ? "No podés marcar un lead como duplicado de sí mismo."
        : "Datos inválidos. Refrescá la página.",
    };
  }
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }

  try {
    const svc = await getMergeExecutorForRequest();
    await svc.createManualCandidate({
      leadId: parsed.data.leadId,
      otherLeadId: parsed.data.otherLeadId,
    });
  } catch (e) {
    if (e instanceof ConflictError) {
      // §2.C: par pending ya existente tiene copy propio, no el genérico de toActionError.
      return { ok: false, error: "Ya hay un duplicado pendiente para este par." };
    }
    return toActionError(e, "create-manual-candidate");
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true };
}
