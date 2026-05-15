import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import { isUuid } from "@/server/db/uuid";
import type { EventOutboxRow, OutboxEventStatus, UUID } from "@/types/entities";
import type { EventOutboxInsert, EventOutboxRepository } from "./event-outbox.repo";

const DEFAULT_LIMIT = 50;

/**
 * Supabase impl EventOutboxRepository. Slice 1 sub-paso 7.4 repo 14 (último).
 *
 * Transactional outbox B2: cron `dispatch-outbox-events` poll pending → emit
 * Inngest → markSent. at-least-once delivery.
 *
 * Sin FKs externas — outbox es root. CHECK status IN (pending, sent, failed).
 *
 * markSent/markFailedAttempt: SELECT-then-UPDATE pattern. Race no-protected
 * (entre SELECT y UPDATE otro worker podría modificar). Acceptable Slice 1;
 * para volumen alto futuro migrar a SQL `UPDATE ... SET attempts=attempts+1`
 * via RPC para increment atómico.
 */
export class SupabaseEventOutboxRepository implements EventOutboxRepository {
  constructor(private readonly db: AppClient) {}

  async enqueue(input: EventOutboxInsert): Promise<EventOutboxRow> {
    const payload: {
      event_name: string;
      event_data: never;
      event_id: string | null;
      status: OutboxEventStatus;
      attempts: number;
      last_error: string | null;
      scheduled_at?: string;
    } = {
      event_name: input.event_name,
      event_data: input.event_data as never,
      event_id: input.event_id,
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      last_error: input.last_error ?? null,
    };
    if (input.scheduled_at !== undefined) {
      payload.scheduled_at = input.scheduled_at.toISOString();
    }

    const { data, error } = await this.db.from("event_outbox").insert(payload).select().single();

    if (error) throw mapPostgrestError(error, { resource: "event_outbox" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<EventOutboxRow | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("event_outbox").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "event_outbox" });
    return data ? mapRow(data) : null;
  }

  async listPending(limit = DEFAULT_LIMIT): Promise<EventOutboxRow[]> {
    // Filtra scheduled_at <= server now (no JS clock para evitar skew).
    const cutoff = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("event_outbox")
      .select()
      .eq("status", "pending")
      .lte("scheduled_at", cutoff)
      .order("scheduled_at", { ascending: true })
      .limit(limit);
    if (error) throw mapPostgrestError(error, { resource: "event_outbox" });
    return (data ?? []).map(mapRow);
  }

  async markSent(id: UUID, sentAt?: Date): Promise<void> {
    if (!isUuid(id)) return;
    // Guard contra re-mark. Lee status actual; si sent o missing → no-op.
    const current = await this.findById(id);
    if (!current) return;
    if (current.status === "sent") return;

    const ts = sentAt ? sentAt.toISOString() : await serverNowIso(this.db);
    const { error } = await this.db
      .from("event_outbox")
      .update({
        status: "sent",
        sent_at: ts,
        last_error: null,
      })
      .eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "event_outbox" });
  }

  async markFailedAttempt(id: UUID, errMsg: string): Promise<void> {
    if (!isUuid(id)) return;
    const current = await this.findById(id);
    if (!current) return;

    const { error } = await this.db
      .from("event_outbox")
      .update({
        attempts: current.attempts + 1,
        last_error: errMsg,
      })
      .eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "event_outbox" });
  }
}

interface EventOutboxRowDb {
  id: string;
  event_name: string;
  event_data: unknown;
  event_id: string | null;
  // DB col es text + CHECK status IN (pending,sent,failed). types.gen no enuma.
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
}

function mapRow(row: EventOutboxRowDb): EventOutboxRow {
  const eventData = (row.event_data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    event_name: row.event_name,
    event_data: structuredClone(eventData),
    event_id: row.event_id,
    // CHECK constraint en DB garantiza valor válido; narrow trust en contract.
    status: row.status as OutboxEventStatus,
    attempts: row.attempts,
    last_error: row.last_error,
    scheduled_at: new Date(row.scheduled_at),
    sent_at: row.sent_at ? new Date(row.sent_at) : null,
    created_at: new Date(row.created_at),
  };
}
