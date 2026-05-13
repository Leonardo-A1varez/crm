import type { AdminAction, UUID } from "@/types/entities";

export type AdminActionInsert = Omit<AdminAction, "id" | "created_at" | "payload"> & {
  payload?: Record<string, unknown>;
};

export interface AdminAuditListFilter {
  actorUserId?: UUID;
  entityType?: string;
  entityId?: UUID;
  limit?: number;
}

export interface AdminAuditRepository {
  create(input: AdminActionInsert): Promise<AdminAction>;
  list(filter?: AdminAuditListFilter): Promise<AdminAction[]>;
  findById(id: UUID): Promise<AdminAction | null>;
}

function cloneAction(a: AdminAction): AdminAction {
  return { ...a, payload: structuredClone(a.payload) };
}

export class NoopAdminAuditRepository implements AdminAuditRepository {
  async create(input: AdminActionInsert): Promise<AdminAction> {
    return {
      ...input,
      payload: structuredClone(input.payload ?? {}),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
  }
  async list(_filter?: AdminAuditListFilter): Promise<AdminAction[]> {
    return [];
  }
  async findById(_id: UUID): Promise<AdminAction | null> {
    return null;
  }
}

export class InMemoryAdminAuditRepository implements AdminAuditRepository {
  private readonly store = new Map<UUID, AdminAction>();

  async create(input: AdminActionInsert): Promise<AdminAction> {
    const row: AdminAction = {
      ...input,
      payload: structuredClone(input.payload ?? {}),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(row.id, row);
    return cloneAction(row);
  }

  async findById(id: UUID): Promise<AdminAction | null> {
    const a = this.store.get(id);
    return a ? cloneAction(a) : null;
  }

  async list(filter: AdminAuditListFilter = {}): Promise<AdminAction[]> {
    let rows = Array.from(this.store.values());
    if (filter.actorUserId !== undefined) {
      rows = rows.filter((r) => r.actor_user_id === filter.actorUserId);
    }
    if (filter.entityType !== undefined) {
      rows = rows.filter((r) => r.entity_type === filter.entityType);
    }
    if (filter.entityId !== undefined) {
      rows = rows.filter((r) => r.entity_id === filter.entityId);
    }
    rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const limit = filter.limit ?? rows.length;
    return rows.slice(0, limit).map(cloneAction);
  }
}
