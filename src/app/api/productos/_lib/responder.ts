import { NextResponse } from "next/server";
import { PermissionDeniedError, ValidationError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { mensajesDeFiltrosInvalidos } from "@/lib/ui/filtros-productos";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import type { CatalogService } from "@/server/services/catalog/catalog.service";
import type { NextRequest } from "next/server";

const logger = getLogger({ scope: "api-productos" });

/** Lo que Next entrega en `searchParams`: una clave repetida llega como lista. */
export type Parametros = Record<string, string | string[]>;

/** La query de un route handler con la forma de `searchParams`. */
export function comoParametros(sp: URLSearchParams): Parametros {
  const out: Parametros = {};
  for (const clave of new Set(sp.keys())) {
    const valores = sp.getAll(clave);
    out[clave] = valores.length > 1 ? valores : (valores[0] ?? "");
  }
  return out;
}

/** El primer valor de un parámetro, o `undefined`. */
export function primero(p: Parametros, clave: string): string | undefined {
  const v = p[clave];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Cuerpo común de las lecturas del catálogo (`/api/productos/*`).
 *
 * **Es un route handler y no una Server Action.** La lectura es idempotente: un `GET`
 * se puede abortar a mitad de camino cuando el filtro cambia, se reintenta sin
 * efectos y viaja con los filtros en la query, que es donde la pantalla ya los tiene.
 * Una Server Action es un `POST` encolado con las demás acciones: la carga completa
 * son ~21 lotes y no pueden esperar en fila.
 *
 * `/api` queda fuera del proxy de sesión, así que acá se pide sesión. No exige rol
 * admin: lo que devuelve es lo que cualquier usuario del panel puede leer consultando
 * la tabla (la RLS de `productos` lo recorta igual).
 *
 * Los filtros se validan en el service con Zod; un valor inválido es 400 con los
 * mensajes que la pantalla muestra. Lo demás no filtra detalle al cliente.
 */
export async function leerCatalogo(
  req: NextRequest,
  accion: (svc: CatalogService, params: Parametros) => Promise<unknown>,
  que: string,
): Promise<NextResponse> {
  const sinCache = { "Cache-Control": "no-store" };
  const user = await getAuthenticatedUser();
  if (user === null) {
    return NextResponse.json({ error: "Sin sesión." }, { status: 401, headers: sinCache });
  }
  try {
    const svc = await getCatalogServiceForRequest();
    const data = await accion(svc, comoParametros(req.nextUrl.searchParams));
    return NextResponse.json(data, { headers: sinCache });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json(
        { error: "Filtros no válidos.", mensajes: mensajesDeFiltrosInvalidos(e.issues) },
        { status: 400, headers: sinCache },
      );
    }
    if (e instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "No tenés permiso para ver el catálogo." },
        { status: 403, headers: sinCache },
      );
    }
    logger.error("lectura del catalogo fallo", {
      que,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "No se pudo leer el catálogo." },
      { status: 500, headers: sinCache },
    );
  }
}
