/**
 * Env vars validated runtime con zod. Fail-fast al boot si falta o tipo incorrecto.
 *
 * Reglas zone:
 *   - `NEXT_PUBLIC_*` accesibles browser. Resto solo server.
 *   - Service role NUNCA expuesto vía `NEXT_PUBLIC_*`.
 *   - Skip validation en test runtime (Vitest setea NODE_ENV='test'), evita
 *     bloquear suite por env ausente. Tests que necesiten valor real deben
 *     setear via `vi.stubEnv` o `.env.test`.
 *
 * Uso: `import { env } from "@/lib/env"; env.OPENAI_API_KEY`.
 *
 * Cuando agregues nueva var:
 *   1. Agregar entry al schema.
 *   2. Documentar en `.env.local.example`.
 *   3. Agregar a Vercel Project Settings (prod/preview/dev scopes).
 */

import { z } from "zod";

const isTest = process.env.NODE_ENV === "test";

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Inngest
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),

  // OpenAI (vía Vercel AI SDK)
  OPENAI_API_KEY: z.string().min(1),

  // Meta Cloud API
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  META_WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, "esperado v<major>.<minor>"),

  // LLM cost guard (string, parseFloat downstream)
  LLM_DAILY_CAP_USD: z.coerce.number().positive(),

  // Upstash Redis (B3 — rate limit webhook Meta + futuro cost-tracker prod)
  // Optional pilot tier dev; obligatorio prod (NoopRateLimiter en ausencia).
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Loose schema para tests: todos los campos opcionales con default vacíos.
 * No-op de runtime, evita Slice 1 fail al correr Vitest sin env real.
 */
const testEnvSchema = envSchema.partial().transform(
  (partial): AppEnv => ({
    NEXT_PUBLIC_SUPABASE_URL: partial.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: partial.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: partial.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role",
    INNGEST_EVENT_KEY: partial.INNGEST_EVENT_KEY ?? "test-event-key",
    INNGEST_SIGNING_KEY: partial.INNGEST_SIGNING_KEY ?? "test-signing-key",
    OPENAI_API_KEY: partial.OPENAI_API_KEY ?? "test-openai-key",
    META_APP_SECRET: partial.META_APP_SECRET ?? "test-meta-secret",
    META_VERIFY_TOKEN: partial.META_VERIFY_TOKEN ?? "test-verify",
    META_WHATSAPP_PHONE_NUMBER_ID: partial.META_WHATSAPP_PHONE_NUMBER_ID ?? "0",
    META_WHATSAPP_ACCESS_TOKEN: partial.META_WHATSAPP_ACCESS_TOKEN ?? "test-token",
    META_GRAPH_API_VERSION: partial.META_GRAPH_API_VERSION ?? "v21.0",
    LLM_DAILY_CAP_USD: partial.LLM_DAILY_CAP_USD ?? 10,
    UPSTASH_REDIS_REST_URL: partial.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: partial.UPSTASH_REDIS_REST_TOKEN,
  }),
);

function parseEnv(): AppEnv {
  if (isTest) {
    return testEnvSchema.parse(process.env);
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables. Fix .env.local o Vercel Project Settings:\n${issues}`,
    );
  }
  return parsed.data;
}

export const env: AppEnv = parseEnv();
