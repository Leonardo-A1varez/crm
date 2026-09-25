import { afterEach, describe, expect, test, vi } from "vitest";

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

describe("env estricto: claves HMAC de bajas de difusión", () => {
  const CLAVE_CORTA = Buffer.alloc(16, 9).toString("base64");
  const CLAVE_OK = Buffer.alloc(32, 9).toString("base64");

  function stubProduccion(claves: string | undefined, activa: string | undefined) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("INNGEST_EVENT_KEY", "e");
    vi.stubEnv("INNGEST_SIGNING_KEY", "s");
    vi.stubEnv("OPENAI_API_KEY", "o");
    vi.stubEnv("META_APP_SECRET", "m");
    vi.stubEnv("META_VERIFY_TOKEN", "v");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "1");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "t");
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    vi.stubEnv("LLM_DAILY_CAP_USD", "10");
    // `undefined` borra la var del entorno para este test.
    vi.stubEnv("DIFUSION_BAJAS_HMAC_CLAVES", claves);
    vi.stubEnv("DIFUSION_BAJAS_HMAC_VERSION_ACTIVA", activa);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("con claves válidas el boot pasa", async () => {
    stubProduccion(`1:${CLAVE_OK}`, "1");
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(env.DIFUSION_BAJAS_HMAC_VERSION_ACTIVA).toBe(1);
  });

  test("una clave corta tumba el boot sin mostrar la clave", async () => {
    stubProduccion(`1:${CLAVE_CORTA}`, "1");
    vi.resetModules();
    const error = await import("@/lib/env").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("DIFUSION_BAJAS_HMAC_CLAVES");
    expect(error?.message).not.toContain(CLAVE_CORTA);
  });

  test("una versión activa que no tiene clave tumba el boot", async () => {
    stubProduccion(`1:${CLAVE_OK}`, "2");
    vi.resetModules();
    await expect(import("@/lib/env")).rejects.toThrow(/versión activa/);
  });

  // Que falten apaga las bajas, no el panel: la obligación se exige donde se
  // usan (`hasherBajasDesdeEnv()`).
  test("sin las claves el boot pasa", async () => {
    stubProduccion(undefined, undefined);
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(env.DIFUSION_BAJAS_HMAC_CLAVES).toBeUndefined();
    expect(env.DIFUSION_BAJAS_HMAC_VERSION_ACTIVA).toBeUndefined();
  });

  test("declaradas vacías cuentan como ausentes y el boot pasa", async () => {
    stubProduccion("", "");
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(env.DIFUSION_BAJAS_HMAC_CLAVES).toBeUndefined();
  });

  test("las claves sin versión activa son una configuración a medias y tumban el boot", async () => {
    stubProduccion(`1:${CLAVE_OK}`, undefined);
    vi.resetModules();
    await expect(import("@/lib/env")).rejects.toThrow(/DIFUSION_BAJAS_HMAC_VERSION_ACTIVA/);
  });
});
