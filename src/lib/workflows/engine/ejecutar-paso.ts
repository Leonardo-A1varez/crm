/**
 * Ejecutor de un paso individual del workflow.
 *
 * Recibe un nodo, lo ejecuta con su handler correspondiente, y devuelve el
 * resultado con métricas de timing. Maneja timeout y reintentos según la
 * config del nodo.
 */

import type { Nodo, Puerto } from "@/types/workflows";
import type { ContextoEjecucion, PasoEjecutado } from "./contexto-ejecucion";
import { interpolarValor } from "./interpolador-variables";
import { obtenerHandler, type ResultadoHandler } from "./handlers/registro";

/** Timeout por defecto para un paso: 30 segundos. */
const TIMEOUT_DEFAULT_MS = 30_000;

/** Máximo de reintentos por defecto. */
const REINTENTOS_DEFAULT = 0;

/** Delay entre reintentos en ms. */
const DELAY_REINTENTO_MS = 1_000;

export interface ResultadoPaso {
  /** El paso ya ejecutado, listo para el historial. */
  paso: PasoEjecutado;
  /** Puerto de salida para determinar el siguiente nodo. */
  puerto: Puerto;
  /** Nuevas variables a mergear en el contexto. */
  contextoNuevo?: Record<string, unknown>;
  /** Si el paso requiere esperar antes de continuar. */
  esperar?: {
    tipo: "tiempo" | "respuesta" | "evento";
    hasta: Date;
    timeout?: boolean;
  };
  /** Si el paso falló y no se debe continuar. */
  fallido: boolean;
}

/**
 * Crea una promesa que rechaza después de `ms` milisegundos.
 */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout: el paso tardó más de ${ms}ms`));
    }, ms);
  });
}

/**
 * Espera `ms` milisegundos.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta un paso con reintentos.
 */
async function ejecutarConReintentos(
  nodo: Nodo,
  configInterpolada: Record<string, unknown>,
  ctx: ContextoEjecucion,
  reintentos: number,
  timeoutMs: number,
): Promise<ResultadoHandler> {
  let ultimoError: Error | undefined;

  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const handler = obtenerHandler(nodo.tipo);
      if (!handler) {
        throw new Error(`No hay handler para el tipo de nodo: ${nodo.tipo}`);
      }

      // Ejecutar con timeout
      const resultado = await Promise.race([handler(configInterpolada, ctx), timeout(timeoutMs)]);

      return resultado;
    } catch (error) {
      ultimoError = error instanceof Error ? error : new Error(String(error));

      // Si quedan reintentos, esperar y volver a intentar
      if (intento < reintentos) {
        await sleep(DELAY_REINTENTO_MS * (intento + 1)); // Backoff lineal
      }
    }
  }

  throw ultimoError ?? new Error("Error desconocido ejecutando el paso");
}

/**
 * Ejecuta un nodo individual del workflow.
 *
 * 1. Interpola las variables en la config del nodo
 * 2. Obtiene el handler correspondiente al tipo
 * 3. Ejecuta con timeout y reintentos
 * 4. Devuelve el resultado con métricas
 */
export async function ejecutarPaso(nodo: Nodo, ctx: ContextoEjecucion): Promise<ResultadoPaso> {
  const inicio = Date.now();
  const tipo = nodo.tipo;

  // Leer config de reintentos y timeout del nodo
  const reintentos =
    typeof nodo.config.reintentos === "number" ? nodo.config.reintentos : REINTENTOS_DEFAULT;
  const timeoutMs =
    typeof nodo.config.timeout_ms === "number" ? nodo.config.timeout_ms : TIMEOUT_DEFAULT_MS;

  // Interpolar variables en la config
  const { valor: configInterpolada, noResueltas } = interpolarValor(nodo.config, ctx);

  // Si hay variables no resueltas, las guardamos en el contexto para observabilidad
  // (el motor es puro y no tiene acceso a logger; el caller puede loguear al ver el resultado)
  if (noResueltas.length > 0) {
    ctx.variables.set("_ultimo_nodo_variables_no_resueltas", noResueltas);
  }

  try {
    const resultado = await ejecutarConReintentos(
      nodo,
      configInterpolada as Record<string, unknown>,
      ctx,
      reintentos,
      timeoutMs,
    );

    const duracionMs = Date.now() - inicio;

    return {
      paso: {
        nodoId: nodo.id,
        tipo,
        entrada: configInterpolada as Record<string, unknown>,
        salida: resultado.salida ?? {},
        duracionMs,
        estado: "ok",
        timestamp: new Date(),
      },
      puerto: resultado.puerto,
      contextoNuevo: resultado.contexto,
      esperar: resultado.esperar,
      fallido: false,
    };
  } catch (error) {
    const duracionMs = Date.now() - inicio;
    const mensajeError = error instanceof Error ? error.message : String(error);

    return {
      paso: {
        nodoId: nodo.id,
        tipo,
        entrada: configInterpolada as Record<string, unknown>,
        salida: {},
        duracionMs,
        estado: "error",
        error: mensajeError,
        timestamp: new Date(),
      },
      puerto: "salida", // Default, aunque no se usará si falló
      fallido: true,
    };
  }
}

/**
 * Ejecuta un paso que ya falló, marcándolo como skipped.
 *
 * Útil para nodos en ramas que no se ejecutan (condición false).
 */
export function crearPasoSkipped(nodo: Nodo, razon: string): PasoEjecutado {
  return {
    nodoId: nodo.id,
    tipo: nodo.tipo,
    entrada: nodo.config,
    salida: { razon },
    duracionMs: 0,
    estado: "skipped",
    timestamp: new Date(),
  };
}
