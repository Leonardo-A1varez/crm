"use server";

import { revalidatePath } from "next/cache";
import { EditarCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function editarCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = EditarCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  try {
    const { id, ...patch } = parsed.data;
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.editar(id, patch);
  } catch (e) {
    return toActionError(e, "editar-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
