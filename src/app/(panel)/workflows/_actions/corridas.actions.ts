"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { CorridaIdSchema } from "@/lib/validation/workflows.schema";
import { getCurrentRol, rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCorridasWorkflowServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type { CorridaReanudada, VistaCorrida } from "@/server/services/workflows/corridas.service";
import type { ActionError, ActionResult } from "@/types/inbox";

/**
 * Las acciones de la pantalla "corrida en vivo" (CorridaEnVivo y
 * PreviaReanudacion). Todas parsean con Zod en la primera línea (AGENTS.md
 * §0.9) y reciben sólo el id de la corrida: desde dónde se reanuda lo decide
 * el servidor, nunca un nodo que mande la pantalla.
 *
 * Para ver la corrida en vivo sin polling, la pantalla se suscribe con
 * Supabase Realtime a `workflow_run_pasos` (INSERT, `run_id=eq.<id>`) y a
 * `workflow_runs` (UPDATE, `id=eq.<id>`), y ante cada evento vuelve a pedir
 * `obtenerCorridaAction`.
 */

/**
 * Mismo gate que en `workflows.actions.ts`. Está repetido porque una función
 * de un archivo `"use server"` no se puede importar desde otro sin exportarla,
 * y exportarla la volvería una acción que cualquiera puede invocar.
 */
async function soloAdmin(): Promise<void> {
  const rol = await getCurrentRol();
  if (rol !== "admin") {
    throw new PermissionDeniedError("solo un admin puede relanzar o cancelar una corrida");
  }
}

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof PermissionDeniedError) return "Solo un administrador puede hacer esto.";
  // Los errores de dominio del servicio ya están escritos para quien mira la
  // pantalla: "Ya hay otra corrida en curso de este flujo para este lead."
  if (e instanceof DomainError) return e.message;
  return fallback;
}

/**
 * Todo lo que pinta la corrida: el grafo de SU versión, cada paso, el estado de
 * cada nodo y las previas de reanudar y de ejecutar de nuevo. `data: null` si
 * la corrida no existe. Es lectura: no pide admin, RLS decide qué se ve —igual
 * que el historial—.
 */
export async function obtenerCorridaAction(
  raw: unknown,
): Promise<{ ok: true; data: VistaCorrida | null } | ActionError> {
  const parsed = CorridaIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Corrida inválida." };

  try {
    const svc = await getCorridasWorkflowServiceForRequest();
    return { ok: true, data: await svc.vista(parsed.data.runId) };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo cargar la corrida.") };
  }
}

/**
 * "Reanudar desde el fallo": la misma corrida sigue desde el nodo del paso que
 * falló, con los pasos anteriores reusados. No repite ningún envío, por eso la
 * pantalla no pide confirmación.
 */
export async function reanudarCorridaAction(
  raw: unknown,
): Promise<{ ok: true; data: CorridaReanudada } | ActionError> {
  const parsed = CorridaIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Corrida inválida." };

  let reanudada: CorridaReanudada;
  try {
    await soloAdmin();
    const svc = await getCorridasWorkflowServiceForRequest();
    reanudada = await svc.reanudar(parsed.data.runId);
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo reanudar la corrida.") };
  }

  revalidatePath("/workflows", "layout");
  return { ok: true, data: reanudada };
}

/**
 * "Ejecutar de nuevo desde el principio": una corrida nueva de la misma
 * versión. Repite los envíos que la previa enumera; la pantalla los confirma
 * antes de llamar. Devuelve el id de la corrida NUEVA.
 */
export async function ejecutarCorridaDeNuevoAction(
  raw: unknown,
): Promise<{ ok: true; data: { runId: string } } | ActionError> {
  const parsed = CorridaIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Corrida inválida." };

  let nueva: { runId: string };
  try {
    await soloAdmin();
    const svc = await getCorridasWorkflowServiceForRequest();
    nueva = await svc.ejecutarDeNuevo(parsed.data.runId);
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo ejecutar de nuevo la corrida.") };
  }

  revalidatePath("/workflows", "layout");
  return { ok: true, data: nueva };
}

/**
 * "Cancelar corrida": sólo admin. Pasa a `cancelado` una corrida viva, de
 * producción o de Probar, con el motivo en `error`, deja en `admin_actions`
 * quién la canceló y avisa a Inngest, que corta en el acto el segmento que
 * duerme en una espera (`cancelOn` de `workflow-segmento`). Una con el
 * segmento en vuelo relee su estado antes de cada acción y no ejecuta la
 * siguiente. Lo que ya se ejecutó —un mensaje que ya salió— queda como pasó.
 */
export async function cancelarCorridaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CorridaIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Corrida inválida." };

  // Un solo round-trip a Supabase Auth: el mismo user sirve para gate y actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un administrador puede hacer esto." };
  }

  try {
    const svc = await getCorridasWorkflowServiceForRequest();
    await svc.cancelar(parsed.data.runId, user?.id ?? null);
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo cancelar la corrida.") };
  }

  revalidatePath("/workflows", "layout");
  return { ok: true };
}
