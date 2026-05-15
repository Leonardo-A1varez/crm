import { generateText, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import type {
  ConversationSummarizerLLM,
  ConversationSummarizerLLMInput,
} from "@/server/services/conversation-summarizer.service";
import { recordLlmUsage } from "./cost-tracker-bridge";

export interface OpenAiConversationSummarizerConfig {
  model: LanguageModel;
  modelName: string;
  costTracker: CostTracker;
}

const SYSTEM_PROMPT = [
  "Sos un summarizer de conversaciones para un CRM de venta de repuestos automotrices.",
  "Recibís el resumen anterior (si existe) + el historial de turnos de conversación.",
  "Devolvés un resumen actualizado conciso (máx 4-6 frases) que preserve hechos clave:",
  "qué pieza busca, marca/modelo/año del vehículo, decisiones, bloqueadores, próximos pasos.",
  "Omití pleitesía y saludos. Solo facts.",
  "Si previousSummary existe, mergeá info nueva en lugar de empezar desde cero.",
].join(" ");

/**
 * OpenAI impl `ConversationSummarizerLLM`. Slice 1 sub-paso 7.5.
 *
 * Usa `generateText` (output texto libre, no JSON). Threshold trigger
 * configurable en service consumidor (default 20 turnos).
 * Rolling summary B4: preserva contexto bounded → cost LLM downstream estable.
 */
export class OpenAiConversationSummarizerLLM implements ConversationSummarizerLLM {
  constructor(private readonly cfg: OpenAiConversationSummarizerConfig) {}

  async summarize(input: ConversationSummarizerLLMInput): Promise<string> {
    const historyText = input.history.map((line, i) => `[${i + 1}] ${line}`).join("\n");
    const previousBlock =
      input.previousSummary !== null
        ? `Resumen previo:\n${input.previousSummary}\n\n`
        : "Resumen previo: (ninguno)\n\n";

    const result = await generateText({
      model: this.cfg.model,
      system: SYSTEM_PROMPT,
      prompt: [
        previousBlock,
        "Historial conversación:",
        historyText,
        "",
        "Devolvé el resumen actualizado.",
      ].join("\n"),
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
      workflow: "conversation-summarizer",
      sessionId: input.sessionId,
    });

    return result.text;
  }
}
