"use server";

import { revalidatePath } from "next/cache";
import { ConflictError, DomainError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import {
  CrearWorkflowSchema,
  CrearVersionDesdeSchema,
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
import type { ProblemaPublicacion } from "@/lib/workflows/validar-workflow";
import type { PreviaPublicacion } from "@/server/services/workflows/workflows-admin.service";
import type { HistorialPaginado, WorkflowRunDetalle, WorkflowVersion } from "@/types/entities";
import type { ActionError, ActionResult } from "@/types/inbox";

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
 * Lo que devuelven las acciones de versión: la versión que quedó. Si el flujo
 * tiene errores que impiden publicarlo, vienen en `problemas`, uno por nodo,
 * para que la pantalla los muestre nombrando cada uno.
 */
export type ResultadoVersion =
  | { ok: true; data: { versionId: string; version: number } }
  | (ActionError & { problemas?: ProblemaPublicacion[] });

/** Los problemas de publicar que trae un `ValidationError` del servicio, o `null`. */
function problemasDelError(e: unknown): ProblemaPublicacion[] | null {
  if (!(e instanceof ValidationError) || !Array.isArray(e.issues)) return null;
  const problemas = e.issues.filter(
    (p): p is ProblemaPublicacion =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as ProblemaPublicacion).mensaje === "string" &&
      (typeof (p as ProblemaPublicacion).nodoId === "string" ||
        (p as ProblemaPublicacion).nodoId === null),
  );
  return problemas.length > 0 ? problemas : null;
}

/** El fallo de publicar o restaurar: con los problemas del flujo si los hay. */
function falloDeVersion(e: unknown, fallback: string): ResultadoVersion {
  const problemas = problemasDelError(e);
  if (problemas) {
    return {
      ok: false,
      error: "El flujo tiene errores. Corregilos en el editor antes de publicar.",
      problemas,
    };
  }
  return { ok: false, error: mensajeDeError(e, fallback) };
}

/** El error de entrada: el de la nota se lee; el de un id roto, no le dice nada a nadie. */
function errorDeEntrada(issue: { path: PropertyKey[]; message: string } | undefined): string {
  return issue?.path[0] === "nota" ? issue.message : "Versión inválida.";
}

/**
 * Lo que necesita la pantalla "Publicar la versión N" (DiffPublicacion): la
 * versión a publicar, la publicada hoy —contra la que se dibuja el diff con
 * `compararGrafos`— y cuántas corridas siguen en marcha, por versión. Es de
 * sólo lectura, pero pertenece al flujo de publicar, que es de admin.
 */
export async function obtenerPreviaPublicacionAction(
  raw: unknown,
): Promise<{ ok: true; data: PreviaPublicacion } | ActionError> {
  const parsed = PublicarVersionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Versión inválida." };

  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const previa = await svc.previaPublicacion(parsed.data.versionId);
    if (!previa) return { ok: false, error: "Esa versión ya no existe." };
    return { ok: true, data: previa };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo preparar la publicación.") };
  }
}

/**
 * Publicar con la nota de la versión. Las corridas en curso no se tocan:
 * terminan en la versión donde arrancaron. Sin nota, la versión conserva la
 * que tuviera.
 */
export async function publicarVersionConDescripcionAction(raw: unknown): Promise<ResultadoVersion> {
  const parsed = PublicarVersionConDescripcionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: errorDeEntrada(parsed.error.issues[0]) };

  let publicada: WorkflowVersion;
  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    publicada = await svc.publicar(parsed.data.versionId, parsed.data.nota);
  } catch (e) {
    return falloDeVersion(e, "No se pudo publicar la versión.");
  }

  revalidatePath("/workflows", "layout");
  return { ok: true, data: { versionId: publicada.id, version: publicada.version } };
}

/**
 * Un borrador nuevo con el grafo de una versión existente, para editar una
 * versión publicada sin romperla. El grafo se revalida con las reglas de hoy.
 */
export async function crearVersionDesdeAction(raw: unknown): Promise<ResultadoVersion> {
  const parsed = CrearVersionDesdeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Versión inválida." };

  let creada: WorkflowVersion;
  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    creada = await svc.crearVersionDesde(parsed.data.versionId, user?.id ?? null);
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo crear la versión.") };
  }

  revalidatePath("/workflows", "layout");
  return { ok: true, data: { versionId: creada.id, version: creada.version } };
}

/**
 * Restaurar una versión vieja: se copia a una versión NUEVA —número nuevo,
 * fila nueva— y se publica en la misma transacción. La vieja no revive. Sin
 * nota, la nueva dice de qué versión salió.
 */
export async function rollbackVersionAction(raw: unknown): Promise<ResultadoVersion> {
  const parsed = RollbackVersionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: errorDeEntrada(parsed.error.issues[0]) };

  let restaurada: WorkflowVersion;
  try {
    await soloAdmin();
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    restaurada = await svc.rollbackAVersion(
      parsed.data.workflowId,
      parsed.data.versionId,
      user?.id ?? null,
      parsed.data.nota,
    );
  } catch (e) {
    return falloDeVersion(e, "No se pudo restaurar la versión.");
  }

  revalidatePath("/workflows", "layout");
  return { ok: true, data: { versionId: restaurada.id, version: restaurada.version } };
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
