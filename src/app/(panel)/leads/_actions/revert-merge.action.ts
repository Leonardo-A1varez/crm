"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

const RevertMergeSchema = z.object({ accionId: UUIDSchema });

/**
 * Deshace una fusión: resucita el lead absorbido y le devuelve lo que era suyo.
 *
 * El rol admin lo exige la RPC (`is_admin()` sobre `auth.uid()`), no esta
 * capa: una acción es un endpoint y la autorización tiene que vivir donde no
 * se pueda saltear.
 */
export async function revertMergeAction(raw: unknown): Promise<ActionResult> {
  const parsed = RevertMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Fusión inválida." };
  }

  try {
    const svc = await getMergeExecutorForRequest();
    await svc.revertMerge({ accionId: parsed.data.accionId });
  } catch (e) {
    return toActionError(e, "revert-merge", {
      permisoDenegado: "Solo un admin puede deshacer una fusión.",
    });
  }

  // El lead resucitado vuelve a la lista, y la ficha pierde lo que se llevó.
  revalidatePath("/leads");
  return { ok: true };
}
