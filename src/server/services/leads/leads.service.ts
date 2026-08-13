import type { Canal, CurrentStage, MotivoPerdida, Resultado } from "@/types/domain";
import type { LeadDetail, LeadsPage, VentanaActividad } from "@/types/leads";
import type { Lead, UUID } from "@/types/entities";
import type { UpdateLeadProfileInput } from "@/lib/validation/leads.schema";

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
  /**
   * Sin consumidor desde que la barra de filtros dejó de ofrecerlo: la UI ya no
   * pregunta por sesión abierta. Se mantiene porque está testeado y porque el
   * criterio "abierta o cerrada" no dejó de ser cierto, no porque alguien lo
   * use — el único caller vivo es `parseFiltrosLeads`, que ya no lo produce.
   */
  conSesionActiva?: boolean;
  /** Resultado de la última sesión cerrada del lead. */
  resultado?: Resultado;
  motivoPerdida?: MotivoPerdida;
  /** Sin consumidor: misma historia que `conSesionActiva`. */
  actividad?: VentanaActividad;
  /** Conversaciones con entrantes posteriores a nuestra última respuesta. */
  sinResponder?: boolean;
  vehiculoMarca?: string;
  vehiculoModelo?: string;
  /** Año exacto. `0` en la fila significa "sin año", no "año cero". */
  vehiculoAnio?: number;
  /** Reloj contra el que se mide `actividad`. Inyectable para tests. */
  ahora?: Date;
}

export interface LeadsService {
  /**
   * Página /leads: los leads que pasan los filtros (cap 1000; orden
   * `updated_at DESC` lo garantiza el repo) + count de pares duplicados
   * pendientes + las opciones que pueblan los filtros (vehículos y motivos de
   * pérdida presentes en el resultado, y catálogo de etiquetas).
   *
   * Ningún filtro dispara una consulta por fila: lo que no puede resolver la
   * consulta de `leads` se cruza en memoria contra lecturas agrupadas
   * (sesiones activas, cierres, etiquetas, hilos).
   */
  listLeads(input?: LeadsListInput): Promise<LeadsPage>;

  /** Detalle /leads/[id]: ficha + tags + sesiones (DESC) + duplicados pendientes. NotFoundError si no existe. */
  getLeadDetail(leadId: UUID): Promise<LeadDetail>;

  /** Actualiza solo campos editables; identidad de canal y teléfono quedan fuera. */
  updateLeadProfile(
    input: UpdateLeadProfileInput & { actorUserId: UUID },
  ): Promise<{ lead: Lead; changedFields: string[] }>;
}
