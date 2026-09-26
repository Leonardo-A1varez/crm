"use server";

import { z } from "zod";
import { PermissionDeniedError, ValidationError } from "@/lib/errors";
import { getCurrentRol } from "@/server/auth/guards";
import { getImagenesDeFlujoRepoForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { subirImagenDeFlujo } from "@/server/services/workflows/imagenes-de-flujo.service";

/**
 * Lo que llega del panel: un solo archivo. Tipo, tamaño y contenido los revisa
 * `subirImagenDeFlujo`; acá sólo la forma.
 */
const SubirImagenSchema = z.object({
  archivo: z.instanceof(File, { error: "Elegí una imagen" }),
});

export type ResultadoSubirImagen = { ok: true; ruta: string } | { ok: false; error: string };

/**
 * Sube la imagen de un bloque "Enviar imagen" y devuelve la ruta que guarda
 * el bloque. Sólo un admin arma flujos; Storage lo vuelve a exigir con su
 * policy (`20260926130500_mensajeria_rica.sql`).
 */
export async function subirImagenDeFlujoAction(form: FormData): Promise<ResultadoSubirImagen> {
  const parsed = SubirImagenSchema.safeParse({ archivo: form.get("archivo") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const rol = await getCurrentRol();
    if (rol !== "admin") throw new PermissionDeniedError("sólo un admin sube imágenes de flujos");
    const { archivo } = parsed.data;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const repo = await getImagenesDeFlujoRepoForRequest();
    const { ruta } = await subirImagenDeFlujo(repo, { bytes, tipo: archivo.type });
    return { ok: true, ruta };
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return { ok: false, error: "Solo un administrador puede subir imágenes." };
    }
    if (e instanceof ValidationError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "No se pudo subir la imagen." };
  }
}
