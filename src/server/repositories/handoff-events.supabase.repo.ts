import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { HandoffEvent, UUID } from "@/types/entities";
import type {
  HandoffEventsRepository,
  HandoffTransitionInput,
  HandoffTransitionResult,
} from "./handoff-events.repo";
import type { LeadSessionRepository } from "./lead-session.repo";

export class SupabaseHandoffEventsRepository implements HandoffEventsRepository {
  constructor(
    private readonly db: AppClient,
    private readonly sessions: LeadSessionRepository,
  ) {}

  async transition(input: HandoffTransitionInput): Promise<HandoffTransitionResult> {
    const { data, error } = await this.db.rpc("transition_handoff", {
      p_action: input.action,
      p_notify_customer: input.notifyCustomer,
      p_reason_code: input.reasonCode,
      p_session_id: input.sessionId,
      p_source: input.source,
      p_source_event_key: input.sourceEventKey,
    });
    if (error) throw mapPostgrestError(error, { resource: "handoff_events" });
    const row = data?.[0];
    if (!row) throw new InfraError("transition_handoff no devolvió evento", "postgrest");
    const session = await this.sessions.findById(input.sessionId);
    if (!session) {
      throw new NotFoundError(
        `sesión no encontrada: ${input.sessionId}`,
        "lead_session",
        input.sessionId,
      );
    }
    return {
      event: {
        id: row.handoff_event_id,
        lead_session_id: row.lead_session_id,
        action: row.action as HandoffEvent["action"],
        reason_code: row.reason_code as HandoffEvent["reason_code"],
        source: row.source as HandoffEvent["source"],
        previous_stage: row.previous_stage,
        actor_user_id: null,
        source_event_key: input.sourceEventKey,
        created_at: new Date(row.created_at),
      },
      session,
    };
  }

  async listBySessionIds(sessionIds: UUID[]): Promise<HandoffEvent[]> {
    if (sessionIds.length === 0) return [];
    const { data, error } = await this.db
      .from("handoff_events")
      .select()
      .in("lead_session_id", sessionIds)
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "handoff_events" });
    return (data ?? []).map((row) => ({
      ...row,
      action: row.action as HandoffEvent["action"],
      reason_code: row.reason_code as HandoffEvent["reason_code"],
      source: row.source as HandoffEvent["source"],
      previous_stage: row.previous_stage,
      created_at: new Date(row.created_at),
    }));
  }
}
