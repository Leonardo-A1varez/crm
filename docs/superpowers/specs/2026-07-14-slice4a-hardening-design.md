# Slice 4a — Hardening pre-launch — Design Spec

> **Fecha:** 2026-07-14
> **Estado:** aprobado en diseño (pendiente review spec escrita)
> **Fase padre:** Slice 4 — cron real + hardening + launch. **Partido en 4a (hardening, verificable local) + 4b (deploy Vercel + soft launch, requiere creds reales).** Este spec cubre 4a.

---

## 1. Scope

### Qué hace

Observability prod-grade (Pino + Sentry + OTel), `/api/health`, CostTracker persistente (arregla kill-switch roto en serverless), y los 2 callbacks cron reales (purge de sesiones + reactivación predictiva). Todo verificable local: unit + integration + curl.

### Qué NO hace (→ Slice 4b)

- Deploy Vercel, dominio, webhook Meta público.
- Creds reales (META/OPENAI/INNGEST/UPSTASH/SENTRY) — el código queda env-gated y degradado sin ellas.
- Templates WhatsApp pre-aprobados por Meta (la reactivación fuera de ventana 24h los necesitará en prod; pilot usa texto libre dentro de ventana o falla con error Meta esperado).
- Soft launch 10 leads, monitores externos, penetration test (checklist threat model 4b).

### Decisiones tomadas (brainstorming 2026-07-14)

1. **4a/4b split:** hardening ahora sin bloquear por creds; launch cuando el usuario cargue `.env` real.
2. **Sentry DSN-por-env:** `SENTRY_DSN` opcional; ausente = disabled sin overhead. Cuenta free la crea el usuario en 4b.
3. **OTel vía `@vercel/otel`:** no-op local, capturado por Vercel en deploy. Spans custom solo en puntos calientes.
4. **CostTracker → Upstash Redis** (dep ya instalada por rate-limiter B3). Sin creds → InMemory + `logger.warn` (dev). `INCRBYFLOAT` atómico por día + TTL 48h.

### Tecnologías / deps nuevas (aprobadas)

| Dep              | Uso                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pino`           | Logger prod JSON stdout (Vercel Log Drains). Wrapper sobre la interface `Logger` propia — el resto del código no cambia. |
| `@sentry/nextjs` | Uncaught exceptions + unhandled rejections, client/server/edge.                                                          |
| `@vercel/otel`   | Registro OTel en `instrumentation.ts` + `@opentelemetry/api` para spans custom.                                          |

---

## 2. Arquitectura

### 10.1 PinoLogger + factory

- `src/lib/observability/pino-logger.ts` — `PinoLogger implements Logger` (info/warn/error/debug + `child(bindings)`). **`redactPii()` aplicado al merge bindings+ctx pre-emit, mismo contrato que `ConsoleLogger`** (test de paridad obligatorio).
- `src/lib/observability/get-logger.ts` — `getLogger(env)`: `NODE_ENV === "production"` → Pino, else → `ConsoleLogger`. Un singleton por proceso.
- Swap call sites que hoy hacen `new ConsoleLogger(...)`: webhook meta route, inngest bootstrap, inbox actions (`action-error.ts`), futuros. Los constructores siguen aceptando `Logger` inyectado (tests sin cambio).

### 10.2 Sentry

- `npx @sentry/wizard` NO (interactivo): archivos manuales — `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, hook en `instrumentation.ts` + `onRequestError`. `dsn: env.SENTRY_DSN` (nueva var **opcional** en `env.ts`); sin DSN Sentry queda disabled.
- `beforeSend`: `redactPii` sobre `event.extra` + `event.contexts`; jamás enviar `request.data` de webhooks (bodies con PII).
- `tracesSampleRate: 0` (tracing lo hace OTel; Sentry solo errores).

### 10.3 OTel

- `src/instrumentation.ts` — `registerOTel({ serviceName: "crm" })` de `@vercel/otel` + import de los config Sentry server/edge (conviven: Sentry per docs oficiales se registra en `instrumentation.ts` junto a OTel).
- `src/lib/observability/tracing.ts` — helper `withSpan(name, attrs, fn)` sobre `@opentelemetry/api` (trace.getTracer("crm")). Sin PII en attrs (ids OK, bodies NO).
- Spans custom: `webhook.meta.post`, `inngest.on-message-received.<step>` (wrap de los step.run existentes NO — demasiado invasivo; span por handler completo + LLM calls), `llm.<workflow>`, `meta.sendText`.
- Local/dev sin collector → no-op (comportamiento @vercel/otel).

### 10.4 /api/health

- `src/app/api/health/route.ts` — GET. Checks con timeout 3s c/u:
  - `db`: RPC `server_now()` con **client anon** (zones prohíben service-role en `app/**`; `server_now()` devuelve `now()`, cero data → mini-migration `grant execute ... to anon`). ok/fail = conexión+Postgres vivos.
  - `inngest`: si `INNGEST_SIGNING_KEY` placeholder (`dev-placeholder`) → `skipped`; real → GET `https://api.inngest.com/health` (reachability, no auth).
  - `openai`: si key placeholder → `skipped`; real → HEAD models endpoint.
- Respuesta `{ status: "ok" | "degraded" | "down", checks: {...}, version: commit sha env opcional }`. `down` (503) solo si DB falla; `degraded` (200) si algún check no-DB falla/skipped. Sin auth (monitores), sin data sensible; ya excluida del proxy (matcher excluye `/api`).
- Factory `makeHealthHandler(deps)` para tests DI (fetch + db inyectables).

### 10.5 CostTracker Upstash

- `src/lib/observability/upstash-cost-tracker.ts` — `UpstashCostTracker implements CostTracker`:
  - `record()`: computa USD (misma lógica pricing) → `INCRBYFLOAT cost:<YYYY-MM-DD> <usd>` + `EXPIRE 172800` (48h, idempotente).
  - `getDailySpendUsd()`: `GET cost:<day>` → float.
  - `exceedsCap()`: spend >= dailyCapUsd.
- Factory `makeCostTracker(cfg)`: creds Upstash presentes y no-placeholder → Upstash; else InMemory + `logger.warn("cost-tracker in-memory: daily cap NO persistente")`.
- Swap en `src/inngest/bootstrap.ts` (único lugar que hoy instancia `InMemoryCostTracker`).
- Unit: mock de `Redis` (interfaz mínima incrbyfloat/get/expire inyectable). Integration opcional si usuario carga Upstash free (no bloquea).

### 10.6 Purge real

- `LeadSessionRepository.delete(id)`: interface + InMemory + Supabase + contract test + integration. DELETE por id; CASCADE (migration 0003) borra mensajes + rule_executions. Idempotente: delete de id inexistente = no-op (no throw) — replay-safe.
- Storage cleanup: ANTES del delete, `messages.listBySessionId(id)` → recolectar `media_url` no-null → `storage.from("mensajes_media").remove(paths)` (paths derivados de media_url; si la URL no pertenece al bucket, skip + warn). Falla de storage NO aborta el purge (warn + continúa: quota huérfana < retención ilegal de PII).
- `makePurgeSession(deps)` real: `{ sessions, messages, storage, logger }`. El cron `purge-old-sessions` ya lista `listClosedBefore(now-29d)` y llama al callback per sesión con idempotency key existente.
- Tests: unit callback (InMemory repos + spy storage) + replay (doble purge no-op) + integration repo delete.

### 10.7 Reactivation real

- `src/inngest/callbacks/send-reactivation.ts` real. Input ya definido (`ReactivationSendInput`: leadId, motivo, dispatchId…— verificar shape exacto al implementar).
- Flow: `leads.findById` → conversación del canal preferido (más reciente actividad; fallback `canal_origen`) → si lead tiene sesión ACTIVA → skip (no molestar conversación viva) → template por `motivo_perdida` (tabla TS fija, español, 5 motivos + default) → `metaApi.sendOutbound({ sender: "ia", idempotencyKey: "react-<dispatchId>" })`.
- `reactivation_dispatches` row la persiste el cron existente (cooldown ya enforce); el callback solo envía. Verificar al implementar: quién escribe el dispatch row hoy (cron) y con qué estado.
- Sin conversación / canal sin config → warn + skip (no retry loop: `ValidationError` es non-retriable).
- Tests: unit con InMemory + spy metaApi (happy, skip-sesión-activa, sin-conversación, template por motivo, idempotencia vía key).

### Riesgos

| Riesgo                                             | Mitigación                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pino/Sentry/OTel conflicto en `instrumentation.ts` | Orden documentado: Sentry init dentro de instrumentation per docs `@sentry/nextjs` v8+; OTel `registerOTel` primero. Smoke: `npm run build` + dev boot sin warnings. |
| Redact regression en Pino                          | Test de paridad: mismo input → `PinoLogger` y `ConsoleLogger` redactan idéntico (snapshot de campos redactados).                                                     |
| Purge borra sesión equivocada                      | Solo ids provenientes de `listClosedBefore(now-29d)`; test de ventana en cron ya existe; delete por PK exacto.                                                       |
| Reactivación spamea lead activo                    | Check sesión activa → skip, test dedicado.                                                                                                                           |
| Health endpoint filtra info                        | Respuesta solo estados; sin versiones de deps, sin URLs internas, sin mensajes de error crudos (map a "fail").                                                       |

---

## 3. Estructura archivos

```
src/
├── instrumentation.ts                                [NEW] registerOTel + Sentry server/edge init
├── sentry.client.config.ts                           [NEW]
├── sentry.server.config.ts                           [NEW]
├── sentry.edge.config.ts                             [NEW]
├── lib/env.ts                                        [MOD] + SENTRY_DSN opcional
├── lib/observability/
│   ├── pino-logger.ts                                [NEW]
│   ├── get-logger.ts                                 [NEW] factory env-based
│   ├── upstash-cost-tracker.ts                       [NEW] + makeCostTracker factory
│   └── tracing.ts                                    [NEW] withSpan helper
├── app/api/health/route.ts                           [NEW] makeHealthHandler + GET
├── (migration) grant server_now() to anon            [NEW] supabase migration new slice4_health_grant
├── server/repositories/lead-session.repo.ts          [MOD] + delete(id)
├── server/repositories/lead-session.supabase.repo.ts [MOD] + delete(id)
├── inngest/bootstrap.ts                              [MOD] getLogger + makeCostTracker + callbacks reales
├── inngest/callbacks/purge-session.ts                [MOD] real
└── inngest/callbacks/send-reactivation.ts            [MOD] real + templates por motivo

tests/
├── unit/pino-logger.test.ts                          [NEW] paridad redact + shape JSON
├── unit/upstash-cost-tracker.test.ts                 [NEW]
├── unit/health-route.test.ts                         [NEW]
├── unit/purge-session-callback.test.ts               [NEW]
├── unit/send-reactivation-callback.test.ts           [NEW]
├── repositories/lead-session.contract.ts             [MOD] + delete cases
└── integration/lead-session.supabase.test.ts         [cubierto por contract]

package.json                                          [MOD] pino, @sentry/nextjs, @vercel/otel
```

Nota zones: `lib/observability` no importa server-db ✓ (cost tracker recibe Redis client inyectado, creado en bootstrap zona inngest).

## 4. Sub-pasos (cadencia §5)

| Sub-paso | Scope                                                                                | Validación                                                                              |
| -------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **10.1** | Pino + getLogger + swap call sites                                                   | Unit paridad redact; dev boot logs legibles; `NODE_ENV=production node -e` smoke JSON   |
| **10.2** | Sentry env-gated                                                                     | Build OK sin DSN; unit beforeSend redact                                                |
| **10.3** | OTel + withSpan + spans calientes                                                    | Build + dev boot sin warnings; spans no-op local                                        |
| **10.4** | /api/health                                                                          | Unit handler DI (db ok/fail, checks skipped) + curl local 200 `degraded` (placeholders) |
| **10.5** | UpstashCostTracker + factory + swap                                                  | Unit mock redis (record/get/cap/TTL) + warn fallback                                    |
| **10.6** | repo.delete + storage cleanup + purge real                                           | Contract+integration delete; unit callback + replay idempotente                         |
| **10.7** | Reactivation real + templates                                                        | Unit 5 escenarios                                                                       |
| **10.8** | Docs (AGENTS/next-session/threat-model delta/cost-budget nota) + `npm run ci` + push | CI verde                                                                                |

## 5. Out of scope explícito

Deploy/launch (4b), UI métricas de costo, alerting (Slack/email), retention configurable per cliente, Realtime, RTL.

---

**FIN SPEC.**
