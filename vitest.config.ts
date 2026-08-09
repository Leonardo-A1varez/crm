import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "tests/integration/**", // Slice 1 7.4+: requieren Supabase real (npm run test:integration)
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        "src/types/**", // tipos puros, no ejecutables
        "src/app/**/page.tsx", // pages stub Fase 1 — Slice 2 implementa
        "src/app/**/layout.tsx",
        "src/app/**/route.ts", // route handlers stub
        "src/components/ui/**", // shadcn vendored
        "src/inngest/client.ts", // Inngest singleton trivial
        "src/server/repositories/*.supabase.repo.ts", // solo cubierto por integration suite (npm run test:integration)
        // Slice 2-3: UI client + actions + glue auth — cubiertos por validación
        // browser Playwright + suites de integración (RLS), no por unit (RTL
        // diferido por spec Slice 2 §1). Re-evaluar al agregar RTL.
        "src/components/inbox/**",
        "src/components/lead-twin/**",
        "src/components/shared/**",
        "src/components/auth/**",
        "src/components/productos/**", // fase 9: validados browser Playwright
        "src/components/leads/**", // fase 10: validados browser + E2E merge
        "src/app/**/_actions/**",
        // Misma política que src/components/**: UI validada en navegador, no
        // con unit tests. Vive bajo src/app/ y no src/components/ porque es
        // privada de una ruta, pero es UI igual.
        "src/app/**/_components/**",
        "src/app/**/error.tsx",
        "src/app/**/loading.tsx",
        "src/proxy.ts",
        "src/server/auth/**",
        "src/server/bootstrap/**",
      ],
      thresholds: {
        // Floor mínimo del proyecto. Subir según madurez (90% post Slice 4).
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
