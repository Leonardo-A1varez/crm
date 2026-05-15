import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { ToolExecution, UUID } from "@/types/entities";
import type { ToolExecutionInsert, ToolExecutionsRepository } from "./tool-executions.repo";

const DEFAULT_LIMIT = 50;

/**
 * Supabase impl ToolExecutionsRepository. Slice 1 sub-paso 7.4 repo 10.
 *
 * Audit log de tool calls del agente IA. Append-only (sin update/delete).
 *
 * FKs:
 *   - lead_session_id → lead_session.id ON DELETE CASCADE (cron purge >29d)
 *   - mensaje_id → mensajes.id ON DELETE SET NULL (mensaje_id nullable)
 */
export class SupabaseToolExecutionsRepository implements ToolExecutionsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ToolExecutionInsert): Promise<ToolExecution> {
    const { data, error } = await this.db
      .from("tool_executions")
      .insert({
        lead_session_id: input.lead_session_id,
        mensaje_id: input.mensaje_id,
        tool_name: input.tool_name,
        args: input.args as never,
        result: input.result as never,
        error: input.error,
        duration_ms: input.duration_ms,
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "tool_execution" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<ToolExecution | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("tool_executions")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "tool_execution" });
    return data ? mapRow(data) : null;
  }

  async listBySession(sessionId: UUID, limit = DEFAULT_LIMIT): Promise<ToolExecution[]> {
    if (!isUuid(sessionId)) return [];
    const { data, error } = await this.db
      .from("tool_executions")
      .select()
      .eq("lead_session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw mapPostgrestError(error, { resource: "tool_execution" });
    return (data ?? []).map(mapRow);
  }
}

interface ToolExecutionRow {
  id: string;
  lead_session_id: string;
  mensaje_id: string | null;
  tool_name: string;
  args: unknown;
  result: unknown;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

function mapRow(row: ToolExecutionRow): ToolExecution {
  return {
    id: row.id,
    lead_session_id: row.lead_session_id,
    mensaje_id: row.mensaje_id,
    tool_name: row.tool_name,
    args: structuredClone(row.args ?? {}) as Record<string, unknown>,
    result: row.result === null ? null : (structuredClone(row.result) as Record<string, unknown>),
    error: row.error,
    duration_ms: row.duration_ms,
    created_at: new Date(row.created_at),
  };
}
