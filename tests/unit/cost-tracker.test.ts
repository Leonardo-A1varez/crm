import { beforeEach, describe, expect, test } from "vitest";
import {
  InMemoryCostTracker,
  type CostTrackerConfig,
  type PricingTable,
} from "@/lib/observability/cost-tracker";

const PRICING: PricingTable = {
  "gpt-4o": { inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
};

function configWith(overrides: Partial<CostTrackerConfig> = {}): CostTrackerConfig {
  return {
    pricing: PRICING,
    dailyCapUsd: 10,
    now: () => new Date("2026-05-12T12:00:00Z"),
    ...overrides,
  };
}

describe("InMemoryCostTracker", () => {
  let tracker: InMemoryCostTracker;

  beforeEach(() => {
    tracker = new InMemoryCostTracker(configWith());
  });

  test("record + getDailySpendUsd suma cost del día", async () => {
    await tracker.record({ model: "gpt-4o", inputTokens: 1000, outputTokens: 500 });
    // 1000/1e6 * 2.5 + 500/1e6 * 10 = 0.0025 + 0.005 = 0.0075
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.0075, 6);
  });

  test("multiples records mismo dia se acumulan", async () => {
    await tracker.record({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 });
    await tracker.record({ model: "gpt-4o", inputTokens: 0, outputTokens: 1_000_000 });
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(2.5 + 10, 6);
  });

  test("records de distintos dias no se suman al pedir un día específico", async () => {
    const yesterday = new Date("2026-05-11T12:00:00Z");
    await tracker.record({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 0,
      at: yesterday,
    });
    await tracker.record({ model: "gpt-4o", inputTokens: 2_000_000, outputTokens: 0 });

    const today = await tracker.getDailySpendUsd(new Date("2026-05-12T00:00:00Z"));
    const yest = await tracker.getDailySpendUsd(yesterday);
    expect(today).toBeCloseTo(5, 6);
    expect(yest).toBeCloseTo(2.5, 6);
  });

  test("model sin pricing lanza error", async () => {
    await expect(
      tracker.record({ model: "modelo-fantasma", inputTokens: 100, outputTokens: 0 }),
    ).rejects.toThrow(/pricing/i);
  });

  test("exceedsCap false bajo límite", async () => {
    await tracker.record({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 });
    expect(await tracker.exceedsCap()).toBe(false);
  });

  test("exceedsCap true cuando spend ≥ dailyCapUsd", async () => {
    await tracker.record({ model: "gpt-4o", inputTokens: 4_000_000, outputTokens: 0 });
    expect(await tracker.exceedsCap()).toBe(true);
  });

  test("cap distinto por día (records ayer no cuentan hoy)", async () => {
    const yesterday = new Date("2026-05-11T00:00:00Z");
    await tracker.record({
      model: "gpt-4o",
      inputTokens: 5_000_000,
      outputTokens: 0,
      at: yesterday,
    });
    expect(await tracker.exceedsCap()).toBe(false);
    expect(await tracker.exceedsCap(yesterday)).toBe(true);
  });

  test("now() injection determinismo", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00Z");
    const t = new InMemoryCostTracker(configWith({ now: () => fixedNow }));
    await t.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 100 });
    const spend = await t.getDailySpendUsd();
    expect(spend).toBeGreaterThan(0);
  });

  test("record con sessionId/workflow no rompe contabilidad", async () => {
    await tracker.record({
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      sessionId: "sess-1",
      workflow: "on-message-received",
    });
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeGreaterThan(0);
  });
});
