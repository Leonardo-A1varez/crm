import { describe, expect, test } from "vitest";
import { NoopRateLimiter, makeRateLimiterFromEnv, type RateLimiter } from "@/lib/rate-limit";

describe("NoopRateLimiter", () => {
  test("siempre permite", async () => {
    const rl = new NoopRateLimiter();
    for (let i = 0; i < 100; i++) {
      const r = await rl.limit(`key-${i}`);
      expect(r.success).toBe(true);
      expect(r.remaining).toBe(Number.POSITIVE_INFINITY);
    }
  });

  test("returns limit infinito", async () => {
    const rl = new NoopRateLimiter();
    const r = await rl.limit("test");
    expect(r.limit).toBe(Number.POSITIVE_INFINITY);
    expect(r.reset).toBeGreaterThan(Date.now());
  });
});

describe("makeRateLimiterFromEnv", () => {
  test("retorna Noop cuando faltan creds", () => {
    const rl = makeRateLimiterFromEnv({ url: undefined, token: undefined });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });

  test("retorna Noop cuando solo url presente", () => {
    const rl = makeRateLimiterFromEnv({ url: "https://x.upstash.io", token: undefined });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });

  test("retorna Noop cuando solo token presente", () => {
    const rl = makeRateLimiterFromEnv({ url: undefined, token: "abc" });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });

  test("retorna UpstashRateLimiter cuando ambos presentes", () => {
    const rl: RateLimiter = makeRateLimiterFromEnv({
      url: "https://test.upstash.io",
      token: "test-token",
      limit: 10,
      window: "1 s",
    });
    expect(rl).not.toBeInstanceOf(NoopRateLimiter);
    // No invocamos limit() porque no hay backend real; constructor wireup OK.
  });
});
