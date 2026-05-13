import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { HandoffDecision, IntentClassification } from "@/lib/validation/ai";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { LeadSession, UUID } from "@/types/entities";

const DEFAULT_UNKNOWN_THRESHOLD = 3;

export interface AutoHandoffInput {
  recentClassifications: IntentClassification[];
  threshold?: number;
}

export interface HandoffService {
  pause(sessionId: UUID, motivo: string): Promise<LeadSession>;
  resume(sessionId: UUID): Promise<LeadSession>;
  evaluate(input: AutoHandoffInput): HandoffDecision;
}

export class DefaultHandoffService implements HandoffService {
  constructor(private readonly sessions: LeadSessionRepository) {}

  async pause(sessionId: UUID, _motivo: string): Promise<LeadSession> {
    const current = await this.requireOpen(sessionId);
    if (current.ia_pausada) return current;
    return this.sessions.update(sessionId, { ia_pausada: true });
  }

  async resume(sessionId: UUID): Promise<LeadSession> {
    const current = await this.requireOpen(sessionId);
    if (!current.ia_pausada) return current;
    return this.sessions.update(sessionId, { ia_pausada: false });
  }

  evaluate(input: AutoHandoffInput): HandoffDecision {
    const threshold = input.threshold ?? DEFAULT_UNKNOWN_THRESHOLD;
    const arr = input.recentClassifications;
    if (arr.length < threshold) {
      return { pausar_ia: false, motivo: "" };
    }
    const tail = arr.slice(-threshold);
    const allUnknown = tail.every((c) => c.intent_nombre === null);
    if (!allUnknown) {
      return { pausar_ia: false, motivo: "" };
    }
    return {
      pausar_ia: true,
      motivo: `${threshold} intents desconocidos consecutivos`,
    };
  }

  private async requireOpen(sessionId: UUID): Promise<LeadSession> {
    const s = await this.sessions.findById(sessionId);
    if (!s)
      throw new NotFoundError(`sesión no encontrada: ${sessionId}`, "lead_session", sessionId);
    if (s.resultado !== null)
      throw new ConflictError(`sesión cerrada: ${sessionId}`, "session_closed");
    return s;
  }
}
