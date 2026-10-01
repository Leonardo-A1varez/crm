import { leerCatalogo, primero } from "../_lib/responder";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Un lote del catálogo filtrado y ordenado: `GET /api/productos/lote?<filtros>&lote=N`
 * → `{ filas, total, lote, desde }`. La pantalla pide el lote 1, y con el total sabe
 * cuántos faltan y los pide en paralelo; los junta y los virtualiza. Los filtros y el
 * orden son los mismos `searchParams` de la URL de `/productos`.
 */
export async function GET(req: NextRequest) {
  return leerCatalogo(
    req,
    (svc, params) => svc.loteProductos(params, primero(params, "lote")),
    "lote",
  );
}
