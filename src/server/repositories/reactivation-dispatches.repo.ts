import type { ReactivationDispatch, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type ReactivationDispatchInsert = Insert<
  ReactivationDispatch,
  "id" | "created_at" | "status"
> & {
  status?: ReactivationDispatch["status"];
};

export interface ReactivationDispatchesRepository {
  create(input: ReactivationDispatchInsert): Promise<ReactivationDispatch>;
  findById(id: UUID): Promise<ReactivationDispatch | null>;
  // Cooldown enforcement: último dispatch enviado por sesión.
  // Null = nunca dispatched → reactivación permitida.
  findLatestBySessionId(sessionId: UUID): Promise<ReactivationDispatch | null>;
  listBySessionId(sessionId: UUID, limit?: number): Promise<ReactivationDispatch[]>;
}

// Default cuando audit no se requiere (legacy callers sin tracking).
// Permite siempre dispatch (findLatestBySessionId siempre null).
export class NoopReactivationDispatchesRepository implements ReactivationDispatchesRepository {
  async create(input: ReactivationDispatchInsert): Promise<ReactivationDispatch> {
    return {
      ...input,
      status: input.status ?? "sent",
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
  }
  async findById(_id: UUID): Promise<ReactivationDispatch | null> {
    return null;
  }
  async findLatestBySessionId(_sessionId: UUID): Promise<ReactivationDispatch | null> {
    return null;
  }
  async listBySessionId(_sessionId: UUID, _limit?: number): Promise<ReactivationDispatch[]> {
    return [];
  }
}

export class InMemoryReactivationDispatchesRepository implements ReactivationDispatchesRepository {
  private readonly store = new Map<UUID, ReactivationDispatch>();

  async create(input: ReactivationDispatchInsert): Promise<ReactivationDispatch> {
    const row: ReactivationDispatch = {
      ...input,
      status: input.status ?? "sent",
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findById(id: UUID): Promise<ReactivationDispatch | null> {
    const r = this.store.get(id);
    return r ? { ...r } : null;
  }

  async findLatestBySessionId(sessionId: UUID): Promise<ReactivationDispatch | null> {
    const rows = Array.from(this.store.values()).filter((r) => r.lead_session_id === sessionId);
    if (rows.length === 0) return null;
    rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const latest = rows[0];
    if (!latest) return null;
    return { ...latest };
  }

  async listBySessionId(sessionId: UUID, limit = 50): Promise<ReactivationDispatch[]> {
    return Array.from(this.store.values())
      .filter((r) => r.lead_session_id === sessionId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}
