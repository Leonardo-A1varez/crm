"use server";

import { revalidatePath } from "next/cache";
import { BorrarCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function borrarCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = BorrarCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Campaña inválida." };
  }
  try {
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.borrar(parsed.data.id);
  } catch (e) {
    return toActionError(e, "borrar-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
