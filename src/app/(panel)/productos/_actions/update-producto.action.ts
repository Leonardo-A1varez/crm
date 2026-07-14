"use server";

import { revalidatePath } from "next/cache";
import { UpdateProductoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function updateProductoAction(raw: unknown): Promise<ActionResult> {
  const parsed = UpdateProductoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos: revisá nombre, precio y stock." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    const { id, ...patch } = parsed.data;
    await svc.updateProducto(id, patch);
  } catch (e) {
    return toActionError(e, "update-producto");
  }

  revalidatePath("/productos");
  return { ok: true };
}
