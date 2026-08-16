# Changelog del proyecto

> Bitácora cronológica de decisiones y fases completadas. Para estado actual y reglas vivas, ver `AGENTS.md`.

---

## Investigación Meta API — 2026-08-13

- Inventario negocio+técnico de WhatsApp Business Platform, Instagram API, Messenger/Pages, Marketing API, Business Management y capacidades emergentes, sin catálogo.
- Creado `docs/research/meta-api-capabilities-2026-08.md` con diagnóstico, permisos, disponibilidad, riesgos, matriz ROI, build-vs-buy frente a Meta Business Agent y roadmap M0–M4.
- Creado un ledger fechado de fuentes oficiales con versión/región/confianza; anuncios de rollout quedaron separados de contratos productivos.
- `meta-platform-limits.md` dejó atrás pricing por conversación, HSM, free tier viejo y límites comunitarios: documenta pricing por mensaje entregado, ventanas y permisos actuales.
- `meta-webhook-payloads.md` quedó reconciliado con el parser/cliente real y enumera contexto/media/eventos que hoy se descartan.
- Hallazgo central: solo WhatsApp está configurado; salida es text-only, media WA no se descarga e Instagram/Messenger pierden adjuntos, replies, reactions, postbacks y referrals.
- Prioridad recomendada: M0 versionado/health, WhatsApp media+replies+read/typing y un Flow de solicitud sin catálogo; implementar solo después de que el dueño elija capacidades.
- No se modificó código, schema, configuración, campañas, activos/tokens ni se enviaron mensajes. Tests no rerun por tratarse exclusivamente de documentación.

---

## Cierre de brechas de auditoría — 2026-08-13

- `sendOutbound` cambió de “Meta → INSERT” a “reserva DB → Meta → confirmación”. Los desenlaces desconocidos quedan visibles y no se reenvían; los 429 liberan la reserva.
- Los fallos de red del cliente Graph salen tipados como `InfraError`.
- La configuración de Vitest aborta antes de tocar la red si `SUPABASE_TEST_URL` coincide con la base de la app.
- `server_now()` recibió `search_path` seguro y la migración quedó aplicada en `crm-dev`.
- Se eliminó `CloseSessionButton`, que no tenía consumidores.
- La primera corrección del merge fue insuficiente: el service llamaba un `SessionLock`, pero producción inyectaba `NoopSessionLock`. Se reemplazó por `approve_lead_merge`, RPC `security invoker` que bloquea candidate/leads en orden estable y ejecuta validación, auditoría, reasignaciones y delete dentro de una transacción.
- Smoke admin no destructivo de `approve_lead_merge` verificado con `candidate_not_found`. El flujo completo contra Postgres queda para la base aislada de tests.
- `docs/workflows.md` reconstruido desde las 12 funciones/12 eventos reales; `docs/data-model.md` reconciliado con 38 migraciones; idempotencia, README y estado operativo corregidos.
- `20260813172558_fix_approve_lead_merge_lint.sql` elimina una variable muerta sin reescribir la migración aplicada; `db lint` remoto queda limpio y el smoke autenticado de `approve_lead_merge` continúa verde.
- Cierre verificado: 1617/1617 tests en 136 archivos, ambos typechecks, lint y formato verdes; 38/38 migraciones alineadas. No se corrieron integración ni build.
- No ejecutado: `test:integration`, build, mensajes Meta, QA visual ni benchmark representativo.

---

## Checkpoint QA — 2026-08-12

- Recuperado el Inbox: `db.rpc` conserva su contexto, `inbox_recent_messages` acota el read path y el coste de consultas queda constante con 20/60 leads.
- La consola del agente ya no depende del agregado completo del Inbox; el preview falla de forma local y no tumba configuración ni reglas.
- Handoff administrativo unificado mediante transición Postgres atómica, historial append-only sin PII, etapa previa restaurable y aviso durable idempotente para escalados automáticos. Pausas manuales sin envío.
- Recordatorios con cancelación Inngest por ID + fecha anterior al reprogramar, cancelar manualmente o recibir respuesta del cliente; guard de fecha en Postgres conservado.
- Perfil del lead editable con validación Zod, RLS, no-op sin write y auditoría que guarda únicamente nombres de campos. Identificadores de canal y teléfono siguen de solo lectura.
- `mensajes.platform_created_at` persiste la hora original de Meta. Métricas separan sin intervención, resueltas por IA, escaladas y tomadas; muestran medianas y cobertura sin convertir datos ausentes en cero.
- Correcciones de producto/UI: una sola puerta de cierre en el rail, búsqueda GET con botón y Enter, `Cerrar` localizado, plurales compartidos y logo eager.
- Respaldo lógico previo de esquema/datos y aplicación sin reset ni truncate de `20260812170131_inbox_active_summary.sql` y `20260812222808_qa_handoff_metrics.sql`; `crm-dev` queda en 35 migraciones.
- Verificación: 1595/1595 tests en 133 archivos, ambos typechecks, lint y formato. No se corrieron integración ni build.
- Pendiente: smoke autenticado de RPC, regeneración de tipos remotos, `EXPLAIN`, QA visual y base Supabase aislada para integración.

---

## Rediseño sala de control A-G2 — 2026-08-08 a 2026-08-12

- Base visual oscura, tokens semánticos, SideNav y shell del panel.
- Inbox de tres paneles, estados de entrega, triage, búsqueda y Lead Twin con procedencia/edición.
- Métricas en tres cortes, configuración versionada del agente y motor de intents/reglas/escalado.
- Dos revisiones de rama detectaron componentes sin consumidores y defectos de ancho que los tests de existencia no veían.
- Pendiente desde el cierre: comparación visual humana contra el prototipo y `/ajustes`, que no tiene diseño aprobado.

## Slice 4b — Cadena WhatsApp real local — 2026-08-07

- Outbound de plantilla e inbound por webhook Meta verificados mediante túnel efímero; pipeline completo creó lead, conversación, sesión, mensajes y tool executions, y respondió por WhatsApp.
- Corregido `INNGEST_DEV`, tres schemas incompatibles con Structured Outputs strict y variables opcionales vacías que rompían el arranque.
- Modelos LLM configurables por workflow y contrato opcional contra OpenAI real.
- Pendiente: catálogo/empresa reales, deploy estable, Sentry con DSN, templates propios, monitores y número productivo.

## Fase 10 Leads + Slice 3/4a — 2026-07-14 a 2026-07-16

- Leads: búsqueda/lista determinística, sesiones, merge manual/review, ficha, filtros y policies administrativas.
- Auth/RLS: panel autenticado, matriz de 43 policies y suite RLS real verificada en ese corte.
- Hardening: Pino con redacción, Sentry/OTel env-gated, `/api/health`, cost tracker Upstash, purge real y reactivación persistida.
- El merge inicial era replay-tolerant pero no transaccional; la carrera multi-tabla quedó cerrada recién el 2026-08-13.

## Slice 2 — Productos, Intents/Reglas, Tags y Métricas — 2026-07 a 2026-08

- Fase 9: CRUD/importación de productos con RLS y validaciones.
- Fase 11/G2: intents y reglas IF/THEN, clasificación auditable y handoff por reglas/guards.
- Fase 12/F: etiquetas administrables, métricas de embudo, IA y rendimiento con costo persistido en `llm_usage`.
- “Realtime” no se entregó: el Inbox permanece sobre `RefreshPoller` de cinco segundos.

---

## Slice 1 sub-paso 7.4 follow-up — 2026-05-14

### Fix vitest integration config

- Commit `369d708 fix(test): vitest integration config carga .env.local via loadEnv`.
- Razón: Vitest no auto-carga `.env.local` como Next.js. `loadEnv(mode, cwd, "")` del vite/config expone `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_KEY` al test runner sin prefix `VITE_*`.
- Estructura del config refactorizada a callback `defineConfig(({ mode }) => ({...}))` para acceder al mode.
- Hooks pre-commit verdes (typecheck + eslint + prettier + commitlint).

### Incidente — proyecto Supabase duplicado por error usuario

- Usuario creó proyecto Supabase secundario `xwcsovqhyclvdpoacgfh` (org `ootqtdmvehhflwgnyfql`, region West US, nombre default "pruevaservicios.efecto@gmail.com's Project") el 2026-05-14 03:41 UTC por error.
- Confusión al copiar credenciales: pegó `sb_secret_*` del proyecto nuevo en chat asistente (NO el del viejo crm-dev).
- Mitigación: usuario rotó `sb_secret_*` del proyecto nuevo. Secret comprometido invalidado.
- Decisión: descartar proyecto nuevo, seguir con `crm-dev` (`edlranjncwpxkyllopfa`, us-east-2) que ya tiene 15 migrations aplicadas + CLI linked.
- Pendiente usuario: borrar `xwcsovqhyclvdpoacgfh` desde dashboard (free tier 2 slots, ocupa uno innecesariamente).
- Aprendizaje: comunicación de credenciales en chat es riesgo. Recordatorio explícito en `docs/next-session.md` próxima sesión: secrets directo a `.env.local`, jamás pegar en chat.

### Estado integration tests piloto leads

- `.env.local` SIGUE PENDIENTE setup por usuario (acción que estaba pendiente pre-pausa 2026-05-13 sigue pendiente).
- Decisión confirmada: usar credenciales del viejo `crm-dev` `edlranjncwpxkyllopfa` (NO las del proyecto nuevo rotado).
- Sin `.env.local` verificado, no se procede a replicar pattern a 13 repos restantes (riesgo: propagar bug del pilot 13 veces).

---

## Slice 1 sub-pasos 7.1-7.4 piloto — 2026-05-13

### 7.1 — Supabase setup + 15 migrations

- Install Supabase CLI v2.98.2 via scoop.
- `supabase init` regenera `config.toml` proper (project_id="crm", db.major_version=17, db.pooler.pool_mode="transaction").
- Crear proyecto `crm-dev` en Supabase Cloud (region `us-east-2`, free tier).
- `supabase login` + `supabase link --project-ref=edlranjncwpxkyllopfa`.
- Fix bug B1: `COMMENT ON TABLE ... ||` string concat no soportado Postgres. Convertido a single-string literal en migrations 01 + 14.
- `supabase db push` aplica 14 migrations. Migration 15 nueva `20260512000015_fix_function_search_path.sql` fix advisor WARN.
- Re-run `db push` aplica migration 15. Advisors clean except `pg_trgm` extension WARN (defer Slice 4 documented threat-model).
- Validación: `supabase migration list --linked` muestra 15/15 aplicadas.

### 7.2 — config.toml audit

Auto-generated por `supabase init`. Auditado: defaults sanos, sin secrets hardcoded.

### 7.3 — DB client real wireup

- Install `@supabase/supabase-js@2.105.4` (pinned exact).
- `src/server/db/client.ts` reemplaza stub:
  - `AppClient = SupabaseClient<Database>`.
  - `serviceRole()` singleton bypass RLS.
  - `authed(jwt)` per-request con Bearer JWT.
- `tests/unit/db-client-factory.test.ts` 9 tests (singleton, isolation, reset).
- Pre-Slice 3: service-role obligatorio (RLS policies aún no escritas).

### 7.4 piloto — SupabaseLeadsRepository

- `src/server/repositories/leads.supabase.repo.ts` implementa `LeadsRepository` via Supabase JS.
- `src/server/db/postgrest-errors.ts` mapping 23505/42501/23502/23514 → DomainError.
- Integration test infrastructure (`tests/integration/`):
  - `setup.ts` makeTestSupabaseClient + cleanupTestDb (DELETE CASCADE-safe).
  - `leads.supabase.test.ts` usa `runLeadsContract(makeRepo)` reusable.
- `vitest.integration.config.ts` separate config + `loadEnv` para `.env.local` + sequential exec.
- `package.json` script `test:integration` ahora ejecuta vitest real.
- `.env.local.example` documenta `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_KEY`.
- `.gitignore` allow `.env.local.example` tracking (template, no secrets).
- Pattern establecido para 13 repos restantes (sub-pasos 7.4.X siguientes).

### Métricas post sesión 2026-05-13

- 432/432 unit tests pass (+9 db-client-factory tests).
- 14 integration tests SupabaseLeadsRepository (pending verify usuario local).
- 0 typecheck errors. 0 lint errors. Format clean.
- 16 deps prod (+@supabase/supabase-js).
- 15 migrations aplicadas Supabase `crm-dev`.
- 4 commits conventional history (initial foundation + 7.1-7.2 + 7.3 + 7.4 piloto).

---

## Pre-Slice 1 Industrial Hardening (Camino B+) — 2026-05-13

Plan re-shape post-A10 sesión 2026-05-13. Audit profundo detectó 47 issues across 10 categorías (product, stack, data model, security, performance, observability, testing, DX, architecture, business continuity). Camino B+ ajustado cubre 16 HIGH priority issues, 31 LOW/MEDIUM diferidos post-pilot.

### B0 — Lock business spec Pilot tier Latam

- Update `AGENTS.md §1` Resumen ejecutivo: white-label self-hosted per cliente, target Latam aftermarket parts (Brasil/México/Argentina/Chile/Colombia/Perú).
- Update `AGENTS.md §3` Decisiones Producto: tiers pilot/mediana/grande.
- Crear `docs/business-plan.md`: TAM $47-60B Latam + SAM 300-500 empresas + SOM Y3 30-80 clientes + ICP + competitive landscape + pricing.
- Crear `docs/meta-platform-limits.md`: WhatsApp tiers/quality/24h-window + Instagram DM tags + Messenger OTN + error codes 131xxx/132xxx + pricing per país.
- Crear `docs/data-retention.md`: compliance 6 países (LGPD/Ley 25.326/LFPDPPP/Chile 21.719/Colombia 1581/Perú 29.733) + right-to-erasure design + sub-processors disclosure + audit log obligatorio.

### B1 — Migration fixes pre-apply

- Rename 13 migrations a timestamp format `YYYYMMDDHHMMSS_<name>.sql` (Supabase CLI v2+ standard).
- `tags.color` CHECK regex hex `^#[0-9a-fA-F]{6}$` + default `#888888`.
- `empresas` table COMMENT documenta single-org constraint (keep, no DROP).
- C.1 `leads.telefono` split diferido post-pilot (documented data-model.md known issue).

### B2 — Outbox pattern + EventBus

- Migration 14 `20260512000014_event_outbox.sql` con `event_outbox` table + partial index pending + RLS enabled.
- `src/server/repositories/event-outbox.repo.ts` interface + Noop + InMemory + 9 contract tests.
- `src/server/services/event-bus.service.ts` `DefaultEventBusService.publish` optimistic direct dispatch + outbox fallback.
- `src/inngest/functions/dispatch-outbox-events.cron.ts` cron `*/1 * * * *` + manual trigger.
- Update `architecture.md` + `idempotency.md` + `workflows.md` + AGENTS.md inventory.
- 11 tests nuevos (6 contract + 4 service + 6 handler cron via passthrough step + factory).

### B3 — Security baseline

- Install `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0` (pinned exact).
- `src/lib/rate-limit/index.ts` interface + NoopRateLimiter + UpstashRateLimiter + makeRateLimiterFromEnv factory.
- 6 tests rate-limit unit.
- `next.config.ts` reemplazado por security headers strict: CSP (script-src self + Supabase/Meta/OpenAI), HSTS preload 2y, X-Frame-Options DENY, Referrer-Policy strict-origin, Permissions-Policy (no camera/mic/geo), X-Content-Type-Options nosniff.
- `scripts/verify-rls-policies.sh` CI gate: count `CREATE POLICY` ≥ `MIN_RLS_POLICIES` env (pre-Slice 3 = 0).
- `.github/workflows/ci.yml` agrega job `security` con `verify-rls-policies.sh`.
- Crear `docs/security-threat-model.md` STRIDE per componente + OWASP top 10 coverage + known issues `pg_trgm` deferred.
- Update `docs/dependency-audit.md` con Upstash entries pinned.
- Update `src/lib/env.ts` zod schema con UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN optional.
- Update `.env.local.example` Upstash section.

### B4 — Performance baseline

- Crear `docs/database-tuning.md`: pgBouncer transaction mode + autovacuum hints per table + query plan baselines + Inngest concurrency keys + read replicas Mid-market.
- `src/inngest/functions/on-message-received.ts` agregar `concurrency: { key: "event.data.parsed.meta_user_id", limit: 1 }` race protection.
- `src/server/services/conversation-summarizer.service.ts` agregar `DEFAULT_SUMMARY_THRESHOLD = 20` + `shouldSummarize(totalTurns)` helper + threshold configurable constructor.
- 3 tests nuevos summarizer threshold.

### B5 — Observability foundation

- Crear `docs/slo.md` SLI catalog (availability, latency, correctness, cost) + SLO targets pilot tier (webhook uptime 99.5%, webhook→reply P95 <3s, LLM classify P95 <1s, etc.) + alert thresholds critical/warn/info.
- Decision alert canal: Slack default (free tier 10K msgs/mes).
- Crear `docs/runbooks/cost-spike.md` LLM cost spike runbook.
- Crear `docs/runbooks/llm-down.md` LLM provider outage runbook + failover criteria.
- Crear `docs/runbooks/meta-rate-limit.md` Meta API rate limit / quality drop runbook.

### B6 — Business continuity

- Crear `docs/backup-strategy.md`: RPO 1h / RTO 4h pilot tier + Supabase Pro PITR + custom S3 weekly snapshots + restore procedures + drill cadence + multi-region DR Mid-market+.

### B+R — Re-baseline

- `npm run ci` end-to-end verde: typecheck 0 errors, lint 0 errors (boundaries deprecation warnings preexisting), format clean, **423/423 tests pass**.
- Coverage: statements 88.69% / branches 84.57% / functions 84.09% / lines 89.93% (todos sobre threshold 80/75/80/80).
- Update `AGENTS.md` §2 estado actual + inventory (migrations 14, Inngest 9 functions, repos 14, services 11) + tabla progreso.

### Cuando NO se hizo (deferred)

31 issues LOW/MEDIUM diferidos post-pilot launch:

- A.1 (PRD complete), A.2 (user research kanban), A.4 (foto-to-SKU v2), A.5 (reactivation A/B).
- B.1 (Realtime persistent path), B.2 (Inngest alternatives matrix), B.3 (AI SDK thin wrap), B.4 (Realtime channel cap), B.5 (shadcn/Tailwind v4 pin).
- C.2 (extras jsonb audit), C.3 (audit_log global), C.6 (merge heurística pg_trgm), C.7 (partitioning), C.8 (autovacuum runtime tuning).
- D.2 (service-role rotation), D.6 (2FA admin Slice 3), D.7 (STRIDE walkthrough completo Slice 3).
- E.1 (EXPLAIN ANALYZE Slice 1 7.4), E.2 (lock monitoring), E.3 (pgBouncer config Slice 1 7.7).
- F.1 (OTel tracing), F.2 (SLO ops review), F.3 (runbooks complete), F.4 (alert canal wireup Slice 1 7.7).
- G.2 (mutation testing), G.3 (property-based), G.4 (load testing Slice 4).
- H.1-H.5 (DX polish).
- I.1 (feature-based folders Slice 2), I.2 (RLS dual-mode), I.3 (event versioning), I.4 (CQRS).
- J.2 (multi-region DR), J.4 (postmortem template generic).

Listed en `docs/security-threat-model.md` + `docs/data-model.md` + relevant docs como known issues / technical debt.

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
