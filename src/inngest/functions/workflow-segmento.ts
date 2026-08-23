import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { workflowSegmentoPendiente } from "@/inngest/events";
import { ConflictError, isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { disparadorDe } from "@/lib/workflows/recorrer";
import { ejecutarSegmento, type PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import type { RegistroDeAcciones } from "@/server/services/workflows/acciones/registro";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID } from "@/types/entities";
import type { MotivoFallo } from "@/types/workflows";

export interface WorkflowSegmentoInput {
  runId: UUID;
  desdePaso: number;
}

export interface WorkflowSegmentoDeps {
  runs: Pick<
    WorkflowRunsRepository,
    "tomarSegmento" | "registrarPaso" | "esperar" | "terminar" | "fallar"
  >;
  workflows: Pick<WorkflowsRepository, "findVersion">;
  registro: RegistroDeAcciones;
  /** Inyectado para tests/simulación con reloj virtual. Default: reloj real. */
  ahora?: () => Date;
  logger?: Logger;
}

export type WorkflowSegmentoResultado =
  | { tipo: "no-op" }
  | { tipo: "espera"; nodoId: string; hasta: string; desdePaso: number }
  | { tipo: "fin" }
  | {
      tipo: "fallado";
      nodoId: string | null;
      motivo: MotivoFallo | "version_ausente" | "grafo_sin_disparador";
    };

async function fallarConMensaje(
  deps: WorkflowSegmentoDeps,
  runId: UUID,
  pasos: number,
  mensaje: string,
  motivo: "version_ausente" | "grafo_sin_disparador",
): Promise<WorkflowSegmentoResultado> {
  await deps.runs.fallar(runId, mensaje, pasos);
  return { tipo: "fallado", nodoId: null, motivo };
}

/**
 * Un segmento de una corrida: toma la corrida con el CAS, corre inline hasta
 * una espera/fin/falla, y decide qué hacer con el resultado.
 *
 * `tomarSegmento` es el compare-and-swap (anti-doble-envío): si la corrida ya
 * avanzó más allá de `desdePaso` -- otro segmento la tomó primero -- o ya no
 * está viva (terminó, falló, la cancelaron), este handler sale SIN RUIDO: ni
 * throw ni log de error. Inngest reentrega al menos una vez, y un evento
 * reentregado que llega después de que el segmento ya corrió es el caso
 * normal, no una falla -- tratarlo como error haría que una reentrega
 * reintentara para siempre.
 *
 * La versión que se lee es la PINNEADA de la corrida
 * (`run.workflow_version_id`), nunca `findVersionPublicada`: publicar una
 * versión nueva o despublicar la actual no puede alterar una corrida que ya
 * está en vuelo -- para eso `workflow_versiones` es append-only.
 *
 * Retry semantics viven ACÁ, no en `ejecutarSegmento` (que sólo devuelve un
 * resultado tipado, nunca reintenta nada por su cuenta): cuando el segmento
 * falla con `retriable: true`, este handler TIRA el error -- sin llamar
 * `runs.fallar`, así la corrida se queda exactamente como la dejó
 * `tomarSegmento` (misma `pasos_ejecutados`, estado vivo) y un reintento del
 * step la vuelve a tomar con el MISMO `desdePaso`, reejecutando el segmento
 * entero desde donde arrancó. Con `retriable: false`, marca la corrida
 * `fallado` en la base y retorna normalmente -- Inngest no reintenta nada.
 * Envolver al revés es un error permanente reintentado para siempre, o un
 * blip transitorio que mata una corrida.
 */
export async function segmentoHandler(
  input: WorkflowSegmentoInput,
  deps: WorkflowSegmentoDeps,
): Promise<WorkflowSegmentoResultado> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "workflow-segmento",
    run_id: input.runId,
  });

  const run = await deps.runs.tomarSegmento(input.runId, input.desdePaso);
  if (!run) {
    logger.info("segmento-sin-efecto");
    return { tipo: "no-op" };
  }

  const version = await deps.workflows.findVersion(run.workflow_version_id);
  if (!version) {
    // No debería pasar nunca -- `workflow_versiones` es append-only y una
    // corrida sólo referencia versiones que existieron -- pero si pasa es un
    // bug de datos, no algo transitorio: se falla en voz alta.
    logger.error("version-pinneada-ausente", { version_id: run.workflow_version_id });
    return fallarConMensaje(
      deps,
      run.id,
      run.pasos_ejecutados,
      `la versión pinneada ${run.workflow_version_id} no existe`,
      "version_ausente",
    );
  }

  // `nodo_actual` es null sólo en el primer segmento de la corrida (recién
  // arrancada por `runs.arrancar`); de ahí en más lo deja `runs.esperar()`
  // apuntando a `reanudarEn`. Un grafo que pasó el validador de W1 siempre
  // tiene exactamente un disparador (regla `disparador_unico`).
  const desdeNodo = run.nodo_actual ?? disparadorDe(version.grafo)?.id;
  if (!desdeNodo) {
    logger.error("grafo-sin-disparador");
    return fallarConMensaje(
      deps,
      run.id,
      run.pasos_ejecutados,
      "el grafo pinneado no tiene nodo disparador",
      "grafo_sin_disparador",
    );
  }

  let ultimoOrden = run.pasos_ejecutados;
  const onPaso = async (paso: PasoEjecutado) => {
    ultimoOrden = paso.orden;
    try {
      await deps.runs.registrarPaso(run.id, {
        nodo_id: paso.nodoId,
        orden: paso.orden,
        entrada: null,
        salida: paso.salida,
        error: paso.error,
      });
    } catch (error) {
      // Un reintento de un segmento fallado con `retriable: true` corre de
      // nuevo los MISMOS nodos desde `pasosPrevios`: el `orden` se repite
      // exacto y el UNIQUE (run_id, orden) de `workflow_run_pasos` (auditoría,
      // no fuente de verdad -- ver migración `20260822044955`) rechaza el
      // insert duplicado con 23505. Es la misma fila que ya se escribió en el
      // intento anterior: ignorarla es correcto, no silenciar un error real.
      // Sin este catch, CUALQUIER retry de una acción transitoria (la razón
      // de ser de `retriable: true`) degrada en un ConflictError permanente
      // en el segundo intento, enmascarando el problema original.
      if (!(error instanceof ConflictError)) throw error;
    }
  };

  const resultado = await ejecutarSegmento(
    {
      grafo: version.grafo,
      desdeNodo,
      contexto: run.contexto,
      leadId: run.lead_id,
      leadSessionId: run.lead_session_id,
      runId: run.id,
      pasosPrevios: run.pasos_ejecutados,
      maxPasos: version.max_pasos,
    },
    { registro: deps.registro, ahora: deps.ahora ?? (() => new Date()), onPaso },
  );

  if (resultado.tipo === "espera") {
    await deps.runs.esperar(run.id, resultado.reanudarEn, resultado.contexto, ultimoOrden);
    logger.info("segmento-en-espera", {
      nodo_id: resultado.nodoId,
      hasta: resultado.hasta.toISOString(),
    });
    return {
      tipo: "espera",
      nodoId: resultado.nodoId,
      hasta: resultado.hasta.toISOString(),
      desdePaso: ultimoOrden,
    };
  }

  if (resultado.tipo === "fin") {
    await deps.runs.terminar(run.id, ultimoOrden);
    logger.info("segmento-terminado");
    return { tipo: "fin" };
  }

  // fallado.
  if (resultado.retriable) {
    logger.warn("segmento-fallado-retriable", {
      motivo: resultado.motivo,
      nodo_id: resultado.nodoId,
    });
    // Deliberadamente un Error genérico, no un DomainError: isNonRetriable()
    // le da false en el wrapper de abajo, así que Inngest lo trata como
    // transitorio y reintenta el step. Ver el doc comment de esta función.
    throw new Error(resultado.error);
  }

  await deps.runs.fallar(run.id, resultado.error, ultimoOrden);
  logger.warn("segmento-fallado", { motivo: resultado.motivo, nodo_id: resultado.nodoId });
  return { tipo: "fallado", nodoId: resultado.nodoId, motivo: resultado.motivo };
}

export function makeWorkflowSegmentoFn(deps: WorkflowSegmentoDeps) {
  return inngest.createFunction(
    { id: "workflow-segmento", triggers: [{ event: workflowSegmentoPendiente }] },
    async ({ event, step }) => {
      const { runId, desdePaso } = event.data;

      const resultado = await step.run(`workflow-segmento-${runId}-${desdePaso}`, async () => {
        try {
          return await segmentoHandler({ runId, desdePaso }, deps);
        } catch (error) {
          if (isNonRetriable(error)) {
            throw new NonRetriableError((error as Error).message, { cause: error });
          }
          throw error;
        }
      });

      // El sleep y el envío del próximo segmento son steps APARTE del que
      // ejecutó y persistió el segmento: `step.sleepUntil`/`step.sendEvent`
      // no se pueden invocar dentro del callback de otro `step.run`. Separarlos
      // así es también lo que hace esto crash-safe -- una vez que el step de
      // arriba queda memoizado por Inngest, un crash a mitad del sleep o del
      // envío hace que la función RETOME en ese punto exacto al reintentar,
      // sin volver a tomar el segmento ni reescribir `workflow_runs`. Mismo
      // patrón que `recordatorio-seguimiento.ts` (`sleepUntil` + step de
      // marcar avisado), aplicado acá para encadenar el próximo segmento en
      // vez de marcar una fila.
      if (resultado.tipo === "espera") {
        await step.sleepUntil(`esperar-${runId}-${resultado.desdePaso}`, new Date(resultado.hasta));
        await step.sendEvent(`emitir-siguiente-segmento-${runId}-${resultado.desdePaso}`, {
          name: workflowSegmentoPendiente.name,
          data: { runId, desdePaso: resultado.desdePaso },
          id: `workflow-segmento-pendiente:${runId}:${resultado.desdePaso}`,
        });
      }

      return resultado;
    },
  );
}
