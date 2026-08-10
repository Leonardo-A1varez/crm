import { NotFoundError } from "@/lib/errors";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Lead, UUID } from "@/types/entities";
import type { DuplicadoPendiente, LeadDetail, LeadListItem, LeadsPage } from "@/types/leads";
import type { LeadsListInput, LeadsService } from "./leads.service";

// Cap defensivo (patrón fase 9): sin paginación v1, la búsqueda acota.
const LIST_LIMIT = 1000;
const Q_MAX = 100;

export interface DefaultLeadsServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  candidates: MergeCandidatesRepository;
  tags: TagsRepository;
}

function vehiculoDe(lead: Lead): string {
  return [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export class DefaultLeadsService implements LeadsService {
  constructor(private readonly deps: DefaultLeadsServiceDeps) {}

  async listLeads(input: LeadsListInput = {}): Promise<LeadsPage> {
    const q = input.q?.trim().slice(0, Q_MAX);
    // Un solo fetch de candidates pending: alimenta pendingPairs Y el filtro
    // soloDuplicados (nunca dos llamadas). Un solo listActive(): el badge
    // sesionActiva se cruza en memoria, nunca N+1 findActiveByLeadId por lead.
    const [rows, activas, pendientes] = await Promise.all([
      this.deps.leads.list({ q: q || undefined, limit: LIST_LIMIT }),
      this.deps.sessions.listActive(),
      this.deps.candidates.list({ status: "pending" }),
    ]);

    // Map y no Set: la lista muestra la etapa además del badge, y la sesión
    // abierta es la única que la define (una cerrada quedó congelada).
    const etapaActiva = new Map(activas.map((s) => [s.lead_id, s.current_stage]));
    const involucrados = new Set(pendientes.flatMap((c) => [c.src_lead_id, c.dst_lead_id]));

    let items: LeadListItem[] = rows.map((lead) => ({
      leadId: lead.id,
      nombre: lead.nombre,
      telefono: lead.telefono,
      canalOrigen: lead.canal_origen,
      vehiculo: vehiculoDe(lead),
      sesionActiva: etapaActiva.has(lead.id),
      currentStage: etapaActiva.get(lead.id) ?? null,
      createdAt: lead.created_at,
      updatedAt: lead.updated_at,
    }));

    if (input.soloDuplicados) {
      items = items.filter((i) => involucrados.has(i.leadId));
    }

    return { items, pendingPairs: pendientes.length };
  }

  async getLeadDetail(leadId: UUID): Promise<LeadDetail> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);

    const [tags, sesiones, pendientes] = await Promise.all([
      this.deps.tags.listByLead(leadId),
      this.deps.sessions.listByLeadId(leadId),
      this.deps.candidates.list({ status: "pending" }),
    ]);

    const propios = pendientes.filter((c) => c.src_lead_id === leadId || c.dst_lead_id === leadId);
    const duplicados: DuplicadoPendiente[] = [];
    for (const c of propios) {
      const otherId = c.src_lead_id === leadId ? c.dst_lead_id : c.src_lead_id;
      const otherLead = await this.deps.leads.findById(otherId);
      if (!otherLead) continue; // huérfano imposible por FK; defensa
      duplicados.push({
        candidateId: c.id,
        otherLead,
        reasons: c.reasons,
        score: c.similarity_score,
        createdAt: c.created_at,
      });
    }

    return {
      lead,
      tags: tags.map((t) => ({ id: t.id, nombre: t.nombre, color: t.color, source: t.source })),
      sesiones,
      sesionActiva: sesiones.find((s) => s.resultado === null) ?? null,
      duplicados,
    };
  }
}
