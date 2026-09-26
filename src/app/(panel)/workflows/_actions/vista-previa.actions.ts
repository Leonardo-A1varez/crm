"use server";

import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { getVistaPreviaMensajeServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type { VistaPreviaMensaje } from "@/server/services/workflows/vista-previa.service";

const logger = getLogger({ scope: "workflows-vista-previa" });

/** Sin exportar: un archivo `"use server"` sólo puede exportar funciones async. */
const LeerVistaPreviaSchema = z.object({ leadId: z.string().uuid() });

/**
 * Lo que el motor usaría para mandar «Enviar mensaje» a este lead ahora: los
 * datos de las variables y la ventana de 24 h de su conversación.
 *
 * Sólo lee y no tiene gate de rol: el editor lo ve también un vendedor, en
 * sólo lectura, y RLS decide qué lead puede leer cada uno.
 */
export async function leerVistaPreviaMensajeAction(
  raw: unknown,
): Promise<{ ok: true; data: VistaPreviaMensaje } | { ok: false; error: string }> {
  const parsed = LeerVistaPreviaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Elegí un lead de la lista." };

  try {
    const svc = await getVistaPreviaMensajeServiceForRequest();
    return { ok: true, data: await svc.leer(parsed.data.leadId) };
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, error: "Ese lead ya no existe." };
    // Sólo el nombre del error: el mensaje de Postgres puede traer datos del lead.
    logger.error("vista-previa-fallo", { error_name: e instanceof Error ? e.name : typeof e });
    return { ok: false, error: "No se pudo leer el lead para la vista previa." };
  }
}
