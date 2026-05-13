import type { EventOutboxRow, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type EventOutboxInsert = Insert<
  EventOutboxRow,
  "id" | "created_at" | "status" | "attempts" | "last_error" | "scheduled_at" | "sent_at"
> & {
  status?: EventOutboxRow["status"];
  attempts?: number;
  last_error?: string | null;
  scheduled_at?: Date;
};

export interface EventOutboxRepository {
  enqueue(input: EventOutboxInsert): Promise<EventOutboxRow>;
  findById(id: UUID): Promise<EventOutboxRow | null>;
  // Pending rows ordenados ASC por scheduled_at (FIFO). Limit default 50.
  listPending(limit?: number): Promise<EventOutboxRow[]>;
  // Idempotente: si row no existe o ya está sent → no-op (no throw).
  markSent(id: UUID, sentAt?: Date): Promise<void>;
  // Increment attempts + persist error message. Mantiene status='pending'
  // para retry siguiente cron tick. Si quiere markear permanent fail, caller
  // debe llamar markPermanentlyFailed (futuro).
  markFailedAttempt(id: UUID, error: string): Promise<void>;
}

export class NoopEventOutboxRepository implements EventOutboxRepository {
  async enqueue(input: EventOutboxInsert): Promise<EventOutboxRow> {
    const now = new Date();
    return {
      id: crypto.randomUUID(),
      event_name: input.event_name,
      event_data: { ...input.event_data },
      event_id: input.event_id,
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      last_error: input.last_error ?? null,
      scheduled_at: input.scheduled_at ?? now,
      sent_at: null,
      created_at: now,
    };
  }
  async findById(_id: UUID): Promise<EventOutboxRow | null> {
    return null;
  }
  async listPending(_limit?: number): Promise<EventOutboxRow[]> {
    return [];
  }
  async markSent(_id: UUID, _sentAt?: Date): Promise<void> {
    // no-op
  }
  async markFailedAttempt(_id: UUID, _error: string): Promise<void> {
    // no-op
  }
}

export class InMemoryEventOutboxRepository implements EventOutboxRepository {
  private readonly store = new Map<UUID, EventOutboxRow>();

  async enqueue(input: EventOutboxInsert): Promise<EventOutboxRow> {
    const now = new Date();
    const row: EventOutboxRow = {
      id: crypto.randomUUID(),
      event_name: input.event_name,
      event_data: structuredClone(input.event_data),
      event_id: input.event_id,
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      last_error: input.last_error ?? null,
      scheduled_at: input.scheduled_at ?? now,
      sent_at: null,
      created_at: now,
    };
    this.store.set(row.id, row);
    return clone(row);
  }

  async findById(id: UUID): Promise<EventOutboxRow | null> {
    const r = this.store.get(id);
    return r ? clone(r) : null;
  }

  async listPending(limit = 50): Promise<EventOutboxRow[]> {
    const now = Date.now();
    return Array.from(this.store.values())
      .filter((r) => r.status === "pending" && r.scheduled_at.getTime() <= now)
      .sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async markSent(id: UUID, sentAt?: Date): Promise<void> {
    const r = this.store.get(id);
    if (!r) return;
    if (r.status === "sent") return;
    r.status = "sent";
    r.sent_at = sentAt ?? new Date();
    r.last_error = null;
  }

  async markFailedAttempt(id: UUID, error: string): Promise<void> {
    const r = this.store.get(id);
    if (!r) return;
    r.attempts = r.attempts + 1;
    r.last_error = error;
  }
}

function clone(row: EventOutboxRow): EventOutboxRow {
  return {
    ...row,
    event_data: structuredClone(row.event_data),
  };
}
