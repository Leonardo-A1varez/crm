import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { DEFAULT_OPENAI_MODEL, OPENAI_PRICING } from "@/server/services/llm/pricing";
import {
  LLM_WORKFLOWS,
  makeLlmFactory,
  resolveLlmModels,
  type LlmFactoryConfig,
} from "@/server/services/llm/llm-factory";
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
    const bundle = makeLlmFactory({
      mode: "real",
      openaiApiKey: "sk-test",
      modelName: "gpt-4o",
      costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
    });
    expect(bundle.intentClassifier).toBeDefined();
  });

  test("modelName sin pricing falla al construir (no en mitad del workflow)", () => {
    expect(() =>
      makeLlmFactory({
        mode: "real",
        openaiApiKey: "sk-test",
        modelName: "gpt-inventado",
        costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
      }),
    ).toThrow(ValidationError);
  });

  test("override por workflow sin pricing tambien falla", () => {
    expect(() =>
      makeLlmFactory({
        mode: "real",
        openaiApiKey: "sk-test",
        models: { agent: "gpt-inventado" },
        costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
      }),
    ).toThrow(/gpt-inventado/);
  });

  test("mock mode ignora los modelos (no valida pricing)", () => {
    expect(() =>
      makeLlmFactory({
        mode: "mock",
        modelName: "gpt-inventado",
        models: { agent: "otro-inventado" },
        costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 }),
      }),
    ).not.toThrow();
  });
});

describe("resolveLlmModels", () => {
  test("sin default ni overrides, los 5 workflows usan DEFAULT_OPENAI_MODEL", () => {
    const models = resolveLlmModels(undefined, {});
    expect(Object.keys(models).sort()).toEqual([...LLM_WORKFLOWS].sort());
    for (const workflow of LLM_WORKFLOWS) {
      expect(models[workflow]).toBe(DEFAULT_OPENAI_MODEL);
    }
  });

  test("default explicito aplica a los workflows sin override", () => {
    const models = resolveLlmModels("gpt-4.1-mini", {});
    for (const workflow of LLM_WORKFLOWS) {
      expect(models[workflow]).toBe("gpt-4.1-mini");
    }
  });

  test("override pisa solo su workflow, el resto hereda el default", () => {
    const models = resolveLlmModels("gpt-4o-mini", { agent: "gpt-5-mini" });
    expect(models.agent).toBe("gpt-5-mini");
    expect(models.intentClassifier).toBe("gpt-4o-mini");
    expect(models.twinExtractor).toBe("gpt-4o-mini");
    expect(models.conversationSummarizer).toBe("gpt-4o-mini");
    expect(models.intentBatchDetector).toBe("gpt-4o-mini");
  });

  test("override undefined se ignora (env var ausente hereda el default)", () => {
    const models = resolveLlmModels("gpt-4o-mini", { agent: undefined });
    expect(models.agent).toBe("gpt-4o-mini");
  });

  test("cada workflow puede tener modelo distinto", () => {
    const models = resolveLlmModels("gpt-4o-mini", {
      agent: "gpt-5-mini",
      intentClassifier: "gpt-5-nano",
      twinExtractor: "gpt-4.1-nano",
    });
    expect(models.agent).toBe("gpt-5-mini");
    expect(models.intentClassifier).toBe("gpt-5-nano");
    expect(models.twinExtractor).toBe("gpt-4.1-nano");
    expect(models.conversationSummarizer).toBe("gpt-4o-mini");
  });

  test("modelo sin pricing lanza ValidationError nombrando el modelo", () => {
    expect(() => resolveLlmModels("gpt-inventado", {})).toThrow(ValidationError);
    expect(() => resolveLlmModels("gpt-inventado", {})).toThrow(/gpt-inventado/);
  });

  test("el error lista los modelos validos para que el fix sea obvio", () => {
    expect(() => resolveLlmModels("gpt-inventado", {})).toThrow(/gpt-4o-mini/);
  });

  test("modelos desconocidos se reportan sin repetir", () => {
    // Mismo modelo invalido en default + override: debe aparecer una sola vez.
    try {
      resolveLlmModels("gpt-inventado", { agent: "gpt-inventado" });
      expect.unreachable("deberia haber lanzado");
    } catch (err) {
      const matches = String((err as Error).message).match(/gpt-inventado/g) ?? [];
      expect(matches).toHaveLength(1);
    }
  });
});

describe("makeLlmFactory — exhaustiveness", () => {
  test("mode invalido (TS prevent compile-time; runtime fallback throws)", () => {
    expect(() =>
      makeLlmFactory({ mode: "invalido" as unknown as "mock" } as LlmFactoryConfig),
    ).toThrow();
  });
});
