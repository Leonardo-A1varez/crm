import { ConflictError, NotFoundError } from "@/lib/errors";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { HandoffEvent, LeadSession, UUID } from "@/types/entities";

export type HandoffReasonCode = HandoffEvent["reason_code"];
export type HandoffSource = HandoffEvent["source"];

export interface HandoffTransitionInput {
  sessionId: UUID;
  action: HandoffEvent["action"];
  reasonCode: HandoffReasonCode;
  source: HandoffSource;
  sourceEventKey: string;
  notifyCustomer: boolean;
}

export interface HandoffTransitionResult {
  event: HandoffEvent;
  session: LeadSession;
}

export interface HandoffEventsRepository {
  transition(input: HandoffTransitionInput): Promise<HandoffTransitionResult>;
  listBySessionIds(sessionIds: UUID[]): Promise<HandoffEvent[]>;
}

export class InMemoryHandoffEventsRepository implements HandoffEventsRepository {
  private readonly byKey = new Map<string, HandoffEvent>();

  constructor(private readonly sessions: LeadSessionRepository) {}

  async transition(input: HandoffTransitionInput): Promise<HandoffTransitionResult> {
    const current = await this.sessions.findById(input.sessionId);
    if (!current) {
      throw new NotFoundError(
        `sesión no encontrada: ${input.sessionId}`,
        "lead_session",
        input.sessionId,
      );
    }
    if (current.resultado !== null) {
      throw new ConflictError(`sesión cerrada: ${input.sessionId}`, "session_closed");
    }

    const duplicate = this.byKey.get(input.sourceEventKey);
    if (duplicate) return { event: { ...duplicate }, session: current };

    const previous =
      input.action === "pause"
        ? current.current_stage === "requiere_humano"
          ? (current.stage_before_handoff ?? null)
          : current.current_stage
        : (current.stage_before_handoff ?? null);

    const session =
      input.action === "pause"
        ? await this.sessions.update(input.sessionId, {
            ia_pausada: true,
            current_stage: "requiere_humano",
            stage_before_handoff: current.stage_before_handoff ?? previous,
          })
        : await this.sessions.update(input.sessionId, {
            ia_pausada: false,
            current_stage: current.stage_before_handoff ?? "nuevo",
            stage_before_handoff: null,
          });

    const event: HandoffEvent = {
      id: crypto.randomUUID(),
      lead_session_id: input.sessionId,
      action: input.action,
      reason_code: input.reasonCode,
      source: input.source,
      previous_stage: previous,
      actor_user_id: null,
      source_event_key: input.sourceEventKey,
      created_at: new Date(),
    };
    this.byKey.set(input.sourceEventKey, event);
    return { event: { ...event }, session };
  }

  async listBySessionIds(sessionIds: UUID[]): Promise<HandoffEvent[]> {
    const ids = new Set(sessionIds);
    return Array.from(this.byKey.values())
      .filter((event) => ids.has(event.lead_session_id))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map((event) => ({ ...event }));
  }
}
