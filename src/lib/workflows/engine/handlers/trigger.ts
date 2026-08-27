/**
 * Handlers de nodos trigger.
 *
 * Los triggers son el punto de entrada del workflow. No ejecutan lógica real
 * aquí — la ejecución empieza DESPUÉS de que el evento que los activa ocurre.
 * Estos handlers existen para:
 * 1. Validar que la config del trigger es correcta
 * 2. Extraer datos del evento y ponerlos en el contexto
 * 3. Continuar al siguiente nodo
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Trigger: mensaje recibido.
 * El evento ya ocurrió; extraemos datos del mensaje al contexto.
 */
async function triggerMensaje(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      mensaje_contenido: ctx.mensaje?.contenido ?? "",
      mensaje_tipo: ctx.mensaje?.tipo ?? "text",
      mensaje_id: ctx.mensaje?.id ?? "",
    },
    salida: {
      tipo: "trigger_mensaje",
      mensaje_id: ctx.mensaje?.id,
    },
  };
}

/**
 * Trigger: webhook externo.
 * Los datos del webhook vienen en trigger.datos.
 */
async function triggerWebhook(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  // Extraer datos del payload del webhook
  const payload = ctx.trigger.datos;

  return {
    puerto: "salida",
    contexto: {
      webhook_payload: payload,
      webhook_source: config.source ?? "externo",
    },
    salida: {
      tipo: "trigger_webhook",
      payload_keys: Object.keys(payload),
    },
  };
}

/**
 * Trigger: cron programado.
 * No hay evento específico; la corrida arrancó porque tocaba.
 */
async function triggerCron(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      cron_ejecutado_at: new Date().toISOString(),
      cron_expresion: config.cron ?? "",
    },
    salida: {
      tipo: "trigger_cron",
      lead_id: ctx.lead?.id,
    },
  };
}

/**
 * Trigger: ejecución manual.
 * Alguien apretó "Ejecutar" en la UI.
 */
async function triggerManual(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      ejecutado_manualmente: true,
      ejecutado_at: new Date().toISOString(),
    },
    salida: {
      tipo: "trigger_manual",
      lead_id: ctx.lead?.id,
    },
  };
}

/**
 * Trigger: etiqueta asignada.
 * El lead recibió una etiqueta específica.
 */
async function triggerEtiqueta(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etiquetaId = config.etiqueta_id as string | undefined;
  const etiquetaNombre = ctx.trigger.datos.etiqueta_nombre as string | undefined;

  return {
    puerto: "salida",
    contexto: {
      etiqueta_asignada_id: etiquetaId ?? ctx.trigger.datos.etiqueta_id,
      etiqueta_asignada_nombre: etiquetaNombre,
    },
    salida: {
      tipo: "trigger_etiqueta",
      etiqueta: etiquetaNombre ?? etiquetaId,
    },
  };
}

/**
 * Trigger: etiqueta removida.
 */
async function triggerEtiquetaRemovida(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etiquetaId = config.etiqueta_id as string | undefined;
  const etiquetaNombre = ctx.trigger.datos.etiqueta_nombre as string | undefined;

  return {
    puerto: "salida",
    contexto: {
      etiqueta_removida_id: etiquetaId ?? ctx.trigger.datos.etiqueta_id,
      etiqueta_removida_nombre: etiquetaNombre,
    },
    salida: {
      tipo: "trigger_etiqueta_removida",
      etiqueta: etiquetaNombre ?? etiquetaId,
    },
  };
}

/**
 * Trigger: etapa cambiada.
 */
async function triggerEtapa(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etapaAnterior = ctx.trigger.datos.etapa_anterior as string | undefined;
  const etapaNueva = ctx.trigger.datos.etapa_nueva as string | undefined;

  return {
    puerto: "salida",
    contexto: {
      etapa_anterior: etapaAnterior,
      etapa_nueva: etapaNueva ?? ctx.sesion?.current_stage,
    },
    salida: {
      tipo: "trigger_etapa",
      de: etapaAnterior,
      a: etapaNueva,
    },
  };
}

/**
 * Trigger: lead creado.
 */
async function triggerLeadCreado(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      lead_nuevo: true,
      lead_creado_at: ctx.lead?.created_at?.toISOString() ?? new Date().toISOString(),
    },
    salida: {
      tipo: "trigger_lead_creado",
      lead_id: ctx.lead?.id,
    },
  };
}

/**
 * Trigger: vendedor asignado.
 */
async function triggerVendedorAsignado(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const vendedorId = ctx.trigger.datos.vendedor_id as string | undefined;
  const vendedorNombre = ctx.vendedor?.nombre;

  return {
    puerto: "salida",
    contexto: {
      vendedor_asignado_id: vendedorId ?? ctx.vendedor?.id,
      vendedor_asignado_nombre: vendedorNombre,
    },
    salida: {
      tipo: "trigger_vendedor_asignado",
      vendedor: vendedorNombre ?? vendedorId,
    },
  };
}

/**
 * Trigger: inactividad.
 * El lead no respondió en X tiempo.
 */
async function triggerInactividad(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const minutos = config.minutos_inactividad as number | undefined;

  return {
    puerto: "salida",
    contexto: {
      inactividad_minutos: minutos,
      inactividad_detectada_at: new Date().toISOString(),
    },
    salida: {
      tipo: "trigger_inactividad",
      minutos,
      lead_id: ctx.lead?.id,
    },
  };
}

/**
 * Trigger: formulario enviado.
 */
async function triggerFormulario(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const formId = config.formulario_id as string | undefined;
  const formData = ctx.trigger.datos.formulario_data as Record<string, unknown> | undefined;

  return {
    puerto: "salida",
    contexto: {
      formulario_id: formId ?? ctx.trigger.datos.formulario_id,
      formulario_data: formData ?? {},
    },
    salida: {
      tipo: "trigger_formulario",
      formulario_id: formId,
    },
  };
}

// Registrar todos los handlers de trigger
export function registrarHandlersTrigger(): void {
  registrarHandler("trigger_mensaje", triggerMensaje);
  registrarHandler("trigger_webhook", triggerWebhook);
  registrarHandler("trigger_cron", triggerCron);
  registrarHandler("trigger_manual", triggerManual);
  registrarHandler("trigger_etiqueta", triggerEtiqueta);
  registrarHandler("trigger_etiqueta_removida", triggerEtiquetaRemovida);
  registrarHandler("trigger_etapa", triggerEtapa);
  registrarHandler("trigger_lead_creado", triggerLeadCreado);
  registrarHandler("trigger_vendedor_asignado", triggerVendedorAsignado);
  registrarHandler("trigger_inactividad", triggerInactividad);
  registrarHandler("trigger_formulario", triggerFormulario);
}
