"use server";

import { revalidatePath } from "next/cache";
import { CreateProductoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function createProductoAction(raw: unknown): Promise<ActionResult> {
  const parsed = CreateProductoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos: revisá código, nombre, precio y stock." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    await svc.createProducto(parsed.data);
  } catch (e) {
    return toActionError(e, "create-producto");
  }

  revalidatePath("/productos");
  return { ok: true };
}
