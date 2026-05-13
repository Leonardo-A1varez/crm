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
