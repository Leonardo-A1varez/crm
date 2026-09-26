import { afterEach, describe, expect, test, vi } from "vitest";
import type { NextConfig } from "next";

// El header tal como estaba antes de sumar el origen local de Supabase. Si este
// test se rompe con una URL de Supabase Cloud, cambió la CSP de producción.
const CSP_PRODUCCION = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://scontent.whatsapp.net https://scontent.cdninstagram.com",
  "media-src 'self' https://*.supabase.co https://scontent.whatsapp.net",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.openai.com https://graph.facebook.com wss://*.supabase.co",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

async function cargarConfig(env: Record<string, string | undefined>): Promise<NextConfig> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return (await import("../../next.config")).default;
}

async function csp(config: NextConfig): Promise<string> {
  const reglas = await config.headers!();
  const header = reglas[0]?.headers.find((h) => h.key === "Content-Security-Policy");
  if (!header) throw new Error("sin CSP");
  return header.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config — CSP", () => {
  test("con Supabase Cloud la CSP queda idéntica a la de producción", async () => {
    const config = await cargarConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
    });
    expect(await csp(config)).toBe(CSP_PRODUCCION);
  });

  test("sin URL de Supabase también queda idéntica", async () => {
    const config = await cargarConfig({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(await csp(config)).toBe(CSP_PRODUCCION);
  });

  test("con una URL que no parsea no inventa orígenes", async () => {
    const config = await cargarConfig({ NEXT_PUBLIC_SUPABASE_URL: "no es una url" });
    expect(await csp(config)).toBe(CSP_PRODUCCION);
  });

  test("con Supabase local suma su origen http y ws a connect-src, y nada más", async () => {
    const config = await cargarConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" });
    const valor = await csp(config);
    const connect = valor.split("; ").find((d) => d.startsWith("connect-src "));
    expect(connect).toBe(
      "connect-src 'self' https://*.supabase.co https://api.openai.com https://graph.facebook.com wss://*.supabase.co http://127.0.0.1:55321 ws://127.0.0.1:55321",
    );
    // El resto de las directivas no se toca.
    const sinConnect = (s: string) =>
      s
        .split("; ")
        .filter((d) => !d.startsWith("connect-src "))
        .join("; ");
    expect(sinConnect(valor)).toBe(sinConnect(CSP_PRODUCCION));
  });

  test("localhost y [::1] también cuentan como loopback", async () => {
    expect(
      await csp(await cargarConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })),
    ).toContain("http://localhost:54321 ws://localhost:54321");
    expect(
      await csp(await cargarConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://[::1]:54321" })),
    ).toContain("http://[::1]:54321 ws://[::1]:54321");
  });

  test("un host que solo empieza como loopback no pasa", async () => {
    const config = await cargarConfig({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1.evil.example:54321",
    });
    expect(await csp(config)).toBe(CSP_PRODUCCION);
  });
});

describe("next.config — distDir", () => {
  test("sin NEXT_DIST_DIR queda el default de Next", async () => {
    const config = await cargarConfig({ NEXT_DIST_DIR: undefined });
    expect(config.distDir).toBeUndefined();
  });

  test("NEXT_DIST_DIR lo cambia", async () => {
    const config = await cargarConfig({ NEXT_DIST_DIR: ".next-local" });
    expect(config.distDir).toBe(".next-local");
  });

  test("NEXT_DIST_DIR vacío es como ausente", async () => {
    const config = await cargarConfig({ NEXT_DIST_DIR: "" });
    expect(config.distDir).toBeUndefined();
  });
});

describe("next.config — tsconfigPath", () => {
  // Con otro distDir, `next dev` reescribe el tsconfig para sumarle los tipos
  // de ese directorio. El stack local le da uno propio y el tsconfig.json
  // trackeado no se toca.
  test("sin NEXT_TSCONFIG_PATH no se configura", async () => {
    const config = await cargarConfig({ NEXT_TSCONFIG_PATH: undefined });
    expect(config.typescript?.tsconfigPath).toBeUndefined();
  });

  test("NEXT_TSCONFIG_PATH lo cambia", async () => {
    const config = await cargarConfig({ NEXT_TSCONFIG_PATH: "tsconfig.stack-local.json" });
    expect(config.typescript?.tsconfigPath).toBe("tsconfig.stack-local.json");
  });
});
