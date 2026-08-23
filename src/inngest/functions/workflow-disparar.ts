import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { workflowDisparoRecibido } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type {
  ArrancarWorkflowRunInput,
  WorkflowRunsRepository,
} from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID } from "@/types/entities";

export type DisparadorWorkflow = "etiqueta_asignada" | "mensaje_recibido" | "etapa_cambiada";

export interface DispararWorkflowInput {
  disparador: DisparadorWorkflow;
  leadId: UUID;
  leadSessionId?: UUID;
  contexto: Record<string, unknown>;
}

/**
 * Lo que hace falta para emitir el primer segmento de una corrida recién
 * arrancada. Plano y JSON-safe a propósito: es lo que cruza la frontera de
 * serialización entre el step que arranca corridas y el step que emite --
 * nada de instancias de clase ni de `Date`, que no sobreviven ese viaje.
 */
export interface EmitirSegmentoPendienteInput {
  runId: UUID;
  desdePaso: number;
}

export interface DispararWorkflowDeps {
  workflows: Pick<WorkflowsRepository, "listarPublicadasPorDisparador">;
  runs: Pick<WorkflowRunsRepository, "arrancar">;
  /**
   * Manda `workflow/segmento.pendiente` con `desdePaso: 0`. Sólo se llama por
   * cada corrida que efectivamente arrancó -- ver el comentario de
   * `dispararHandler` sobre por qué "arrancar devolvió null" no emite nada.
   */
  emitir: (input: EmitirSegmentoPendienteInput) => Promise<void>;
  logger?: Logger;
}

export interface DispararWorkflowResult {
  /** Cuántas corridas arrancaron de verdad -- no cuántas versiones matcheaban el disparador. */
  arrancadas: number;
}

/**
 * Por cada versión publicada de un workflow activo cuyo disparador matchea
 * `input.disparador`, intenta arrancar una corrida. NO emite nada -- eso es
 * responsabilidad de quien llama (`dispararHandler` para uso directo, o el
 * primer step de `makeWorkflowDispararFn` para el wireup real de Inngest).
 * Separar esto de `dispararHandler` es lo que permite que el arranque y el
 * emit sean DOS steps de Inngest en vez de uno solo -- ver Fix round 1 en el
 * reporte de esta task.
 *
 * `runs.arrancar` aplica la política de concurrencia dentro del RPC de
 * Postgres (atómico): si ya hay una corrida viva de ESE workflow para este
 * lead y la política dice ignorar, devuelve `run: null` con un motivo. Esta
 * función no agrega esa versión a la lista, ni loguea un error -- es el
 * comportamiento esperado (una etiqueta que se reasigna dos veces no debe
 * abrir una segunda corrida), no una falla.
 */
export async function arrancarPorDisparador(
  input: DispararWorkflowInput,
  deps: Pick<DispararWorkflowDeps, "workflows" | "runs" | "logger">,
): Promise<EmitirSegmentoPendienteInput[]> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "workflow-disparar",
    disparador: input.disparador,
  });

  const versiones = await deps.workflows.listarPublicadasPorDisparador(input.disparador);
  const iniciadas: EmitirSegmentoPendienteInput[] = [];

  for (const version of versiones) {
    const arrancarInput: ArrancarWorkflowRunInput = {
      versionId: version.id,
      leadId: input.leadId,
      sessionId: input.leadSessionId ?? null,
      contexto: input.contexto,
    };
    const resultado = await deps.runs.arrancar(arrancarInput);
    if (!resultado.run) {
      logger.info("corrida-no-arranco", { version_id: version.id, motivo: resultado.motivo });
      continue;
    }
    iniciadas.push({ runId: resultado.run.id, desdePaso: 0 });
    logger.info("corrida-arrancada", { version_id: version.id, run_id: resultado.run.id });
  }

  return iniciadas;
}

/**
 * Composición directa de `arrancarPorDisparador` + `emitir`, sin pasar por
 * Inngest -- es lo que usan los tests y cualquier caller que no necesite el
 * split en dos steps (que sólo importa para la crash-safety del wireup real,
 * ver `makeWorkflowDispararFn`). Firma, comportamiento y test verbatim del
 * brief original: sin cambios respecto de la primera versión de esta task.
 */
export async function dispararHandler(
  input: DispararWorkflowInput,
  deps: DispararWorkflowDeps,
): Promise<DispararWorkflowResult> {
  const iniciadas = await arrancarPorDisparador(input, deps);
  for (const iniciada of iniciadas) {
    await deps.emitir(iniciada);
  }
  return { arrancadas: iniciadas.length };
}

function envolverNoRetriable<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (isNonRetriable(error)) {
      throw new NonRetriableError((error as Error).message, { cause: error });
    }
    throw error;
  });
}

/**
 * Wireup real de Inngest: DOS steps, no uno.
 *
 * Fix round 1 (Important): la primera versión envolvía `dispararHandler`
 * entero (arrancar + emitir) en un solo `step.run`. Un crash entre que
 * `runs.arrancar` crea la fila y `emitir` manda el evento dejaba una corrida
 * viva en Postgres, con `pasos_ejecutados: 0`, sin que nadie la fuera a
 * tomar -- un reintento del step encuentra "ya hay corrida viva" y (correcto
 * según el contrato de `dispararHandler`) NO vuelve a emitir. Corrida
 * huérfana, silenciosa, para siempre.
 *
 * Separado en dos steps, Inngest memoiza el primero (`arrancar`) apenas
 * completa: un crash a mitad del segundo (`emitir`) hace que el reintento
 * RETOME desde el resultado ya memoizado de `arrancar` -- sin volver a
 * llamar `runs.arrancar` -- y sólo repita el loop de `emitir`. Reemitir es
 * inofensivo: el evento lleva el id determinístico
 * `workflow-segmento-pendiente:<runId>:<desdePaso>` y Inngest dedupea por
 * ese id (ver `bootstrap.ts`).
 *
 * Lo que cruza de un step al otro (`iniciadas`) es plano y JSON-safe
 * (`EmitirSegmentoPendienteInput[]`, sólo strings y numbers) porque Inngest
 * serializa el resultado de cada step -- una instancia de clase o un `Date`
 * no sobreviven ese viaje.
 */
export function makeWorkflowDispararFn(deps: DispararWorkflowDeps) {
  return inngest.createFunction(
    { id: "workflow-disparar", triggers: [{ event: workflowDisparoRecibido }] },
    async ({ event, step }) => {
      const day = new Date(event.ts).toISOString().slice(0, 10);
      const base = `workflow-disparar-${day}-${event.data.leadId}-${event.data.disparador}`;

      const iniciadas = await step.run(`${base}-arrancar`, () =>
        envolverNoRetriable(() => arrancarPorDisparador(event.data, deps)),
      );

      if (iniciadas.length > 0) {
        await step.run(`${base}-emitir`, () =>
          envolverNoRetriable(async () => {
            for (const iniciada of iniciadas) {
              await deps.emitir(iniciada);
            }
          }),
        );
      }

      return { arrancadas: iniciadas.length };
    },
  );
}
