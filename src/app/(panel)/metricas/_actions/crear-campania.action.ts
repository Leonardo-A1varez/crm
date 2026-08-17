"use server";

import { revalidatePath } from "next/cache";
import { CrearCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function crearCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  try {
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.crear(parsed.data);
  } catch (e) {
    return toActionError(e, "crear-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
