"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import {
  ContarCorridasVivasSchema,
  CrearFlujoDesdePlantillaSchema,
} from "@/lib/validation/workflows-listado.schema";
import { getCurrentRol } from "@/server/auth/guards";
import {
  getWorkflowRunsRepoForRequest,
  getWorkflowsAdminServiceForRequest,
} from "@/server/bootstrap/workflows-bootstrap";
import type { UUID } from "@/types/entities";

/**
 * Las dos lecturas/escrituras que agregó la pantalla de listado nueva.
 *
 * Viven separadas de `workflows.actions.ts` para no tocar un archivo que ya
 * concentra el editor y las seis mutaciones. Mismo contrato: Zod en la primera
 * línea, `DomainError` traducido a un mensaje que alguien pueda leer.
 */

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof PermissionDeniedError) return "Solo un administrador puede hacer esto.";
  if (e instanceof DomainError) return e.message;
  return fallback;
}

/**
 * Cuántas corridas vivas tiene cada flujo, ahora mismo.
 *
 * "Viva" son dos estados y no uno: `corriendo` es la que está ejecutando un
 * paso y `esperando` es la que está frenada en una espera o esperando una
 * respuesta. Las dos siguen hasta terminar cuando alguien pausa el flujo, así
 * que las dos cuentan para la promesa que hace la tarjeta pausada. Contar sólo
 * `corriendo` diría "no hay ninguna" con tres conversaciones a medio camino.
 *
 * `listarHistorial` filtra por un estado por vez, así que son dos consultas por
 * flujo. Se llama sólo con los flujos pausados (ver
 * `flujosQueNecesitanConteoVivo`), que en una instalación son unos pocos.
 *
 * Va contra el repo y no contra un servicio porque `WorkflowsAdminService` no
 * expone corridas; es el mismo camino que ya toma `obtenerHistorialWorkflowAction`
 * en la action de al lado. Tampoco pasa por `soloAdmin()`: es una lectura, y la
 * policy `workflows_select` deja ver a admin y a vendedor por igual.
 */
export async function contarCorridasVivasAction(
  raw: unknown,
): Promise<{ ok: true; porFlujo: Record<UUID, number> } | { ok: false; error: string }> {
  const parsed = ContarCorridasVivasSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Flujos inválidos." };

  if (parsed.data.workflowIds.length === 0) return { ok: true, porFlujo: {} };

  try {
    const repo = await getWorkflowRunsRepoForRequest();

    const pares = await Promise.all(
      parsed.data.workflowIds.map(async (workflowId) => {
        const [corriendo, esperando] = await Promise.all([
          repo.listarHistorial(workflowId, { estado: "corriendo" }),
          repo.listarHistorial(workflowId, { estado: "esperando" }),
        ]);
        return [workflowId, corriendo.total + esperando.total] as const;
      }),
    );

    return { ok: true, porFlujo: Object.fromEntries(pares) };
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudieron contar las corridas vivas.") };
  }
}

/**
 * Crea un flujo desde la galería y devuelve su id, para poder mandar a la
 * persona directo al editor.
 *
 * `crearWorkflowAction` no sirve acá: devuelve `ActionResult`, o sea `ok` sin
 * id, y después de elegir una plantilla lo único que alguien quiere es estar
 * adentro del flujo que acaba de crear.
 *
 * **La plantilla elegida no arma el grafo.** No existe traducción de las seis
 * plantillas a nodos, así que el flujo nace vacío y apagado. Lo que sí queda es
 * la descripción, que es lo que el formulario muestra antes de crear. Fingir
 * que la plantilla dejó pasos armados sería la peor versión de esto.
 */
export async function crearFlujoDesdePlantillaAction(
  raw: unknown,
): Promise<{ ok: true; workflowId: UUID } | { ok: false; error: string }> {
  const parsed = CrearFlujoDesdePlantillaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  let workflowId: UUID;
  try {
    const rol = await getCurrentRol();
    if (rol !== "admin") throw new PermissionDeniedError("solo un admin puede crear flujos");

    const svc = await getWorkflowsAdminServiceForRequest();
    const creado = await svc.crear({
      nombre: parsed.data.nombre,
      descripcion: parsed.data.descripcion,
    });
    workflowId = creado.id;
  } catch (e) {
    return { ok: false, error: mensajeDeError(e, "No se pudo crear el flujo.") };
  }

  revalidatePath("/workflows");
  return { ok: true, workflowId };
}
