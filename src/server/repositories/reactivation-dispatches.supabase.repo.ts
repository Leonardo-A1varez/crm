import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { MotivoPerdida } from "@/types/domain";
import type { ReactivationDispatch, ReactivationDispatchStatus, UUID } from "@/types/entities";
import type {
  ReactivationDispatchInsert,
  ReactivationDispatchesRepository,
} from "./reactivation-dispatches.repo";

const DEFAULT_LIMIT = 50;

/**
 * Supabase impl ReactivationDispatchesRepository. Slice 1 sub-paso 7.4 repo 13.
 *
 * Audit trail append-only de templates reactivación enviados. FK lead_session_id
 * → lead_session.id ON DELETE CASCADE (purge cron limpia automáticamente).
 *
 * status text con default 'sent' (no DB enum — service-level evolution sin migration).
 * motivo nullable cuando sesión perdida sin motivo registrado.
 */
export class SupabaseReactivationDispatchesRepository implements ReactivationDispatchesRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ReactivationDispatchInsert): Promise<ReactivationDispatch> {
    const { data, error } = await this.db
      .from("reactivation_dispatches")
      .insert({
        lead_session_id: input.lead_session_id,
        motivo: input.motivo,
        template_name: input.template_name,
        meta_message_id: input.meta_message_id,
        status: input.status ?? "sent",
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "reactivation_dispatch" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<ReactivationDispatch | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("reactivation_dispatches")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "reactivation_dispatch" });
    return data ? mapRow(data) : null;
  }

  async findLatestBySessionId(sessionId: UUID): Promise<ReactivationDispatch | null> {
    if (!isUuid(sessionId)) return null;
    const { data, error } = await this.db
      .from("reactivation_dispatches")
      .select()
      .eq("lead_session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "reactivation_dispatch" });
    return data ? mapRow(data) : null;
  }

  async listBySessionId(sessionId: UUID, limit = DEFAULT_LIMIT): Promise<ReactivationDispatch[]> {
    if (!isUuid(sessionId)) return [];
    const { data, error } = await this.db
      .from("reactivation_dispatches")
      .select()
      .eq("lead_session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw mapPostgrestError(error, { resource: "reactivation_dispatch" });
    return (data ?? []).map(mapRow);
  }
}

interface ReactivationDispatchRow {
  id: string;
  lead_session_id: string;
  motivo: MotivoPerdida | null;
  template_name: string;
  meta_message_id: string | null;
  status: string;
  created_at: string;
}

function mapRow(row: ReactivationDispatchRow): ReactivationDispatch {
  return {
    id: row.id,
    lead_session_id: row.lead_session_id,
    motivo: row.motivo,
    template_name: row.template_name,
    meta_message_id: row.meta_message_id,
    // DB stores text; entity narrows a "sent"|"failed"|"bounced". Trust contract producer.
    status: row.status as ReactivationDispatchStatus,
    created_at: new Date(row.created_at),
  };
}
