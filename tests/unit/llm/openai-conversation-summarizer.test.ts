import { describe, expect, test } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiConversationSummarizerLLM } from "@/server/services/llm/openai-conversation-summarizer";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";

const MODEL_NAME = "gpt-4o-mini";
const SESSION_ID = "00000000-0000-0000-0000-000000000001";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

function makeMockModel(text: string, usage = { input: 500, output: 100 }) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
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

describe("OpenAiConversationSummarizerLLM", () => {
  test("summarize devuelve texto del LLM (sin schema parsing)", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiConversationSummarizerLLM({
      model: makeMockModel("Lead busca pastilla freno Corolla 2015. Precio cotizado $150k."),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.summarize({
      sessionId: SESSION_ID,
      history: ["lead: pastilla corolla 2015", "ia: $150.000 OEM"],
      previousSummary: null,
    });

    expect(result).toBe("Lead busca pastilla freno Corolla 2015. Precio cotizado $150k.");
  });

  test("summarize con previousSummary preserva contexto previo en prompt", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiConversationSummarizerLLM({
      model: makeMockModel("Resumen mergeado actualizado"),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.summarize({
      sessionId: SESSION_ID,
      history: ["lead: actualizo"],
      previousSummary: "Resumen previo existente",
    });
    expect(result).toBe("Resumen mergeado actualizado");
  });

  test("summarize permite history vacío (edge case)", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiConversationSummarizerLLM({
      model: makeMockModel(""),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.summarize({
      sessionId: SESSION_ID,
      history: [],
      previousSummary: null,
    });
    expect(result).toBe("");
  });

  test("summarize registra usage tokens en CostTracker con sessionId", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiConversationSummarizerLLM({
      model: makeMockModel("ok", { input: 3_000_000, output: 200_000 }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await llm.summarize({ sessionId: SESSION_ID, history: ["x"], previousSummary: null });
    // gpt-4o-mini: 0.45 + 0.12 = 0.57 USD
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.57, 5);
  });
});
