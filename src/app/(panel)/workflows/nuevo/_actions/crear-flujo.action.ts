"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { CrearFlujoDesdePlantillaSchema } from "@/lib/validation/workflows-listado.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { TOPE_PASOS } from "../../[id]/_lib/max-pasos";
import { armarPlantilla } from "../_lib/grafos-plantillas";
import type { WorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { UUID } from "@/types/entities";

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof PermissionDeniedError) return "Solo un administrador puede hacer esto.";
  if (e instanceof DomainError) return e.message;
  return fallback;
}

/**
 * Crea un flujo desde la galería y, si se eligió una plantilla, lo deja armado:
 * guarda el grafo de la plantilla como su primera versión.
 *
 * Reemplaza a `crearFlujoDesdePlantillaAction` (`../../_actions/listado.actions.ts`),
 * que creaba el flujo vacío se eligiera lo que se eligiera. Vive en un archivo
 * propio para no tocar aquel, que es de la pantalla de listado.
 *
 * ## Todo o nada
 *
 * Son dos escrituras —el flujo y su versión— y el servicio no ofrece una que
 * haga las dos juntas. Si la versión falla después de crear el flujo, el flujo
 * se borra: abrir un lienzo vacío después de haber elegido una plantilla es el
 * defecto que esto corrige. Si además falla el borrado, el error lo dice, para
 * que nadie tenga que adivinar de dónde salió un flujo vacío en la lista.
 *
 * La versión queda guardada y no publicada, y el flujo nace apagado: nada corre
 * hasta que alguien lo publique.
 */
export async function crearFlujoAction(
  raw: unknown,
): Promise<{ ok: true; workflowId: UUID } | { ok: false; error: string }> {
  const parsed = CrearFlujoDesdePlantillaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { nombre, descripcion, plantillaId } = parsed.data;
  const armada = plantillaId === null ? null : armarPlantilla(plantillaId);
  if (plantillaId !== null && armada === null) {
    return { ok: false, error: "Esa plantilla no existe." };
  }

  let svc: WorkflowsAdminService;
  let workflowId: UUID;
  try {
    const rol = await getCurrentRol();
    if (rol !== "admin") throw new PermissionDeniedError("solo un admin puede crear flujos");
    svc = await getWorkflowsAdminServiceForRequest();
    workflowId = (await svc.crear({ nombre, descripcion })).id;
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo crear el flujo.") };
  }

  if (armada !== null) {
    try {
      const user = await getAuthenticatedUser();
      await svc.guardarVersion({
        workflowId,
        grafo: armada.grafo,
        maxPasos: TOPE_PASOS.POR_DEFECTO,
        // Queda registrado quién la creó: `workflow_versiones.created_by`.
        userId: user?.id ?? null,
      });
    } catch (e) {
      const motivo = mensajeDeError(e, "No se pudo armar el flujo desde la plantilla.");
      try {
        await svc.eliminar(workflowId);
      } catch {
        return {
          ok: false,
          error: `${motivo} El flujo quedó creado vacío y no se pudo borrar: borralo desde la lista de flujos.`,
        };
      }
      return { ok: false, error: motivo };
    }
  }

  revalidatePath("/workflows");
  return { ok: true, workflowId };
}
