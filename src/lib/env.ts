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

  // Modo dev del SDK Inngest: rutea `inngest.send()` al dev server local
  // (localhost:8288) en vez de Inngest Cloud. Valor "1" o la URL del dev server.
  // NODE_ENV=development NO alcanza: con INNGEST_EVENT_KEY seteada el SDK asume
  // cloud, y una key dummy da 401 → el webhook Meta responde 500 y Meta reintenta.
  INNGEST_DEV: z.string().min(1).optional(),

  // OpenAI (vía Vercel AI SDK)
  OPENAI_API_KEY: z.string().min(1),

  // Modelo OpenAI. `OPENAI_MODEL` aplica a los 4 LLM auxiliares; los `_<WORKFLOW>`
  // pisan ese default por workflow. Sin ninguno, cae a DEFAULT_OPENAI_MODEL.
  // Todos deben existir en OPENAI_PRICING o `makeLlmFactory` falla al boot.
  // Razón del split: clasificador, extractor, resumidor y batch-detector llenan
  // un schema cada uno (modelo barato alcanza); el agente habla con el cliente.
  OPENAI_MODEL: z.string().min(1).optional(),
  // DEPRECADA (Task 8, provider de config): el modelo del agente ya no sale de
  // env, se configura en /agente (tabla agente_config, leída por turno via
  // AgentConfigProvider). Se mantiene en el schema por si alguien la tiene
  // seteada en su .env.local — no borrarla no la hace útil, seguir seteándola
  // simplemente no tiene efecto.
  OPENAI_MODEL_AGENT: z.string().min(1).optional(),
  OPENAI_MODEL_CLASSIFIER: z.string().min(1).optional(),
  OPENAI_MODEL_TWIN: z.string().min(1).optional(),
  OPENAI_MODEL_SUMMARIZER: z.string().min(1).optional(),
  OPENAI_MODEL_BATCH: z.string().min(1).optional(),

  // Meta Cloud API
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  META_WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, "esperado v<major>.<minor>"),

  // Meta IG + FB Messenger (opcionales pilot — WA-only puede arrancar sin estos).
  // Si missing, GraphApiMetaClient.sendText({canal:"ig"|"fb"}) throws ValidationError.
  // Activar cuando empresa cliente conecte cuentas IG Business + FB Page.
  META_IG_PAGE_ID: z.string().min(1).optional(),
  META_IG_ACCESS_TOKEN: z.string().min(1).optional(),
  META_FB_PAGE_ID: z.string().min(1).optional(),
  META_FB_PAGE_ACCESS_TOKEN: z.string().min(1).optional(),

  // LLM cost guard (string, parseFloat downstream)
  LLM_DAILY_CAP_USD: z.coerce.number().positive(),

  // LLM mode selector (Slice 1 7.7.A — DI factory).
  //   - "real"  → OpenAI impls (requiere OPENAI_API_KEY válida)
  //   - "mock"  → InMemory impls (responses deterministic, sin tokens)
  //   - default → "real" prod / "mock" tests (testEnvSchema)
  LLM_MODE: z.enum(["real", "mock"]).default("real"),

  // Upstash Redis (B3 — rate limit webhook Meta + cost-tracker prod 4a)
  // Optional pilot tier dev; obligatorio prod (NoopRateLimiter en ausencia).
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Sentry (Slice 4a 10.2) — opcional: sin DSN queda disabled sin overhead.
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
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
    INNGEST_DEV: partial.INNGEST_DEV,
    OPENAI_API_KEY: partial.OPENAI_API_KEY ?? "test-openai-key",
    OPENAI_MODEL: partial.OPENAI_MODEL,
    OPENAI_MODEL_AGENT: partial.OPENAI_MODEL_AGENT,
    OPENAI_MODEL_CLASSIFIER: partial.OPENAI_MODEL_CLASSIFIER,
    OPENAI_MODEL_TWIN: partial.OPENAI_MODEL_TWIN,
    OPENAI_MODEL_SUMMARIZER: partial.OPENAI_MODEL_SUMMARIZER,
    OPENAI_MODEL_BATCH: partial.OPENAI_MODEL_BATCH,
    META_APP_SECRET: partial.META_APP_SECRET ?? "test-meta-secret",
    META_VERIFY_TOKEN: partial.META_VERIFY_TOKEN ?? "test-verify",
    META_WHATSAPP_PHONE_NUMBER_ID: partial.META_WHATSAPP_PHONE_NUMBER_ID ?? "0",
    META_WHATSAPP_ACCESS_TOKEN: partial.META_WHATSAPP_ACCESS_TOKEN ?? "test-token",
    META_GRAPH_API_VERSION: partial.META_GRAPH_API_VERSION ?? "v21.0",
    META_IG_PAGE_ID: partial.META_IG_PAGE_ID,
    META_IG_ACCESS_TOKEN: partial.META_IG_ACCESS_TOKEN,
    META_FB_PAGE_ID: partial.META_FB_PAGE_ID,
    META_FB_PAGE_ACCESS_TOKEN: partial.META_FB_PAGE_ACCESS_TOKEN,
    LLM_DAILY_CAP_USD: partial.LLM_DAILY_CAP_USD ?? 10,
    LLM_MODE: partial.LLM_MODE ?? "mock",
    UPSTASH_REDIS_REST_URL: partial.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: partial.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: partial.SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_DSN: partial.NEXT_PUBLIC_SENTRY_DSN,
  }),
);

/**
 * dotenv setea `""` para toda línea `KEY=` sin valor. Zod `.optional()` acepta
 * `undefined` pero NO `""`, así que una var opcional simplemente declarada vacía
 * en `.env.local` — que es como las deja `.env.local.example` — tumba el boot con
 * un error que apunta al schema y no al archivo. Pasó con `UPSTASH_REDIS_REST_URL`
 * el 2026-08-07: "Invalid URL" sobre una var documentada como opcional.
 *
 * Normalizar `"" → undefined` antes de parsear hace que "declarada vacía" y
 * "ausente" signifiquen lo mismo, que es lo que espera cualquiera que edite el
 * archivo. Las requeridas siguen fallando igual, con mensaje "Required".
 */
function stripEmpty(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

function parseEnv(): AppEnv {
  if (isTest) {
    return testEnvSchema.parse(stripEmpty(process.env));
  }
  const parsed = envSchema.safeParse(stripEmpty(process.env));
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
