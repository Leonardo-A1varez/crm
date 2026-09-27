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

import type { NodoTipo, NodoTipoTrigger } from "@/types/workflows";

/**
 * Los eventos de dominio que arrancan una corrida.
 *
 * Los consume `workflow-disparar`, que busca las versiones publicadas cuyo
 * nodo disparador matchea. Agregar uno acá no lo hace existir: hay que
 * emitirlo, y recién entonces mapearlo en `DISPARADOR_DE_TIPO`. Quién emite
 * cada uno lo dice el doc de `workflowDisparoRecibido` (`inngest/events.ts`).
 */
export const DISPARADORES = [
  "mensaje_recibido",
  "etiqueta_asignada",
  "etapa_cambiada",
  "etiqueta_removida",
  "lead_creado",
  "programado",
  "inactividad",
  "manual",
  "vendedor_asignado",
  "difusion_respondida",
] as const;
export type DisparadorWorkflow = (typeof DISPARADORES)[number];

/**
 * Los disparos que nombran su flujo (`workflowId`). Quien los emite ya eligió
 * cuál corre —el cron que calculó el horario de ESE flujo, el escaneo que midió
 * SU tiempo de inactividad, la persona que apretó SU botón—, así que escuchar el
 * evento no alcanza: sin `workflowId`, `workflow-disparar` no arranca nada. Un
 * "manual" sin destino arrancaría todos los flujos manuales del lead.
 */
export const DISPARADORES_DIRIGIDOS: readonly DisparadorWorkflow[] = [
  "programado",
  "inactividad",
  "manual",
];

/**
 * Qué evento de dominio escucha cada trigger del canvas.
 *
 * Los que no están no tienen emisor: un flujo publicado con uno de ellos no
 * arranca nunca. Se dejan afuera a propósito en vez de mapearlos a lo más
 * parecido — un trigger que arranca con el evento equivocado le escribe a leads
 * que nadie eligió. Mapear uno es afirmar que su emisor existe.
 */
export const DISPARADOR_DE_TIPO: Partial<Record<NodoTipoTrigger, DisparadorWorkflow>> = {
  trigger_mensaje: "mensaje_recibido",
  trigger_etiqueta: "etiqueta_asignada",
  trigger_etapa: "etapa_cambiada",
  // `on-message-received`, con el primer mensaje del lead.
  trigger_lead_creado: "lead_creado",
  // `quitar-etiqueta.action.ts` (inbox): una persona saca la etiqueta a mano.
  trigger_etiqueta_removida: "etiqueta_removida",
  // `workflow-programados` (cron cada 5 minutos).
  trigger_cron: "programado",
  // `workflow-inactividad` (escaneo cada 10 minutos).
  trigger_inactividad: "inactividad",
  // `dispararWorkflowManualAction` (`app/(panel)/workflows/_actions/`).
  trigger_manual: "manual",
  // Las acciones "Asignar vendedor" y "Round Robin" de un flujo
  // (`acciones/asignacion.ts`), cuando la sesión cambia de vendedor.
  trigger_vendedor_asignado: "vendedor_asignado",
  // `on-message-received`, cuando el entrante es la primera respuesta del lead
  // a una difusión (`services/difusion/respuesta.service.ts`).
  trigger_difusion_respondida: "difusion_respondida",
};

/**
 * Los eventos que "Esperar evento" puede esperar de verdad: los que alguien
 * emite. El panel ofrece también `comprobante_subido`, que no tiene emisor:
 * esperarlo vencería siempre por tiempo, y el validador lo rechaza.
 */
export const EVENTOS_ESPERABLES = [
  "etiqueta_asignada",
  "etapa_cambiada",
  "vendedor_asignado",
] as const satisfies readonly DisparadorWorkflow[];
export type EventoEsperable = (typeof EVENTOS_ESPERABLES)[number];

/**
 * Las acciones que el motor sabe ejecutar.
 *
 * **El registro es uno solo: `crearRegistroDeAcciones` en
 * `server/services/workflows/acciones/registro.ts`.** Lo usan producción
 * (`inngest/bootstrap.ts`) y "Probar" (con los efectos interceptados). Esta
 * lista es la que ve la UI; `tests/unit/workflows/registro-unico.test.ts`
 * falla si deja de coincidir con los handlers del registro.
 */
export const ACCIONES = [
  "enviar_mensaje",
  "poner_etiqueta",
  "cambiar_etapa",
  "escalar_a_humano",
  "asignar_vendedor",
  "repartir_round_robin",
  "enviar_plantilla",
  // Mensajes de servicio de WhatsApp (tanda 4a): sólo con la ventana de 24 h
  // abierta. Botones y lista esperan la respuesta y salen por la opción.
  "enviar_botones",
  "enviar_lista",
  "enviar_imagen",
  "enviar_ubicacion",
  // "Actualizar campo del Twin" (tanda 4b): escribe un campo editable de la
  // sesión con su procedencia, como «Cambiar etapa».
  "actualizar_campo_twin",
  // "Avisar al equipo": un aviso en el panel para el vendedor asignado o, sin
  // uno, para los admins. No sale por Meta.
  "avisar_equipo",
  // "Delegar al agente" (PRD §4.5): no contesta nada; le cede la conversación
  // al agente del pipeline y observa sus turnos hasta una de cinco salidas.
  "delegar_al_agente",
] as const;
export type AccionWorkflow = (typeof ACCIONES)[number];

/**
 * Qué acción ejecuta cada tipo de nodo del canvas.
 *
 * El nodo legacy `accion` la declara en `config.accion`; los del canvas la
 * llevan en el tipo. Los tipos que no están acá no tienen handler: el registro
 * los rechaza con un error que nombra el tipo, en producción y en "Probar" por
 * igual. Mapear uno sin handler real sería volver al simulador que "ejecutaba"
 * nodos que producción no conocía.
 */
export const ACCION_DE_TIPO: Partial<Record<NodoTipo, AccionWorkflow>> = {
  msg_texto: "enviar_mensaje",
  crm_etiqueta_add: "poner_etiqueta",
  crm_etapa: "cambiar_etapa",
  // El nodo legacy `accion` con `escalar_a_humano` sigue funcionando: los dos
  // caen en la misma acción y leen la config con el mismo schema.
  crm_escalar_humano: "escalar_a_humano",
  crm_vendedor: "asignar_vendedor",
  crm_round_robin: "repartir_round_robin",
  msg_plantilla: "enviar_plantilla",
  msg_botones: "enviar_botones",
  msg_lista: "enviar_lista",
  msg_imagen: "enviar_imagen",
  msg_ubicacion: "enviar_ubicacion",
  crm_campo: "actualizar_campo_twin",
  int_notif_vendedor: "avisar_equipo",
  ia_delegar: "delegar_al_agente",
};

/** Cómo se nombra cada cosa en pantalla. */
export const ETIQUETA_DISPARADOR: Record<DisparadorWorkflow, string> = {
  mensaje_recibido: "Llega un mensaje",
  etiqueta_asignada: "Se le pone una etiqueta",
  etapa_cambiada: "Cambia de etapa",
  etiqueta_removida: "Se le quita una etiqueta",
  lead_creado: "Aparece un lead nuevo",
  programado: "Llega la hora programada",
  inactividad: "Pasa un tiempo sin respuesta",
  manual: "Alguien lo dispara a mano",
  vendedor_asignado: "Se le asigna un vendedor",
  difusion_respondida: "Responde una difusión",
};

export const ETIQUETA_ACCION: Record<AccionWorkflow, string> = {
  enviar_mensaje: "Enviar un mensaje",
  poner_etiqueta: "Poner una etiqueta",
  cambiar_etapa: "Cambiar la etapa",
  escalar_a_humano: "Pasar a un vendedor",
  asignar_vendedor: "Asignar un vendedor",
  repartir_round_robin: "Repartir entre vendedores",
  enviar_plantilla: "Enviar una plantilla de WhatsApp",
  enviar_botones: "Enviar un mensaje con botones",
  enviar_lista: "Enviar un mensaje de lista",
  enviar_imagen: "Enviar una imagen",
  enviar_ubicacion: "Enviar una ubicación",
  actualizar_campo_twin: "Actualizar un campo del Twin",
  avisar_equipo: "Avisar al equipo",
  delegar_al_agente: "Delegar al agente",
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
  trigger_difusion_respondida: "Difusión respondida",
  // Mensajería (8)
  msg_texto: "Enviar mensaje",
  msg_botones: "Mensaje con botones",
  msg_lista: "Mensaje de lista",
  msg_imagen: "Enviar imagen",
  msg_documento: "Enviar documento",
  msg_ubicacion: "Enviar ubicación",
  msg_plantilla: "Plantilla HSM",
  msg_reaccion: "Reacción",
  // CRM (11)
  crm_etiqueta_add: "Asignar etiqueta",
  crm_etiqueta_remove: "Remover etiqueta",
  crm_etapa: "Cambiar etapa",
  crm_vendedor: "Asignar vendedor",
  crm_round_robin: "Round Robin",
  crm_campo: "Actualizar campo del Twin",
  crm_tarea: "Crear tarea",
  crm_nota: "Agregar nota",
  crm_spam: "Marcar spam",
  crm_archivar: "Archivar",
  crm_escalar_humano: "Escalar a humano",
  // Lógica (11)
  logica_condicion: "Condición (IF)",
  logica_switch: "Según el valor",
  logica_validacion: "Validación",
  logica_esperar: "Esperar tiempo",
  logica_esperar_respuesta: "Esperar respuesta",
  logica_esperar_evento: "Esperar evento",
  logica_loop: "Loop",
  logica_grupo: "Agrupar",
  logica_goto: "Ir a",
  logica_detener: "Detener",
  logica_error: "Error handler",
  // Integraciones (6)
  int_http: "HTTP Request",
  int_webhook_out: "Webhook saliente",
  int_codigo: "Código JS",
  int_email: "Enviar email",
  int_sheets: "Google Sheets",
  int_db: "Base de datos",
  // IA (8)
  ia_clasificar: "Clasificar intent",
  ia_responder: "Generar respuesta",
  ia_extraer: "Extraer datos",
  ia_sentimiento: "Sentimiento",
  ia_resumir: "Resumir",
  ia_traducir: "Traducir",
  ia_spam: "Verificar spam",
  ia_delegar: "Delegar al agente",
  // Internos (4)
  int_notif_vendedor: "Avisar al equipo",
  int_notif_grupo: "Notificar grupo",
  int_comentario: "Comentario interno",
  int_debug: "Log/Debug",
  // Difusión (5)
  dif_audiencia: "Definir audiencia",
  dif_enviar: "Enviar difusión",
  dif_excluir: "Excluir",
  dif_esperar_respuesta: "Esperar respuesta de difusión",
  dif_dividir: "Dividir audiencia",
};

export const ETIQUETA_PUERTO: Record<string, string> = {
  salida: "sigue",
  verdadero: "si se cumple",
  falso: "si no se cumple",
  sin_respuesta: "si no responde a tiempo",
};
