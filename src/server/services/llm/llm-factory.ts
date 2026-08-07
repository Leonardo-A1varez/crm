/**
 * LLM Factory env-based — Slice 1 sub-paso 7.7.A.
 *
 * Selector `LLM_MODE`:
 *   - "real" → OpenAI impls (require `openaiApiKey` válida).
 *   - "mock" → InMemory impls (deterministic responses, sin tokens).
 *
 * Bundle único `LlmBundle` consumido por Inngest functions + services DI.
 * Garantiza que TODAS las 5 LLMs vienen del mismo mode (no mezclar real+mock).
 *
 * Modelo: `modelName` es el default de los 5; `models` lo pisa por workflow.
 * El split existe porque las exigencias son distintas — el agente le habla al
 * cliente y usa tool calling, mientras clasificador y extractor solo llenan un
 * schema. Poner el mismo modelo en ambos extremos paga de más o rinde de menos.
 *
 * Todo modelo resuelto se valida contra `OPENAI_PRICING` al construir. Sin esa
 * validación el fallo aparecía recién dentro de un workflow, cuando
 * `CostTracker.record()` no encontraba pricing — con el mensaje ya perdido.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { ValidationError } from "@/lib/errors";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import type { IntentClassifierLLM } from "@/server/services/intent-classifier.service";
import type { TwinExtractorLLM } from "@/server/services/twin-extractor.service";
import type { ConversationSummarizerLLM } from "@/server/services/conversation-summarizer.service";
import type { IntentBatchDetectorLLM } from "@/server/services/intent-batch-detector.service";
import type { AgentLLM } from "@/server/services/ai-agent.service";

import { DEFAULT_OPENAI_MODEL, OPENAI_PRICING } from "./pricing";
import { OpenAiIntentClassifierLLM } from "./openai-intent-classifier";
import { OpenAiTwinExtractorLLM } from "./openai-twin-extractor";
import { OpenAiConversationSummarizerLLM } from "./openai-conversation-summarizer";
import { OpenAiIntentBatchDetectorLLM } from "./openai-intent-batch-detector";
import { OpenAiAgentLLM } from "./openai-ai-agent";

import { InMemoryIntentClassifierLLM } from "./in-memory-intent-classifier";
import { InMemoryTwinExtractorLLM } from "./in-memory-twin-extractor";
import { InMemoryConversationSummarizerLLM } from "./in-memory-conversation-summarizer";
import { InMemoryIntentBatchDetectorLLM } from "./in-memory-intent-batch-detector";
import { InMemoryAgentLLM } from "./in-memory-ai-agent";

export type LlmMode = "real" | "mock";

export const LLM_WORKFLOWS = [
  "intentClassifier",
  "twinExtractor",
  "conversationSummarizer",
  "intentBatchDetector",
  "agent",
] as const;

export type LlmWorkflow = (typeof LLM_WORKFLOWS)[number];

/** Modelo por workflow. `undefined` hereda el default (env var ausente). */
export type LlmModelOverrides = Partial<Record<LlmWorkflow, string | undefined>>;

export interface LlmBundle {
  intentClassifier: IntentClassifierLLM;
  twinExtractor: TwinExtractorLLM;
  conversationSummarizer: ConversationSummarizerLLM;
  intentBatchDetector: IntentBatchDetectorLLM;
  agent: AgentLLM;
}

export interface LlmFactoryConfig {
  mode: LlmMode;
  /** Solo real mode. Obligatorio si mode=real. */
  openaiApiKey?: string;
  /** Solo real mode. Default DEFAULT_OPENAI_MODEL. Válidos: keys de OPENAI_PRICING. */
  modelName?: string;
  /** Solo real mode. Pisa `modelName` por workflow. */
  models?: LlmModelOverrides;
  /** CostTracker compartido entre 5 LLMs. */
  costTracker: CostTracker;
}

/**
 * Resuelve el modelo de cada workflow y valida que todos tengan pricing.
 *
 * Pura y exportada para poder testear la resolución sin construir el bundle
 * (que necesita una API key y toca el provider de OpenAI).
 *
 * @throws ValidationError si algún modelo resuelto falta en `OPENAI_PRICING`.
 */
export function resolveLlmModels(
  defaultModel: string | undefined,
  overrides: LlmModelOverrides = {},
): Record<LlmWorkflow, string> {
  const base = defaultModel ?? DEFAULT_OPENAI_MODEL;
  const resolved = {} as Record<LlmWorkflow, string>;
  const sinPricing = new Set<string>();

  for (const workflow of LLM_WORKFLOWS) {
    const model = overrides[workflow] ?? base;
    if (!(model in OPENAI_PRICING)) sinPricing.add(model);
    resolved[workflow] = model;
  }

  if (sinPricing.size > 0) {
    throw new ValidationError(
      `Modelo OpenAI sin pricing configurado: ${[...sinPricing].join(", ")}. ` +
        `Agregá su entry en src/server/services/llm/pricing.ts (con precios de ` +
        `https://developers.openai.com/api/docs/pricing) o usá uno de: ` +
        `${Object.keys(OPENAI_PRICING).join(", ")}.`,
    );
  }

  return resolved;
}

export function makeLlmFactory(cfg: LlmFactoryConfig): LlmBundle {
  if (cfg.mode === "mock") {
    return {
      intentClassifier: new InMemoryIntentClassifierLLM(),
      twinExtractor: new InMemoryTwinExtractorLLM(),
      conversationSummarizer: new InMemoryConversationSummarizerLLM(),
      intentBatchDetector: new InMemoryIntentBatchDetectorLLM(),
      agent: new InMemoryAgentLLM(),
    };
  }
  if (cfg.mode === "real") {
    if (!cfg.openaiApiKey) {
      throw new Error(
        "LLM_MODE=real requiere openaiApiKey (lee de env.OPENAI_API_KEY). Setear var o cambiar LLM_MODE=mock.",
      );
    }
    const models = resolveLlmModels(cfg.modelName, cfg.models);
    const provider = createOpenAI({ apiKey: cfg.openaiApiKey });
    const configFor = (workflow: LlmWorkflow) => ({
      model: provider(models[workflow]),
      modelName: models[workflow],
      costTracker: cfg.costTracker,
    });

    return {
      intentClassifier: new OpenAiIntentClassifierLLM(configFor("intentClassifier")),
      twinExtractor: new OpenAiTwinExtractorLLM(configFor("twinExtractor")),
      conversationSummarizer: new OpenAiConversationSummarizerLLM(
        configFor("conversationSummarizer"),
      ),
      intentBatchDetector: new OpenAiIntentBatchDetectorLLM(configFor("intentBatchDetector")),
      agent: new OpenAiAgentLLM(configFor("agent")),
    };
  }
  // Exhaustiveness check + runtime guard si caller bypassa types.
  const _exhaustive: never = cfg.mode;
  throw new Error(`LLM_MODE desconocido: ${String(_exhaustive)}`);
}
