import { NotFoundError } from "@/lib/errors";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadSession, UUID } from "@/types/entities";

// B4: threshold default 20 turns antes de trigger rolling summary.
// Razón: keep LLM context window bounded → cost predictable + latencia stable.
// Override per-cliente via env config (Slice 1 7.7).
export const DEFAULT_SUMMARY_THRESHOLD = 20;

export interface SummarizeInput {
  sessionId: UUID;
  history: string[];
}

export interface ConversationSummarizerLLMInput {
  sessionId: UUID;
  history: string[];
  previousSummary: string | null;
}

export interface ConversationSummarizerLLM {
  summarize(input: ConversationSummarizerLLMInput): Promise<string>;
}

export interface ConversationSummarizerService {
  summarize(input: SummarizeInput): Promise<LeadSession>;
  // Helper para callers (pipelines) decidir si trigger summarize basado en
  // total turns acumulados en la sesión actual. Threshold configurable
  // por instancia del service.
  shouldSummarize(totalTurns: number): boolean;
}

export class DefaultConversationSummarizerService implements ConversationSummarizerService {
  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly llm: ConversationSummarizerLLM,
    private readonly threshold: number = DEFAULT_SUMMARY_THRESHOLD,
  ) {}

  shouldSummarize(totalTurns: number): boolean {
    return totalTurns >= this.threshold;
  }

  async summarize(input: SummarizeInput): Promise<LeadSession> {
    const current = await this.sessions.findById(input.sessionId);
    if (!current) {
      throw new NotFoundError(
        `sesión no encontrada: ${input.sessionId}`,
        "lead_session",
        input.sessionId,
      );
    }
    if (current.resultado !== null) return current;

    const summary = await this.llm.summarize({
      sessionId: input.sessionId,
      history: input.history,
      previousSummary: current.context_summary,
    });

    return this.sessions.update(input.sessionId, { context_summary: summary });
  }
}
