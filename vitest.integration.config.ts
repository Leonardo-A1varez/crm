import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

/**
 * Integration tests config (Slice 1 7.4+).
 *
 * Requiere env vars (typically en .env.local):
 *   SUPABASE_TEST_URL              (e.g. https://<dev-ref>.supabase.co)
 *   SUPABASE_TEST_SERVICE_KEY      service_role key del proyecto exclusivo de tests
 *
 * Vitest no auto-carga .env.local como Next.js. loadEnv del vite explicit.
 *
 * Tests corren SECUENCIALES (no parallel) — TRUNCATE entre tests requiere
 * aislamiento de DB para evitar races.
 *
 * NO incluido en `npm run ci` ni `npm test`. Trigger explícito:
 *   `npm run test:integration`
 */
export default defineConfig(({ mode }) => {
  // Load .env, .env.local, .env.<mode>, .env.<mode>.local. Sin prefix filter
  // (default vite filtra a VITE_*; "" allow all).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    test: {
      environment: "node",
      globals: true,
      include: ["tests/integration/**/*.test.ts"],
      exclude: ["**/node_modules/**"],
      fileParallelism: false, // sequential, single DB shared
      // Remote DB sobre red residencial: roundtrips 0.4-1s. Tests con 60
      // inserts secuenciales superan 30s. retry 1 absorbe `fetch failed`
      // transitorios de undici.
      testTimeout: 120_000,
      hookTimeout: 120_000,
      retry: 1,
      env: {
        SUPABASE_TEST_URL: env["SUPABASE_TEST_URL"] ?? "",
        SUPABASE_TEST_SERVICE_KEY: env["SUPABASE_TEST_SERVICE_KEY"] ?? "",
        // La guarda assertBaseDeTestsAislada compara SUPABASE_TEST_URL contra
        // esta: sin inyectarla, la guarda no puede ver la url de la app.
        NEXT_PUBLIC_SUPABASE_URL: env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
        // Suite RLS (Slice 3): clients authed reales necesitan la anon key.
        NEXT_PUBLIC_SUPABASE_ANON_KEY: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "",
        // Suite de contrato schemas↔OpenAI: valida que los schemas Zod que
        // mandamos sean aceptables para la API real. Sin key, esa suite skipea.
        OPENAI_API_KEY: env["OPENAI_API_KEY"] ?? "",
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
