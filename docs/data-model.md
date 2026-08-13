# Modelo de datos

> Espejo del modelo versionado en `supabase/migrations/`. Estado verificado el 2026-08-13: **38 migraciones locales y 38 aplicadas en `crm-dev`**, sin drift de timestamps. Detalle complementa `README.md §Modelo de datos`.

> **Aplicado en `crm-dev` (2026-08-12):** `mensajes.platform_created_at`, `lead_session.stage_before_handoff` y `handoff_events` entraron en la migración `20260812222808`. Los datos históricos ausentes permanecen en `null`; no hay backfill inventado.

## Migraciones (orden)

> **Naming convention:** `YYYYMMDDHHMMSS_<name>.sql` (Supabase CLI v2+ standard). Renombrado en B1 desde `0001`-`0013` para compat CLI moderno. Orden lógico preservado via timestamps secuenciales 2026-05-12 00:00:01-13.

| Orden | Migración                                                    | Contenido                                                                                                                               |
| ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | `20260512000001_init.sql`                                    | extensions (pgcrypto, pg_trgm) + 7 enums + empresas/usuarios/leads/productos/lead_session + RLS enabled + COMMENT empresas (single-org) |
| 02    | `20260512000002_intents_rules.sql`                           | enums respuesta_tipo/tag_source + intents/reglas/tags/lead_tags + CHECK hex `tags.color`                                                |
| 03    | `20260512000003_messages.sql`                                | enums direction/sender/tipo_mensaje + conversaciones/mensajes/rule_executions                                                           |
| 04    | `20260512000004_users_roles.sql`                             | schema `private` + trigger `auth.users → public.usuarios` + helpers RLS (`current_rol`, `is_admin`, `is_vendedor`)                      |
| 05    | `20260512000005_storage_buckets.sql`                         | 3 buckets privados (comprobantes_pago, productos, mensajes_media)                                                                       |
| 06    | `20260512000006_outbound_dedup.sql` (R2)                     | `mensajes.idempotency_key text` + UNIQUE partial `WHERE direction='out' AND idempotency_key IS NOT NULL`                                |
| 07    | `20260512000007_tool_executions.sql` (R8)                    | `tool_executions` table audit tool calls agente                                                                                         |
| 08    | `20260512000008_session_extras.sql` (R9)                     | `lead_session.extras jsonb DEFAULT '{}'` + GIN index                                                                                    |
| 09    | `20260512000009_session_summary.sql` (R10)                   | `lead_session.context_summary text`                                                                                                     |
| 10    | `20260512000010_admin_audit.sql` (R11)                       | `admin_actions` table audit acciones admin                                                                                              |
| 11    | `20260512000011_merge_candidates.sql` (R12)                  | `merge_candidate_status_enum` + `merge_candidates` table + UNIQUE partial pending pair                                                  |
| 12    | `20260512000012_inbound_dedup.sql`                           | UNIQUE partial `mensajes(meta_message_id) WHERE NOT NULL` (atomic inbound dedup, reemplaza non-unique index 0003)                       |
| 13    | `20260512000013_reactivation_dispatches.sql`                 | `reactivation_dispatches` table (cooldown enforcement DB + audit history, CASCADE con sesión)                                           |
| 14    | `20260512000014_event_outbox.sql` (B2)                       | `event_outbox` table transactional outbox pattern (at-least-once delivery) + partial index pending                                      |
| 15    | `20260512000015_fix_function_search_path.sql`                | Fix advisor WARN function_search_path_mutable: 4 funciones helpers públicas con `set search_path` explícito                             |
| 16    | `20260514000016_repo_helpers.sql`                            | RPC `server_now()` para timestamps server-side sin clock skew                                                                           |
| 17    | `20260714124024_slice3_rls_policies.sql`                     | Matriz RLS fail-closed por rol y policies de Storage                                                                                    |
| 18    | `20260714182011_slice4_health_grant.sql`                     | `GRANT EXECUTE server_now()` a `anon` para `/api/health`                                                                                |
| 19    | `20260715140738_leads_delete_admin.sql`                      | DELETE de leads solo para admin                                                                                                         |
| 20    | `20260716001443_admin_actions_insert_admin.sql`              | INSERT de auditoría administrativa solo para admin                                                                                      |
| 21    | `20260808213309_agente_config.sql`                           | Configuración versionada y append-only del agente                                                                                       |
| 22    | `20260810011500_mensajes_estado_entrega.sql`                 | Estado de entrega Meta y error del saliente                                                                                             |
| 23    | `20260810011600_lead_session_procedencia.sql`                | Procedencia JSON por campo del Twin; contrato ampliado por migración 25                                                                 |
| 24    | `20260810143000_turn_classifications.sql`                    | Auditoría de clasificaciones de turnos resueltos por LLM                                                                                |
| 25    | `20260810143100_lead_session_updated_at.sql`                 | `lead_session.updated_at` y trigger de actualización                                                                                    |
| 26    | `20260810150000_procedencia_extractor_y_etapa_alcanzada.sql` | Procedencia IA/humano y máximo alcanzado del embudo                                                                                     |
| 27    | `20260810161500_agente_config_escalado.sql`                  | Configuración de escalado, horario y plantilla de handoff                                                                               |
| 28    | `20260810190000_llm_usage.sql`                               | Uso y costo LLM por workflow/sesión                                                                                                     |
| 29    | `20260810200000_tags_delete_admin.sql`                       | DELETE de tags solo para admin                                                                                                          |
| 30    | `20260810210000_lead_tags_delete.sql`                        | Remoción de etiquetas por admin o vendedor                                                                                              |
| 31    | `20260810230000_leads_nombre_perfil_y_datos_extra.sql`       | Nombre reportado por Meta y datos libres validados                                                                                      |
| 32    | `20260811120000_session_recordatorios.sql`                   | Recordatorios de seguimiento con ciclo de vida e índice de uno vivo por sesión                                                          |
| 33    | `20260811160000_mensajes_contenido_trgm.sql`                 | Índice trigram para búsqueda dentro de conversaciones                                                                                   |
| 34    | `20260812170131_inbox_active_summary.sql`                    | RPC RLS-aware de mensajes recientes acotados por sesión                                                                                 |
| 35    | `20260812222808_qa_handoff_metrics.sql`                      | Timestamp de Meta, perfil parcial, handoffs auditables y RPC transaccional                                                              |
| 36    | `20260813090000_server_now_search_path.sql`                  | `search_path` seguro de `server_now()`                                                                                                  |
| 37    | `20260813163957_approve_lead_merge_transaction.sql`          | Merge administrativo atómico con locks ordenados, RLS y auditoría                                                                       |
| 38    | `20260813172558_fix_approve_lead_merge_lint.sql`             | Reemplazo aditivo de la RPC sin la variable PL/pgSQL muerta detectada por `db lint`                                                     |

## Known issues / technical debt (diferido post-pilot)

### C.1 — `leads.telefono` mezcla teléfonos + Meta IDs placeholders

**Diseño actual:** `telefono text NOT NULL UNIQUE` carga semánticas mixtas:

- WhatsApp: real phone (`+5491112345678`).
- IG/FB: placeholder `${canal}:${meta_user_id}`.

**Issues:**

- Index trigram `leads_telefono_trgm_idx` retorna noise queries `LIKE '+54%'` matchea placeholders.
- `meta_user_ids jsonb` ya cubre canonical Meta IDs cross-canal, telefono placeholder es redundante.
- Service `meta-api` debe parsear telefono para distinguir real phone vs placeholder.

**Fix futuro (post-pilot launch, Slice 4 o v2):**

```sql
-- Split semánticas
ALTER TABLE leads
  ALTER COLUMN telefono DROP NOT NULL,
  ADD COLUMN provider_user_id text NOT NULL DEFAULT '';

-- Backfill provider_user_id desde telefono actual (preserving canonical Meta ID)
UPDATE leads SET provider_user_id = CASE
  WHEN canal_origen = 'wa' THEN telefono
  ELSE split_part(telefono, ':', 2)
END;

-- Reset telefono a real-phone-only
UPDATE leads SET telefono = NULL WHERE canal_origen != 'wa';

-- Drop UNIQUE telefono global
ALTER TABLE leads DROP CONSTRAINT leads_telefono_key;

-- Composite UNIQUE canonical
ALTER TABLE leads ADD CONSTRAINT leads_canal_provider_uid_unique
  UNIQUE (canal_origen, provider_user_id);

-- UNIQUE partial real phones (WhatsApp only)
CREATE UNIQUE INDEX leads_telefono_wa_unique ON leads (telefono)
  WHERE canal_origen = 'wa' AND telefono IS NOT NULL;
```

**Razón defer:** refactor afecta repos `leads.repo.ts` interface + impl + services + ~50 tests. ~6h work + riesgo regresión. Pilot tier funcional con design actual. Documented técnicamente debt.

### C.10 — Tabla `empresas` mantenida con `COMMENT` single-org

**Decisión B1:** mantener tabla `empresas` (vs DROP). Razón:

- 0 cost mantener (1 row per deployment).
- `leads.empresa_id` FK + `empresas.nombre` útiles para branding UI per cliente.
- `COMMENT ON TABLE empresas` (added in 0001) documenta single-org constraint explícitamente.
- DROP requeriría modificar `leads.empresa_id` + tests + repos.

**Constraint single-org:** enforced via convention + COMMENT, no DB constraint. Re-evaluar si multi-tenant post-Year 3.

## Enums

```sql
current_stage_enum      = nuevo, identificando, cotizado, negociando, esperando_pago, cerrado, perdido, requiere_humano
urgencia_enum           = baja, media, alta
canal_enum              = wa, ig, fb
metodo_pago_enum        = transferencia, efectivo, tarjeta
resultado_enum          = exito, perdido
motivo_perdida_enum     = precio, stock, tiempo, no_responde, otro
rol_usuario_enum        = admin, vendedor
direction_enum          = in, out
sender_enum             = lead, ia, humano, sistema
tipo_mensaje_enum       = text, image, audio, video, doc, location, template
respuesta_tipo_enum     = text, template, handoff
tag_source_enum         = manual, workflow
merge_candidate_status_enum = pending, approved, rejected, superseded
estado_entrega_enum     = enviado, entregado, leido, fallido
```

`session_recordatorios.estado/motivo_cancelacion` y `handoff_events.action/reason_code/source` son `text` protegidos por `CHECK`, no enums Postgres. Esto permite ampliar esos catálogos con una migración aditiva sin alterar un tipo compartido.

## Tablas

### Core

#### `empresas`

- `id uuid PK`, `nombre text`, `ruc_nit text UNIQUE nullable`, `created_at`

#### `leads`

- `id uuid PK`, `nombre text`, `telefono text UNIQUE NOT NULL` (wa_id o placeholder `${canal}:${id}` no-WA), `email/direccion text nullable`
- `nombre_perfil text nullable` (Meta) y `datos_extra jsonb` (campos manuales libres)
- `vehiculo_marca/modelo text nullable`, `vehiculo_anio int nullable`, `vehiculo_motor text nullable`
- `empresa_id uuid FK nullable`, `canal_origen canal_enum`, `meta_user_ids jsonb` (mapa Canal → id)
- `created_at/updated_at timestamptz`
- **Indexes:** GIN `meta_user_ids`, trigram `nombre/telefono`

#### `lead_session`

- `id uuid PK`, `lead_id uuid FK CASCADE`
- `current_stage/urgencia` enums, `consulta text`
- `producto_cotizado_id uuid FK nullable`, `codigo_interno text nullable`, `precio_cotizado numeric nullable`, `cantidad int nullable`
- `bloqueador text nullable`, `comprobante_pago_url text nullable`, `metodo_pago enum nullable`
- `resultado enum nullable` (NULL = activa), `motivo_perdida enum nullable`
- `ia_pausada bool default false`
- `stage_before_handoff current_stage_enum nullable` — etapa restaurable al reanudar
- `etapa_alcanzada current_stage_enum` — máximo real del embudo, sin contar desvíos
- `procedencia jsonb` — origen IA/humano por campo, mensaje origen y valor anterior
- **(R9)** `extras jsonb NOT NULL DEFAULT '{}'` — catch-all LLM custom fields
- **(R10)** `context_summary text` nullable — rolling summary
- `started_at/updated_at/closed_at timestamptz`
- **Constraint:** UNIQUE partial `(lead_id) WHERE resultado IS NULL` — max 1 activa
- **Indexes:** closed_at (purge), GIN extras

#### `productos`

- `id uuid PK`, `codigo_interno text UNIQUE NOT NULL`, `sku_proveedor text nullable`
- `nombre text`, `descripcion/categoria text nullable`
- `compatibilidad jsonb` array `[{marca, modelo, anio_desde, anio_hasta, motor?}]`
- `precio numeric`, `stock int default 0`, `imagen_url text nullable`, `activo bool default true`
- `created_at/updated_at`
- **Indexes:** GIN `compatibilidad`, trigram `nombre/codigo_interno`

### Mensajería

#### `conversaciones`

- `id uuid PK`, `lead_id uuid FK`, `canal canal_enum`, `canal_thread_id text`, `ultima_actividad_at timestamptz`
- **Constraint:** UNIQUE `(canal, canal_thread_id)`. Persiste siempre (no purge).

#### `mensajes`

- `id uuid PK`, `conversacion_id uuid FK`, `lead_session_id uuid FK CASCADE`
- `direction enum`, `sender enum`, `sender_user_id uuid FK nullable`
- `tipo enum`, `contenido text nullable`, `media_url text nullable`
- `meta_message_id text nullable` — UNIQUE partial 0012 `WHERE NOT NULL` (atomic dedup inbound)
- **(R2)** `idempotency_key text nullable` — UNIQUE partial `WHERE direction='out' AND idempotency_key IS NOT NULL`
- `estado_entrega`, `estado_entrega_at`, `error_entrega` — último estado reportado por Meta
- `platform_created_at timestamptz nullable` — timestamp original del canal; `null` si no se pudo medir
- `metadata jsonb`, `created_at timestamptz`
- **Index:** `(conversacion_id, created_at DESC)` para timeline inbox

### Intents + reglas

#### `intents`

- `id uuid PK`, `nombre text` (sin UNIQUE — service `findByNombre` decide dup), `descripcion text`
- `ejemplos text[]`, `auto_detectado bool`, `activo bool default true`

#### `reglas`

- `id uuid PK`, `intent_id uuid FK`, `condiciones_extra jsonb nullable`
- `respuesta_tipo enum`, `respuesta_contenido text`, `prioridad int default 0`, `activa bool default true`, `created_at`
- **Index parcial:** `(intent_id, prioridad DESC) WHERE activa=true` — hot path pre-LLM

#### `rule_executions` (audit)

- `id uuid PK`, `regla_id uuid FK`, `mensaje_id uuid FK`, `matched_intent_id uuid FK`, `created_at`

### Tags

#### `tags`

- `id uuid PK`, `nombre text UNIQUE`, `color text default '#888888' CHECK ('^#[0-9a-fA-F]{6}$')`, `descripcion text nullable`

#### `lead_tags`

- PK `(lead_id, tag_id)`, `source tag_source_enum`, `assigned_by uuid FK nullable`, `assigned_at`

### Auth + usuarios

#### `usuarios`

- `id uuid PK = auth.users.id`, `nombre/email text`, `rol rol_usuario_enum`, `activo bool default true`, `created_at`
- Populated via trigger `auth.users INSERT → public.usuarios`. Lee rol desde `raw_app_meta_data` (NUNCA `user_metadata` editable cliente).

### Audit (post-REPAIR)

#### `tool_executions` (R8)

- `id uuid PK`, `lead_session_id uuid FK CASCADE`, `mensaje_id uuid FK nullable SET NULL`
- `tool_name text`, `args jsonb`, `result jsonb nullable`, `error text nullable`, `duration_ms int nullable`, `created_at`
- **Indexes:** `(lead_session_id, created_at DESC)`, `(tool_name, created_at DESC)`

#### `admin_actions` (R11)

- `id uuid PK`, `actor_user_id uuid FK SET NULL` (NULL=sistema)
- `action text`, `entity_type text`, `entity_id uuid nullable`, `payload jsonb DEFAULT '{}'`, `created_at`
- **Indexes:** `created_at DESC`, `(entity_type, entity_id, created_at DESC)`, `(actor_user_id, created_at DESC)`
- **Catálogo acciones:** ver `src/server/services/admin-audit.service.ts ADMIN_ACTIONS`.

#### `reactivation_dispatches` (0013)

- `id uuid PK`, `lead_session_id uuid FK CASCADE`
- `motivo motivo_perdida_enum nullable`, `template_name text`, `meta_message_id text nullable`
- `status text DEFAULT 'sent'` (`sent`/`failed`/`bounced` — service-level enum, no DB enum para evolución sin migration)
- `created_at`
- **Indexes:** `(lead_session_id, created_at DESC)` (cooldown lookup), `(status, created_at DESC)` (analytics)
- Append-only. Múltiples dispatches por sesión soportados (estrategia "3 intentos espaciados").

#### `merge_candidates` (R12)

- `id uuid PK`, `src_lead_id/dst_lead_id uuid FK CASCADE`
- `similarity_score numeric(4,3)`, `reasons jsonb DEFAULT '[]'`
- `status merge_candidate_status_enum default 'pending'`, `resolved_by uuid FK nullable`, `resolved_at timestamptz nullable`, `created_at`
- **Check:** `src_lead_id <> dst_lead_id`
- **UNIQUE partial:** `(LEAST(src,dst), GREATEST(src,dst)) WHERE status='pending'` — orden-independiente
- **Index:** `(status, created_at DESC)`

#### `event_outbox` (B2)

- `id uuid PK`, `event_name text NOT NULL`, `event_data jsonb NOT NULL DEFAULT '{}'`
- `event_id text NULL` — optional dedup key (Inngest event id)
- `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed'))`
- `attempts integer NOT NULL DEFAULT 0`, `last_error text NULL`
- `scheduled_at timestamptz NOT NULL DEFAULT now()`, `sent_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()`
- **Indexes:** partial `(status, scheduled_at) WHERE status='pending'` (cron poll hot path), `sent_at WHERE sent_at IS NOT NULL`, `(event_name)`
- Transactional outbox pattern. `EventBusService.publish` persiste row + optimistic direct Inngest emit + `markSent` o `markFailedAttempt`. Cron `dispatch-outbox-events` retry pending rows cada minuto. Garantiza at-least-once delivery.

#### `agente_config`

- Configuración append-only y versionada del modelo, prompt, tono, horario, límites y escalado.
- Solo una versión activa; rollback crea una versión nueva y conserva el historial.
- SELECT para authenticated; INSERT/UPDATE solo admin.

#### `turn_classifications`

- Una fila append-only por entrante contestado por LLM: `mensaje_id`, intent opcional, nombre y confianza.
- Complementa `rule_executions`; no duplica los turnos resueltos por regla.

#### `llm_usage`

- Uso por llamada: sesión opcional, modelo, tokens, costo USD, workflow y fecha.
- Fuente de métricas de costo por conversación; no sustituye el kill switch de gasto.

#### `session_recordatorios`

- Recordatorio sobre sesión abierta: fecha, nota, estado y causa de cancelación.
- UNIQUE partial garantiza un solo recordatorio vivo (`pendiente` o `avisado`) por sesión.
- Al reprogramar se conserva el id y cambia la fecha; el workflow viejo se cancela por id + fecha anterior.

#### `handoff_events`

- Historial append-only de pausa/reanudación con motivo tipado, fuente, etapa previa, actor y `source_event_key` único.
- No almacena texto del cliente ni la palabra sensible que provocó el handoff.
- `transition_handoff` cambia sesión, registra evento y encola la notificación dentro de una transacción.

## RPC de dominio

| RPC                                  | Seguridad                                        | Contrato                                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| `server_now()`                       | invoker; anon/authenticated                      | Hora del servidor para writes monotónicos              |
| `inbox_recent_messages(uuid[], int)` | invoker; authenticated/service_role              | Cola reciente acotada por sesión                       |
| `transition_handoff(...)`            | invoker; authenticated/service_role              | Pausa/reanudación auditable e idempotente              |
| `approve_lead_merge(uuid, uuid)`     | invoker; authenticated/service_role + gate admin | Merge, audit, reasignación y delete en una transacción |

## Storage buckets

| Bucket            | Public | Size cap | MIME                       |
| ----------------- | ------ | -------- | -------------------------- |
| comprobantes_pago | false  | 5 MB     | image/\* + application/pdf |
| productos         | false  | 3 MB     | image/\*                   |
| mensajes_media    | false  | 20 MB    | image/audio/video/pdf      |

CASCADE cleanup en cron purge Fase 14 (storage object delete via signed URL list).

## Relaciones críticas

```
leads (1) ──┬── (N) lead_session ──┬── (N) mensajes
            └── (N) conversaciones │
                                   ├── (N) tool_executions
                                   └── context_summary, extras (1:1 jsonb)

intents (1) ──┬── (N) reglas
              └── (1:N audit) detected_by_batch

merge_candidates ──┬── src_lead_id
                   └── dst_lead_id
```

## RLS aplicadas

| Tabla                 | Admin | Vendedor            |
| --------------------- | ----- | ------------------- |
| empresas              | RW    | R                   |
| leads                 | RW    | RW                  |
| lead_session          | RW    | RW                  |
| conversaciones        | RW    | RW                  |
| mensajes              | RW    | RW                  |
| productos             | RW    | R                   |
| intents               | RW    | R                   |
| reglas                | RW    | R                   |
| tags                  | RW    | R                   |
| lead_tags             | RW    | RW                  |
| usuarios              | RW    | R                   |
| tool_executions       | R     | R (audit read-only) |
| admin_actions         | R     | — (oculto)          |
| merge_candidates      | RW    | R                   |
| agente_config         | RW    | R                   |
| turn_classifications  | R     | R                   |
| llm_usage             | R     | R                   |
| session_recordatorios | RW    | RW                  |
| handoff_events        | RW    | RW                  |

Storage policies: comprobantes_pago RW vendedor + admin. productos RW admin solo. mensajes_media R todos + INSERT system.

## Inserts type (servidor)

`LeadSessionInsert`:

```ts
Omit<LeadSession, "id"|"started_at"|"closed_at"|"extras"|"context_summary"> & {
  extras?: Record<string, unknown>;
  context_summary?: string | null;
}
```

DB defaults `'{}'` y `NULL` mirrored.

`MensajeInsert`:

```ts
Omit<Mensaje, "id" | "created_at">;
// idempotency_key requerido en type (null si no aplica).
```

`MergeCandidateInsert`:

```ts
Omit<MergeCandidate, "id"|"created_at"|"status"|"resolved_by"|"resolved_at"> & {
  status?: MergeCandidateStatus;
}
```

Default `'pending'`.

## Deep-clone defense

Jsonb fields siempre `structuredClone` en repo in-memory para parity Supabase (que siempre retorna objetos nuevos):

- `leads.meta_user_ids`
- `lead_session.extras`
- `productos.compatibilidad`
- `mensajes.metadata`
- `reglas.condiciones_extra`
- `tool_executions.args/result`
- `admin_actions.payload`
- `merge_candidates.reasons`
- `intents.ejemplos`
- `event_outbox.event_data`
