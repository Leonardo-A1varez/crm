import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { compatibilidadRecalculoRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type {
  RecalcularCompatibilidadResultado,
  RecalcularCompatibilidadService,
} from "@/server/services/catalog/recalcular-compatibilidad.service";

const FUNCION = "recalcular-compatibilidad";
const LIMITE_LOTE_DEFAULT = 250;
const MAX_LOTES_DEFAULT = 4;
const MINUTOS_POR_VENTANA = 5;

export interface RecalcularCompatibilidadDeps {
  servicio: RecalcularCompatibilidadService;
  /** Productos por lote. */
  limiteLote?: number;
  /** Lotes por corrida: el resto lo toma la corrida de 5 minutos después. */
  maxLotes?: number;
  logger?: Logger;
}

export interface RecalcularCompatibilidadCorrida extends RecalcularCompatibilidadResultado {
  lotes: number;
}

export interface PasoDeCorrida {
  run<T>(nombre: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * La clave de idempotencia de un lote: `${función}-${día}-${ventana}-lote${n}`
 * (AGENTS.md §0.9). La ventana es el tramo de 5 minutos del disparo, que es el
 * mismo en cada reintento de la corrida: el paso se memoiza por nombre y un
 * reintento no traduce dos veces. Ya de por sí la escritura es idempotente
 * (guarda por nombre y baja la marca), así que esto es solo ahorro.
 */
export function claveDeLote(disparo: Date, lote: number): string {
  const dia = disparo.toISOString().slice(0, 10);
  const ventana = Math.floor(disparo.getUTCMinutes() / MINUTOS_POR_VENTANA) * MINUTOS_POR_VENTANA;
  const hhmm = `${String(disparo.getUTCHours()).padStart(2, "0")}${String(ventana).padStart(2, "0")}`;
  return `${FUNCION}-${dia}-${hhmm}-lote${lote}`;
}

export async function recalcularCompatibilidadHandler(
  input: { ts: number },
  deps: RecalcularCompatibilidadDeps,
  step: PasoDeCorrida,
): Promise<RecalcularCompatibilidadCorrida> {
  const logger = (deps.logger ?? new NoopLogger()).child({ workflow: FUNCION });
  const limite = deps.limiteLote ?? LIMITE_LOTE_DEFAULT;
  const maxLotes = deps.maxLotes ?? MAX_LOTES_DEFAULT;
  // `input.ts` es la hora del disparo (la fija Inngest, no cambia al reintentar): con
  // `new Date()` los nombres de los pasos cambiarían en cada reintento.
  const disparo = new Date(input.ts);

  const total: RecalcularCompatibilidadCorrida = {
    lotes: 0,
    leidos: 0,
    actualizados: 0,
    sinVehiculo: 0,
    descartados: 0,
  };
  for (let lote = 0; lote < maxLotes; lote += 1) {
    const r = await step.run(claveDeLote(disparo, lote), () => deps.servicio.recalcular(limite));
    total.lotes += 1;
    total.leidos += r.leidos;
    total.actualizados += r.actualizados;
    total.sinVehiculo += r.sinVehiculo;
    total.descartados += r.descartados;
    if (r.leidos < limite) break;
  }

  if (total.leidos > 0) logger.info("compatibilidad-recalculada", { ...total });
  return total;
}

export function makeRecalcularCompatibilidadFn(deps: RecalcularCompatibilidadDeps) {
  return inngest.createFunction(
    {
      id: FUNCION,
      triggers: [{ event: compatibilidadRecalculoRequested }, { cron: "*/5 * * * *" }],
    },
    async ({ event, step }) => {
      try {
        return await recalcularCompatibilidadHandler({ ts: event.ts ?? Date.now() }, deps, {
          run: <T>(nombre: string, fn: () => Promise<T>): Promise<T> =>
            step.run(nombre, fn) as Promise<T>,
        });
      } catch (e) {
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
