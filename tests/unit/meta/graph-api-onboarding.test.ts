import { describe, expect, test, vi } from "vitest";
import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";
import { GraphApiOnboardingClient } from "@/server/services/meta/graph-api-onboarding";

const BASE = "http://127.0.0.1:55390";

function respuesta(status: number, cuerpo: unknown, comoTexto = false): Response {
  return new Response(comoTexto ? String(cuerpo) : JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": comoTexto ? "text/plain" : "application/json" },
  });
}

function cliente(fetchImpl: typeof fetch) {
  return new GraphApiOnboardingClient({
    graphApiVersion: "v26.0",
    appId: "1234",
    appSecret: "secreto-de-app",
    baseUrl: BASE,
    fetchImpl,
  });
}

describe("GraphApiOnboardingClient.canjearCodigo", () => {
  test("GET oauth/access_token con client_id, client_secret y code; devuelve el token", async () => {
    const f = vi.fn(async () =>
      respuesta(200, { access_token: "EAAG-negocio", token_type: "bearer" }),
    );
    const token = await cliente(f as unknown as typeof fetch).canjearCodigo("codigo-30s");
    expect(token).toBe("EAAG-negocio");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe("/v26.0/oauth/access_token");
    expect(u.searchParams.get("client_id")).toBe("1234");
    expect(u.searchParams.get("client_secret")).toBe("secreto-de-app");
    expect(u.searchParams.get("code")).toBe("codigo-30s");
    expect(init.method ?? "GET").toBe("GET");
  });

  test("la doc de Meta muestra la respuesta como el token solo, en texto: también se acepta", async () => {
    const f = vi.fn(async () => respuesta(200, "EAAGtokenPlano123", true));
    expect(await cliente(f as unknown as typeof fetch).canjearCodigo("c")).toBe(
      "EAAGtokenPlano123",
    );
  });

  test("código vencido o usado (400): ValidationError sin el secreto en el mensaje", async () => {
    const f = vi.fn(async () =>
      respuesta(400, { error: { message: "This authorization code has expired.", code: 100 } }),
    );
    const err = await cliente(f as unknown as typeof fetch)
      .canjearCodigo("c")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).not.toContain("secreto-de-app");
  });

  test("respuesta 200 sin token reconocible: ValidationError", async () => {
    const f = vi.fn(async () => respuesta(200, { algo: "otro" }));
    await expect(cliente(f as unknown as typeof fetch).canjearCodigo("c")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("red caída: InfraError", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(cliente(f as unknown as typeof fetch).canjearCodigo("c")).rejects.toBeInstanceOf(
      InfraError,
    );
  });
});

describe("GraphApiOnboardingClient — con el token del negocio", () => {
  test("numerosDeWaba lee id, número y nombre verificado con Bearer", async () => {
    const f = vi.fn(async () =>
      respuesta(200, {
        data: [
          {
            id: "106540352242922",
            display_phone_number: "+1 555-078-3881",
            verified_name: "Lucky Shrub",
          },
        ],
      }),
    );
    const numeros = await cliente(f as unknown as typeof fetch).numerosDeWaba(
      "102290129340398",
      "tok",
    );
    expect(numeros).toEqual([
      {
        id: "106540352242922",
        display_phone_number: "+1 555-078-3881",
        verified_name: "Lucky Shrub",
      },
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/v26.0/102290129340398/phone_numbers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  test("leerNumero pide is_on_biz_app y platform_type", async () => {
    const f = vi.fn(async () =>
      respuesta(200, { id: "1", is_on_biz_app: true, platform_type: "CLOUD_API" }),
    );
    const n = await cliente(f as unknown as typeof fetch).leerNumero("1", "tok");
    expect(n).toMatchObject({ id: "1", is_on_biz_app: true, platform_type: "CLOUD_API" });
    const [url] = f.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get("fields")).toContain("is_on_biz_app");
  });

  test("suscribirApp hace POST a subscribed_apps y exige success", async () => {
    const ok = vi.fn(async () => respuesta(200, { success: true }));
    await cliente(ok as unknown as typeof fetch).suscribirApp("999", "tok");
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/v26.0/999/subscribed_apps");
    expect(init.method).toBe("POST");

    const no = vi.fn(async () => respuesta(200, { success: false }));
    await expect(
      cliente(no as unknown as typeof fetch).suscribirApp("999", "tok"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("pedirSincronizacion manda sync_type y devuelve el request_id", async () => {
    const f = vi.fn(async () =>
      respuesta(200, { messaging_product: "whatsapp", request_id: "req-1" }),
    );
    const id = await cliente(f as unknown as typeof fetch).pedirSincronizacion(
      "1",
      "tok",
      "history",
    );
    expect(id).toBe("req-1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/v26.0/1/smb_app_data");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      sync_type: "history",
    });
  });

  test("429 de Meta: RateLimitError (reintentable)", async () => {
    const f = vi.fn(async () => respuesta(429, { error: { message: "too many", code: 4 } }));
    await expect(
      cliente(f as unknown as typeof fetch).pedirSincronizacion("1", "tok", "smb_app_state_sync"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
