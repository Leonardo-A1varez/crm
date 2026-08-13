# Idempotency

> **Aplicado (2026-08-12):** handoff `source_event_key` único, aviso `handoff-notice:<handoffEventId>` y cancelación de recordatorio por `(recordatorioId, recordarAt anterior)`. La guarda de fecha en Postgres se mantiene como segunda barrera aunque Inngest cancele el workflow.

> Keys + dedup strategy por operación. Cada op replay-safe — Inngest puede reintentar sin side-effects duplicados.

## Principio

Inngest reintenta steps con backoff exponencial. Cada step debe ser **idempotente**: si se ejecuta N veces con mismo input, efecto observable = ejecutarlo 1 vez.

Strategies:

1. **Unique constraint en DB** — primer write gana, dup throws ConflictError, retry detecta y reuses.
2. **Pre-check existing** — read antes de write. Race condition tolerable si downstream sigue idempotente.
3. **Idempotency key column** — caller pasa key, repo enforces UNIQUE. R2 pattern para outbound.
4. **Read-only** — no side-effects.

## Operaciones críticas

### Inbound webhook → recordInbound

**Key:** `meta_message_id` (Meta nos da uno único por mensaje del lead).

**Mechanism:** `messages.findByMetaMessageId(id)` pre-check en `metaApi.recordInbound`. Si existe → return existing.

**Race tolerance:** Two webhook deliveries de Meta arrive en paralelo (raro pero posible) → ambos llegan a `recordInbound` → ambos `findByMetaMessageId` retornan null → ambos call `create` → segundo viola UNIQUE → PostgrestError `23505` → `mapPostgrestError` → `ConflictError` → Inngest retry → ahora `findByMetaMessageId` retorna existing → service short-circuits return existing.

**Migration:** `20260512000012_inbound_dedup.sql` — UNIQUE partial `mensajes(meta_message_id) WHERE meta_message_id IS NOT NULL`. Reemplaza el índice non-unique de 0003 (mismo predicado, lookups equality igual de rápidos). Parity garantizada in-memory ↔ Supabase via contract test `create rechaza meta_message_id duplicado (UNIQUE 0012)`.

### Outbound agent reply → sendOutbound (R2)

**Key:** `out:<inbound_meta_message_id>`. Cada inbound dispara máximo 1 outbound (1:1 mapping turn).

**Mechanism vigente (2026-08-13):**

1. `sendOutbound` busca una fila existente por key. Si existe, devuelve esa fila sin invocar Meta.
2. Si no existe, reserva primero el saliente en `mensajes` con `meta_message_id = null`.
3. Solo después llama a Meta y confirma la misma fila con el id devuelto.
4. `RateLimitError` significa rechazo explícito: libera la reserva para que el retry pueda reenviar.
5. `ValidationError` marca la reserva como fallida y no se reintenta.
6. `InfraError`, 5xx o resultado desconocido marcan la reserva como fallida. El retry encuentra la key y **no reenvía**.

No existe exactly-once contra una API remota sin idempotencia server-side. La decisión del producto es conservar una fila fallida y visible antes que arriesgar un WhatsApp duplicado e irretractable.

### Twin extractor (R3)

**Key prevista:** `twin:<sessionId>`.

**Estado real:** `SessionLock` existe, pero el extractor usa `NoopSessionLock` por defecto y no hay implementación Postgres. Por tanto, el single-flight durable todavía **no está resuelto**; los tests del lock in-memory no demuestran serialización entre instancias serverless.

**Race tolerance:** 2 `turn.completed` events para misma sesión en paralelo:

- Sin lock: ambos read session, ambos call LLM, ambos `sessions.update` → last-write-wins → loss intermediate state.
- Fix pendiente: mover la transición a una RPC transaccional o implementar un lock Postgres cuyo lock y writes compartan la misma transacción.

### Lead resolution (on-message-received)

**Key:** `(canal, meta_user_id)` pair.

**Mechanism:**

- WA: `leads.findByTelefono(meta_user_id)`. Si existe, use. Si no, `create`.
- IG/FB: `leads.findByMetaUserId(canal, meta_user_id)`. Si existe, use. Si no, `create` con telefono placeholder `${canal}:${id}`.

**Race tolerance:** 2 webhooks paralelos primer mensaje mismo lead → ambos `find` retornan null → ambos `create` → UNIQUE telefono violation en segundo → `ConflictError` → retry → `find` ahora ve row → return existing. **Retry safe.**

**Concurrencia aplicada:** `on-message-received` usa `concurrency.key = event.data.parsed.meta_user_id` con `limit: 1`. Las constraints UNIQUE siguen como barrera final ante otros productores o replays.

### Conversation upsert

**Key:** `(canal, canal_thread_id)`.

**Mechanism:** `conversations.upsertByCanalThread`. Throws `ConflictError(conv_belongs_other_lead)` si pair ya pertenece a otro lead. Race-safe via UNIQUE constraint Supabase.

### Active session resolution

**Key:** `(lead_id, resultado IS NULL)`.

**Mechanism:** `lead-session` UNIQUE partial index `(lead_id) WHERE resultado IS NULL`. Race: 2 webhooks crear sesión → primero gana, segundo throws `ConflictError(active_session_exists)` → retry → `findActiveByLeadId` retorna existing.

### Detect intents batch

**Key:** `intents.nombre` UNIQUE en `intents` table.

**Mechanism:** Service pre-check `intents.findByNombre(name)` antes de `create`. Si race, segundo create lanza ConflictError (UNIQUE), service ignora (skip).

### Purge sessions cron

**Key:** sessions ya borradas son no-existentes en next run.

**Mechanism:** `listClosedBefore(cutoff)` solo retorna no-purgadas. Re-run cron idempotente — list shrinks.

### Reactivation cron

**Key:** `(lead_session_id, latest dispatch created_at)`. Cooldown via DB lookup (no Date math sobre `closed_at`).

**Mechanism:** Migration `20260512000013_reactivation_dispatches.sql` agrega tabla `reactivation_dispatches` append-only. Handler antes de cada `sendReactivation`:

```
latest = dispatches.findLatestBySessionId(sessionId)
if latest && (now - latest.created_at) < cooldownMs: skip → result.skippedCooldown++
else: send + dispatches.create({...})
```

**Race tolerance:** 2 cron runs paralelos (raro) → ambos leen `latest=null` → ambos send → 2 dispatches rows. Mitigación: Inngest cron lock por function id (built-in single-run) + idempotency event `id: cron-YYYY-MM-DD`.

**History:** múltiples dispatches por sesión persisten (estrategia "3 intentos espaciados 30d" futura + analytics por motivo/template).

### Tool executions audit (R8)

**Mechanism:** Append-only. Cada call genera nueva row. No dedup needed. Si retry de `respond` step llama tool 2x → 2 rows. Diagnóstico ver duración + identificar dup.

### Admin actions audit (R11)

**Mechanism:** Append-only mismo patrón. UI debe deshabilitar botones tras click para evitar dup user actions.

### Merge candidates (R12)

**Key:** `(LEAST(src,dst), GREATEST(src,dst)) WHERE status='pending'` UNIQUE partial.

**Mechanism:** `findPendingPair(a,b)` orden-independiente. `recordCandidate` retorna `null` si pending existe (idempotente para `findCandidatesFor` re-runs).

La aprobación usa `approve_lead_merge(candidateId, keepLeadId)`: bloquea candidate y ambos leads en orden estable, valida sesiones activas, audita, reasigna conversaciones/sesiones/tags, rellena campos y borra el perdedor dentro de una sola transacción. Un fallo revierte todos los pasos; `auth.uid()` determina el actor.

## Inngest event sends

Inngest acepta event `id` deterministic para event dedup. **B2 outbox pattern integrado:** `EventBusService.publish` propaga `id` opcional al outbox row + emit Inngest. Pipeline emits pueden usar deterministic ids:

```typescript
await eventBus.publish({
  name: "lead-session/turn.completed",
  data: { leadSessionId, conversationTurn },
  id: `turn-completed:${session.id}:${parsed.meta_message_id}`,
});
```

Beneficios:

1. **Inngest deduplication** dentro de su window con mismo id.
2. **Outbox `event_id` column** facilita queries audit (e.g. `WHERE event_id LIKE 'turn-completed:%'`).
3. **Replay-safe** pipeline re-runs — mismo input genera mismo id, Inngest descarta dup.

### Outbox pattern (B2 — at-least-once delivery)

**Key:** Transactional outbox + cron retry.

**Mechanism:**

1. **Service emit obligatorio via `EventBusService.publish`** (no llamar `inngest.send` directo en services nuevos).
2. **`publish` persiste row en `event_outbox`** con status='pending'.
3. **Optimistic direct dispatch:** try `inngest.send`. Si succeed → `markSent`. Si fail → log + `markFailedAttempt` (sigue pending).
4. **Cron `dispatch-outbox-events`** (`*/1 * * * *`) poll pending → emit + markSent/markFailed.

**Race tolerance:**

- DB write success + Inngest emit fail = outbox row pending. Cron next tick retries.
- DB write success + Inngest emit success + markSent fail = row sigue pending. Cron retries → Inngest deduplica via event_id si presente. **Idempotency requiere event_id deterministic en pipelines críticos.**
- DB write fail = outbox row no persistido = no emit. Consistent.

**Migration:** `20260512000014_event_outbox.sql`.

**Tabla:**

| Columna      | Tipo             | Notas                                    |
| ------------ | ---------------- | ---------------------------------------- |
| id           | uuid PK          | gen_random_uuid                          |
| event_name   | text NOT NULL    | Inngest event name (e.g. `lead/created`) |
| event_data   | jsonb NOT NULL   | Payload                                  |
| event_id     | text NULL        | Optional dedup key                       |
| status       | text NOT NULL    | pending/sent/failed (CHECK)              |
| attempts     | int NOT NULL     | Counter retries                          |
| last_error   | text NULL        | Último error message                     |
| scheduled_at | timestamptz      | Default now(). Permite delayed dispatch. |
| sent_at      | timestamptz NULL | Set en markSent                          |
| created_at   | timestamptz      |                                          |

**Indexes:** partial `(status, scheduled_at) WHERE status='pending'` para fast cron poll. `(event_name)` para audit queries.

**Trade-offs:**

- **Pro:** garantía at-least-once. DB write/event consistency. Auditable.
- **Con:** +1 DB write per event. Latencia adicional (~milliseconds DB roundtrip). Para 1000 events/sec throughput → connection pool stress (mitigated via batched insert si necesario futuro).
- **Pilot tier (peak 50 msg/sec):** ~150-200 events/sec peak. DB overhead negligible.

**Cuando NO usar outbox:** eventos genuinely fire-and-forget sin consistency requirement (metrics, async cache invalidation no-critical). Para pipeline events críticos (turn.completed → twin update, lead/created → merge detection) outbox obligatorio.

## Resumen de keys por op

| Op               | Idempotency key                   | Storage                                          |
| ---------------- | --------------------------------- | ------------------------------------------------ |
| Inbound persist  | `meta_message_id`                 | `mensajes.meta_message_id` UNIQUE partial (0012) |
| Outbound persist | `out:<inbound_meta_message_id>`   | `mensajes.idempotency_key` UNIQUE partial        |
| Twin extract     | `twin:<sessionId>`                | `SessionLock`                                    |
| Lead resolve     | `(canal, meta_user_id)`           | `leads.telefono` UNIQUE / `meta_user_ids` jsonb  |
| Conv upsert      | `(canal, canal_thread_id)`        | UNIQUE constraint                                |
| Active session   | `lead_id`                         | partial UNIQUE `WHERE resultado IS NULL`         |
| Intent batch dup | `intents.nombre`                  | UNIQUE                                           |
| Merge candidate  | `(LEAST, GREATEST) pending`       | partial UNIQUE                                   |
| Outbox emit (B2) | optional `event_id` deterministic | Inngest event dedup + `event_outbox.event_id`    |
