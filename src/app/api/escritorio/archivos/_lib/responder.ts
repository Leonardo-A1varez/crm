import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import type { ArchivosEscritorioService } from "@/server/services/media/archivos-escritorio.service";

const logger = getLogger({ scope: "api-escritorio-archivos" });
const SIN_CACHE = { "Cache-Control": "no-store" };

const QuerySchema = z.object({
  despues: z.string().min(1).max(300).optional(),
  limite: z.coerce.number().int().min(1).max(50).default(20),
});

export interface DepsArchivosEscritorio {
  usuario: () => Promise<{ id: string } | null>;
  servicio: () => Promise<ArchivosEscritorioService>;
}

/**
 * `GET /api/escritorio/archivos?despues=<cursor>&limite=<1-50>`: los archivos
 * nuevos que la app de escritorio guarda en la PC (docs/meta/media.md §4). La app
 * va por el proceso principal con la sesión del CRM (cookie de su partición); no
 * hay un token aparte ni una puerta nueva en el renderer. `/api` queda fuera del
 * proxy de sesión: se pide acá. La respuesta lleva el nombre del cliente
 * (carpeta), así que no se cachea ni se loguea.
 */
export async function responderArchivosEscritorio(
  req: Request,
  deps: DepsArchivosEscritorio,
): Promise<Response> {
  if ((await deps.usuario()) === null) {
    return Response.json({ error: "Sin sesión." }, { status: 401, headers: SIN_CACHE });
  }
  const sp = new URL(req.url).searchParams;
  const q = QuerySchema.safeParse({
    despues: sp.get("despues") ?? undefined,
    limite: sp.get("limite") ?? undefined,
  });
  if (!q.success) {
    return Response.json({ error: "Parámetros inválidos." }, { status: 400, headers: SIN_CACHE });
  }
  try {
    const servicio = await deps.servicio();
    const pagina = await servicio.listar({ cursor: q.data.despues ?? null, limite: q.data.limite });
    return Response.json(pagina, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof ValidationError) {
      return Response.json({ error: "Parámetros inválidos." }, { status: 400, headers: SIN_CACHE });
    }
    logger.error("archivos de escritorio: fallo", {
      error: e instanceof Error ? e.name : "desconocido",
    });
    return Response.json({ error: "No se pudo leer." }, { status: 500, headers: SIN_CACHE });
  }
}
