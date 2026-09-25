"use server";

import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { ContarCorridasVivasSchema } from "@/lib/validation/workflows-listado.schema";
import { getWorkflowRunsRepoForRequest } from "@/server/bootstrap/workflows-bootstrap";
import type { UUID } from "@/types/entities";

/**
 * La lectura que agregó la pantalla de listado nueva: las corridas vivas por flujo.
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
