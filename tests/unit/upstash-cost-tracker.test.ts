import { describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { NoopLogger } from "@/lib/observability/logger";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import {
  UpstashCostTracker,
  makeCostTracker,
  type MinimalRedis,
} from "@/lib/observability/upstash-cost-tracker";

const PRICING = { "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 } };
const FIXED_NOW = () => new Date("2026-07-14T12:00:00Z");

function makeRedisMock() {
  const store = new Map<string, number>();
  const redis: MinimalRedis = {
    incrbyfloat: vi.fn(async (key: string, value: number) => {
      const next = (store.get(key) ?? 0) + value;
      store.set(key, next);
      return next;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    expire: vi.fn(async () => 1),
  };
  return { redis, store };
}

describe("UpstashCostTracker", () => {
  test("record computa USD por pricing e incrementa key del día con TTL", async () => {
    const { redis } = makeRedisMock();
    const tracker = new UpstashCostTracker(
      { pricing: PRICING, dailyCapUsd: 10, now: FIXED_NOW },
      redis,
    );

    await tracker.record({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 500_000 });

    // 1M in × 0.15 + 0.5M out × 0.6 = 0.15 + 0.30 = 0.45 (tolerancia float)
    expect(redis.incrbyfloat).toHaveBeenCalledWith("cost:2026-07-14", expect.closeTo(0.45, 10));
    expect(redis.expire).toHaveBeenCalledWith("cost:2026-07-14", 172_800);
  });

  test("model sin pricing lanza ValidationError", async () => {
    const { redis } = makeRedisMock();
    const tracker = new UpstashCostTracker(
      { pricing: PRICING, dailyCapUsd: 10, now: FIXED_NOW },
      redis,
    );

    await expect(
      tracker.record({ model: "gpt-fantasma", inputTokens: 1, outputTokens: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(redis.incrbyfloat).not.toHaveBeenCalled();
  });

  test("getDailySpendUsd parsea el acumulado; vacío = 0", async () => {
    const { redis, store } = makeRedisMock();
    const tracker = new UpstashCostTracker(
      { pricing: PRICING, dailyCapUsd: 10, now: FIXED_NOW },
      redis,
    );

    expect(await tracker.getDailySpendUsd()).toBe(0);
    store.set("cost:2026-07-14", 3.75);
    expect(await tracker.getDailySpendUsd()).toBe(3.75);
  });

  test("exceedsCap true cuando spend >= cap", async () => {
    const { redis, store } = makeRedisMock();
    const tracker = new UpstashCostTracker(
      { pricing: PRICING, dailyCapUsd: 5, now: FIXED_NOW },
      redis,
    );

    store.set("cost:2026-07-14", 4.99);
    expect(await tracker.exceedsCap()).toBe(false);
    store.set("cost:2026-07-14", 5);
    expect(await tracker.exceedsCap()).toBe(true);
  });
});

describe("makeCostTracker", () => {
  test("sin creds → InMemory + warn", () => {
    const warnSpy = vi.fn();
    const logger = new NoopLogger();
    logger.warn = warnSpy;

    const tracker = makeCostTracker({
      pricing: PRICING,
      dailyCapUsd: 10,
      logger,
    });

    expect(tracker).toBeInstanceOf(InMemoryCostTracker);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  test("creds placeholder → InMemory", () => {
    const tracker = makeCostTracker({
      pricing: PRICING,
      dailyCapUsd: 10,
      upstashUrl: "https://dev-placeholder.upstash.io",
      upstashToken: "dev-placeholder",
      logger: new NoopLogger(),
    });

    expect(tracker).toBeInstanceOf(InMemoryCostTracker);
  });

  test("creds reales → UpstashCostTracker", () => {
    const tracker = makeCostTracker({
      pricing: PRICING,
      dailyCapUsd: 10,
      upstashUrl: "https://real-instance.upstash.io",
      upstashToken: "AXt0token-real",
      logger: new NoopLogger(),
    });

    expect(tracker).toBeInstanceOf(UpstashCostTracker);
  });
});
