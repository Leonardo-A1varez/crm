"use server";

import { revalidatePath } from "next/cache";
import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { BorrarTagSchema, CrearTagSchema, EditarTagSchema } from "@/lib/validation/tags.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import type { ActionResult } from "@/types/inbox";
import type { BorrarTagResult } from "@/types/tags";

const logger = getLogger({ scope: "etiquetas-actions" });

/**
 * Gate de rol en el server. RLS lo vuelve a enforcear en la DB (vendedor tiene
 * solo lectura sobre `tags`): esto existe para dar un mensaje entendible, no
 * como única defensa.
 */
async function soloAdmin(): Promise<void> {
  const rol = await getCurrentRol();
  if (rol !== "admin") {
    throw new PermissionDeniedError("solo un admin puede administrar etiquetas");
  }
}

function fallo(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    // `reglas_etiqueta.tag_id` es ON DELETE RESTRICT a propósito: con cascade,
    // borrar la etiqueta se llevaría puesta la regla que la asigna sin decir
    // nada. El mensaje tiene que nombrar el motivo real o el usuario ve un
    // "ya existe" que no tiene sentido al borrar.
    if (e.conflictType === "foreign_key_violation") {
      return {
        ok: false,
        error: "Una regla automática usa esta etiqueta. Sacala de la regla y volvé a intentar.",
      };
    }
    return { ok: false, error: "Ya existe una etiqueta con ese nombre." };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "La etiqueta ya no existe. Refrescá la página." };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action tags", { accion });
    return { ok: false, error: "Solo un administrador puede administrar etiquetas." };
  }
  if (e instanceof ValidationError) {
    // Con cause = rechazo de la DB (mapPostgrestError): el mensaje trae el
    // nombre del constraint, que no va al toast. Sin cause = mensaje de dominio.
    if (e.cause !== undefined) {
      logger.warn("validacion DB rechazo escritura tags", { accion, error: e.message });
      return { ok: false, error: "Datos inválidos: revisá nombre y color." };
    }
    return { ok: false, error: e.message };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action tags", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action tags inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}

export async function crearTagAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearTagSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Etiqueta inválida." };
  }

  try {
    await soloAdmin();
    const svc = await getTagsAdminServiceForRequest();
    await svc.crear(parsed.data);
  } catch (e) {
    return fallo(e, "crear-tag");
  }

  revalidatePath("/leads");
  return { ok: true };
}

export async function editarTagAction(raw: unknown): Promise<ActionResult> {
  const parsed = EditarTagSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Etiqueta inválida." };
  }

  try {
    await soloAdmin();
    const svc = await getTagsAdminServiceForRequest();
    await svc.editar(parsed.data);
  } catch (e) {
    return fallo(e, "editar-tag");
  }

  revalidatePath("/leads");
  return { ok: true };
}

export async function borrarTagAction(raw: unknown): Promise<BorrarTagResult> {
  const parsed = BorrarTagSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Etiqueta inválida." };

  let resultado: { leadsAfectados: number; nombre: string };
  try {
    await soloAdmin();
    const user = await getAuthenticatedUser();
    const svc = await getTagsAdminServiceForRequest();
    resultado = await svc.borrar(parsed.data.id, user?.id ?? null);
  } catch (e) {
    return fallo(e, "borrar-tag");
  }

  // `/inbox/[leadId]`, la otra pantalla donde la etiqueta desaparece, es
  // `force-dynamic`: vuelve a leer de la DB sola.
  revalidatePath("/leads");
  return { ok: true, ...resultado };
}
