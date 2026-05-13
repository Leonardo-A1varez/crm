# Changelog del proyecto

> Bitácora cronológica de decisiones y fases completadas. Para estado actual y reglas vivas, ver `AGENTS.md`.

---

## Pre-Slice 1 hardening (Camino A+) — 2026-05-12

Plan re-shape post-REPAIR. Objetivo: foundation enterprise-grade antes de wireup real (Slice 1). 10 sub-pasos, infra + DX + tooling.

### A1 — Migration 0012 inbound dedup

UNIQUE partial `mensajes(meta_message_id) WHERE NOT NULL` (reemplaza non-unique index de 0003). `InMemoryMessagesRepository.create` enforce parity con Supabase. 2 contract tests (dup rechazo + null coexistencia). `docs/idempotency.md` TODO resuelto.

### A2 — Migration 0013 reactivation_dispatches

Tabla append-only history-friendly (CASCADE con sesión). `ReactivationDispatch` entity + `ReactivationDispatchesRepository` interface + `Noop`/`InMemory` impls + 8 contract tests. Handler `reactivation-predictor.cron` refactor: cooldown vía DB lookup (no Date math sobre `closed_at`), retorna `{scanned, dispatched, skippedCooldown}`. 3 tests nuevos handler.

### A3 — sessions.close idempotent + db clients factory + IllegalStateError

`lead-session.repo.close()` ahora idempotente: mismo resultado/motivo → return existing sin throw (replay-safe Inngest retry). Resultado distinto → `IllegalStateError` (nueva class NonRetriable). 4 contract tests + 2 errors-integration tests actualizados. `src/server/db/client.ts` factory `makeDbClientFactory` + `defaultDbClientFactory` con zone rules service-role vs authed (real wireup Slice 1 sub-paso 7.3, ESLint enforcement A7). `src/lib/env.ts` stub (zod schema en A6).

### A4 — BudgetExceededError + merge-candidates detect

`BudgetExceededError` class (NonRetriable, kill switch LLM daily cap). `lead/created` + `merge-candidates/detect.requested` events. `detect-merge-candidates.ts` con 2 handlers (per-lead via event + global cron daily 5 AM 7d window). `on-message-received` emit `lead/created` post-resolve-lead. `makeCrmInngestFunctions` wireup 8 functions totales.

### A5 — CI GitHub Actions + coverage threshold

`.github/workflows/ci.yml`: job `quality` (typecheck + lint + test:coverage + format:check) + job `audit` (`npm audit --audit-level=high`). Cache npm + concurrency cancel-in-progress + 15min timeout. `@vitest/coverage-v8` instalado. Thresholds 80/75/80/80. Coverage actual: statements 89%, branches 85.6%, functions 85.7%, lines 90.3%. `npm run ci` end-to-end verde local.

### A6 — Pre-commit hooks + zod env validation

`lefthook.yml` (pre-commit: typecheck+lint-staged+vitest related; commit-msg: commitlint; pre-push: full test). `commitlint.config.cjs` extends conventional + español-friendly (subject-case=0, max 72). `.lintstagedrc.cjs` con eslint --fix max-warnings=0 + prettier --write. `prepare` script auto-instala hooks. `src/lib/env.ts` refactor: zod schema fail-fast en NODE_ENV != test, schema permisivo con defaults en test. `.env.local.example` agrega `LLM_DAILY_CAP_USD`.

### A7 — tsconfig strictness max + ESLint architecture rules

`tsconfig.json` agrega `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `forceConsistentCasingInFileNames`. Target ES2017→ES2022 (Error.cause, top-level await). Bug real surfaceado: `reactivation-dispatches.repo.findLatestBySessionId` accedía `rows[0]` sin check undefined post-sort → fix con guard. `tsconfig.tests.json` separado: tests permiten `noUncheckedIndexedAccess: false`. `eslint-plugin-boundaries` + 12 element zones + reglas allow/disallow. App/ NO importa inngest/server-repositories/server-db. Convention `_var` para unused args.

### A8 — Prettier + scripts task-runner

`prettier` + `prettier-plugin-tailwindcss`. `.prettierrc.json` (printWidth 100, trailing comma all, semi, double quotes, tailwindFunctions clsx/cn/cva/twMerge). `.prettierignore` excluye `types.gen.ts`, `.next`, `coverage`. Codebase formateado (28 files). Scripts task-runner first-class: `format`, `format:check`, `test:integration`, `db:push`, `db:gen-types`, `db:advisors`, `db:reset`, `inngest:dev`, `analyze`. CI agrega `format:check` step.

### A9 — AGENTS.md slim + docs/changelog.md + README product-only

Documentación reorganizada para contexto óptimo en agentes IA. `AGENTS.md` 631→269 líneas (-57%): reglas oro + estado actual + convenciones + qué NO hacer + glosario. `README.md` 658→184 líneas (-72%): visión + qué hace/no + stack high-level + cómo correr + glosario; schema tablas removidas (→ `docs/data-model.md`), arquitectura detallada removida (→ `docs/architecture.md`), plan implementación detallado removido (→ `AGENTS.md §2`). `docs/changelog.md` nuevo: histórico completo Fases 0-6 + REPAIR R1-R12 + Pre-Slice 1 hardening + decisiones cronológicas.

### A10 — Dep update audit

Inngest pinned exact `4.4.0`. Zod pinned exact `4.4.3` (vs caret). Patch updates: react/react-dom 19.2.4→19.2.6, @types/node 20.19.40→20.19.41. Override `protobufjs ^8.2.0` resuelve 7 high-severity vulns (Inngest→opentelemetry chain): DoS + code injection + prototype pollution + unbounded recursion. Audit baseline: 17 vulns → 2 moderate (postcss <8.5.10 via Next 16, accepted risk — fix requiere Next downgrade). `npm audit --audit-level=high` ✅ verde. CI workflow gate. `docs/dependency-audit.md` documenta pins + overrides + accepted risks + re-audit cadence (semanal + pre-Slice merge + quarterly majors).

### Pre-Slice 1 hardening — Estado final (10/10)

| Métrica             | Valor                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Tests               | **394/394 pass**                                                                                    |
| Test files          | 50                                                                                                  |
| Coverage statements | 89.07%                                                                                              |
| Coverage branches   | 85.88%                                                                                              |
| Coverage functions  | 85.76%                                                                                              |
| Coverage lines      | 90.44%                                                                                              |
| Typecheck errors    | 0 (dual config src + tests)                                                                         |
| Lint errors         | 0 (boundaries enforced, 12 zones)                                                                   |
| High audit vulns    | 0 (7 patched via override)                                                                          |
| Migrations escritas | 13 (0001-0013) NO aplicadas                                                                         |
| Inngest functions   | 8 (6 base + 2 merge detect)                                                                         |
| Error classes       | 6 (NotFound, Validation, PermissionDenied, IllegalState, BudgetExceeded, Conflict)                  |
| Tooling             | CI GitHub Actions + lefthook hooks + commitlint + Prettier + ESLint boundaries + coverage threshold |

**Foundation lista para Slice 1.** Siguiente: sub-paso 7.1 — crear Supabase project + preview branch + aplicar 13 migrations + `supabase gen types`.

---

## REPAIR phase R1-R12 — 2026-05-12

Gap-analysis post-Fase 6 detectó 25 carencias. REPAIR aborda 12 fundamentos antes de wireup real. Foundation lista para Slice 1 sin re-engineering.

| ID  | Componente                                                  | Migración | Files clave                                                  |
| --- | ----------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| R1  | Error class hierarchy + Inngest `NonRetriableError` mapping | —         | `lib/errors.ts` + refactor 8 repos + 3 services + 6 bindings |
| R2  | Outbound idempotency (column + UNIQUE partial + key gen)    | 0006      | `mensajes.idempotency_key` + `meta-api.sendOutbound`         |
| R3  | SessionLock single-flight (interface + InMemory)            | —         | `server/lock/session-lock.ts` + twin-extractor wrap          |
| R4  | Granular `step.run` (10 stages on-message-received)         | —         | `StepRunner` interface + `adaptInngestStep`                  |
| R5  | Logger interface (Noop + Console + child bindings)          | —         | `lib/observability/logger.ts` + DI handler                   |
| R6  | Cost tracker + daily cap kill switch                        | —         | `lib/observability/cost-tracker.ts`                          |
| R7  | Feature flags (Static + AllEnabled + EdgeConfig planned)    | —         | `lib/feature-flags.ts` + DI 3 sitios                         |
| R8  | Tool executions audit                                       | 0007      | `tool_executions` table + `ai-agent.invokeWithAudit`         |
| R9  | LeadSession `extras` jsonb (catch-all LLM fields)           | 0008      | column + Zod + twin shallow merge                            |
| R10 | Rolling conversation summary                                | 0009      | `context_summary` + `ConversationSummarizerService`          |
| R11 | Admin action audit log                                      | 0010      | `admin_actions` table + `AdminAuditService`                  |
| R12 | Lead merge auto-detector                                    | 0011      | `merge_candidates` table + `LeadMergeDetectorService`        |

**Patterns consolidados:**

1. **Error taxonomy** — `DomainError` abstract + `NotFoundError/ConflictError/ValidationError/PermissionDeniedError`. `isNonRetriable()` helper maps a Inngest.
2. **Idempotency** — Outbound key `out:<inbound_meta_message_id>`. Inbound dedup `meta_message_id`. Twin extract lock per sessionId.
3. **Defense-in-depth interfaces** — Externos detrás de interfaces: LLMs, Meta, Logger, CostTracker, FeatureFlags, SessionLock. Cada uno `Noop*` default + real impl Slice 1+.
4. **Granular step.run** — 10 etapas en `on-message-received`. Retry sin re-LLM. Memoización Inngest preservada.
5. **Audit trails** — `tool_executions`, `admin_actions`, `merge_candidates`.
6. **Feature flags integrados** — `ai_agent.enabled`, `auto_handoff.enabled`, `reactivation.enabled`.

**Migrations finales tras REPAIR:** 0001-0011 (11 archivos). +0012-0013 post Pre-Slice 1 = 13 totales.

**Validación final REPAIR:** `npm run typecheck` ✅ 0 errors. `npm test` ✅ **371/371 pass** (236 → 371, +135 tests, 0 regressions). 47 test files (24 nuevos durante REPAIR).

---

## Fases 0-6 (foundation mock-first) — 2026-05-10/12

### Fase 0 — Bootstrap

- Next.js **16.2.6** + React **19.2.4** + TypeScript **5** + Tailwind **v4** + 13 componentes shadcn + Vitest **4.1.5**.
- Sub-pasos 0.1–0.13: carpeta, create-next-app, git init, deps prod/dev, shadcn init + components, vitest config, tsconfig paths, scripts package.json, .env.local.example.
- Dev server validado en puerto **3001**.

### Fase 1 — Estructura carpetas + placeholders

- 37 directorios + ~55 archivos placeholder (pages, route stubs, services, repos, components, Inngest functions, lib stubs, docs).
- Rename `src/lib/openai/` → `src/lib/ai/` (coherencia AI SDK).
- Dynamic routes Next 16: `params` es `Promise<...>` → siempre `await params`.

### Fase 2 — Tipos TS + Zod schemas

- `src/types/domain.ts` — 11 enums string-literal const-arrays + tipos derivados (`(typeof X)[number]`).
- `src/types/entities.ts` — 12 interfaces TS + 3 helpers jsonb (`MetaUserIds`, `CompatibilidadEntry`, `MensajeMetadata`).
- `src/lib/validation/schemas.ts` — Zod 4.x schemas espejo entidades.
- `src/lib/validation/api.ts` — 8 schemas input HTTP.
- `src/lib/validation/ai.ts` — 6 schemas AI SDK (`LeadTwinUpdateSchema`, `BuscarRepuestoInputSchema`/`OutputSchema`, `IntentClassificationSchema`, `HandoffDecisionSchema`).

### Fase 3 — Migración SQL escrita (NO aplicada)

5 archivos en `supabase/migrations/`: `0001_init.sql`, `0002_intents_rules.sql`, `0003_messages.sql`, `0004_users_roles.sql`, `0005_storage_buckets.sql` (renombrados B1 a timestamp format `YYYYMMDDHHMMSS_<name>.sql`). Extensions pgcrypto + pg_trgm. 7 enums postgres + tablas + RLS enabled deny-all. Triggers `auth.users → public.usuarios`. Helpers `current_rol()`, `is_admin()`, `is_vendedor()`.

### Fase 4 — Repositories interface + impl in-memory + contract tests

**Patrón:** cada repo expone `interface XRepository` + `class InMemoryXRepository`. Contract tests `runXContract(makeRepo)` desacoplados de impl → reusables Slice 1 contra `SupabaseXRepository`. 9 repos creados. **109/109 tests verde, 10 test files.**

Review aplicada: 6 Critical deep-clone fix `meta_user_ids`, 1 Important `metadata` jsonb, 1 Minor mutación tests.

### Fase 5 — Services con lógica + mocks externos

**Patrón:** cada service expone `interface XService` + `class DefaultXService`. DI repos por constructor. Externos (LLM, Meta API) detrás de interface inyectable. 7 services creados: `catalog-matcher`, `intent-classifier`, `rule-engine`, `twin-extractor`, `handoff`, `meta-api`, `ai-agent`. **199/199 tests verde, 19 test files.**

Mocks: `FakeIntentClassifierLLM`, `FakeTwinExtractorLLM`, `FakeAgentLLM`, `FakeMetaApiClient`.

### Fase 6 — Workflows Inngest definidos

**Patrón:** cada workflow = `xHandler(input, deps)` puro testable + `makeXFn(deps)` binding Inngest. `inngest@4.4.0` API: `createFunction(options, handler)` + `eventType(name, {schema: staticSchema<T>()})`. 6 functions: `on-message-received`, `update-lead-twin`, `detect-intents.batch` (cron weekly), `auto-handoff`, `purge-old-sessions.cron` (cron daily 4 AM), `reactivation-predictor.cron` (cron weekly mon). **236/236 tests verde, 27 test files.**

---

## Changelog de decisiones (cronológico)

### 2026-05-10

- **LLM:** `openai` SDK directo → **Vercel AI SDK** (`ai` + `@ai-sdk/openai`). Razón: `generateObject` Zod-typed para Lead Twin, `tool()` con tipos derivados, multi-step `stopWhen`, swap provider trivial.
- **AI Gateway:** diferido a post-fase 11. Razón: tradeoff real (latencia + markup + vendor lock vs failover + cost caps). Migración futura = 1 línea (`gateway()` reemplaza `openai()`).
- **Puerto dev:** 3000 → **3001** (usuario usa 3000 en otro proyecto).
- **Plugins/skills:** todos los útiles instalados desde día 1.

### 2026-05-12

- **Contract tests pattern** adoptado: cada repo expone `runXContract(makeRepo)` reusable. Parity in-memory ↔ Supabase garantizada.
- **Deep-clone defensivo** obligatorio para jsonb fields (parity con Supabase que siempre retorna objetos nuevos).
- **UI/UX Fase 8 (notas previas):** performance > flourish. Distintivo: naranja industrial `#f97316`, tipografía simple, micro-interacciones sólo en acciones clave. Dark-first.
- **Fase 5/6 completas.** Interfaces inyectables consolidadas — Slice 1 = swap impl, no rewrite.
- **AI SDK pattern confirmado:** interfaces espejan API real esperada.
- **Defense-in-depth pattern:** classifier filtra pre-LLM + sanitiza post-LLM; rule-engine valida intent activo; twin-extractor re-parse Zod.
- **Service scope estricto:** `meta-api` solo comunica Meta + persiste mensajes. NO resuelve lead/upsert conv.
- **Inngest v4 API:** `createFunction({id, triggers:[{event}]}, handler)`. Events tipados `staticSchema<T>()`. Factory `makeCrmInngestFunctions(deps)` consolidado.
- **Cron schedules:** purge `0 4 * * *`, detect-intents `0 3 * * 0`, reactivation `0 9 * * 1`.
- **Callbacks inyectables Slice 4:** `purgeSession(id)` + `sendReactivation({sessionId, leadId, motivo})`.
- **REPAIR phase R1-R12 completa.** Error taxonomy + idempotency end-to-end + audit ampliado + feature flags + cost guards.
- **Pre-Slice 1 hardening A1-A8 completa.** CI + pre-commit + zod env + tsconfig strict++ + ESLint boundaries + Prettier + scripts task-runner.

---

## Decisiones bloqueadas post-REPAIR

- Outbound idempotency key: `out:<inbound_meta_message_id>`.
- Single-flight twin extractor: scope per-session, lock key `twin:<sessionId>`. Real impl Slice 1 = `pg_advisory_xact_lock(hashtext($1))`.
- Cost tracker: pricing por model en config. Daily cap kill switch via `dailyCapUsd`. Day key `YYYY-MM-DD` UTC.
- Feature flags catalog: 3 flags iniciales (`ai_agent`, `auto_handoff`, `reactivation`).
- Audit log catálogo: `ADMIN_ACTIONS.*` constants. 15 acciones identificadas.
- Merge detection heurística: nombre exacto case-insensitive + canales distintos + ventana 7d + vehicle no-conflict. Score 0.7 default.
- Rolling summary: trigger threshold deferido Slice 1.
- Granular step.run: 10 stages. `Jsonify<T>` adapter wrapper en binding.
