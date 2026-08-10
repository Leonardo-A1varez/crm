import type { Canal, CurrentStage, TagSource } from "./domain";
import type { Lead, LeadSession, UUID } from "./entities";

/**
 * Formas derivadas para las vistas `/leads` y `/leads/[id]` (fase 10). Viven en
 * types/ porque UI (components/) y service (server-services/) las comparten —
 * boundaries no permite components→server-services.
 */
export interface LeadListItem {
  leadId: UUID;
  nombre: string;
  telefono: string;
  canalOrigen: Canal;
  vehiculo: string; // "marca modelo anio" trim; "" si todo vacío
  sesionActiva: boolean;
  /**
   * Etapa de la sesión abierta. `null` sin sesión activa: la etapa de una
   * sesión cerrada quedó congelada donde terminó y mostrarla como vigente
   * miente sobre el estado del lead.
   */
  currentStage: CurrentStage | null;
  /** Alta del lead. Es lo que cuenta el "nuevos esta semana" del encabezado. */
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadsPage {
  items: LeadListItem[];
  pendingPairs: number; // candidates pending totales (banner admin)
}

export interface LeadTagView {
  id: UUID;
  nombre: string;
  color: string;
  source: TagSource;
}

export interface DuplicadoPendiente {
  candidateId: UUID;
  otherLead: Lead;
  reasons: string[];
  score: number;
  createdAt: Date;
}

export interface LeadDetail {
  lead: Lead;
  tags: LeadTagView[];
  sesiones: LeadSession[]; // started_at DESC (orden del repo)
  sesionActiva: LeadSession | null;
  duplicados: DuplicadoPendiente[]; // pending que involucran al lead
}
