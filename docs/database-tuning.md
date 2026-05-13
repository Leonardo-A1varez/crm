# Database Tuning — Supabase Postgres

> B4 baseline performance config. Aplicable per-instance cliente self-hosted. Re-tune cuando peak msg/sec sostenido > 20% del cap actual.

---

## 1. Connection pooling

### Modo recomendado: pgBouncer transaction mode

Supabase incluye pgBouncer automáticamente. Connection string variants:

| Modo                                      | Connection string suffix             | Uso                                                     |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Direct (port 5432)                        | (no suffix)                          | Migrations + admin queries puntuales. NO prod hot path. |
| Session pool (port 6543)                  | `?pgbouncer=true`                    | Connections largas (compat session-level features).     |
| **Transaction pool (port 6543, default)** | `?pgbouncer=true&connection_limit=1` | **Prod hot path.** Cada query checkout/return rápido.   |

**Para pilot tier (peak 50 msg/sec):**

- Supabase Pro = 60 connections direct + ilimitadas via pgBouncer transaction.
- Hot path repositories deben usar **transaction mode**.
- Inngest functions + API routes en `src/app/api/**` + RSC fetch usan transaction.

**Connection string pattern Vercel env:**

```bash
# Direct (migrations + admin)
SUPABASE_DIRECT_URL="postgresql://postgres:[PWD]@db.[REF].supabase.co:5432/postgres"

# Pooled (prod)
SUPABASE_POOLED_URL="postgresql://postgres:[PWD]@db.[REF].supabase.co:6543/postgres?pgbouncer=true&connection_limit=1"
```

### Pitfalls

- **PREPARE / DEALLOCATE statements** no soportados en transaction pool. `@supabase/supabase-js` no usa prepared, OK. ORM Drizzle/Prisma con prepared cache: configurar `prepare: false`.
- **LISTEN / NOTIFY** + advisory locks **inter-transaction** no funcionan en transaction mode. Supabase Realtime usa connection separada via WSS. Postgres advisory locks intra-transaction (`pg_advisory_xact_lock`) OK ✅ (R3 twin extractor lock funciona).
- **Long transactions saturan pool.** No transactions >2-3s en hot path.

---

## 2. Autovacuum tuning

Tablas hot (write-heavy) requieren autovacuum más agresivo que default. Aplicar **post Slice 1 7.1** (después de aplicar migrations):

```sql
-- mensajes: write-heavy (cada mensaje webhook → insert)
ALTER TABLE public.mensajes SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.025,
  autovacuum_vacuum_cost_delay = 10
);

-- lead_session: update-heavy (twin extractor patch + auto-stage)
ALTER TABLE public.lead_session SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.025
);

-- event_outbox: insert + update heavy (B2 cron poll)
ALTER TABLE public.event_outbox SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 5
);

-- tool_executions: append-only growing
ALTER TABLE public.tool_executions SET (
  autovacuum_vacuum_scale_factor = 0.1
);

-- admin_actions: append-only growing slower
ALTER TABLE public.admin_actions SET (
  autovacuum_vacuum_scale_factor = 0.2
);
```

**Defaults:**

- `autovacuum_vacuum_scale_factor = 0.2` (20% bloat triggers vacuum).
- Reducción a `0.05` = vacuum 4× más frecuente. Hot path benefitting.

**Monitor:**

```sql
-- Check autovacuum runs recientes
SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, n_dead_tup
FROM pg_stat_user_tables
WHERE relname IN ('mensajes', 'lead_session', 'event_outbox')
ORDER BY n_dead_tup DESC;
```

---

## 3. Indexes verificación post-migrations

`supabase db advisors` (CLI) o MCP `get_advisors` corre post `db push` para detectar:

- Missing indexes en queries comunes.
- Unused indexes (overhead write sin lectura).
- Duplicate indexes.
- RLS policy missing (post-Slice 3).

**Cadence:** ejecutar post cada major schema change + quarterly.

---

## 4. Partitioning futuro (post-pilot)

`mensajes` table crecerá linealmente con volumen:

- Pilot tier (peak 50 msg/sec, ~5K leads/mes, ~50K msgs/mes per cliente).
- 12 meses = ~600K msgs.
- Sin partitioning: queries cross-conversation lentas post 5M rows.

**Plan partitioning (Slice 4 si justifica):**

```sql
-- Convertir mensajes a partitioned por created_at MENSUAL
-- Esto requiere migration con table swap (downtime planeado).
CREATE TABLE mensajes_partitioned (
  -- same columns
) PARTITION BY RANGE (created_at);

CREATE TABLE mensajes_2026_06 PARTITION OF mensajes_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- ... etc
```

Trade-off: complexity backup + restore + foreign keys. Pre-launch evaluar si peak msg/día > 5K sostenido.

---

## 5. Read replicas

**Pilot tier:** no necesario.

**Mid-market tier (post-pilot):** Supabase Team plan incluye 1 read replica.

**Use cases read replica:**

- Inbox UI queries (`mensajes.listByConversacion`, `conversations.listRecent`).
- Analytics queries (`detect-intents.batch` historical).
- Cost dashboards.

**Mantener primary:**

- All writes.
- Realtime subscriptions (Supabase Realtime backend usa primary).
- Active session reads (consistency requirement).

**Implementación cuando aplicable (Slice 4+):**

```typescript
// src/server/db/client.ts (futuro)
export interface DbClientFactory {
  readReplica(): SupabaseClient; // read-only queries
  primary(): SupabaseClient; // writes + critical reads
  serviceRole(): SupabaseClient; // workflows
  authed(jwt: string): SupabaseClient; // app user-scoped
}
```

---

## 6. Query plan baseline (B4 — EXPLAIN ANALYZE)

Top queries a auditar post-Slice 1 7.4 (contract tests vs real Supabase):

| Query                                                    | Index esperado                                              | Target P95      |
| -------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| `findByMetaMessageId(id)` — dedup webhook                | `mensajes(meta_message_id) UNIQUE WHERE NOT NULL` (0012)    | <2ms            |
| `findByTelefono(phone)` — resolve lead WA                | `leads.telefono UNIQUE`                                     | <3ms            |
| `findActiveByLeadId(leadId)` — resolve session           | `lead_session(lead_id) UNIQUE WHERE resultado IS NULL`      | <2ms            |
| `listByConversacion(convId, limit=10)` — build turn      | `mensajes(conversacion_id, created_at DESC)`                | <5ms            |
| `listClosedBefore(date)` — purge cron                    | `lead_session.closed_at WHERE NOT NULL`                     | <50ms / 1K rows |
| `listPending(50)` outbox dispatcher                      | `event_outbox(status, scheduled_at) WHERE pending` (B2)     | <5ms            |
| `findLatestBySessionId(sessionId)` reactivation cooldown | `reactivation_dispatches(lead_session_id, created_at DESC)` | <3ms            |

**Validar con:**

```sql
EXPLAIN (ANALYZE, BUFFERS) <query>;
-- Si Seq Scan en tabla >100 rows = falta index.
-- Si rows estimated >> rows actual = stats stale, run ANALYZE.
```

Documentar resultados → `docs/query-plans.md` (Slice 1 7.4 output).

---

## 7. Inngest concurrency keys (race protection)

`on-message-received` factory ahora declara concurrency limit per `meta_user_id`:

```typescript
inngest.createFunction(
  {
    id: "on-message-received",
    concurrency: {
      key: "event.data.parsed.meta_user_id",
      limit: 1,
    },
    triggers: [{ event: messageReceived }],
  },
  // handler...
);
```

**Razón:** 2 webhook deliveries simultáneas del mismo `meta_user_id` (raro pero posible) podrían:

- Race resolve-lead → 2 leads creados (gana UNIQUE).
- Race resolve-session → 2 sessions creadas (gana UNIQUE).
- Doble outbound idempotency hit, gracias a UNIQUE pero gasta retries.

Concurrency key serializa. Cost: latencia adicional si lead activo manda 2 mensajes rápidos (improbable users humanos).

**Pilot tier impact:** insignificante. Mid-market+: monitor queue depth si peak > 100 msg/sec.

---

## 8. LLM context window cap

`conversation-summarizer.service.ts` ahora aplica threshold default:

```typescript
const DEFAULT_SUMMARY_THRESHOLD = 20; // turns antes de rolling summary
```

Cuando una sesión acumula 20+ turns:

1. Summarizer LLM genera `context_summary` reemplazando msgs antiguos.
2. `build-turn` step (on-message-received) prefix `[Resumen previo]: ...` antes de últimos N msgs.
3. Cost ahorro: ~80% input tokens evitados conversaciones largas.

**Tunable:** override per env config (`SUMMARY_THRESHOLD_TURNS`) en Slice 1 7.7.

---

## 9. Métricas a alertar (post Slice 1 7.7 observability)

| Métrica                         | Threshold warn      | Threshold critical |
| ------------------------------- | ------------------- | ------------------ |
| Postgres CPU                    | >70% sustained 5min | >85%               |
| Connection pool usage           | >70%                | >90%               |
| `pg_stat_activity` long queries | any >5s             | any >30s           |
| `event_outbox` pending count    | >100 sostenido      | >1000              |
| `event_outbox` attempts max     | >5                  | >10                |
| `mensajes` table dead tuples %  | >10%                | >25%               |
| LLM daily spend                 | >70% cap            | >95% cap           |
| P95 webhook→reply latency       | >3s                 | >8s                |

---

## 10. Re-tune cadence

- **Post-Slice 1 7.4:** EXPLAIN ANALYZE validation primer queries reales.
- **Post-pilot launch +30d:** Re-tune autovacuum según `pg_stat_user_tables`.
- **Cuando peak msg/sec sostenido > 20% cap:** revisar connection pool + indexes.
- **Pre-cada upgrade Supabase tier:** baseline pre/post comparison.
