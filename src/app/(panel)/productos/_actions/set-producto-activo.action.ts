"use server";

import { revalidatePath } from "next/cache";
import { SetProductoActivoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function setProductoActivoAction(raw: unknown): Promise<ActionResult> {
  const parsed = SetProductoActivoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    await svc.setProductoActivo(parsed.data.id, parsed.data.activo);
  } catch (e) {
    return toActionError(e, "set-producto-activo");
  }

  revalidatePath("/productos");
  return { ok: true };
}
