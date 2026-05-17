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
 * Default modelo OpenAI: `gpt-4o-mini` (cheap + suficiente pilot tier).
 * Override per-LLM (intent vs twin vs agent) diferido a 7.7.B observability
 * cuando podamos medir per-workflow.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import type { IntentClassifierLLM } from "@/server/services/intent-classifier.service";
import type { TwinExtractorLLM } from "@/server/services/twin-extractor.service";
import type { ConversationSummarizerLLM } from "@/server/services/conversation-summarizer.service";
import type { IntentBatchDetectorLLM } from "@/server/services/intent-batch-detector.service";
import type { AgentLLM } from "@/server/services/ai-agent.service";

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
  /** Solo real mode. Default "gpt-4o-mini". Modelos válidos: ver pricing.ts. */
  modelName?: string;
  /** CostTracker compartido entre 5 LLMs. */
  costTracker: CostTracker;
}

const DEFAULT_MODEL = "gpt-4o-mini";

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
    const modelName = cfg.modelName ?? DEFAULT_MODEL;
    const provider = createOpenAI({ apiKey: cfg.openaiApiKey });
    const model = provider(modelName);
    const shared = { model, modelName, costTracker: cfg.costTracker };

    return {
      intentClassifier: new OpenAiIntentClassifierLLM(shared),
      twinExtractor: new OpenAiTwinExtractorLLM(shared),
      conversationSummarizer: new OpenAiConversationSummarizerLLM(shared),
      intentBatchDetector: new OpenAiIntentBatchDetectorLLM(shared),
      agent: new OpenAiAgentLLM(shared),
    };
  }
  // Exhaustiveness check + runtime guard si caller bypassa types.
  const _exhaustive: never = cfg.mode;
  throw new Error(`LLM_MODE desconocido: ${String(_exhaustive)}`);
}
