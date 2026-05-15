import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { AdminAction, UUID } from "@/types/entities";
import type {
  AdminActionInsert,
  AdminAuditListFilter,
  AdminAuditRepository,
} from "./admin-audit.repo";

/**
 * Supabase impl AdminAuditRepository. Slice 1 sub-paso 7.4 repo 11.
 *
 * Audit log append-only. FK: actor_user_id → usuarios.id ON DELETE SET NULL
 * (nullable). entity_id sin FK (uuid column libre — service decide qué entidad).
 *
 * payload jsonb default '{}'. listBy filtros opcionales (actorUserId,
 * entityType, entityId) + limit + ORDER created_at DESC vía
 * idx_admin_actions_created.
 */
export class SupabaseAdminAuditRepository implements AdminAuditRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: AdminActionInsert): Promise<AdminAction> {
    const { data, error } = await this.db
      .from("admin_actions")
      .insert({
        actor_user_id: input.actor_user_id,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        payload: (input.payload ?? {}) as never,
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "admin_action" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<AdminAction | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("admin_actions").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "admin_action" });
    return data ? mapRow(data) : null;
  }

  async list(filter: AdminAuditListFilter = {}): Promise<AdminAction[]> {
    let query = this.db.from("admin_actions").select().order("created_at", { ascending: false });

    if (filter.actorUserId !== undefined) {
      if (!isUuid(filter.actorUserId)) return [];
      query = query.eq("actor_user_id", filter.actorUserId);
    }
    if (filter.entityType !== undefined) {
      query = query.eq("entity_type", filter.entityType);
    }
    if (filter.entityId !== undefined) {
      if (!isUuid(filter.entityId)) return [];
      query = query.eq("entity_id", filter.entityId);
    }
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }

    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "admin_action" });
    return (data ?? []).map(mapRow);
  }
}

interface AdminActionRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: unknown;
  created_at: string;
}

function mapRow(row: AdminActionRow): AdminAction {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    payload: structuredClone(payload),
    created_at: new Date(row.created_at),
  };
}
