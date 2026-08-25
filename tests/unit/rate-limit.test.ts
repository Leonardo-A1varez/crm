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

  // El fixture NO puede empezar con `test-` ni decir `placeholder`: desde que
  // la guarda comparte `esPlaceholder()` con el cost tracker, esos valores
  // degradan a Noop a proposito. Antes pasaban y por eso el bug de produccion
  // no se veia desde los tests.
  test("retorna UpstashRateLimiter cuando ambos presentes", () => {
    const rl: RateLimiter = makeRateLimiterFromEnv({
      url: "https://real-instance.upstash.io",
      token: "AX1sASQgY2Y2NmU5",
      limit: 10,
      window: "1 s",
    });
    expect(rl).not.toBeInstanceOf(NoopRateLimiter);
    // No invocamos limit() porque no hay backend real; constructor wireup OK.
  });
});

/**
 * Regresión de producción (2026-08-25). `UPSTASH_REDIS_REST_URL` valía
 * `https://placeholder.upstash.io` y la guarda de abajo sólo miraba si el
 * valor estaba vacío. Un placeholder ES una URL válida: pasaba el filtro, se
 * construía un cliente Redis contra un host inexistente, y el webhook de Meta
 * moría con `ENOTFOUND` → 500 → Meta reintentando el mismo mensaje en loop.
 *
 * `makeCostTracker` nunca tuvo el bug porque usa `esPlaceholder()`. La causa
 * de fondo era que esa función vivía privada en otro módulo y acá no se podía
 * usar; por eso ahora es compartida y no una copia.
 */
describe("makeRateLimiterFromEnv con placeholders", () => {
  test("un placeholder en la url degrada a Noop, no construye Redis", () => {
    const rl = makeRateLimiterFromEnv({
      url: "https://placeholder.upstash.io",
      token: "un-token-cualquiera",
    });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });

  test("un placeholder en el token degrada a Noop", () => {
    const rl = makeRateLimiterFromEnv({
      url: "https://real.upstash.io",
      token: "placeholder-token",
    });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });

  test("un valor de test degrada a Noop, igual que en el cost tracker", () => {
    const rl = makeRateLimiterFromEnv({
      url: "https://real.upstash.io",
      token: "test-token",
    });
    expect(rl).toBeInstanceOf(NoopRateLimiter);
  });
});
