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
 * `input.disparador`, intenta arrancar una corrida.
 *
 * `runs.arrancar` aplica la política de concurrencia dentro del RPC de
 * Postgres (atómico): si ya hay una corrida viva de ESE workflow para este
 * lead y la política dice ignorar, devuelve `run: null` con un motivo. Este
 * handler no emite nada para esa versión, ni loguea un error -- es el
 * comportamiento esperado (una etiqueta que se reasigna dos veces no debe
 * abrir una segunda corrida), no una falla.
 *
 * Nota honesta (no una garantía): si el proceso muere DESPUÉS de que
 * `runs.arrancar` creó la fila pero ANTES de que `emitir` complete, esa
 * corrida queda viva en Postgres con `pasos_ejecutados: 0` y sin que nadie la
 * haya programado -- un reintento del step de Inngest, al reprocesar esta
 * misma versión, encuentra "ya hay corrida viva" y NO vuelve a emitir (así lo
 * exige este mismo contrato: no emitir para una corrida que ya existe). Es
 * una corrida huérfana, no duplicada. El mismo riesgo ya existe en
 * `handoff-notification.ts` (leer estado + `sendOutbound` en un solo
 * `step.run`); ahí se cierra porque `sendOutbound` deduplica y un reintento
 * puede reintentar la llamada entera. Acá no hay con qué cerrarlo sin violar
 * "no emitir dos veces para la misma corrida" -- se documenta en voz alta en
 * vez de ocultarlo.
 */
export async function dispararHandler(
  input: DispararWorkflowInput,
  deps: DispararWorkflowDeps,
): Promise<DispararWorkflowResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "workflow-disparar",
    disparador: input.disparador,
  });

  const versiones = await deps.workflows.listarPublicadasPorDisparador(input.disparador);
  let arrancadas = 0;

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
    arrancadas += 1;
    await deps.emitir({ runId: resultado.run.id, desdePaso: 0 });
    logger.info("corrida-arrancada", { version_id: version.id, run_id: resultado.run.id });
  }

  return { arrancadas };
}

export function makeWorkflowDispararFn(deps: DispararWorkflowDeps) {
  return inngest.createFunction(
    { id: "workflow-disparar", triggers: [{ event: workflowDisparoRecibido }] },
    async ({ event, step }) => {
      const day = new Date(event.ts).toISOString().slice(0, 10);
      return step.run(
        `workflow-disparar-${day}-${event.data.leadId}-${event.data.disparador}`,
        async () => {
          try {
            return await dispararHandler(event.data, deps);
          } catch (error) {
            if (isNonRetriable(error)) {
              throw new NonRetriableError((error as Error).message, { cause: error });
            }
            throw error;
          }
        },
      );
    },
  );
}
