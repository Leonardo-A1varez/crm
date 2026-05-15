import { describe, expect, test } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiIntentClassifierLLM } from "@/server/services/llm/openai-intent-classifier";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { IntentClassifierInput } from "@/server/services/intent-classifier.service";

const MODEL_NAME = "gpt-4o-mini";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

function makeMockModel(jsonObject: object, usage = { input: 100, output: 50 }) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(jsonObject) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: usage.input,
          noCache: usage.input,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const baseInput: IntentClassifierInput = {
  text: "cuanto sale la pastilla de freno",
  candidates: [
    {
      nombre: "consulta_precio",
      descripcion: "Lead pregunta precio de repuesto",
      ejemplos: ["cuánto sale", "qué precio tiene"],
    },
    {
      nombre: "saludo",
      descripcion: "Lead saluda",
      ejemplos: ["hola", "buenas"],
    },
  ],
};

describe("OpenAiIntentClassifierLLM", () => {
  test("classify devuelve IntentClassification parseado desde JSON del LLM", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentClassifierLLM({
      model: makeMockModel({
        intent_nombre: "consulta_precio",
        confidence: 0.92,
        razon: "Pregunta directa por precio",
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.classify(baseInput);
    expect(result.intent_nombre).toBe("consulta_precio");
    expect(result.confidence).toBe(0.92);
    expect(result.razon).toBe("Pregunta directa por precio");
  });

  test("classify registra usage tokens en CostTracker post-call", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentClassifierLLM({
      model: makeMockModel(
        { intent_nombre: "saludo", confidence: 0.8, razon: "ok" },
        { input: 1_000_000, output: 500_000 },
      ),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await llm.classify(baseInput);

    // gpt-4o-mini: 0.15 + 0.30 = 0.45 USD
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.45, 5);
  });

  test("classify acepta intent_nombre null (sin match)", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentClassifierLLM({
      model: makeMockModel({
        intent_nombre: null,
        confidence: 0.3,
        razon: "Ningún candidate matchea",
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.classify(baseInput);
    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0.3);
  });

  test("classify lanza si LLM devuelve JSON incompatible con schema", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentClassifierLLM({
      // confidence > 1 viola schema (max(1)).
      model: makeMockModel({ intent_nombre: "x", confidence: 99 }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });
    await expect(llm.classify(baseInput)).rejects.toThrow();
  });
});
