import { generateObject, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import { IntentClassificationSchema, type IntentClassification } from "@/lib/validation/ai";
import type {
  IntentClassifierInput,
  IntentClassifierLLM,
} from "@/server/services/intent-classifier.service";
import { recordLlmUsage } from "./cost-tracker-bridge";

export interface OpenAiIntentClassifierConfig {
  /** Language model (e.g., openai("gpt-4o-mini")). Inyectable para tests. */
  model: LanguageModel;
  /** Nombre del modelo (matchea key en PricingTable para CostTracker). */
  modelName: string;
  costTracker: CostTracker;
}

const SYSTEM_PROMPT = [
  "Sos un clasificador de intents para un CRM conversacional de venta de repuestos automotrices.",
  "Recibís un mensaje del lead y una lista de candidates con descripción + ejemplos.",
  "Devolvés el intent_nombre del candidate más probable o null si ninguno aplica con confidence >= 0.6.",
  "confidence: número 0..1 (0 = nada seguro, 1 = certeza absoluta).",
  "razon: explicación corta de por qué (1-2 frases).",
].join(" ");

/**
 * OpenAI impl `IntentClassifierLLM`. Slice 1 sub-paso 7.5.
 *
 * Usa `generateObject` con zod schema `IntentClassificationSchema` (output
 * estructurado garantizado). Registra usage tokens al CostTracker post-call.
 *
 * No hace cap-check pre-call (el caller decide vía CostTracker.exceedsCap).
 * Si el LLM devuelve intent_nombre desconocido, el service consumidor
 * (DefaultIntentClassifierService) lo filtra contra activos.
 */
export class OpenAiIntentClassifierLLM implements IntentClassifierLLM {
  constructor(private readonly cfg: OpenAiIntentClassifierConfig) {}

  async classify(input: IntentClassifierInput): Promise<IntentClassification> {
    const candidatesText = input.candidates
      .map(
        (c, i) =>
          `${i + 1}. ${c.nombre}\n   Descripción: ${c.descripcion}\n   Ejemplos: ${c.ejemplos
            .map((e) => `"${e}"`)
            .join(", ")}`,
      )
      .join("\n\n");

    const result = await generateObject({
      model: this.cfg.model,
      schema: IntentClassificationSchema,
      system: SYSTEM_PROMPT,
      prompt: `Mensaje del lead: "${input.text}"\n\nCandidates:\n${candidatesText}`,
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
      workflow: "intent-classifier",
    });

    return result.object;
  }
}
