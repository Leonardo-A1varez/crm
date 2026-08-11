import type { Canal, CurrentStage, MotivoPerdida, Resultado } from "@/types/domain";
import type { LeadDetail, LeadsPage, VentanaActividad } from "@/types/leads";
import type { UUID } from "@/types/entities";

/**
 * Filtros de la pantalla `/leads`. Todos combinables y todos opcionales:
 * cada uno ausente significa "no filtres por esto", nunca un default.
 */
export interface LeadsListInput {
  /** Nombre, nombre de perfil, teléfono, vehículo y código cotizado. */
  q?: string;
  soloDuplicados?: boolean;
  canal?: Canal;
  /** Etapa de la sesión abierta. Una sesión cerrada no tiene etapa vigente. */
  etapa?: CurrentStage;
  etiquetaId?: UUID;
  conSesionActiva?: boolean;
  /** Resultado de la última sesión cerrada del lead. */
  resultado?: Resultado;
  motivoPerdida?: MotivoPerdida;
  actividad?: VentanaActividad;
  /** Conversaciones con entrantes posteriores a nuestra última respuesta. */
  sinResponder?: boolean;
  vehiculoMarca?: string;
  vehiculoModelo?: string;
  /** Reloj contra el que se mide `actividad`. Inyectable para tests. */
  ahora?: Date;
}

export interface LeadsService {
  /**
   * Página /leads: los leads que pasan los filtros (cap 1000; orden
   * `updated_at DESC` lo garantiza el repo) + count de pares duplicados
   * pendientes + las opciones que pueblan los filtros (vehículos del resultado
   * y catálogo de etiquetas).
   *
   * Ningún filtro dispara una consulta por fila: lo que no puede resolver la
   * consulta de `leads` se cruza en memoria contra lecturas agrupadas
   * (sesiones activas, cierres, etiquetas, hilos).
   */
  listLeads(input?: LeadsListInput): Promise<LeadsPage>;

  /** Detalle /leads/[id]: ficha + tags + sesiones (DESC) + duplicados pendientes. NotFoundError si no existe. */
  getLeadDetail(leadId: UUID): Promise<LeadDetail>;
}
