"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import {
  CrearWorkflowSchema,
  GuardarVersionSchema,
  PublicarVersionSchema,
} from "@/lib/validation/workflows.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type { ActionResult } from "@/types/inbox";

/**
 * Las tres acciones de la pantalla de workflows.
 *
 * Todas parsean con Zod en la primera línea (AGENTS.md §0.9) y ninguna valida
 * el grafo por su cuenta: eso lo hace `guardarVersion` del servicio, que es la
 * única puerta por la que un grafo entra a la base. Duplicar la validación acá
 * crearía dos reglas que se desincronizan.
 */

/**
 * Gate de rol en el server. RLS lo vuelve a enforcear en la DB: esto existe
 * para dar un mensaje entendible, no como única defensa.
 */
async function soloAdmin(): Promise<void> {
  const rol = await getCurrentRol();
  if (rol !== "admin") {
    throw new PermissionDeniedError("solo un admin puede tocar workflows");
  }
}

function fallo(e: unknown, fallback: string): ActionResult {
  if (e instanceof PermissionDeniedError) {
    return { ok: false, error: "Solo un administrador puede hacer esto." };
  }
  // Los `ValidationError` de `guardarVersion` traen los problemas del grafo
  // enumerados: ese texto es exactamente lo que el usuario necesita leer.
  if (e instanceof DomainError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

export async function crearWorkflowAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.crear(parsed.data);
  } catch (e) {
    return fallo(e, "No se pudo crear el flujo.");
  }

  revalidatePath("/workflows");
  return { ok: true };
}

export async function guardarVersionAction(raw: unknown): Promise<ActionResult> {
  const parsed = GuardarVersionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "El flujo no tiene forma válida.",
    };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    await svc.guardarVersion({
      workflowId: parsed.data.workflowId,
      grafo: parsed.data.grafo,
      maxPasos: parsed.data.maxPasos,
      // Queda registrado quién guardó esta versión: `workflow_versiones.created_by`.
      userId: user?.id ?? null,
    });
  } catch (e) {
    return fallo(e, "No se pudo guardar la versión.");
  }

  revalidatePath(`/workflows/${parsed.data.workflowId}`);
  return { ok: true };
}

export async function publicarVersionAction(raw: unknown): Promise<ActionResult> {
  const parsed = PublicarVersionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Versión inválida." };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.publicar(parsed.data.versionId);
  } catch (e) {
    return fallo(e, "No se pudo publicar la versión.");
  }

  // No se sabe el workflow desde acá sin otra lectura; la pantalla de detalle
  // cuelga de `/workflows`, así que revalidar la raíz alcanza para las dos.
  revalidatePath("/workflows", "layout");
  return { ok: true };
}
