import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { difusionProgramada, difusionReanudada } from "@/inngest/events";
import { DifusionProgramadaSchema } from "@/lib/difusion/eventos";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { MotorDifusionService, PlanEsperado } from "@/server/services/difusion/motor.service";

/**
 * La función que drena la cola de difusión. La lógica es del motor
 * (`server/services/difusion/motor.service.ts`); esto sólo la orquesta.
 *
 * - Arranca con `difusion/programada` (el aviso directo del panel o el
 *   reenvío del outbox), con `difusion/reanudada` y con un cron que retoma lo
 *   que quedó: las tandas de mañana, lo que esperó cupo o una corrida cortada.
 * - Un step por lote. Entre lote y lote el motor relee el estado, así que
 *   pausar o detener frena el lote siguiente.
 * - `concurrency: 1` para la función entera: nunca dos lotes a la vez. Como
 *   hay un solo número por instalación (single-org), es "una difusión drenando
 *   a la vez por número"; y como cada lote toma una sola difusión, la primera
 *   programada se drena antes que la siguiente.
 * - El nombre de cada step lleva el minuto del evento que arrancó la corrida:
 *   un reintento vuelve a armar los mismos nombres. La idempotencia por envío
 *   no depende de eso: la da la reserva de cada fila en la base.
 */

/** Decisión propia: cada 5 minutos alcanza para retomar sin gastar invocaciones. */
export const CRON_DRENAR_DIFUSIONES = "*/5 * * * *";
/** Lotes por corrida: 200 × 25 = 5.000 envíos. Lo que sobra lo toma la corrida siguiente. */
export const MAX_LOTES_POR_CORRIDA = 200;
/** Meta: "backoff desde 4 segundos" ante el throughput (PRD §4.2). */
const ESPERA_RITMO_MS = 5_000;
/** Meta: 1 mensaje cada 6 s al mismo destinatario. */
const ESPERA_DESTINATARIO_MS = 6_000;

export interface DrenarDifusionesDeps {
  motor: MotorDifusionService;
  logger?: Logger;
}

export interface PasosDrenado {
  run<T>(nombre: string, fn: () => Promise<T>): Promise<T>;
  sleep(nombre: string, ms: number): Promise<void>;
}

export interface DrenarDifusionesInput {
  /** Minuto del evento que arrancó la corrida: estable entre reintentos. */
  tick: string;
  /** Viene con `difusion/programada`: se verifica antes del primer lote. */
  plan?: PlanEsperado;
}

export interface DrenarDifusionesResult {
  lotes: number;
  aceptados: number;
  fin: "sin_trabajo" | "esperando_cupo" | "tope_de_lotes";
}

export async function drenarDifusionesHandler(
  input: DrenarDifusionesInput,
  deps: DrenarDifusionesDeps,
  step: PasosDrenado,
): Promise<DrenarDifusionesResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({ workflow: "drenar-difusiones" });
  const base = `drenar-difusiones-${input.tick}`;

  if (input.plan) {
    const plan = input.plan;
    await step.run(`${base}-verificar-${plan.difusionId}`, () => deps.motor.verificarPlan(plan));
  }

  let aceptados = 0;
  for (let i = 0; i < MAX_LOTES_POR_CORRIDA; i++) {
    const r = await step.run(`${base}-lote-${i}`, () => deps.motor.drenarLote());
    switch (r.tipo) {
      case "sin_trabajo":
      case "esperando_cupo":
        logger.info("difusion.corrida_terminada", { lotes: i + 1, aceptados, fin: r.tipo });
        return { lotes: i + 1, aceptados, fin: r.tipo };
      case "ritmo":
        await step.sleep(`${base}-ritmo-${i}`, ESPERA_RITMO_MS);
        break;
      case "frenada":
        // La que se frenó ya no está activa; la siguiente, si hay, sigue.
        break;
      case "enviado":
        aceptados += r.aceptados;
        // Sólo quedaban personas que recibieron algo hace menos de 6 s:
        // reintentar ya daría lo mismo.
        if (r.aceptados + r.fallidos + r.excluidos === 0 && r.diferidos > 0) {
          await step.sleep(`${base}-destinatario-${i}`, ESPERA_DESTINATARIO_MS);
        }
        break;
    }
  }
  logger.info("difusion.corrida_terminada", {
    lotes: MAX_LOTES_POR_CORRIDA,
    aceptados,
    fin: "tope_de_lotes",
  });
  return { lotes: MAX_LOTES_POR_CORRIDA, aceptados, fin: "tope_de_lotes" };
}

function adaptar(step: {
  run: <U>(nombre: string, fn: () => Promise<U>) => Promise<unknown>;
  sleep: (nombre: string, ms: number) => Promise<unknown>;
}): PasosDrenado {
  return {
    run: <T>(nombre: string, fn: () => Promise<T>) => step.run(nombre, fn) as Promise<T>,
    sleep: async (nombre, ms) => {
      await step.sleep(nombre, ms);
    },
  };
}

export function makeDrenarDifusionesFn(deps: DrenarDifusionesDeps) {
  return inngest.createFunction(
    {
      id: "drenar-difusiones",
      concurrency: { limit: 1 },
      triggers: [
        { event: difusionProgramada },
        { event: difusionReanudada },
        { cron: CRON_DRENAR_DIFUSIONES },
      ],
    },
    async ({ event, step }) => {
      const tick = new Date(event.ts ?? Date.now()).toISOString().slice(0, 16);
      // El evento llega también por el outbox: se valida contra su contrato
      // antes de usar las cifras para verificar el plan.
      const programada =
        event.name === difusionProgramada.name
          ? DifusionProgramadaSchema.safeParse(event.data)
          : null;
      if (programada && !programada.success) {
        (deps.logger ?? new NoopLogger()).warn("difusion.evento_programada_invalido", {
          eventId: event.id,
        });
      }
      const plan = programada?.success ? programada.data : undefined;
      try {
        return await drenarDifusionesHandler({ tick, plan }, deps, adaptar(step));
      } catch (e) {
        if (isNonRetriable(e)) throw new NonRetriableError((e as Error).message, { cause: e });
        throw e;
      }
    },
  );
}
