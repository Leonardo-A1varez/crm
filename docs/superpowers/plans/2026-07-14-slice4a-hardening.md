# Slice 4a — Hardening pre-launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Observability prod (Pino/Sentry/OTel) + `/api/health` + CostTracker persistente + purge y reactivación reales — todo verificable local.

**Architecture:** cada pieza respeta las interfaces existentes (`Logger`, `CostTracker`, callbacks DI de Inngest) para que el swap sea de factory, no de call sites de negocio. Env-gated: sin creds reales todo degrada explícito (warn/skipped), nunca silencioso.

**Tech Stack:** pino · @sentry/nextjs · @vercel/otel + @opentelemetry/api · @upstash/redis (ya instalada) · Vitest TDD.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-slice4a-hardening-design.md`.
- Español; Conventional Commits ≤72; commitlint body ≤100/línea.
- `redactPii` en TODO sink de logs (paridad ConsoleLogger↔PinoLogger testeada).
- `DomainError` jerarquía en `src/server/**`; sin `console.*` fuera del sink logger.
- Idempotency: purge replay-safe; reactivación key `react-<sessionId>` determinística.
- Cada task: typecheck+lint+tests verdes → commit.

---

### Task 1 (10.1): PinoLogger + getLogger + swap

**Files:** Create `src/lib/observability/pino-logger.ts`, `src/lib/observability/get-logger.ts`, `tests/unit/pino-logger.test.ts`. Modify call sites `new ConsoleLogger(` (grep: webhook meta route, inngest bootstrap, action-error.ts).

**Interfaces:** Produces `PinoLogger implements Logger` (ctor `(bindings?: LogContext, instance?: pino.Logger)`) · `getLogger(bindings?: LogContext): Logger` (prod→Pino, else→Console; singleton por proceso).

- [ ] Test paridad redact (RED): mismo `{telefono, mensaje, nested}` → campos redactados idénticos a ConsoleLogger; shape JSON con `level/msg/time`; `child()` mergea bindings.
- [ ] `npm i pino` + impl: pino base `{ base: undefined, timestamp: stdTimeFunctions.epochTime, formatters: { level: (label) => ({ level: label }) } }`; `emit` = `redactPii({...bindings,...ctx})` → `pino[level](redacted, msg)`. `child()` retorna PinoLogger con bindings mergeados (redact en emit, no en child — igual que Console).
- [ ] `get-logger.ts`: `process.env.NODE_ENV === "production" ? new PinoLogger(bindings) : new ConsoleLogger(bindings)`.
- [ ] GREEN + swap call sites a `getLogger({ scope: "..." })`.
- [ ] Commit `feat(obs): Slice 4a 10.1 PinoLogger + getLogger env-based`.

### Task 2 (10.2): Sentry env-gated

**Files:** Create `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (raíz src/ per convención Next), hook en `src/instrumentation.ts` (se crea en Task 3 — acá crear con solo Sentry y Task 3 agrega OTel si se ejecuta después; orden real: Task 2 y 3 tocan el mismo file, ejecutar 2→3). Modify `src/lib/env.ts` (+`SENTRY_DSN: z.string().url().optional()` + `NEXT_PUBLIC_SENTRY_DSN` espejo opcional).

**Interfaces:** Produces configs Sentry cargados vía `instrumentation.ts` `register()` + `onRequestError` export.

- [ ] `npm i @sentry/nextjs`.
- [ ] Configs: `Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: Boolean(process.env.SENTRY_DSN), tracesSampleRate: 0, beforeSend(event) { return redactSentryEvent(event); } })`. Helper `redactSentryEvent` en `src/lib/observability/sentry-redact.ts`: `redactPii` sobre `extra`/`contexts`/`request.data→undefined`. Client config usa `NEXT_PUBLIC_SENTRY_DSN`.
- [ ] Unit test `sentry-redact` (extra con telefono → redactado; request.data → removido).
- [ ] `npm run build` OK sin DSN (enabled=false).
- [ ] Commit `feat(obs): Slice 4a 10.2 Sentry env-gated + redact PII`.

### Task 3 (10.3): OTel + withSpan

**Files:** Create/Modify `src/instrumentation.ts` (registerOTel + import sentry server/edge por runtime), `src/lib/observability/tracing.ts`, `tests/unit/tracing.test.ts`. Spans en: `src/app/api/webhooks/meta/route.ts` POST, `src/server/services/llm/cost-tracker-bridge.ts` o cada OpenAI impl (elegir 1 punto común: bridge), `src/server/services/meta/graph-api-client.ts` sendText.

**Interfaces:** Produces `withSpan<T>(name: string, attrs: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T>` (status error + rethrow en throw).

- [ ] `npm i @vercel/otel @opentelemetry/api`.
- [ ] `instrumentation.ts`: `export async function register() { registerOTel({ serviceName: "crm" }); if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config"); if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config"); }` + `export const onRequestError = Sentry.captureRequestError` (import estático de @sentry/nextjs).
- [ ] `tracing.ts` withSpan con `trace.getTracer("crm")`, `setStatus({ code: SpanStatusCode.ERROR })` + `recordException` en catch, `span.end()` en finally. Test: fn ok → resultado; fn throw → rethrow.
- [ ] Wrap 3 puntos calientes (span names: `webhook.meta.post`, `llm.<workflow>`, `meta.sendText`; attrs ids/canal, sin body).
- [ ] `npm run build` + dev boot sin warnings.
- [ ] Commit `feat(obs): Slice 4a 10.3 OTel registerOTel + withSpan puntos calientes`.

### Task 4 (10.4): /api/health

**Files:** Create migration (`supabase migration new slice4_health_grant`: `grant execute on function public.server_now() to anon;`), `src/app/api/health/route.ts`, `tests/unit/health-route.test.ts`.

**Interfaces:** Produces `makeHealthHandler(deps: { checkDb: () => Promise<boolean>; inngestKey: string; openaiKey: string; fetchFn?: typeof fetch })` → `GET(): Promise<Response>`.

- [ ] Tests (RED): db ok + placeholders → 200 `{status:"degraded", checks:{db:"ok",inngest:"skipped",openai:"skipped"}}`; db fail → 503 `down`; keys reales + fetch ok → `ok`; fetch inngest fail → `degraded`.
- [ ] Impl: `isPlaceholder = (v) => v.includes("placeholder") || v.startsWith("test-")`; checks con `AbortSignal.timeout(3000)`; errores → "fail" (sin mensaje crudo). Default deps: `checkDb` = anon client (`createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)`) `.rpc("server_now")` sin error. Route runtime nodejs, `dynamic = "force-dynamic"`.
- [ ] `supabase db push` + curl local `http://localhost:3001/api/health` → 200 degraded.
- [ ] Commit `feat(ops): Slice 4a 10.4 /api/health + grant server_now anon`.

### Task 5 (10.5): UpstashCostTracker

**Files:** Create `src/lib/observability/upstash-cost-tracker.ts`, `tests/unit/upstash-cost-tracker.test.ts`. Modify `src/inngest/bootstrap.ts` (swap factory).

**Interfaces:** Produces `UpstashCostTracker implements CostTracker` (ctor `(config: CostTrackerConfig, redis: MinimalRedis)` con `interface MinimalRedis { incrbyfloat(k,v): Promise<number>; get(k): Promise<string | number | null>; expire(k,s): Promise<unknown> }`) · `makeCostTracker(cfg: CostTrackerConfig & { upstashUrl?: string; upstashToken?: string; logger: Logger }): CostTracker`.

- [ ] Tests (RED): record computa usd (pricing) + incrbyfloat key `cost:<YYYY-MM-DD>` + expire 172800; model sin pricing → ValidationError; getDailySpendUsd parsea; exceedsCap >= cap; factory sin creds/placeholder → InMemory + warn; con creds → Upstash.
- [ ] Impl + factory (`new Redis({url, token})` de `@upstash/redis` solo en rama real).
- [ ] Swap bootstrap: `makeCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: env.LLM_DAILY_CAP_USD, upstashUrl: env.UPSTASH_REDIS_REST_URL, upstashToken: env.UPSTASH_REDIS_REST_TOKEN, logger })`.
- [ ] Commit `feat(obs): Slice 4a 10.5 CostTracker Upstash persistente + factory`.

### Task 6 (10.6a): LeadSessionRepository.delete

**Files:** Modify `src/server/repositories/lead-session.repo.ts` (+interface+InMemory), `lead-session.supabase.repo.ts`, `tests/repositories/lead-session.contract.ts` (+2 cases: delete borra + delete inexistente no-op).

- [ ] Contract cases (RED en InMemory) → impl InMemory (`store.delete(id)`) → GREEN.
- [ ] Supabase impl: `.from("lead_session").delete().eq("id", id)` + mapPostgrestError.
- [ ] `npm run test:integration -- lead-session` verde. **OJO: la suite limpia la DB dev → re-seed fixtures browser después si hace falta.**
- [ ] Commit `feat(repo): Slice 4a 10.6 LeadSessionRepository.delete idempotente`.

### Task 7 (10.6b): purge-session callback real

**Files:** Modify `src/inngest/callbacks/purge-session.ts` + `src/inngest/bootstrap.ts` (deps nuevas). Create `tests/unit/purge-session-callback.test.ts`.

**Interfaces:** Produces `makePurgeSession(deps: { sessions: LeadSessionRepository; messages: MessagesRepository; removeMedia: (paths: string[]) => Promise<void>; logger: Logger })`. `removeMedia` inyectable (bootstrap la implementa con `db.storage.from("mensajes_media").remove(paths)`); paths = `media_url` que contengan `/mensajes_media/` → substring post-bucket, resto skip+warn.

- [ ] Tests (RED): purge borra sesión + llama removeMedia solo con paths del bucket; sin media → no llama; removeMedia throw → warn y el delete IGUAL ocurre; replay (2º purge) no-op sin throw.
- [ ] Impl + wire bootstrap.
- [ ] Commit `feat(inngest): Slice 4a 10.6 purge real con storage cleanup`.

### Task 8 (10.7): send-reactivation real

**Files:** Modify `src/inngest/callbacks/send-reactivation.ts` + bootstrap wire. Create `tests/unit/send-reactivation-callback.test.ts`.

**Interfaces:** Produces `makeSendReactivation(deps: { leads: LeadsRepository; sessions: LeadSessionRepository; convs: ConversationsRepository; metaApi: MetaApiService; logger: Logger })` → `(input: ReactivationSendInput) => Promise<ReactivationSendResult>`. Templates `Record<MotivoPerdida | "default", (nombre: string) => string>` español. Result: `{ templateName, metaMessageId, status: "sent" | "skipped" | "failed" }` (verificar valores exactos de `ReactivationDispatchStatus` en el repo antes de fijar).

- [ ] Tests (RED): happy → sendOutbound con canal de conv más reciente + `idempotencyKey: "react-<sessionId>"` + status sent; lead con sesión activa → skipped sin send; lead sin conversaciones → skipped + warn; motivo precio vs null → template distinto; metaApi throw ValidationError → failed sin rethrow (cron registra), throw InfraError → rethrow (retriable).
- [ ] Impl + wire bootstrap (reusa metaApi ya construido).
- [ ] Commit `feat(inngest): Slice 4a 10.7 reactivacion real templates por motivo`.

### Task 9 (10.8): docs + CI + push

- [ ] `docs/cost-budget.md`: nota tracker persistente Upstash + fallback dev. `docs/security-threat-model.md`: delta (Sentry/OTel sin PII, health sin leak). `AGENTS.md` §2 + tabla + métricas. `docs/next-session.md` (header, tabla 10.1-10.8, opciones → 4b launch checklist: creds + Vercel + Sentry DSN + Upstash + templates Meta + monitores + pen test).
- [ ] `npm run ci` verde + `npm test` + smoke dev boot.
- [ ] Commit docs + `git push`.

## Self-review

- Spec coverage: 10.1→T1 … 10.8→T9 ✓. Grant anon → T4 ✓. Paridad redact → T1 ✓. Riesgos spec mapeados a tests (replay T7, skip-activa T8, health sin leak T4).
- Consistencia nombres: `getLogger`/`makeCostTracker`/`makePurgeSession(deps)`/`makeSendReactivation(deps)` usados una sola vez cada uno; `MinimalRedis` local al tracker.
- Verificaciones runtime marcadas: valores `ReactivationDispatchStatus` (T8), convención archivos sentry config con Turbopack (T2/T3: si Next 16 exige otra ubicación, seguir el error del build), shape exacto de paths storage (T7).
