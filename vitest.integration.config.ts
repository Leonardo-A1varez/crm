import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

/**
 * Integration tests config (Slice 1 7.4+).
 *
 * Requiere env vars (typically en .env.local):
 *   SUPABASE_TEST_URL              (e.g. https://<dev-ref>.supabase.co)
 *   SUPABASE_TEST_SERVICE_KEY      service_role key del proyecto dev
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
      testTimeout: 30_000,
      hookTimeout: 30_000,
      env: {
        SUPABASE_TEST_URL: env["SUPABASE_TEST_URL"] ?? "",
        SUPABASE_TEST_SERVICE_KEY: env["SUPABASE_TEST_SERVICE_KEY"] ?? "",
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
