import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ADMIN_ACTIONS } from "@/server/services/admin-audit.service";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadsRepository, LeadUpdate } from "@/server/repositories/leads.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Lead, MergeCandidate, UUID } from "@/types/entities";

export interface ApproveMergeInput {
  candidateId: UUID;
  keepLeadId: UUID;
  actorUserId: UUID | null;
}

export interface MergeExecutorService {
  /**
   * Ejecuta el merge (contrato addendum §2.A). Orden replay-safe: valida →
   * audit → convs → sesiones → tags → campos → delete perdedor. Cada paso es
   * no-op/tolerante en re-ejecución; el registro permanente es admin_actions
   * (los candidates se autodestruyen por FK CASCADE al borrar el perdedor).
   */
  approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }>;
  /** Rechaza el par — no se vuelve a proponer (detector respeta rejected, T6). */
  rejectMerge(input: { candidateId: UUID; actorUserId: UUID | null }): Promise<void>;
  /** Candidate manual (score 1, reasons ["manual"]) — mismo flujo de review. */
  createManualCandidate(input: { leadId: UUID; otherLeadId: UUID }): Promise<MergeCandidate>;
}

export interface DefaultMergeExecutorServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  tags: TagsRepository;
  candidates: MergeCandidatesRepository;
  audit: AdminAuditService;
}

/** Huecos del ganador que el perdedor puede rellenar. NUNCA sobrescribe valores. */
function buildFillPatch(ganador: Lead, perdedor: Lead): LeadUpdate {
  const patch: LeadUpdate = {};
  if (ganador.email === null && perdedor.email !== null) patch.email = perdedor.email;
  if (ganador.direccion === null && perdedor.direccion !== null) {
    patch.direccion = perdedor.direccion;
  }
  if (ganador.vehiculo_motor === null && perdedor.vehiculo_motor !== null) {
    patch.vehiculo_motor = perdedor.vehiculo_motor;
  }
  if (ganador.empresa_id === null && perdedor.empresa_id !== null) {
    patch.empresa_id = perdedor.empresa_id;
  }
  if (!ganador.vehiculo_marca?.trim() && perdedor.vehiculo_marca?.trim()) {
    patch.vehiculo_marca = perdedor.vehiculo_marca;
  }
  if (!ganador.vehiculo_modelo?.trim() && perdedor.vehiculo_modelo?.trim()) {
    patch.vehiculo_modelo = perdedor.vehiculo_modelo;
  }
  if (
    (ganador.vehiculo_anio === null || ganador.vehiculo_anio === 0) &&
    perdedor.vehiculo_anio !== null &&
    perdedor.vehiculo_anio !== 0
  ) {
    patch.vehiculo_anio = perdedor.vehiculo_anio;
  }
  if (ganador.nombre_perfil === null && perdedor.nombre_perfil !== null) {
    patch.nombre_perfil = perdedor.nombre_perfil;
  }
  // Unión de identidades Meta: el ganador prima por canal.
  patch.meta_user_ids = { ...perdedor.meta_user_ids, ...ganador.meta_user_ids };
  // Unión de campos libres: el ganador prima clave por clave. El perdedor se
  // borra con CASCADE, así que lo que no se copie acá se pierde.
  patch.datos_extra = { ...perdedor.datos_extra, ...ganador.datos_extra };
  return patch;
}

export class DefaultMergeExecutorService implements MergeExecutorService {
  constructor(private readonly deps: DefaultMergeExecutorServiceDeps) {}

  async approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }> {
    // 1. Validaciones (todas ANTES de cualquier escritura)
    const candidate = await this.deps.candidates.findById(input.candidateId);
    if (!candidate) {
      throw new NotFoundError(
        `merge_candidate no encontrado: ${input.candidateId}`,
        "merge_candidate",
        input.candidateId,
      );
    }
    if (candidate.status !== "pending") {
      throw new ConflictError(`merge_candidate ya resuelto: ${candidate.id}`, "already_resolved");
    }
    if (input.keepLeadId !== candidate.src_lead_id && input.keepLeadId !== candidate.dst_lead_id) {
      // keepLeadId no pertenece al par del candidate — solo alcanzable con request
      // crafteado; mensaje curado porque ValidationError sin cause hace passthrough a toast.
      throw new ValidationError("Datos inválidos. Refrescá la página.");
    }
    const perdedorId =
      input.keepLeadId === candidate.src_lead_id ? candidate.dst_lead_id : candidate.src_lead_id;

    const [ganador, perdedor] = await Promise.all([
      this.deps.leads.findById(input.keepLeadId),
      this.deps.leads.findById(perdedorId),
    ]);
    if (!ganador || !perdedor) {
      const missingId = !ganador ? input.keepLeadId : perdedorId;
      throw new NotFoundError("lead del par no encontrado", "lead", missingId);
    }

    const [activaGanador, activaPerdedor] = await Promise.all([
      this.deps.sessions.findActiveByLeadId(ganador.id),
      this.deps.sessions.findActiveByLeadId(perdedor.id),
    ]);
    if (activaGanador && activaPerdedor) {
      throw new ValidationError(
        "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar.",
      );
    }

    const tagsPerdedor = await this.deps.tags.listByLead(perdedor.id);

    // 2. Audit PRIMERO — registro permanente (candidates mueren por CASCADE en paso 7).
    await this.deps.audit.recordAction({
      actorUserId: input.actorUserId,
      action: ADMIN_ACTIONS.LEAD_MERGE,
      entityType: "lead",
      entityId: ganador.id,
      payload: {
        candidate_id: candidate.id,
        ganador_id: ganador.id,
        perdedor: { ...perdedor },
        perdedor_tags: tagsPerdedor.map((t) => ({ id: t.id, nombre: t.nombre, source: t.source })),
      },
    });

    // 3. Conversaciones → ganador (idempotente: re-run no encuentra nada del perdedor).
    const conversaciones = await this.deps.convs.findByLeadId(perdedor.id);
    for (const conv of conversaciones) {
      await this.deps.convs.update(conv.id, { lead_id: ganador.id });
    }

    // 4. Sesiones → ganador (0 movidas = no-op).
    await this.deps.sessions.reassignLead(perdedor.id, ganador.id);

    // 5. Tags → ganador (assignToLead idempotente; el perdedor se borra, sin remove).
    for (const t of tagsPerdedor) {
      await this.deps.tags.assignToLead(ganador.id, t.id, t.source, t.assigned_by ?? undefined);
    }

    // 6. Campos: rellenar huecos + unión meta_user_ids (re-run: huecos ya llenos = no-op).
    await this.deps.leads.update(ganador.id, buildFillPatch(ganador, perdedor));

    // 7. Delete perdedor (no-op si ya borrado; CASCADE limpia candidates del par).
    await this.deps.leads.delete(perdedor.id);

    return { ganadorId: ganador.id };
  }

  async rejectMerge(input: { candidateId: UUID; actorUserId: UUID | null }): Promise<void> {
    const candidate = await this.deps.candidates.findById(input.candidateId);
    if (!candidate) {
      throw new NotFoundError(
        `merge_candidate no encontrado: ${input.candidateId}`,
        "merge_candidate",
        input.candidateId,
      );
    }
    await this.deps.candidates.resolve(candidate.id, "rejected", input.actorUserId);
  }

  async createManualCandidate(input: { leadId: UUID; otherLeadId: UUID }): Promise<MergeCandidate> {
    const [a, b] = await Promise.all([
      this.deps.leads.findById(input.leadId),
      this.deps.leads.findById(input.otherLeadId),
    ]);
    if (!a || !b) {
      const missingId = !a ? input.leadId : input.otherLeadId;
      throw new NotFoundError("lead no encontrado para candidate manual", "lead", missingId);
    }
    return this.deps.candidates.create({
      src_lead_id: input.leadId,
      dst_lead_id: input.otherLeadId,
      similarity_score: 1,
      reasons: ["manual"],
    });
  }
}
