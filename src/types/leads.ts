import type { Canal, TagSource } from "./domain";
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
  canales: Canal[]; // canal_origen + canales con meta_user_ids presentes (dedup)
  vehiculo: string; // "marca modelo anio" trim; "" si todo vacío
  sesionActiva: boolean;
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
