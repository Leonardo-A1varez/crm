import { describe, expect, test } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiIntentBatchDetectorLLM } from "@/server/services/llm/openai-intent-batch-detector";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { IntentBatchDetectorInput } from "@/inngest/functions/detect-intents.batch";

const MODEL_NAME = "gpt-4o-mini";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

function makeMockModel(jsonArray: unknown[], usage = { input: 500, output: 200 }) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ intents: jsonArray }) }],
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

const baseInput: IntentBatchDetectorInput = {
  sessions: [
    {
      sessionId: "00000000-0000-0000-0000-000000000001",
      leadId: "00000000-0000-0000-0000-000000000010",
      messages: ["lead: cuanto sale pastilla freno", "ia: $150k", "lead: ok mando transferencia"],
    },
    {
      sessionId: "00000000-0000-0000-0000-000000000002",
      leadId: "00000000-0000-0000-0000-000000000011",
      messages: ["lead: precio amortiguador toyota", "ia: $80k"],
    },
  ],
};

describe("OpenAiIntentBatchDetectorLLM", () => {
  test("detect devuelve array de intents desde JSON del LLM", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentBatchDetectorLLM({
      model: makeMockModel([
        {
          nombre: "consulta_precio_repuesto",
          descripcion: "Lead pregunta precio de pieza específica",
          ejemplos: ["cuanto sale pastilla freno", "precio amortiguador toyota"],
        },
      ]),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.detect(baseInput);
    expect(result).toHaveLength(1);
    expect(result[0]?.nombre).toBe("consulta_precio_repuesto");
    expect(result[0]?.ejemplos).toHaveLength(2);
  });

  test("detect devuelve [] cuando LLM no encuentra patrón claro", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentBatchDetectorLLM({
      model: makeMockModel([]),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.detect(baseInput);
    expect(result).toEqual([]);
  });

  test("detect throws si element del array viola schema (ejemplos < 2)", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentBatchDetectorLLM({
      model: makeMockModel([{ nombre: "x", descripcion: "y", ejemplos: ["solo uno"] }]),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await expect(llm.detect(baseInput)).rejects.toThrow();
  });

  test("detect registra usage tokens en CostTracker", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiIntentBatchDetectorLLM({
      model: makeMockModel([], { input: 2_000_000, output: 500_000 }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await llm.detect(baseInput);
    // gpt-4o-mini: 0.30 + 0.30 = 0.60 USD
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.6, 5);
  });
});
