/**
 * Barrel export de todos los componentes de nodos del workflow builder.
 * Incluye el mapeo nodeTypes para React Flow con los 57 tipos de nodos.
 */

import { NodoTrigger } from "./NodoTrigger";
import { NodoMensajeria } from "./NodoMensajeria";
import { NodoCRM } from "./NodoCRM";
import { NodoLogica } from "./NodoLogica";
import { NodoIntegracion } from "./NodoIntegracion";
import { NodoIA } from "./NodoIA";
import { NodoInterno } from "./NodoInterno";

// Re-export componentes legacy para compatibilidad
export { NodoDisparador } from "./NodoDisparador";
export { NodoAccion } from "./NodoAccion";
export { NodoCondicion } from "./NodoCondicion";
export { NodoEspera } from "./NodoEspera";
export { NodoFin } from "./NodoFin";

// Re-export nuevos componentes
// `ESTILOS_CATEGORIA` ya no existe: los colores por categoría salen de
// `src/lib/ui/workflow-nodos.ts`, que los deriva de los tokens reales del
// sistema en vez de hardcodear hex de la paleta de Tailwind.
export { NodoBase, Dato, type NodoBaseProps, type SalidaNodo, type IconoNodo } from "./NodoBase";
export { NodoTrigger } from "./NodoTrigger";
export { NodoMensajeria } from "./NodoMensajeria";
export { NodoCRM } from "./NodoCRM";
export { NodoLogica } from "./NodoLogica";
export { NodoIntegracion } from "./NodoIntegracion";
export { NodoIA } from "./NodoIA";
export { NodoInterno } from "./NodoInterno";

/**
 * Mapeo de los 57 tipos de nodos a sus componentes para React Flow.
 * Incluye también los 5 tipos legacy para compatibilidad hacia atrás.
 */
export const nodeTypes = {
  // ===== LEGACY (5 tipos) =====
  disparador: NodoTrigger, // Redirige a NodoTrigger como fallback
  accion: NodoMensajeria, // Redirige a NodoMensajeria como fallback
  condicion: NodoLogica, // Redirige a NodoLogica como fallback
  espera: NodoLogica, // Redirige a NodoLogica como fallback
  fin: NodoLogica, // Redirige a NodoLogica como fallback

  // ===== TRIGGERS (11 tipos) =====
  trigger_mensaje: NodoTrigger,
  trigger_webhook: NodoTrigger,
  trigger_cron: NodoTrigger,
  trigger_manual: NodoTrigger,
  trigger_etiqueta: NodoTrigger,
  trigger_etiqueta_removida: NodoTrigger,
  trigger_etapa: NodoTrigger,
  trigger_lead_creado: NodoTrigger,
  trigger_vendedor_asignado: NodoTrigger,
  trigger_inactividad: NodoTrigger,
  trigger_formulario: NodoTrigger,

  // ===== MENSAJERIA (8 tipos) =====
  msg_texto: NodoMensajeria,
  msg_botones: NodoMensajeria,
  msg_lista: NodoMensajeria,
  msg_imagen: NodoMensajeria,
  msg_documento: NodoMensajeria,
  msg_ubicacion: NodoMensajeria,
  msg_plantilla: NodoMensajeria,
  msg_reaccion: NodoMensajeria,

  // ===== CRM (10 tipos) =====
  crm_etiqueta_add: NodoCRM,
  crm_etiqueta_remove: NodoCRM,
  crm_etapa: NodoCRM,
  crm_vendedor: NodoCRM,
  crm_round_robin: NodoCRM,
  crm_campo: NodoCRM,
  crm_tarea: NodoCRM,
  crm_nota: NodoCRM,
  crm_spam: NodoCRM,
  crm_archivar: NodoCRM,

  // ===== LOGICA (11 tipos) =====
  logica_condicion: NodoLogica,
  logica_switch: NodoLogica,
  logica_validacion: NodoLogica,
  logica_esperar: NodoLogica,
  logica_esperar_respuesta: NodoLogica,
  logica_esperar_evento: NodoLogica,
  logica_loop: NodoLogica,
  logica_grupo: NodoLogica,
  logica_goto: NodoLogica,
  logica_detener: NodoLogica,
  logica_error: NodoLogica,

  // ===== INTEGRACIONES (6 tipos) =====
  int_http: NodoIntegracion,
  int_webhook_out: NodoIntegracion,
  int_codigo: NodoIntegracion,
  int_email: NodoIntegracion,
  int_sheets: NodoIntegracion,
  int_db: NodoIntegracion,

  // ===== IA (7 tipos) =====
  ia_clasificar: NodoIA,
  ia_responder: NodoIA,
  ia_extraer: NodoIA,
  ia_sentimiento: NodoIA,
  ia_resumir: NodoIA,
  ia_traducir: NodoIA,
  ia_spam: NodoIA,

  // ===== INTERNOS (4 tipos) =====
  int_notif_vendedor: NodoInterno,
  int_notif_grupo: NodoInterno,
  int_comentario: NodoInterno,
  int_debug: NodoInterno,
} as const;

/** Tipo del mapeo de nodos para React Flow */
export type NodeTypes = typeof nodeTypes;
