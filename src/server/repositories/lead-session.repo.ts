import { ConflictError, IllegalStateError, NotFoundError } from "@/lib/errors";
import type { MotivoPerdida, Resultado } from "@/types/domain";
import type { LeadSession, UUID } from "@/types/entities";
import type { Update } from "./_types";

// `extras` opcional en insert (default `{}`). `context_summary` opcional (default null).
// DB tiene DEFAULTs equivalentes, mirrored aquí.
export type LeadSessionInsert = Omit<
  LeadSession,
  "id" | "started_at" | "closed_at" | "extras" | "context_summary"
> & {
  extras?: Record<string, unknown>;
  context_summary?: string | null;
};
export type LeadSessionUpdate = Update<
  LeadSession,
  "id" | "lead_id" | "started_at" | "closed_at" | "resultado" | "motivo_perdida"
>;

export interface CloseInput {
  resultado: Resultado;
  motivo_perdida?: MotivoPerdida | null;
}

export interface LeadSessionRepository {
  create(input: LeadSessionInsert): Promise<LeadSession>;
  findById(id: UUID): Promise<LeadSession | null>;
  // Sesión activa = resultado IS NULL. Máx 1 por lead (partial unique).
  findActiveByLeadId(leadId: UUID): Promise<LeadSession | null>;
  // Todas sesiones activas (resultado IS NULL). Inbox listing.
  listActive(): Promise<LeadSession[]>;
  update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession>;
  close(id: UUID, input: CloseInput): Promise<LeadSession>;
  listClosedBefore(date: Date): Promise<LeadSession[]>;
}

// Deep clone defensivo para extras (jsonb arbitrario LLM-extracted).
function cloneSession(s: LeadSession): LeadSession {
  return { ...s, extras: structuredClone(s.extras) };
}

export class InMemoryLeadSessionRepository implements LeadSessionRepository {
  private readonly store = new Map<UUID, LeadSession>();

  async create(input: LeadSessionInsert): Promise<LeadSession> {
    for (const s of this.store.values()) {
      if (s.lead_id === input.lead_id && s.resultado === null) {
        throw new ConflictError(
          `ya existe sesión activa para lead ${input.lead_id}`,
          "active_session_exists",
        );
      }
    }
    const session: LeadSession = {
      ...input,
      extras: structuredClone(input.extras ?? {}),
      context_summary: input.context_summary ?? null,
      id: crypto.randomUUID(),
      started_at: new Date(),
      closed_at: null,
    };
    this.store.set(session.id, session);
    return cloneSession(session);
  }

  async findById(id: UUID): Promise<LeadSession | null> {
    const s = this.store.get(id);
    return s ? cloneSession(s) : null;
  }

  async findActiveByLeadId(leadId: UUID): Promise<LeadSession | null> {
    for (const s of this.store.values()) {
      if (s.lead_id === leadId && s.resultado === null) return cloneSession(s);
    }
    return null;
  }

  async listActive(): Promise<LeadSession[]> {
    const out: LeadSession[] = [];
    for (const s of this.store.values()) {
      if (s.resultado === null) out.push(cloneSession(s));
    }
    return out;
  }

  async update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    const next: LeadSession = {
      ...current,
      ...patch,
      extras: patch.extras !== undefined ? structuredClone(patch.extras) : current.extras,
      id: current.id,
      lead_id: current.lead_id,
      started_at: current.started_at,
      closed_at: current.closed_at,
      resultado: current.resultado,
      motivo_perdida: current.motivo_perdida,
    };
    this.store.set(id, next);
    return cloneSession(next);
  }

  async close(id: UUID, input: CloseInput): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    if (current.resultado !== null) {
      // Idempotencia: mismo resultado + motivo → return existing (replay-safe).
      // Permite Inngest retry sin NonRetriable: close repetido es no-op.
      const requestedMotivo = input.motivo_perdida ?? null;
      if (current.resultado === input.resultado && current.motivo_perdida === requestedMotivo) {
        return cloneSession(current);
      }
      // Resultado/motivo distinto = bug del caller, no retry → fail loud NonRetriable.
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${input.resultado}/${requestedMotivo ?? "null"})`,
        "session_already_closed_different",
      );
    }
    const closed: LeadSession = {
      ...current,
      resultado: input.resultado,
      motivo_perdida: input.motivo_perdida ?? null,
      closed_at: new Date(),
    };
    this.store.set(id, closed);
    return cloneSession(closed);
  }

  async listClosedBefore(date: Date): Promise<LeadSession[]> {
    const out: LeadSession[] = [];
    for (const s of this.store.values()) {
      if (s.closed_at && s.closed_at < date) out.push(cloneSession(s));
    }
    return out;
  }
}
