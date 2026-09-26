"use server";

import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { CoincidenciasCondicionSchema } from "@/lib/validation/workflows.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCondicionWorkflowServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type {
  CatalogosCondicion,
  ResultadoCoincidencias,
} from "@/server/services/workflows/condicion.service";
import type { ActionError } from "@/types/inbox";

/**
 * Las lecturas del panel de Condición del editor: los intents y etiquetas que
 * se pueden elegir, y cuántos leads cumplen la condición ahora.
 *
 * Sólo lectura y sólo con sesión: RLS decide qué leads se cuentan, igual que
 * en Leads. No escriben nada, así que no piden admin.
 */

async function conSesion(): Promise<void> {
  if (!(await getAuthenticatedUser())) {
    throw new PermissionDeniedError("hace falta iniciar sesión");
  }
}

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof PermissionDeniedError) return "Tu sesión venció: volvé a entrar.";
  if (e instanceof DomainError) return e.message;
  return fallback;
}

export async function catalogosCondicionAction(): Promise<
  { ok: true; data: CatalogosCondicion } | ActionError
> {
  try {
    await conSesion();
    const svc = await getCondicionWorkflowServiceForRequest();
    return { ok: true, data: await svc.catalogos() };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudieron cargar intents y etiquetas.") };
  }
}

/**
 * `muestra` > 0 trae también los primeros leads, para "Ver la lista". Una
 * condición incompleta vuelve con error: el panel no pide número hasta que
 * esté entera.
 */
export async function coincidenciasCondicionAction(
  raw: unknown,
): Promise<{ ok: true; data: ResultadoCoincidencias } | ActionError> {
  const parsed = CoincidenciasCondicionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "La condición no tiene una forma válida." };

  try {
    await conSesion();
    const svc = await getCondicionWorkflowServiceForRequest();
    return { ok: true, data: await svc.coincidencias(parsed.data.arbol, parsed.data.muestra) };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo contar a cuántos leads alcanza.") };
  }
}
