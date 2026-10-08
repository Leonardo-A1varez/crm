import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { bodegaSincronizacionRequested } from "@/inngest/events";
import {
  mismoCursor,
  TABLAS_BODEGA,
  type CursorBodega,
  type TablaBodega,
} from "@/lib/catalogo/bodega-contrato";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type {
  ResultadoPagina,
  SincronizarBodegaService,
} from "@/server/services/catalog/bodega/sincronizar-bodega.service";

const FUNCION = "sincronizar-bodega";
/** Páginas por corrida (todas las tablas juntas). El resto lo toma la corrida de 5 minutos después. */
const MAX_PAGINAS_DEFAULT = 50;
const MINUTOS_POR_VENTANA = 5;

export interface SincronizarBodegaDeps {
  /**
   * `null` = faltan `BODEGA_SUPABASE_URL`, `BODEGA_SUPABASE_ANON_KEY` o
   * `BODEGA_CATALOGO_CLAVE`. La corrida no hace nada (no es un error: la integración
   * simplemente no está configurada todavía).
   */
  servicio: SincronizarBodegaService | null;
  maxPaginas?: number;
  logger?: Logger;
}

export interface PasoDeCorrida {
  run<T>(nombre: string, fn: () => Promise<T>): Promise<T>;
}

export interface SincronizarBodegaCorrida {
  configurado: boolean;
  paginas: number;
  filas: number;
  aplicadas: number;
  /** La corrida se cortó por el tope de páginas: queda más para la próxima. */
  topeAlcanzado: boolean;
  porTabla: Record<TablaBodega, { paginas: number; filas: number; aplicadas: number }>;
}

const ventanaDe = (disparo: Date): string => {
  const dia = disparo.toISOString().slice(0, 10);
  const min = Math.floor(disparo.getUTCMinutes() / MINUTOS_POR_VENTANA) * MINUTOS_POR_VENTANA;
  return `${dia}-${String(disparo.getUTCHours()).padStart(2, "0")}${String(min).padStart(2, "0")}`;
};

/** La clave de idempotencia del paso que lee los cursores guardados. */
export function claveDeCursores(disparo: Date): string {
  return `${FUNCION}-${ventanaDe(disparo)}-cursores`;
}

/**
 * La clave de idempotencia de una página (AGENTS.md §0.9): función, día y ventana del
 * disparo, tabla y la posición EXACTA de la que se parte. El cursor viaja como el texto
 * que es. Reintentar la corrida reutiliza la salida memoizada de cada página y no vuelve
 * a pedirla ni a escribirla; una página nueva siempre tiene otro cursor.
 */
export function claveDePagina(disparo: Date, tabla: TablaBodega, cursor: CursorBodega): string {
  return `${FUNCION}-${ventanaDe(disparo)}-${tabla}-${cursor.desde}~${cursor.despues ?? ""}`;
}

const vacio = () => ({ paginas: 0, filas: 0, aplicadas: 0 });

export async function sincronizarBodegaHandler(
  input: { ts: number },
  deps: SincronizarBodegaDeps,
  step: PasoDeCorrida,
): Promise<SincronizarBodegaCorrida> {
  const logger = (deps.logger ?? new NoopLogger()).child({ workflow: FUNCION });
  const total: SincronizarBodegaCorrida = {
    configurado: deps.servicio !== null,
    paginas: 0,
    filas: 0,
    aplicadas: 0,
    topeAlcanzado: false,
    porTabla: {
      marcas: vacio(),
      existencias: vacio(),
      variantes: vacio(),
      bajas: vacio(),
    },
  };

  const servicio = deps.servicio;
  if (servicio === null) {
    logger.info("bodega-sync-no-configurado", {
      motivo: "faltan BODEGA_SUPABASE_URL, BODEGA_SUPABASE_ANON_KEY o BODEGA_CATALOGO_CLAVE",
    });
    return total;
  }

  const maxPaginas = deps.maxPaginas ?? MAX_PAGINAS_DEFAULT;
  // `input.ts` es la hora del disparo (la fija Inngest, no cambia al reintentar): con
  // `new Date()` los nombres de los pasos cambiarían en cada reintento.
  const disparo = new Date(input.ts);

  const cursores = await step.run(claveDeCursores(disparo), () => servicio.leerCursores());

  // Orden del contrato (§3): marcas → existencias → variantes → bajas. Las bajas al
  // final: así una baja nunca se aplica antes de que llegue el alta que la precede.
  for (const tabla of TABLAS_BODEGA) {
    let cursor = cursores[tabla];
    for (;;) {
      if (total.paginas >= maxPaginas) {
        total.topeAlcanzado = true;
        break;
      }
      const posicion = cursor;
      const r: ResultadoPagina = await step.run(claveDePagina(disparo, tabla, posicion), () =>
        servicio.sincronizarPagina(tabla, posicion),
      );
      total.paginas += 1;
      total.filas += r.filas;
      total.aplicadas += r.aplicadas;
      const t = total.porTabla[tabla];
      t.paginas += 1;
      t.filas += r.filas;
      t.aplicadas += r.aplicadas;

      if (r.siguiente === null) break;
      if (mismoCursor(r.siguiente, posicion)) {
        // Una página llena que no mueve el cursor se pediría para siempre.
        logger.warn("bodega-sync-sin-progreso", { tabla });
        break;
      }
      cursor = r.siguiente;
    }
    if (total.topeAlcanzado) break;
  }

  // Solo contadores: nunca el contenido de las filas ni las credenciales.
  if (total.filas > 0 || total.topeAlcanzado) {
    logger.info("bodega-sync-completa", {
      paginas: total.paginas,
      filas: total.filas,
      aplicadas: total.aplicadas,
      topeAlcanzado: total.topeAlcanzado,
    });
  }
  return total;
}

export function makeSincronizarBodegaFn(deps: SincronizarBodegaDeps) {
  return inngest.createFunction(
    {
      id: FUNCION,
      // Nunca dos corridas a la vez: dos cursores en vuelo se pisarían la última página.
      concurrency: { limit: 1 },
      triggers: [{ event: bodegaSincronizacionRequested }, { cron: "*/5 * * * *" }],
    },
    async ({ event, step }) => {
      try {
        return await sincronizarBodegaHandler({ ts: event.ts ?? Date.now() }, deps, {
          run: <T>(nombre: string, fn: () => Promise<T>): Promise<T> =>
            step.run(nombre, fn) as Promise<T>,
        });
      } catch (e) {
        // Una clave rechazada o un pedido mal formado no se arreglan reintentando; el
        // cron lo vuelve a intentar a los 5 minutos.
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
