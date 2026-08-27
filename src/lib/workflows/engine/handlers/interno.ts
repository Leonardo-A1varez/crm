/**
 * Handlers de nodos internos.
 *
 * Notificaciones al equipo, comentarios, debugging. No afectan al lead
 * directamente — son para operaciones internas del equipo.
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Notificar al vendedor asignado.
 */
async function intNotifVendedor(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const canal = (config.canal as string) ?? "email";
  const vendedorId = (config.vendedor_id as string) ?? ctx.vendedor?.id;

  if (!mensaje) {
    throw new Error("El nodo int_notif_vendedor requiere un mensaje");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_notif_vendedor",
      vendedor_id: vendedorId,
      canal,
      mensaje_length: mensaje.length,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Notificar a un grupo/canal.
 */
async function intNotifGrupo(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const grupo = config.grupo as string | undefined;
  const canal = (config.canal as string) ?? "slack";

  if (!mensaje || !grupo) {
    throw new Error("El nodo int_notif_grupo requiere mensaje y grupo");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_notif_grupo",
      grupo,
      canal,
      mensaje_length: mensaje.length,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Comentario interno en la conversación.
 * Solo visible para el equipo, no para el lead.
 */
async function intComentario(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const contenido = config.contenido as string | undefined;
  const visiblePara = config.visible_para as string[] | undefined;

  if (!contenido) {
    throw new Error("El nodo int_comentario requiere contenido");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_comentario",
      contenido_length: contenido.length,
      visible_para: visiblePara ?? ["todos"],
      session_id: ctx.sesion?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Log/Debug para desarrollo.
 * Solo ejecuta en desarrollo; en producción es un no-op.
 */
async function intDebug(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const variables = config.variables as string[] | undefined;
  const nivel = (config.nivel as string) ?? "info";

  // En producción, solo registramos que pasó un debug
  // En desarrollo, se podría loguear el contenido completo

  const variablesResueltas: Record<string, unknown> = {};
  if (variables) {
    for (const v of variables) {
      variablesResueltas[v] = ctx.variables.get(v);
    }
  }

  return {
    puerto: "salida",
    contexto: {
      debug_ejecutado: true,
    },
    salida: {
      tipo: "int_debug",
      nivel,
      mensaje,
      variables_count: variables?.length ?? 0,
      nodo_actual: ctx.nodoActual,
      pasos_ejecutados: ctx.historialPasos.length,
    },
  };
}

// Registrar todos los handlers internos
export function registrarHandlersInterno(): void {
  registrarHandler("int_notif_vendedor", intNotifVendedor);
  registrarHandler("int_notif_grupo", intNotifGrupo);
  registrarHandler("int_comentario", intComentario);
  registrarHandler("int_debug", intDebug);
}
