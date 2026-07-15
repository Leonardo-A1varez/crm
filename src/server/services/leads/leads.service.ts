import type { LeadDetail, LeadsPage } from "@/types/leads";
import type { UUID } from "@/types/entities";

export interface LeadsListInput {
  q?: string;
  soloDuplicados?: boolean;
}

export interface LeadsService {
  /**
   * Página /leads: TODOS los leads (cap 1000; orden updated_at DESC lo garantiza
   * el repo) + count de pares duplicados pendientes. `q` literal (trim, cap 100).
   * `soloDuplicados` filtra a leads involucrados en candidates pending.
   */
  listLeads(input?: LeadsListInput): Promise<LeadsPage>;

  /** Detalle /leads/[id]: ficha + tags + sesiones (DESC) + duplicados pendientes. NotFoundError si no existe. */
  getLeadDetail(leadId: UUID): Promise<LeadDetail>;
}
