import type {
  ConversationSummarizerLLM,
  ConversationSummarizerLLMInput,
} from "@/server/services/conversation-summarizer.service";

/**
 * InMemory mock `ConversationSummarizerLLM` para `LLM_MODE=mock` (Slice 1 7.7.A).
 *
 * Retorna string fixed con prefijo "[mock summary]" + N mensajes count.
 * Service persiste a `lead_session.context_summary` igual que el real,
 * cubriendo pipeline rolling-summary sin OpenAI.
 */
export class InMemoryConversationSummarizerLLM implements ConversationSummarizerLLM {
  async summarize(input: ConversationSummarizerLLMInput): Promise<string> {
    return `[mock summary — ${input.history.length} turnos session ${input.sessionId}]`;
  }
}
