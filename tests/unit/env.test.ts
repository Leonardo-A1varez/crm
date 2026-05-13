import { describe, expect, test } from "vitest";

describe("env validation (zod fail-fast)", () => {
  test("env import en NODE_ENV=test devuelve defaults seguros", async () => {
    // El módulo se carga una sola vez por proceso. En NODE_ENV=test el schema
    // permisivo aplica defaults; aquí solo verificamos que existe y NO bota.
    const { env } = await import("@/lib/env");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeTypeOf("string");
    expect(env.NEXT_PUBLIC_SUPABASE_URL.length).toBeGreaterThan(0);
    expect(env.LLM_DAILY_CAP_USD).toBeTypeOf("number");
    expect(env.LLM_DAILY_CAP_USD).toBeGreaterThan(0);
    expect(env.META_GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
