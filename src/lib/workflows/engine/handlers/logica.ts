/**
 * Handlers de nodos de lógica.
 *
 * Control de flujo: condiciones, switches, esperas, bucles. Estos handlers
 * SÍ ejecutan lógica real — evalúan condiciones, calculan tiempos, etc.
 * No dependen de servicios externos.
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import {
  evaluarCondicion,
  evaluarCondiciones,
  type Condicion,
  type GrupoCondiciones,
} from "../evaluador-condicion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Convierte duración + unidad a milisegundos.
 */
function convertirAMs(duracion: number, unidad: string): number {
  switch (unidad) {
    case "segundos":
      return duracion * 1000;
    case "minutos":
      return duracion * 60 * 1000;
    case "horas":
      return duracion * 60 * 60 * 1000;
    case "dias":
      return duracion * 24 * 60 * 60 * 1000;
    default:
      return duracion * 60 * 1000; // Default: minutos
  }
}

/**
 * Condición (IF).
 * Evalúa una condición y devuelve "verdadero" o "falso".
 */
async function logicaCondicion(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  // La config puede traer una condición individual o un grupo
  const condicion = config as Condicion | { condiciones: Condicion[] | GrupoCondiciones };

  let resultado: boolean;

  if ("condiciones" in condicion) {
    // Grupo de condiciones
    resultado = evaluarCondiciones(condicion.condiciones, ctx);
  } else if ("campo" in condicion && "operador" in condicion) {
    // Condición individual
    resultado = evaluarCondicion(condicion, ctx);
  } else {
    throw new Error("El nodo logica_condicion requiere una condición válida");
  }

  return {
    puerto: resultado ? "verdadero" : "falso",
    contexto: {
      ultima_condicion_resultado: resultado,
    },
    salida: {
      tipo: "logica_condicion",
      resultado,
    },
  };
}

/**
 * Switch (múltiples ramas).
 * Evalúa el valor de un campo y devuelve el handle del caso que matchea.
 */
async function logicaSwitch(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const campo = config.campo as string | undefined;
  const casos = config.casos as Array<{ valor: unknown; id: string }> | undefined;

  if (!campo || !casos || casos.length === 0) {
    throw new Error("El nodo logica_switch requiere campo y casos");
  }

  // Resolver el valor del campo
  const partes = campo.split(".");
  const namespace = partes[0];
  const resto = partes.slice(1);

  let valorCampo: unknown;

  switch (namespace) {
    case "lead":
      valorCampo = ctx.lead;
      break;
    case "sesion":
      valorCampo = ctx.sesion;
      break;
    case "var":
      valorCampo = Object.fromEntries(ctx.variables);
      break;
    default:
      valorCampo = ctx.variables.get(campo);
  }

  if (valorCampo !== undefined && resto.length > 0) {
    valorCampo = resto.reduce<unknown>((obj, key) => {
      if (obj === undefined || obj === null || typeof obj !== "object") {
        return undefined;
      }
      return (obj as Record<string, unknown>)[key];
    }, valorCampo);
  }

  // Buscar el caso que matchea
  for (const caso of casos) {
    if (caso.valor === valorCampo) {
      return {
        puerto: "salida", // El motor usa el handle del caso, no el puerto
        contexto: {
          switch_caso: caso.valor,
        },
        salida: {
          tipo: "logica_switch",
          valor: valorCampo,
          caso: caso.valor,
          handle: caso.id,
        },
      };
    }
  }

  // Default
  return {
    puerto: "salida",
    contexto: {
      switch_caso: "default",
    },
    salida: {
      tipo: "logica_switch",
      valor: valorCampo,
      caso: "default",
      handle: "default",
    },
  };
}

/**
 * Validación.
 * Evalúa condiciones y falla si no se cumplen.
 */
async function logicaValidacion(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const condiciones = config.condiciones as Condicion[] | GrupoCondiciones | undefined;
  const mensajeError = config.mensaje_error as string | undefined;

  const valido = evaluarCondiciones(condiciones, ctx);

  if (!valido) {
    throw new Error(mensajeError ?? "Validación fallida");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_validacion",
      valido: true,
    },
  };
}

/**
 * Esperar tiempo.
 * Pausa el workflow por una duración específica.
 */
async function logicaEsperar(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const duracion = config.duracion as number | undefined;
  const unidad = (config.unidad as string) ?? "minutos";

  if (duracion === undefined || duracion <= 0) {
    throw new Error("El nodo logica_esperar requiere una duración positiva");
  }

  const ms = convertirAMs(duracion, unidad);
  const hasta = new Date(Date.now() + ms);

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_esperar",
      duracion,
      unidad,
      hasta: hasta.toISOString(),
    },
    esperar: {
      tipo: "tiempo",
      hasta,
    },
  };
}

/**
 * Esperar respuesta del lead.
 * Pausa hasta que el lead responda o expire el timeout.
 */
async function logicaEsperarRespuesta(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const timeout = config.timeout as number | undefined;
  const unidad = (config.unidad as string) ?? "horas";

  // Default: 24 horas
  const ms = timeout ? convertirAMs(timeout, unidad) : 24 * 60 * 60 * 1000;
  const hasta = new Date(Date.now() + ms);

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_esperar_respuesta",
      timeout: timeout ?? 24,
      unidad,
      hasta: hasta.toISOString(),
    },
    esperar: {
      tipo: "respuesta",
      hasta,
      timeout: true,
    },
  };
}

/**
 * Esperar evento específico.
 */
async function logicaEsperarEvento(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const evento = config.evento as string | undefined;
  const timeout = config.timeout as number | undefined;
  const unidad = (config.unidad as string) ?? "horas";

  if (!evento) {
    throw new Error("El nodo logica_esperar_evento requiere el nombre del evento");
  }

  const ms = timeout ? convertirAMs(timeout, unidad) : 24 * 60 * 60 * 1000;
  const hasta = new Date(Date.now() + ms);

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_esperar_evento",
      evento,
      hasta: hasta.toISOString(),
    },
    esperar: {
      tipo: "evento",
      hasta,
      timeout: !!timeout,
    },
  };
}

/**
 * Loop (iterar lista).
 * Por cada elemento de la lista, ejecuta los nodos conectados.
 */
async function logicaLoop(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const lista = config.lista as string | unknown[] | undefined;
  const variable = (config.variable as string) ?? "item";

  let items: unknown[];

  if (typeof lista === "string") {
    // Resolver desde variables
    const valor = ctx.variables.get(lista);
    items = Array.isArray(valor) ? valor : [];
  } else if (Array.isArray(lista)) {
    items = lista;
  } else {
    items = [];
  }

  // Guardar el índice actual y el total
  const indiceActual = (ctx.variables.get(`${variable}_indice`) as number) ?? 0;
  const total = items.length;

  if (indiceActual >= total) {
    // Loop terminado
    return {
      puerto: "salida",
      contexto: {
        loop_terminado: true,
      },
      salida: {
        tipo: "logica_loop",
        estado: "terminado",
        total,
      },
    };
  }

  // Hay más items
  return {
    puerto: "salida",
    contexto: {
      [variable]: items[indiceActual],
      [`${variable}_indice`]: indiceActual + 1,
      [`${variable}_total`]: total,
      [`${variable}_primero`]: indiceActual === 0,
      [`${variable}_ultimo`]: indiceActual === total - 1,
    },
    salida: {
      tipo: "logica_loop",
      estado: "iterando",
      indice: indiceActual,
      total,
    },
  };
}

/**
 * Agrupar (visual, no ejecuta nada).
 */
async function logicaGrupo(
  _config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    salida: {
      tipo: "logica_grupo",
    },
  };
}

/**
 * Ir a nodo (goto).
 * Salta a otro nodo del grafo.
 */
async function logicaGoto(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const nodoDestino = config.nodo_destino as string | undefined;

  if (!nodoDestino) {
    throw new Error("El nodo logica_goto requiere nodo_destino");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_goto",
      destino: nodoDestino,
    },
  };
}

/**
 * Detener workflow.
 */
async function logicaDetener(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const motivo = config.motivo as string | undefined;

  return {
    puerto: "salida",
    salida: {
      tipo: "logica_detener",
      motivo: motivo ?? "Detenido por nodo",
    },
  };
}

/**
 * Error handler (capturar errores).
 */
async function logicaError(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const ultimoError = ctx.variables.get("ultimo_error") as string | undefined;

  return {
    puerto: "salida",
    contexto: {
      error_capturado: true,
      error_mensaje: ultimoError,
    },
    salida: {
      tipo: "logica_error",
      error: ultimoError,
    },
  };
}

// Registrar todos los handlers de lógica
export function registrarHandlersLogica(): void {
  registrarHandler("logica_condicion", logicaCondicion);
  registrarHandler("logica_switch", logicaSwitch);
  registrarHandler("logica_validacion", logicaValidacion);
  registrarHandler("logica_esperar", logicaEsperar);
  registrarHandler("logica_esperar_respuesta", logicaEsperarRespuesta);
  registrarHandler("logica_esperar_evento", logicaEsperarEvento);
  registrarHandler("logica_loop", logicaLoop);
  registrarHandler("logica_grupo", logicaGrupo);
  registrarHandler("logica_goto", logicaGoto);
  registrarHandler("logica_detener", logicaDetener);
  registrarHandler("logica_error", logicaError);
}
