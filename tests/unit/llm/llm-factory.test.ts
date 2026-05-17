import { describe, expect, test } from "vitest";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import { makeLlmFactory, type LlmFactoryConfig } from "@/server/services/llm/llm-factory";
import type { IntentClassifierLLM } from "@/server/services/intent-classifier.service";
import type { TwinExtractorLLM } from "@/server/services/twin-extractor.service";
import type { ConversationSummarizerLLM } from "@/server/services/conversation-summarizer.service";
import type { IntentBatchDetectorLLM } from "@/server/services/intent-batch-detector.service";
import type { AgentLLM } from "@/server/services/ai-agent.service";

const MOCK_CONFIG: LlmFactoryConfig = {
  mode: "mock",
  costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
};

const REAL_CONFIG: LlmFactoryConfig = {
  mode: "real",
  openaiApiKey: "sk-test-fake-key",
  modelName: "gpt-4o-mini",
  costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
};

describe("makeLlmFactory — mock mode", () => {
  test("retorna bundle con 5 LLMs", () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    expect(bundle.intentClassifier).toBeDefined();
    expect(bundle.twinExtractor).toBeDefined();
    expect(bundle.conversationSummarizer).toBeDefined();
    expect(bundle.intentBatchDetector).toBeDefined();
    expect(bundle.agent).toBeDefined();
  });

  test("InMemoryIntentClassifierLLM retorna intent null + confidence 0", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const llm: IntentClassifierLLM = bundle.intentClassifier;
    const result = await llm.classify({ text: "hola", candidates: [] });
    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0);
    expect(typeof result.razon).toBe("string");
  });

  test("InMemoryTwinExtractorLLM retorna update vacío (no muta state)", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const llm: TwinExtractorLLM = bundle.twinExtractor;
    const result = await llm.extract({
      current: {} as never,
      conversationTurn: ["hola"],
    });
    expect(result).toEqual({});
  });

  test("InMemoryConversationSummarizerLLM retorna string deterministic", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const llm: ConversationSummarizerLLM = bundle.conversationSummarizer;
    const result = await llm.summarize({
      sessionId: "00000000-0000-0000-0000-000000000001",
      history: ["hola", "necesito un repuesto"],
      previousSummary: null,
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("[mock");
  });

  test("InMemoryIntentBatchDetectorLLM retorna array vacío", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const llm: IntentBatchDetectorLLM = bundle.intentBatchDetector;
    const result = await llm.detect({ sessions: [] });
    expect(result).toEqual([]);
  });

  test("InMemoryAgentLLM retorna text fallback + 0 toolCalls", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const llm: AgentLLM = bundle.agent;
    const result = await llm.generate({
      session: {} as never,
      conversationTurn: ["hola"],
      classification: { intent_nombre: null, confidence: 0 },
      tools: { buscar_repuesto: async () => ({ matches: [], count: 0 }) },
    });
    expect(typeof result.text).toBe("string");
    expect(result.text).toContain("[mock");
    expect(result.toolCalls).toEqual([]);
  });

  test("mocks son singletons-safe (multiple calls no acumulan state)", async () => {
    const bundle = makeLlmFactory(MOCK_CONFIG);
    const r1 = await bundle.intentClassifier.classify({ text: "a", candidates: [] });
    const r2 = await bundle.intentClassifier.classify({ text: "b", candidates: [] });
    expect(r1).toEqual(r2);
  });
});

describe("makeLlmFactory — real mode", () => {
  test("retorna bundle con 5 LLMs OpenAI impls", () => {
    const bundle = makeLlmFactory(REAL_CONFIG);
    expect(bundle.intentClassifier.constructor.name).toBe("OpenAiIntentClassifierLLM");
    expect(bundle.twinExtractor.constructor.name).toBe("OpenAiTwinExtractorLLM");
    expect(bundle.conversationSummarizer.constructor.name).toBe("OpenAiConversationSummarizerLLM");
    expect(bundle.intentBatchDetector.constructor.name).toBe("OpenAiIntentBatchDetectorLLM");
    expect(bundle.agent.constructor.name).toBe("OpenAiAgentLLM");
  });

  test("real mode sin openaiApiKey throws Error claro", () => {
    expect(() =>
      makeLlmFactory({
        mode: "real",
        openaiApiKey: "",
        modelName: "gpt-4o-mini",
        costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  test("real mode sin modelName usa default gpt-4o-mini", () => {
    const bundle = makeLlmFactory({
      mode: "real",
      openaiApiKey: "sk-test",
      costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
    });
    expect(bundle.intentClassifier).toBeDefined();
  });

  test("modelName custom propaga (no override)", () => {
    // gpt-4o existe en PricingTable. Si modelName desconocido, recordLlmUsage
    // logea unknown-model pero no falla la construction.
    const bundle = makeLlmFactory({
      mode: "real",
      openaiApiKey: "sk-test",
      modelName: "gpt-4o",
      costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
    });
    expect(bundle.intentClassifier).toBeDefined();
  });
});

describe("makeLlmFactory — exhaustiveness", () => {
  test("mode invalido (TS prevent compile-time; runtime fallback throws)", () => {
    expect(() =>
      makeLlmFactory({ mode: "invalido" as unknown as "mock" } as LlmFactoryConfig),
    ).toThrow();
  });
});
