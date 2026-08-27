/**
 * Ejecutor principal del motor de workflows.
 *
 * Recorre el grafo nodo por nodo, ejecuta cada paso con su handler, y
 * persiste el estado para recovery. Soporta:
 * - Condiciones: bifurcación por verdadero/falso
 * - Esperas: corta el segmento y programa reanudación
 * - Reintentos: configurable por nodo
 * - Tope de pasos: protección contra ciclos infinitos
 */

import { esFinal, esTrigger } from "@/types/workflows";
import type { Grafo, Nodo, Puerto, MotivoFallo } from "@/types/workflows";
import type { WorkflowVersion, UUID } from "@/types/entities";
import {
  crearContextoVacio,
  serializarVariables,
  deserializarVariables,
  type ContextoEjecucion,
  type PasoEjecutado,
} from "./contexto-ejecucion";
import { ejecutarPaso, type ResultadoPaso } from "./ejecutar-paso";
import { inicializarHandlers } from "./handlers";

/** Resultado de ejecutar un segmento del workflow. */
export type ResultadoEjecucion =
  | {
      tipo: "completado";
      pasos: number;
      duracionMs: number;
    }
  | {
      tipo: "esperando";
      nodoId: string;
      hasta: Date;
      reanudarEn: string;
      contexto: Record<string, unknown>;
    }
  | {
      tipo: "fallado";
      nodoId: string;
      error: string;
      motivo: MotivoFallo;
      retriable: boolean;
    };

/** Callbacks para persistir estado y reportar progreso. */
export interface EjecucionCallbacks {
  /** Guarda el estado del run en la base de datos. */
  persistirEstado: (ctx: ContextoEjecucion) => Promise<void>;
  /** Guarda un paso ejecutado. */
  persistirPaso: (runId: UUID, paso: PasoEjecutado, orden: number) => Promise<void>;
  /** Programa la reanudación del workflow a una hora específica. */
  programarContinuacion?: (ctx: ContextoEjecucion, hasta: Date) => Promise<void>;
  /** Notifica progreso (opcional, para UI). */
  onPaso?: (paso: PasoEjecutado) => void;
}

/**
 * Encuentra el nodo trigger del grafo.
 */
function encontrarTrigger(grafo: Grafo): Nodo | undefined {
  return grafo.nodos.find((n) => esTrigger(n.tipo));
}

/**
 * Encuentra el siguiente nodo dado un nodo actual y un puerto de salida.
 */
function encontrarSiguiente(grafo: Grafo, nodoActual: string, puerto: Puerto): string | null {
  const arista = grafo.aristas.find((a) => a.desde === nodoActual && a.puerto === puerto);
  return arista?.hasta ?? null;
}

/**
 * Obtiene un nodo por su ID.
 */
function obtenerNodo(grafo: Grafo, id: string): Nodo | undefined {
  return grafo.nodos.find((n) => n.id === id);
}

/**
 * Determina el siguiente nodo basándose en el resultado del paso.
 *
 * - Para condiciones: usa el puerto verdadero/falso
 * - Para switches: busca el handle del caso que matcheó
 * - Para el resto: usa el puerto "salida"
 */
function determinarSiguiente(grafo: Grafo, nodo: Nodo, resultado: ResultadoPaso): string | null {
  // Si el nodo es un goto, ir al destino especificado. Reconoce tanto el
  // modelo legacy (tipo "accion" + subtipo en config.accion) como el directo
  // del catálogo nuevo (tipo "logica_goto").
  const esGoto =
    (nodo.tipo === "accion" && nodo.config.accion === "logica_goto") || nodo.tipo === "logica_goto";
  if (esGoto) {
    const destino = resultado.paso.salida?.destino as string | undefined;
    if (destino) {
      return destino;
    }
  }

  // Si es un switch, usar el handle del caso
  const esSwitch =
    (nodo.tipo === "accion" && nodo.config.accion === "logica_switch") ||
    nodo.tipo === "logica_switch";
  if (esSwitch) {
    const handle = resultado.paso.salida?.handle as string | undefined;
    if (handle && handle !== "default") {
      // Buscar arista con ese handle (guardado en metadata de la arista)
      const arista = grafo.aristas.find(
        (a) => a.desde === nodo.id && (a as { handle?: string }).handle === handle,
      );
      if (arista) return arista.hasta;
    }
  }

  // Para condiciones: el puerto viene del resultado
  // Para el resto: buscar por puerto estándar
  return encontrarSiguiente(grafo, nodo.id, resultado.puerto);
}

/**
 * Ejecuta un workflow desde el inicio o desde un punto de reanudación.
 */
export async function ejecutarWorkflow(
  version: WorkflowVersion,
  contextoInicial: Partial<ContextoEjecucion>,
  callbacks: EjecucionCallbacks,
): Promise<ResultadoEjecucion> {
  // Inicializar handlers si no lo están
  inicializarHandlers();

  const grafo = version.grafo;
  const maxPasos = version.max_pasos;
  const inicio = Date.now();

  // Crear o restaurar contexto
  const ctx: ContextoEjecucion = contextoInicial.runId
    ? {
        ...crearContextoVacio({
          workflowId: version.workflow_id,
          runId: contextoInicial.runId,
          versionId: version.id,
          trigger: contextoInicial.trigger ?? { tipo: "manual", datos: {} },
          lead: contextoInicial.lead,
          sesion: contextoInicial.sesion,
          vendedor: contextoInicial.vendedor,
          mensaje: contextoInicial.mensaje,
        }),
        // Restaurar estado si viene de reanudación
        variables: contextoInicial.variables ?? new Map<string, unknown>(),
        nodoActual: contextoInicial.nodoActual ?? "",
        nodosEjecutados: contextoInicial.nodosEjecutados ?? new Set(),
        historialPasos: contextoInicial.historialPasos ?? [],
        estado: "ejecutando",
      }
    : crearContextoVacio({
        workflowId: version.workflow_id,
        runId: crypto.randomUUID(),
        versionId: version.id,
        trigger: contextoInicial.trigger ?? { tipo: "manual", datos: {} },
        lead: contextoInicial.lead,
        sesion: contextoInicial.sesion,
        vendedor: contextoInicial.vendedor,
        mensaje: contextoInicial.mensaje,
      });

  let pasosEjecutados = 0;

  try {
    // Si no hay nodo actual, empezar desde el trigger. Un grafo sin ningún
    // trigger reconocible es un dato mal formado, no una excepción: se
    // reporta igual que "nodo no encontrado" más abajo, con el mismo motivo.
    if (!ctx.nodoActual) {
      const trigger = encontrarTrigger(grafo);
      if (!trigger) {
        ctx.estado = "error";
        ctx.error = "El grafo no tiene nodo disparador";
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "fallado",
          nodoId: ctx.nodoActual,
          error: ctx.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      ctx.nodoActual = trigger.id;
    }

    // Loop de ejecución
    while (ctx.estado === "ejecutando") {
      // Protección contra ciclos infinitos
      if (pasosEjecutados >= maxPasos) {
        ctx.estado = "error";
        ctx.error = `Se alcanzó el tope de ${maxPasos} pasos`;
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "fallado",
          nodoId: ctx.nodoActual,
          error: ctx.error,
          motivo: "tope_pasos",
          retriable: false,
        };
      }

      const nodo = obtenerNodo(grafo, ctx.nodoActual);
      if (!nodo) {
        ctx.estado = "error";
        ctx.error = `Nodo no encontrado: ${ctx.nodoActual}`;
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "fallado",
          nodoId: ctx.nodoActual,
          error: ctx.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }

      // Ejecutar el paso
      const resultado = await ejecutarPaso(nodo, ctx);
      pasosEjecutados++;

      // Registrar en historial
      ctx.historialPasos.push(resultado.paso);
      ctx.nodosEjecutados.add(nodo.id);
      ctx.actualizadoEn = new Date();

      // Mergear nuevas variables
      if (resultado.contextoNuevo) {
        for (const [k, v] of Object.entries(resultado.contextoNuevo)) {
          ctx.variables.set(k, v);
        }
      }

      // Persistir paso
      await callbacks.persistirPaso(ctx.runId, resultado.paso, pasosEjecutados);

      // Notificar progreso
      callbacks.onPaso?.(resultado.paso);

      // Si falló, terminar
      if (resultado.fallido) {
        ctx.estado = "error";
        ctx.error = resultado.paso.error ?? "Error desconocido";
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: ctx.error,
          motivo: "accion_fallo",
          retriable: true, // Las fallas de acción pueden ser transitorias
        };
      }

      // Si es un nodo de detener, terminar. `esFinal` cubre "fin"/"logica_detener"
      // directos; `config.accion` cubre el legacy (tipo "accion" + subtipo).
      if (nodo.config.accion === "logica_detener" || esFinal(nodo.tipo)) {
        ctx.estado = "completado";
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "completado",
          pasos: pasosEjecutados,
          duracionMs: Date.now() - inicio,
        };
      }

      // Si hay espera, cortar y programar reanudación
      if (resultado.esperar) {
        ctx.estado = "esperando";
        const siguiente = determinarSiguiente(grafo, nodo, resultado);
        ctx.nodoActual = siguiente ?? nodo.id;
        await callbacks.persistirEstado(ctx);

        if (callbacks.programarContinuacion) {
          await callbacks.programarContinuacion(ctx, resultado.esperar.hasta);
        }

        return {
          tipo: "esperando",
          nodoId: nodo.id,
          hasta: resultado.esperar.hasta,
          reanudarEn: ctx.nodoActual,
          contexto: serializarVariables(ctx.variables),
        };
      }

      // Determinar siguiente nodo
      const siguiente = determinarSiguiente(grafo, nodo, resultado);

      if (!siguiente) {
        // Fin del flujo
        ctx.estado = "completado";
        await callbacks.persistirEstado(ctx);
        return {
          tipo: "completado",
          pasos: pasosEjecutados,
          duracionMs: Date.now() - inicio,
        };
      }

      ctx.nodoActual = siguiente;
      await callbacks.persistirEstado(ctx);
    }

    // Si salimos del loop sin completar, algo raro pasó
    return {
      tipo: "completado",
      pasos: pasosEjecutados,
      duracionMs: Date.now() - inicio,
    };
  } catch (error) {
    // Error no controlado
    ctx.estado = "error";
    ctx.error = error instanceof Error ? error.message : String(error);
    await callbacks.persistirEstado(ctx);

    return {
      tipo: "fallado",
      nodoId: ctx.nodoActual,
      error: ctx.error,
      motivo: "accion_fallo",
      retriable: false, // Errores no controlados no se reintentan
    };
  }
}

/**
 * Reanuda un workflow que estaba esperando.
 */
export async function reanudarWorkflow(
  version: WorkflowVersion,
  contextoGuardado: Record<string, unknown>,
  nodoActual: string,
  callbacks: EjecucionCallbacks,
): Promise<ResultadoEjecucion> {
  const variables = deserializarVariables(contextoGuardado);

  return ejecutarWorkflow(
    version,
    {
      runId: contextoGuardado.runId as UUID | undefined,
      variables,
      nodoActual,
      nodosEjecutados: new Set((contextoGuardado.nodosEjecutados as string[] | undefined) ?? []),
      historialPasos: (contextoGuardado.historialPasos as PasoEjecutado[] | undefined) ?? [],
    },
    callbacks,
  );
}

// Re-exportar tipos útiles
export { serializarVariables, deserializarVariables };
export type { ContextoEjecucion, PasoEjecutado };
