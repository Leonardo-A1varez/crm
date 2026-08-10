import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import type {
  DetectedIntent,
  IntentBatchDetectorInput,
  IntentBatchDetectorLLM,
} from "@/server/services/intent-batch-detector.service";
import { WORKFLOW_LLM } from "@/types/domain";
import { recordLlmUsage } from "./cost-tracker-bridge";
import { NON_STRICT_JSON_SCHEMA } from "./structured-output";

export interface OpenAiIntentBatchDetectorConfig {
  model: LanguageModel;
  modelName: string;
  costTracker: CostTracker;
}

// Schema runtime para validar shape de cada intent detectado.
const DetectedIntentSchema = z.object({
  nombre: z.string().min(1).max(60).describe("snake_case_corto, max 60 chars, unique por intent"),
  descripcion: z.string().min(1).describe("Para qué sirve este intent (1-2 frases)"),
  ejemplos: z
    .array(z.string().min(1))
    .min(2)
    .max(6)
    .describe("2-6 frases ejemplo del lead que matchearían este intent"),
});

// Wrapper schema: simplifica mocking + matchea pattern "object con array key"
// que la mayoría de LLMs producen naturalmente cuando se les pide JSON.
const DetectedIntentsWrapperSchema = z.object({
  intents: z.array(DetectedIntentSchema),
});

const SYSTEM_PROMPT = [
  "Sos un detector de intents recurrentes para un CRM de venta de repuestos automotrices.",
  "Recibís un batch de N sesiones cerradas con sus mensajes.",
  "Identificás patrones recurrentes que merezcan convertirse en intent nuevo del motor pre-LLM.",
  "Devolvés un array de intents detectados (puede estar vacío si no hay patrón claro).",
  "Cada intent: nombre snake_case corto + descripcion + 2-6 ejemplos reales del batch.",
  "NO devolvés intents triviales (saludo, despedida) salvo que dominen >30% del batch.",
  "Preferí pocos intents bien diferenciados a muchos solapados.",
].join(" ");

/**
 * OpenAI impl `IntentBatchDetectorLLM`. Slice 1 sub-paso 7.5.
 *
 * Cron weekly `detect-intents.batch` analiza sesiones cerradas última semana,
 * llama este LLM, persiste intents detectados via repo intents (admin
 * decide activar via UI Slice 2+).
 *
 * Usa `generateObject` con `output: "array"` + zod schema por elemento.
 */
export class OpenAiIntentBatchDetectorLLM implements IntentBatchDetectorLLM {
  constructor(private readonly cfg: OpenAiIntentBatchDetectorConfig) {}

  async detect(input: IntentBatchDetectorInput): Promise<DetectedIntent[]> {
    const sessionsText = input.sessions
      .map((s, i) => {
        const messages = s.messages.map((m, j) => `  [${j + 1}] ${m}`).join("\n");
        return `Sesión ${i + 1} (id=${s.sessionId}):\n${messages}`;
      })
      .join("\n\n");

    const result = await generateObject({
      model: this.cfg.model,
      schema: DetectedIntentsWrapperSchema,
      system: SYSTEM_PROMPT,
      prompt: [
        `Batch de ${input.sessions.length} sesión(es) cerrada(s):`,
        "",
        sessionsText,
        "",
        'Devolvé `{ "intents": [...] }` con el array de intents detectados (puede estar vacío).',
      ].join("\n"),
      providerOptions: NON_STRICT_JSON_SCHEMA,
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
      workflow: WORKFLOW_LLM.detectorBatch,
    });

    return result.object.intents;
  }
}
