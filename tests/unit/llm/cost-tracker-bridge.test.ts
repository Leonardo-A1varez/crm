import { describe, expect, test } from "vitest";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import { recordLlmUsage } from "@/server/services/llm/cost-tracker-bridge";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

describe("recordLlmUsage", () => {
  test("extrae usage tokens + persiste con model + workflow", async () => {
    const tracker = makeTracker();
    await recordLlmUsage(
      tracker,
      { usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      { model: "gpt-4o-mini", workflow: "intent-classification" },
    );

    // gpt-4o-mini: $0.15/M in + $0.60/M out → 0.15 + 0.30 = 0.45 USD
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.45, 5);
  });

  test("usage undefined cae a 0 tokens (record persiste con 0 USD)", async () => {
    const tracker = makeTracker();
    await recordLlmUsage(tracker, {}, { model: "gpt-4o-mini", workflow: "x" });
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBe(0);
  });

  test("inputTokens undefined parcial cae a 0", async () => {
    const tracker = makeTracker();
    await recordLlmUsage(
      tracker,
      { usage: { outputTokens: 100 } },
      { model: "gpt-4o-mini", workflow: "x" },
    );
    const spend = await tracker.getDailySpendUsd();
    // 0 input + 100/1M * 0.60 = 0.00006
    expect(spend).toBeCloseTo(0.00006, 8);
  });

  test("incluye sessionId cuando se pasa", async () => {
    const tracker = makeTracker();
    const sessionId = "00000000-0000-0000-0000-000000000001";
    await recordLlmUsage(
      tracker,
      { usage: { inputTokens: 10, outputTokens: 20 } },
      { model: "gpt-4o-mini", workflow: "ai-agent", sessionId },
    );
    // Smoke: no throws + record persisted (verificable via spend > 0).
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeGreaterThan(0);
  });
});
