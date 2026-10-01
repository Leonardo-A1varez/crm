import { leerCatalogo, primero } from "../_lib/responder";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La lista de valores de una columna con su cantidad:
 * `GET /api/productos/faceta?columna=marca&busqueda=mob&<filtros>` → `{ valores, distintos }`.
 *
 * `columna` es una de las seis con lista, `busqueda` es lo escrito dentro del panel
 * (el `q` de la URL es el buscador general y sigue siendo un filtro más). Se calcula
 * con todos los filtros menos los de esa columna.
 */
export async function GET(req: NextRequest) {
  return leerCatalogo(
    req,
    (svc, params) =>
      svc.facetaProductos(params, {
        columna: primero(params, "columna") ?? "",
        q: primero(params, "busqueda"),
      }),
    "faceta",
  );
}
