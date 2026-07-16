import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

/**
 * Architecture zones (eslint-plugin-boundaries).
 *
 * Reglas duras (ver docs/architecture.md):
 *   - app/** → presentación. NO importar inngest/, server/repositories/, server/db/
 *   - components/** → UI puro. NO importar server/, inngest/
 *   - inngest/** → workflows. PUEDE importar server/services, server/repositories, lib
 *   - server/services/** → business logic. PUEDE importar server/repositories, lib
 *   - server/repositories/** → data access. PUEDE importar server/db, lib, types
 *   - server/db/** → clients (service-role aquí). PUEDE importar lib (env)
 *   - lib/** → utilidades cross-cutting. NO importar server/, inngest/, app/
 *   - types/** → puros. NO importar nada del proyecto
 */
const boundariesConfig = {
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      { type: "app", pattern: "src/app" },
      { type: "components", pattern: "src/components" },
      { type: "inngest", pattern: "src/inngest" },
      { type: "server-services", pattern: "src/server/services" },
      { type: "server-repositories", pattern: "src/server/repositories" },
      { type: "server-db", pattern: "src/server/db" },
      { type: "server-auth", pattern: "src/server/auth" },
      { type: "server-lock", pattern: "src/server/lock" },
      { type: "lib", pattern: "src/lib" },
      { type: "types", pattern: "src/types" },
      { type: "hooks", pattern: "src/hooks" },
      { type: "stores", pattern: "src/stores" },
    ],
    "boundaries/include": ["src/**/*"],
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true,
        project: "./tsconfig.json",
      },
    },
  },
  rules: {
    "boundaries/element-types": [
      2,
      {
        default: "disallow",
        rules: [
          {
            from: "app",
            allow: [
              "components",
              "server-services",
              "server-auth",
              "lib",
              "types",
              "hooks",
              "stores",
            ],
          },
          {
            from: "components",
            allow: ["components", "lib", "types", "hooks", "stores"],
          },
          {
            from: "inngest",
            allow: [
              "server-services",
              "server-repositories",
              "server-db",
              "server-lock",
              "lib",
              "types",
              "inngest",
            ],
          },
          {
            from: "server-services",
            allow: ["server-repositories", "server-lock", "lib", "types"],
          },
          {
            from: "server-repositories",
            allow: ["server-db", "lib", "types"],
          },
          {
            from: "server-db",
            allow: ["lib", "types"],
          },
          {
            from: "server-auth",
            allow: ["server-db", "lib", "types"],
          },
          {
            from: "server-lock",
            allow: ["lib", "types"],
          },
          {
            from: "lib",
            allow: ["lib", "types"],
          },
          {
            from: "hooks",
            allow: ["lib", "types", "stores"],
          },
          {
            from: "stores",
            allow: ["lib", "types"],
          },
          {
            from: "types",
            allow: ["types"],
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Convención TypeScript: prefijo `_` marca explicitly-unused (interfaces, stubs).
  // Suprime no-unused-vars solo para esos casos.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  boundariesConfig,
  // Seguridad PII (regla §0.9): prohibido console.* en src/**.
  // Razón: PII leak (telefono/email/mensaje.body) + logs no-estructurados.
  // Forzar uso de Logger interface (`src/lib/observability/logger.ts`).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  // Excepción: logger.ts es el sink legítimo (JSON structured → Vercel Log Drains).
  {
    files: ["src/lib/observability/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // Tests: relajar boundaries (acceden a internals para setup).
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "boundaries/element-types": "off",
    },
  },
  // Webhook endpoint Inngest = excepción legítima. Es el único punto donde
  // app/ monta el serve handler con el client + functions registry.
  {
    files: ["src/app/api/webhooks/inngest/route.ts"],
    rules: {
      "boundaries/element-types": "off",
    },
  },
  // Webhook entrante Meta (Slice 1 7.9): app/ debe importar inngest/client
  // para emit `meta/message.received` + lib/meta/* (HMAC + parser). Boundary
  // exception scoped a este file solo.
  {
    files: ["src/app/api/webhooks/meta/route.ts"],
    rules: {
      "boundaries/element-types": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
