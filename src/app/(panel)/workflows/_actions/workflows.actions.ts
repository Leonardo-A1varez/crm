"use server";

import { revalidatePath } from "next/cache";
import { ConflictError, DomainError, PermissionDeniedError } from "@/lib/errors";
import { filtrarYOrdenarWorkflows } from "@/lib/ui/filtros-workflows";
import {
  CrearWorkflowSchema,
  CrearVersionDesdeSchema,
  FiltrosWorkflowsSchema,
  GuardarVersionSchema,
  ObtenerDetalleRunSchema,
  ObtenerHistorialSchema,
  ProbarWorkflowSchema,
  PublicarVersionSchema,
  PublicarVersionConDescripcionSchema,
  RollbackVersionSchema,
  WorkflowIdSchema,
} from "@/lib/validation/workflows.schema";
import { getWorkflowRunsRepoForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type { HistorialPaginado, WorkflowResumen, WorkflowRunDetalle } from "@/types/entities";
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

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof PermissionDeniedError) return "Solo un administrador puede hacer esto.";
  // Los `ValidationError` de `guardarVersion` traen los problemas del grafo
  // enumerados: ese texto es exactamente lo que el usuario necesita leer.
  if (e instanceof DomainError) return e.message;
  return fallback;
}

function fallo(e: unknown, fallback: string): ActionResult {
  return { ok: false, error: mensajeDeError(e, fallback) };
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

/**
 * "Probar": guarda el grafo actual como versión (misma puerta que Guardar) y
 * arranca una corrida real contra un lead de prueba. Segura de correr desde
 * el editor: los handlers del motor son puros, no llaman a Meta ni escriben
 * en la base real — sólo persisten en `workflow_runs`/`workflow_run_pasos`.
 */
export async function probarWorkflowAction(
  raw: unknown,
): Promise<
  | { ok: true; runId: string; tipo: "completado" | "esperando" | "fallado"; error?: string }
  | { ok: false; error: string }
> {
  const parsed = ProbarWorkflowSchema.safeParse(raw);
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
    const { runId, resultado } = await svc.probar({
      workflowId: parsed.data.workflowId,
      grafo: parsed.data.grafo,
      maxPasos: parsed.data.maxPasos,
      leadId: parsed.data.leadId,
      userId: user?.id ?? null,
    });

    revalidatePath(`/workflows/${parsed.data.workflowId}`);
    return {
      ok: true,
      runId,
      tipo: resultado.tipo,
      error: resultado.tipo === "fallado" ? resultado.error : undefined,
    };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo probar el flujo.") };
  }
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

/**
 * Lectura del listado. A diferencia de las otras cinco, no pasa por
 * `soloAdmin()`: `workflows_select` en RLS deja ver a admin Y vendedor por
 * igual (`supabase/migrations/20260822044955_workflows_grafo.sql`), así que
 * gatear acá sería más estricto que la base sin ningún motivo.
 *
 * Devuelve, además de `items`, dos números que sólo se pueden sacar de la
 * lista SIN filtrar:
 *   - `totalSinFiltrar`, para que la pantalla elija el `EmptyState` correcto
 *     -- "todavía no hay flujos" (la instalación entera está vacía) contra
 *     "ningún flujo coincide" (hay flujos, pero ninguno pasa la búsqueda/el
 *     estado puestos) son mensajes distintos;
 *   - `activosCorriendo`, para el subtítulo del header. Si se calculara sobre
 *     `items` (ya filtrados), buscar algo dejaría el contador de "corriendo"
 *     mintiendo sobre el total real de la instalación.
 */
export async function getWorkflowsAction(
  raw?: unknown,
): Promise<
  | { ok: true; items: WorkflowResumen[]; totalSinFiltrar: number; activosCorriendo: number }
  | { ok: false; error: string }
> {
  const parsed = FiltrosWorkflowsSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "Filtros inválidos." };

  try {
    const svc = await getWorkflowsAdminServiceForRequest();
    const todos = await svc.listarConResumen();
    return {
      ok: true,
      items: filtrarYOrdenarWorkflows(todos, parsed.data),
      totalSinFiltrar: todos.length,
      activosCorriendo: todos.filter((i) => i.estado === "activo").length,
    };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudieron cargar los flujos.") };
  }
}

export async function duplicateWorkflowAction(raw: unknown): Promise<ActionResult> {
  const parsed = WorkflowIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Flujo inválido." };

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.duplicar(parsed.data.workflowId);
  } catch (e) {
    return fallo(e, "No se pudo duplicar el flujo.");
  }

  revalidatePath("/workflows");
  return { ok: true };
}

export async function pauseWorkflowAction(raw: unknown): Promise<ActionResult> {
  const parsed = WorkflowIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Flujo inválido." };

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.pausar(parsed.data.workflowId);
  } catch (e) {
    return fallo(e, "No se pudo pausar el flujo.");
  }

  revalidatePath("/workflows");
  return { ok: true };
}

export async function resumeWorkflowAction(raw: unknown): Promise<ActionResult> {
  const parsed = WorkflowIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Flujo inválido." };

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.reanudar(parsed.data.workflowId);
  } catch (e) {
    return fallo(e, "No se pudo reanudar el flujo.");
  }

  revalidatePath("/workflows");
  return { ok: true };
}

export async function deleteWorkflowAction(raw: unknown): Promise<ActionResult> {
  const parsed = WorkflowIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Flujo inválido." };

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    await svc.eliminar(parsed.data.workflowId);
  } catch (e) {
    // El mensaje crudo de Postgres para un 23503 nombra la constraint FK, no
    // algo que alguien armando flujos deba leer.
    if (e instanceof ConflictError) {
      return { ok: false, error: "No se puede eliminar: este flujo tiene corridas registradas." };
    }
    return fallo(e, "No se pudo eliminar el flujo.");
  }

  revalidatePath("/workflows");
  return { ok: true };
}

/**
 * Publicar una versión con descripción opcional del cambio.
 *
 * Extiende `publicarVersionAction` con el campo de descripción que el dialog
 * de publicación permite llenar.
 */
export async function publicarVersionConDescripcionAction(raw: unknown): Promise<ActionResult> {
  const parsed = PublicarVersionConDescripcionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Versión inválida." };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    // TODO: Guardar la descripción cuando se agregue el campo a la tabla.
    // Por ahora, se publica sin descripción pero el schema la acepta para
    // que la UI ya la envíe y esté listo cuando se agregue.
    await svc.publicar(parsed.data.versionId);
  } catch (e) {
    return fallo(e, "No se pudo publicar la versión.");
  }

  revalidatePath("/workflows", "layout");
  return { ok: true };
}

/**
 * Crear una nueva versión draft clonando el grafo de una existente.
 *
 * Se usa cuando se quiere editar una versión publicada sin romperla.
 */
export async function crearVersionDesdeAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearVersionDesdeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Versión inválida." };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    await svc.crearVersionDesde(parsed.data.versionId, user?.id ?? null);
  } catch (e) {
    return fallo(e, "No se pudo crear la versión.");
  }

  revalidatePath("/workflows", "layout");
  return { ok: true };
}

/**
 * Rollback: crear nueva versión desde una antigua y publicarla.
 *
 * La versión nueva tiene el grafo de la versión seleccionada pero con número
 * nuevo — no revive la versión vieja, crea una copia fresca y la publica.
 */
export async function rollbackVersionAction(raw: unknown): Promise<ActionResult> {
  const parsed = RollbackVersionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    await svc.rollbackAVersion(parsed.data.workflowId, parsed.data.versionId, user?.id ?? null);
  } catch (e) {
    return fallo(e, "No se pudo restaurar la versión.");
  }

  revalidatePath("/workflows", "layout");
  return { ok: true };
}

// =========================================================================
// Historial de ejecuciones (panel lateral I)
// =========================================================================

/**
 * Obtener historial de ejecuciones de un workflow con paginacion cursor.
 *
 * No requiere soloAdmin() porque el historial es de lectura y las policies
 * de RLS ya limitan lo que cada rol puede ver.
 */
export async function obtenerHistorialWorkflowAction(
  raw: unknown,
): Promise<{ ok: true; data: HistorialPaginado } | { ok: false; error: string }> {
  const parsed = ObtenerHistorialSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos." };
  }

  try {
    const repo = await getWorkflowRunsRepoForRequest();
    const resultado = await repo.listarHistorial(
      parsed.data.workflowId,
      {
        estado: parsed.data.filtros.estado,
        fechaDesde: parsed.data.filtros.fechaDesde,
        fechaHasta: parsed.data.filtros.fechaHasta,
        leadId: parsed.data.filtros.leadId,
        busqueda: parsed.data.filtros.busqueda,
      },
      parsed.data.cursor,
    );
    return { ok: true, data: resultado };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo cargar el historial.") };
  }
}

/**
 * Obtener detalle de un run con sus pasos.
 */
export async function obtenerDetalleRunAction(
  raw: unknown,
): Promise<{ ok: true; data: WorkflowRunDetalle | null } | { ok: false; error: string }> {
  const parsed = ObtenerDetalleRunSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Run invalido." };
  }

  try {
    const repo = await getWorkflowRunsRepoForRequest();
    const detalle = await repo.detalleRun(parsed.data.runId);
    return { ok: true, data: detalle };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo cargar el detalle.") };
  }
}
