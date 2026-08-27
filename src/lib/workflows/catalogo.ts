/**
 * El vocabulario de un workflow: qué lo dispara y qué puede hacer.
 *
 * Vive en `lib/` porque lo necesitan dos lados que no se pueden ver entre sí:
 * el motor (`inngest/**`, `server/**`) y la pantalla que arma los flujos
 * (`components/**`, que por boundaries no puede importar ninguno de los dos).
 *
 * `Nodo.config` sigue siendo `Record<string, unknown>` en el dominio a
 * propósito —el motor la trata como opaca— pero la UI necesita ofrecer opciones
 * concretas en vez de un campo de texto libre donde cualquier typo se descubre
 * en producción con un `accion_desconocida`.
 */

import type { NodoTipo } from "@/types/workflows";

/**
 * Los eventos de dominio que arrancan una corrida.
 *
 * Los emite `workflow-disparar`, que busca las versiones publicadas cuyo nodo
 * disparador matchea. Agregar uno acá no lo hace existir: hay que emitirlo.
 */
export const DISPARADORES = ["mensaje_recibido", "etiqueta_asignada", "etapa_cambiada"] as const;
export type DisparadorWorkflow = (typeof DISPARADORES)[number];

/**
 * Las acciones que el motor sabe ejecutar.
 *
 * **El registro real se arma en `src/inngest/bootstrap.ts`** con
 * `crearRegistro({...crearAccionesInternas(...), enviar_mensaje: ...})`. Esta
 * lista es la que ve la UI. Si se agrega un handler allá y no acá, la pantalla
 * no lo ofrece; si se agrega acá y no allá, el motor tira `accion_desconocida`
 * en la corrida. Las dos tienen que moverse juntas.
 */
export const ACCIONES = [
  "enviar_mensaje",
  "poner_etiqueta",
  "cambiar_etapa",
  "escalar_a_humano",
] as const;
export type AccionWorkflow = (typeof ACCIONES)[number];

/** Cómo se nombra cada cosa en pantalla. */
export const ETIQUETA_DISPARADOR: Record<DisparadorWorkflow, string> = {
  mensaje_recibido: "Llega un mensaje",
  etiqueta_asignada: "Se le pone una etiqueta",
  etapa_cambiada: "Cambia de etapa",
};

export const ETIQUETA_ACCION: Record<AccionWorkflow, string> = {
  enviar_mensaje: "Enviar un mensaje",
  poner_etiqueta: "Poner una etiqueta",
  cambiar_etapa: "Cambiar la etapa",
  escalar_a_humano: "Pasar a un vendedor",
};

export const ETIQUETA_NODO: Record<NodoTipo, string> = {
  // Legacy (5)
  disparador: "Disparador",
  accion: "Acción",
  condicion: "Condición",
  espera: "Espera",
  fin: "Fin",
  // Triggers (11)
  trigger_mensaje: "Mensaje recibido",
  trigger_webhook: "Webhook",
  trigger_cron: "Programado",
  trigger_manual: "Manual",
  trigger_etiqueta: "Etiqueta asignada",
  trigger_etiqueta_removida: "Etiqueta removida",
  trigger_etapa: "Etapa cambiada",
  trigger_lead_creado: "Lead creado",
  trigger_vendedor_asignado: "Vendedor asignado",
  trigger_inactividad: "Inactividad",
  trigger_formulario: "Formulario",
  // Mensajería (8)
  msg_texto: "Enviar mensaje",
  msg_botones: "Mensaje con botones",
  msg_lista: "Mensaje de lista",
  msg_imagen: "Enviar imagen",
  msg_documento: "Enviar documento",
  msg_ubicacion: "Enviar ubicación",
  msg_plantilla: "Plantilla HSM",
  msg_reaccion: "Reacción",
  // CRM (10)
  crm_etiqueta_add: "Asignar etiqueta",
  crm_etiqueta_remove: "Remover etiqueta",
  crm_etapa: "Cambiar etapa",
  crm_vendedor: "Asignar vendedor",
  crm_round_robin: "Round Robin",
  crm_campo: "Actualizar campo",
  crm_tarea: "Crear tarea",
  crm_nota: "Agregar nota",
  crm_spam: "Marcar spam",
  crm_archivar: "Archivar",
  // Lógica (11)
  logica_condicion: "Condición (IF)",
  logica_switch: "Switch",
  logica_validacion: "Validación",
  logica_esperar: "Esperar tiempo",
  logica_esperar_respuesta: "Esperar respuesta",
  logica_esperar_evento: "Esperar evento",
  logica_loop: "Loop",
  logica_grupo: "Agrupar",
  logica_goto: "Ir a nodo",
  logica_detener: "Detener",
  logica_error: "Error handler",
  // Integraciones (6)
  int_http: "HTTP Request",
  int_webhook_out: "Webhook saliente",
  int_codigo: "Código JS",
  int_email: "Enviar email",
  int_sheets: "Google Sheets",
  int_db: "Base de datos",
  // IA (7)
  ia_clasificar: "Clasificar intent",
  ia_responder: "Generar respuesta",
  ia_extraer: "Extraer datos",
  ia_sentimiento: "Sentimiento",
  ia_resumir: "Resumir",
  ia_traducir: "Traducir",
  ia_spam: "Verificar spam",
  // Internos (4)
  int_notif_vendedor: "Notificar vendedor",
  int_notif_grupo: "Notificar grupo",
  int_comentario: "Comentario interno",
  int_debug: "Log/Debug",
};

export const ETIQUETA_PUERTO: Record<string, string> = {
  salida: "sigue",
  verdadero: "si se cumple",
  falso: "si no se cumple",
};
