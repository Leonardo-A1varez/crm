import type { AgentLLM, AgentLLMInput, AgentLLMResult } from "@/server/services/ai-agent.service";

/**
 * InMemory mock `AgentLLM` para `LLM_MODE=mock` (Slice 1 7.7.A).
 *
 * Retorna text fixed + 0 tool calls. Service consumidor envía text como
 * respuesta IA al lead. Útil para ejercitar webhook → response loop sin
 * OpenAI ni costos. Lead verá mensaje claro que está en modo mock.
 */
export class InMemoryAgentLLM implements AgentLLM {
  async generate(_input: AgentLLMInput): Promise<AgentLLMResult> {
    return {
      text: "[mock agent — LLM_MODE=mock activo. Configurar LLM_MODE=real + OPENAI_API_KEY para respuestas reales.]",
      toolCalls: [],
    };
  }
}
