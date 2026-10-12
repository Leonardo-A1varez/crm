"use server";

import { PrepararAdjuntoSchema } from "@/lib/validation/media.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getEnviarAdjuntoServiceForRequest } from "@/server/bootstrap/media-bootstrap";
import { toActionError } from "./action-error";
import type { ResultadoPrepararAdjunto } from "@/types/inbox";

/**
 * Paso 1 de mandar un archivo: valida tipo, tamaño, sesión y ventana de 24 h, y
 * devuelve dónde y con qué token sube el navegador directo a Storage. El archivo
 * no pasa por acá (Vercel no recibe más de 4,5 MB en el cuerpo del pedido).
 */
export async function prepararAdjuntoAction(raw: unknown): Promise<ResultadoPrepararAdjunto> {
  const parsed = PrepararAdjuntoSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: "Archivo inválido: revisá nombre, tipo y tamaño." };

  try {
    // Sin sesión no hay quien adjunte: el middleware ya lo frena, esto es la segunda barrera.
    if (!(await getAuthenticatedUser())) {
      return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
    }
    const svc = await getEnviarAdjuntoServiceForRequest();
    const r = await svc.preparar(parsed.data);
    return { ok: true, ruta: r.ruta, token: r.token };
  } catch (e) {
    return toActionError(e, "preparar-adjunto");
  }
}
