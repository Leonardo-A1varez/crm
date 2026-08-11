import type { Canal, CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { BusquedaPage, SesionBuscada } from "@/types/inbox";
import type { VentanaActividad } from "@/types/leads";

export type { BusquedaPage };

/**
 * Lo que el buscador del Inbox recibe. Todo opcional menos el texto: los
 * filtros son un refinamiento de una búsqueda, no una consulta por sí solos.
 */
export interface BusquedaInput {
  /** Texto libre. Se busca en nombre, nombre de perfil, teléfono y mensajes. */
  q: string;
  canal?: Canal;
  /** Etapa de la sesión abierta. Un lead sin sesión abierta no tiene etapa. */
  etapa?: CurrentStage;
  etiquetaId?: UUID;
  actividad?: VentanaActividad;
  sesion?: SesionBuscada;
  /**
   * Reloj inyectado, igual que en `LeadsListInput`: leerlo adentro haría el
   * filtro de actividad intesteable.
   */
  ahora?: Date;
}

/**
 * Búsqueda de conversaciones del Inbox.
 *
 * **No filtra la lista de la pantalla: consulta todo el historial.** La lista
 * del Inbox muestra solo sesiones activas (`InboxService.listActiveLeads`), y
 * un filtro de "sesión" ahí no significaría nada. El mensaje que alguien busca
 * suele estar en una conversación que ya terminó, así que este servicio mira
 * también las cerradas.
 *
 * Dos límites del dominio que el resultado hereda y no son bugs:
 *
 * 1. **La purga.** El cron borra los mensajes de sesiones cerradas hace más de
 *    29 días. Lo que se purgó no aparece, y no hay forma de que aparezca.
 * 2. **RLS.** Se consulta con el client autenticado del request: un vendedor ve
 *    lo que sus policies le dejan ver, ni una fila más.
 *
 * Vive aparte de `InboxService` y no adentro porque no comparte nada con él:
 * `InboxService` es la conversación abierta —mensajes, Twin, envío, cierre— y
 * esto es una consulta de lectura sobre el histórico entero.
 */
export interface BusquedaService {
  buscar(input: BusquedaInput): Promise<BusquedaPage>;
}
