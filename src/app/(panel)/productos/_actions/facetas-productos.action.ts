"use server";

import { PermissionDeniedError, ValidationError } from "@/lib/errors";
import { mensajesDeFiltrosInvalidos } from "@/lib/ui/filtros-productos";
import { FacetasActionSchema } from "@/lib/validation/productos-facetas-action.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { FacetasActionResult } from "@/lib/validation/productos-facetas-action.schema";

/**
 * Valores y cantidades de las listas de filtro de /productos, con los filtros
 * que el navegador tiene puestos. Las listas se piden al abrir el desplegable
 * y al buscar dentro de ellas, no con cada render de la página.
 */
export async function facetasProductosAction(raw: unknown): Promise<FacetasActionResult> {
  const parsed = FacetasActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "No se pudo leer el pedido de la lista. Refrescá la página." };
  }
  const { filtros, qCategoria, qMarca, columna } = parsed.data;

  try {
    const svc = await getCatalogServiceForRequest();
    const facetas = await svc.facetasProductos(filtros, { qCategoria, qMarca, columna });
    return { ok: true, facetas };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { ok: false, error: mensajesDeFiltrosInvalidos(e.issues).join(" ") };
    }
    // `toActionError` habla de modificar el catálogo; acá solo se lee.
    if (e instanceof PermissionDeniedError) {
      return { ok: false, error: "No tenés permiso para ver el catálogo." };
    }
    return toActionError(e, "facetas-productos");
  }
}
