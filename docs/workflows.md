# Workflows Inngest

> 6 functions definidas en `src/inngest/functions/`. Cada una = pure handler (testable) + factory binding (`makeXFn(deps)`). Real wireup deps en Slice 1 sub-paso 7.12.

> **Aplicado en el checkpoint QA:** `recordatorio-seguimiento` usa `cancelOn` por `recordatorioId + recordarAt`, y los escalados automáticos publican un aviso durable e idempotente. Tests unitarios verdes; falta observar ambos workflows en Inngest local sin enviar mensajes reales a Meta.

## Patrón factory + handler

```typescript
// Pure handler (testable con stubs in-memory)
export async function xHandler(input, deps): Promise<Result> { ... }

// Inngest binding produced via factory
export function makeXFn(deps: XDeps) {
  return inngest.createFunction(
    { id: "x", triggers: [{ event: xEvent }, { cron: "..." }] },
    async ({ event, step }) => {
      try {
        return await xHandler(input, deps, adaptInngestStep(step));
      } catch (e) {
        if (isNonRetriable(e)) throw new NonRetriableError(e.message, { cause: e });
        throw e;
      }
    },
  );
}
```

Factory raíz: `makeCrmInngestFunctions(deps)` consolida las 6. `route.ts` lo usa cuando hay deps reales.

## Inngest v4 API notes

- `createFunction(options, handler)` — 2 args. `triggers: [{event}|{cron}]` en options.
- Events tipados: `eventType("nombre", { schema: staticSchema<T>() })`. EventType instances pasadas en triggers.
- `step.run(name, fn)` memoiza. `name` único por function. Retornos serializables (Jsonify).
- `step.sleep("5m")` durable sleep.
- `step.sleepUntil(date)` durable sleep.
- `NonRetriableError` from `inngest` package — throws inside step.run para skip retry.

## Functions

### 1. `on-message-received` (R4 — 10 granular steps)

**Trigger:** `meta/message.received` event con `data: { parsed: ParsedMessage }`.

**Concurrency (B4):** `key: "event.data.parsed.meta_user_id"`, `limit: 1`. Serializa pipeline por lead Meta ID. Race protection resolve-lead/resolve-session cuando 2+ mensajes paralelos mismo lead. Detalle → `docs/database-tuning.md §7`.

**Stages:**

| #   | Step name           | Acción                                                                                                               |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `dedup`             | `findByMetaMessageId(parsed.meta_message_id)` → boolean isDuplicate                                                  |
| 2   | `resolve-lead`      | WA por telefono / IG-FB por meta_user_ids. Create placeholder si no existe                                           |
| 3   | `upsert-conv`       | `upsertByCanalThread(canal, threadId, leadId)`                                                                       |
| 4   | `resolve-session`   | `findActiveByLeadId` o crear default `(stage: nuevo, urgencia: media)`                                               |
| 5   | `record-inbound`    | `metaApi.recordInbound` (dedup interno por meta_message_id)                                                          |
| ↓   | **short-circuit**   | si isDuplicate → return con `duplicate: true, sent: false`. Skip stages 6-11.                                        |
| 6   | `classify`          | `intentClassifier.classify(parsed.contenido ?? "")`                                                                  |
| 7   | `build-turn`        | `listByConversacion(limit 10) → reverse → format`. Prefix `[Resumen previo]: ...` si `session.context_summary` (R10) |
| 8   | `respond`           | `aiAgent.respond({sessionId, conversationTurn, classification})`                                                     |
| 9   | `send`              | Si `source !== "handoff"`: `metaApi.sendOutbound` con `idempotencyKey: \`out:${meta_message_id}\`` (R2)              |
| 10  | `emit-turn`         | emit `turn.completed`                                                                                                |
| 11  | `emit-handoff-eval` | emit `auto-handoff.evaluate`                                                                                         |

**Logging (R5):** logger child bindings `{workflow, canal, meta_message_id}`. Events: `pipeline-start`, `dedup-hit`, `lead-created`, `session-created`, `classified`, `agent-decision`, `send-out`/`send-skipped`, `pipeline-complete`, `pipeline-error`.

### 2. `update-lead-twin`

**Trigger:** `lead-session/turn.completed` event con `data: { leadSessionId, conversationTurn }`.

**Acción:** wrap `twin-extractor.extract` — pure delegation. SessionLock (R3) serializa per session. LLM `generateObject({schema: LeadTwinUpdateSchema})`. Service:

- Short-circuit si sesión cerrada (no-op).
- `LeadTwinUpdateSchema.safeParse` defensa anti-alucinación LLM.
- Shallow merge `extras` (R9): `{...current.extras, ...patch.extras}`.
- Split `resultado/motivo_perdida` → invoca `close()`, resto via `update()`.

### 3. `detect-intents.batch` (cron weekly)

**Trigger:** `intents/detect.batch.requested` event O cron `0 3 * * 0` (domingo 3 AM).

**Acción:**

1. List `sessions.listClosedBefore(now)` filter `closed_at >= now-7d`.
2. Por cada session: `conversations.findByLeadId → messages.listByConversacion(limit 200) → filter by lead_session_id → collect contenidos`.
3. `IntentBatchDetectorLLM.detect({sessions: [{sessionId, leadId, messages}]})` → `DetectedIntent[]`.
4. Por cada proposal: si `intents.findByNombre(nombre)` null → create con `auto_detectado: true, activo: false`. Admin review obligatoria via UI (Slice 2).

**Window:** 7 días previos. Frecuencia weekly limita re-detección.

### 4. `auto-handoff`

**Trigger:** `lead-session/auto-handoff.evaluate` event con `data: { leadSessionId, recentClassifications, threshold? }`.

**Acción:**

1. Flag check `auto_handoff.enabled` (R7) — si off, return paused: false.
2. `handoff.evaluate({recentClassifications, threshold})` — puro, sin repo.
3. Si decision.pausar_ia → `handoff.pause(sessionId, decision.motivo)`.

**Default threshold:** 3 intents consecutivos `intent_nombre === null`.

### 5. `purge-old-sessions.cron`

**Trigger:** `sessions/purge.requested` event O cron `0 4 * * *` (daily 4 AM).

**Acción:**

1. `listClosedBefore(now - 29d)`.
2. Por cada candidate: `deps.purgeSession(id)` callback inyectable.

**Callback wireup Fase 14:**

- SQL `DELETE FROM lead_session WHERE id = $1` → CASCADE mensajes + tool_executions.
- Storage cleanup: signed URL list `comprobantes_pago` filtrar por session ref → delete batch.

### 7. `dispatch-outbox-events.cron` (B2 — at-least-once delivery)

**Trigger:** `outbox/dispatch.requested` event O cron `*/1 * * * *` (every minute).

**Acción:**

1. `outbox.listPending(batchSize=50)` retorna rows status='pending' + scheduled_at <= now ordenados ASC.
2. Por cada row: granular `step.run(emit-<id>)` → `inngestEmit({name, data, id?})`. Si succeed: `step.run(mark-sent-<id>)` → `markSent(id)`. Si fail: `step.run(mark-failed-<id>)` → `markFailedAttempt(id, error)` (sigue pending para next tick).
3. Return `{scanned, sent, failed}`.

**Razón existencia:** at-least-once delivery garantía. `EventBusService.publish` intenta direct dispatch optimista; si falla (Inngest down, network), row queda pending y este cron retries.

**Granular step.run:** memoización Inngest per row. Si proceso muere mid-batch, retry sigue desde row no procesada (no re-emit duplicados).

**Race tolerance:** múltiples cron ticks paralelos (raro Inngest single-flight per function id, pero pose):

- 2 ticks leen mismas pending rows.
- Tick A: emit + markSent OK.
- Tick B: tries emit (Inngest dedupe via `event_id` si presente; else dup event procesado downstream — caller debe ser idempotente).
- Tick B: markSent (idempotente, no-op si ya sent).

**Migration:** `20260512000014_event_outbox.sql`.

### 8. `detect-merge-candidates-per-lead` + `detect-merge-candidates-global`

**Trigger per-lead:** `lead/created` event (emit en `on-message-received` step `emit-lead-created` cuando `resolveLead` retorna `created=true`).

**Trigger global:** `merge-candidates/detect.requested` event O cron `0 5 * * *` (daily 5 AM).

**Acción per-lead:** `detector.findCandidatesFor({leadId})` → para cada proposal `detector.recordCandidate(p)` (idempotente: dup pending pair retorna null).

**Acción global:** `leads.list()` → filter `created_at >= now - 7d` → scan per-lead. Catch races perdidas del handler per-event.

**Heurística (R12):** nombre exacto case-insensitive + canales distintos + window 7d + sin conflicto de vehículo (marca/modelo distintos descarta).

**Resolve workflow (fase 10):** admin UI `/leads/[id]` lista pending → approve/reject. Approve ejecuta `MergeExecutorService.approveMerge` (audit-first, replay-safe: audit → fill-nulls ganador → reassign sesiones/convs → delete perdedor con CASCADE de candidates). Reject marca `rejected` y el detector no re-propone el par (`findAnyPair`). `leads.mergeInto` fue eliminado en fase 10 T3.

### 6. `reactivation-predictor.cron`

**Trigger:** `leads/reactivation.requested` event O cron `0 9 * * 1` (lunes 9 AM).

**Acción:**

1. Flag check `reactivation.enabled` (R7).
2. `listClosedBefore(now - 7d)` filter `resultado='perdido' AND closed_at >= now-60d AND closed_at < now-7d`.
3. Por cada lost session: `dispatches.findLatestBySessionId(sessionId)` → si `created_at` dentro cooldown (default 7d) → skip (`skippedCooldown++`). Sino → `deps.sendReactivation(...)` → `dispatches.create({template_name, meta_message_id, status})`.

**Migration:** `20260512000013_reactivation_dispatches.sql` (cooldown enforcement DB + audit history).

**Callback wireup Slice 4:** template Meta API dispatch segmentada por `motivo_perdida` (templates aprobados Meta requeridos). `sendReactivation` retorna `{templateName, metaMessageId, status}` para persist en `reactivation_dispatches`.

## Events catalog (`src/inngest/events.ts`)

| Event                                | Data                                                 | Origin                                                   | Trigger function                   |
| ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `meta/message.received`              | `{parsed: ParsedMessage}`                            | `/api/webhooks/meta` POST                                | `on-message-received`              |
| `lead-session/turn.completed`        | `{leadSessionId, conversationTurn}`                  | `on-message-received` step 10                            | `update-lead-twin`                 |
| `lead-session/auto-handoff.evaluate` | `{leadSessionId, recentClassifications, threshold?}` | `on-message-received` step 11                            | `auto-handoff`                     |
| `intents/detect.batch.requested`     | `{}`                                                 | manual o cron                                            | `detect-intents.batch`             |
| `sessions/purge.requested`           | `{}`                                                 | manual o cron                                            | `purge-old-sessions.cron`          |
| `leads/reactivation.requested`       | `{}`                                                 | manual o cron                                            | `reactivation-predictor.cron`      |
| `lead/created`                       | `{leadId, canal}`                                    | `on-message-received` resolve-lead (cuando created=true) | `detect-merge-candidates-per-lead` |
| `merge-candidates/detect.requested`  | `{}`                                                 | manual o cron daily 5 AM                                 | `detect-merge-candidates-global`   |
| `outbox/dispatch.requested`          | `{}`                                                 | manual o cron `*/1 * * * *`                              | `dispatch-outbox-events.cron`      |

## Retry semantics

Default: backoff exponencial, 4 retries. Configurable per function (Fase 7 si necesario).

`NonRetriableError` desde handler → skip retry, mark failed.

Mapping via `isNonRetriable()`:

- NotFound, Validation, PermissionDenied → NonRetriable.
- Conflict → retry-able (asume race tolerable).
- Network / timeout → retry default.

## Wireup deps (Slice 1 sub-paso 7.12)

`makeCrmInngestFunctions(deps)` espera `CrmInngestDeps`:

```typescript
{
  onMessageReceived: {
    leads, conversations, sessions, messages,
    metaApi, intentClassifier, aiAgent,
    emit, logger?,
  },
  updateLeadTwin: { twinExtractor },
  detectIntentsBatch: { sessions, conversations, messages, intents, detector },
  autoHandoff: { handoff, flags? },
  purgeOldSessions: { sessions, purgeSession, now? },
  reactivationPredictor: { sessions, sendReactivation, windowDays?, cooldownDays?, now?, flags? },
}
```

Real impls Slice 1:

- repos = `SupabaseXRepository` instances.
- LLMs = `OpenAI*` impls wrapping AI SDK + CostTracker middleware.
- `metaApi` con `MetaCloudApiClient` real.
- `logger` = `PinoLogger` con Vercel Log Drains.
- `flags` = `EdgeConfigFeatureFlags`.
- `emit` = `(e) => inngest.send({ name: e.name, data: e.data })`.
- `purgeSession` = SQL DELETE + Storage cleanup.
- `sendReactivation` = Meta template dispatch.

## Testing

Pure handlers testeables con stubs in-memory + spy step:

```typescript
class SpyStepRunner implements StepRunner {
  public readonly steps: string[] = [];
  async run<T>(name, fn) { this.steps.push(name); return fn(); }
}

const spy = new SpyStepRunner();
await onMessageReceivedHandler({ parsed }, deps, spy);
expect(spy.steps).toEqual([...10 step names]);
```

`@workflow/vitest` no aplica (no es WDK). Test integración real con Inngest Dev Server diferido a Slice 1.

## Inngest Dev Server (Slice 1)

```bash
npx inngest-cli@latest dev
```

Inspect runs: `http://localhost:8288`. Function registry pull desde `app/api/webhooks/inngest/route.ts`.

## Observability

- Inngest dashboard nativo: run history, retries, latencia per step.
- Vercel Logs: structured JSON via `PinoLogger` (Slice 1 sub-paso 7.9).
- Custom metrics: cost dashboard (Slice 1 sub-paso 7.14).
