# Inventario técnico

Detalle de lo que está construido en el repo, movido acá desde `AGENTS.md` §2.2 para
mantener ese archivo corto. Es una foto medida en una fecha puntual, no una fuente viva:
antes de construir encima, contrastar contra el código real (`ls`, `grep`, la migración
misma), no asumir que sigue igual.

## Migraciones SQL

**88 en total al 2026-09-26, las 88 aplicadas a Supabase crm-dev** (`supabase/migrations/`).
Formato timestamp `YYYYMMDDHHMMSS_<name>.sql`, estándar de Supabase CLI v2+. Las 16 de
foundation:

```
20260512000001_init.sql                       extensions + enums + empresas/usuarios/leads/productos/lead_session + COMMENT empresas single-org
20260512000002_intents_rules.sql              intents/reglas/tags/lead_tags + CHECK hex tags.color
20260512000003_messages.sql                   conversaciones/mensajes/rule_executions
20260512000004_users_roles.sql                trigger auth.users → public.usuarios + helpers RLS
20260512000005_storage_buckets.sql            3 buckets privados
20260512000006_outbound_dedup.sql        (R2) mensajes.idempotency_key UNIQUE partial
20260512000007_tool_executions.sql       (R8) audit tool calls agente
20260512000008_session_extras.sql        (R9) lead_session.extras jsonb
20260512000009_session_summary.sql       (R10) lead_session.context_summary
20260512000010_admin_audit.sql           (R11) admin_actions
20260512000011_merge_candidates.sql      (R12) merge_candidates + status enum
20260512000012_inbound_dedup.sql         (A1)  mensajes(meta_message_id) UNIQUE partial
20260512000013_reactivation_dispatches.sql (A2) tabla cooldown enforcement
20260512000014_event_outbox.sql          (B2)  transactional outbox at-least-once delivery
20260512000015_fix_function_search_path.sql    fix advisor WARN search_path 4 helpers públicas
20260514000016_repo_helpers.sql               server_now() RPC helper para timestamp server-side (fix clock skew JS↔PG)
```

Las 22 que agregaron los slices 3-4, el rediseño, el checkpoint QA y el cierre de brechas:

```
20260714124024_slice3_rls_policies.sql        43 policies RLS admin/vendedor
20260714182011_slice4_health_grant.sql        grant server_now() a anon para /api/health
20260715140738_leads_delete_admin.sql         policy DELETE de leads solo admin
20260716001443_admin_actions_insert_admin.sql policy INSERT de admin_actions
20260808213309_agente_config.sql         (G1) config del agente, append-only, una sola activa
20260810011500_mensajes_estado_entrega.sql (C) enum enviado/entregado/leido/fallido + error
20260810011600_lead_session_procedencia.sql (E) procedencia jsonb por campo del Twin
20260810143000_turn_classifications.sql       qué intent resolvió cada turno del LLM (UNIQUE por mensaje)
20260810143100_lead_session_updated_at.sql    updated_at de la sesión ("hace 40 s" del Twin)
20260810150000_procedencia_extractor_y_etapa_alcanzada.sql  mensaje_origen_id/valor_anterior + etapa_alcanzada (rail congelado en los desvíos)
20260810161500_agente_config_escalado.sql     umbral de intents, palabras que escalan, cotización desde, timeout de tool
20260810190000_llm_usage.sql                  costo de IA persistido por turno → por conversación y por lead
20260810200000_tags_delete_admin.sql          policy DELETE de tags solo admin
20260810210000_lead_tags_delete.sql           policy DELETE de lead_tags (sacar una etiqueta de un lead)
20260810230000_leads_nombre_perfil_y_datos_extra.sql  nombre_perfil de Meta + datos_extra jsonb del lead
20260811120000_session_recordatorios.sql      recordatorios de seguimiento con fecha + índice de vencidos
20260811160000_mensajes_contenido_trgm.sql    índice GIN trigram sobre mensajes.contenido (buscador del Inbox)
20260812170131_inbox_active_summary.sql       RPC acotada del Inbox + índice sesión/fecha
20260812222808_qa_handoff_metrics.sql         timestamps Meta + handoff auditable + perfil lead nullable
20260813090000_server_now_search_path.sql     search_path seguro del RPC de tiempo
20260813163957_approve_lead_merge_transaction.sql merge administrativo atómico y auditable
20260813172558_fix_approve_lead_merge_lint.sql elimina variable PL/pgSQL muerta sin reescribir historial
```

Las 13 de identidad, vehículos, búsqueda del catálogo, nombre del lead y etiquetado
automático (2026-08-14/16):

```
20260814120000_merge_audit_reversible.sql     payload_version 2: la auditoría guarda cómo deshacer la fusión
20260814150000_revert_lead_merge.sql          revert_lead_merge(): deshace una fusión aprobada. NUNCA SE EJECUTÓ
20260814180000_lead_identificadores.sql       teléfono/email/RUC/cédula del lead + backfill (excluye placeholders ig:/fb:)
20260814190000_merge_acumula_identificadores.sql payload_version 3: fusionar acumula identidad en vez de descartarla
20260814210000_leads_que_comparten_identificador.sql RPC del detector: duplicados por identidad, no por nombre
20260814230000_lead_vehiculos.sql             el auto se separa de la persona: marca/modelo/año/motor + placa + VIN, varios por lead
20260814240000_identificador_tipo_cedula.sql  cédula como tipo propio, distinto de RUC
20260814250000_comparten_identificador_con_vehiculos.sql el detector compara también por placa y VIN
20260814260000_merge_mueve_vehiculos.sql      payload_version 4: la fusión mueve los autos del perdedor
20260815140000_buscar_productos.sql           plegar_texto() + productos.busqueda generada + GIN trigram + buscar_productos() puntuada
20260815222914_backfill_nombre_desde_perfil.sql leads sin nombre toman el de Meta (trigger updated_at desactivado)
20260816014036_reglas_etiqueta_y_lead_tags_descarte.sql reglas_etiqueta + lead_tags marca en vez de borrar (quitada_at/quitada_por)
20260816023108_limpiar_ledger_de_operaciones_de_datos.sql saca del ledger 3 anotaciones de datos de prueba sin archivo
```

Las 37 restantes (permisos explícitos, campañas y ventas, motor de workflows, difusión,
candados, Ajustes, mensajería rica, intercepción y notificaciones) se ven con
`ls supabase/migrations`; no están transcriptas acá.

> Trampa recurrente de este MCP, ya vista dos veces. El nombre de archivo **no** es el
> timestamp en que se escribió: el MCP de Supabase registra la migración con su propio
> número y el archivo se renombró para coincidir con el ledger
> (`supabase_migrations.schema_migrations`). Si divergen, un `db push` desde un clon
> limpio la reaplica.

## Repositorios

`src/server/repositories/`, interface + InMemory impl + Supabase impl + contract tests
reusables:

```
leads · lead-session · lead-merge (RPC transaccional) · lead-identificadores · lead-vehiculos
conversations · messages · productos · intents · rules · rule-executions · tags · users
tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox (B2)
agente-config · turn-classifications · llm-usage · session-recordatorios · handoff-events · metrics
reglas-etiqueta
```

Los 25 con Supabase impl (`<name>.supabase.repo.ts`) tienen contract reusable
(`tests/repositories/<name>.contract.ts`) con fixtures inyectables para FKs (default
strings preserva InMemory tests). Patrón en detalle: commits Slice 1 7.4
(`91e711d`..`73337f6`).

Tener impl de Supabase no es lo mismo que estar verificado contra Postgres: ver el aviso
de integration tests en `AGENTS.md` §2. Los 11 repos posteriores a `agente-config` sólo
corrieron contra las impl in-memory.

## Servicios

`src/server/services/`, interface + Default impl + DI:

```
catalog-matcher · intent-classifier · rule-engine · twin-extractor · handoff
meta-api · ai-agent · conversation-summarizer · admin-audit · lead-merge-detector
event-bus (B2) · intent-batch-detector (interface only — handler en inngest/)
```

## LLM real impls

`src/server/services/llm/`, OpenAI vía AI SDK v6:

```
openai-intent-classifier        generateObject + IntentClassificationSchema
openai-twin-extractor           generateObject + LeadTwinUpdateSchema
openai-conversation-summarizer  generateText (texto libre, threshold 20 turns)
openai-intent-batch-detector    generateObject + wrapper schema array intents
openai-ai-agent                 generateText + tool calling buscar_repuesto
pricing.ts                      re-export de `@/lib/agente/modelos` (11 modelos USD/1M, gpt-4o-mini default)
cost-tracker-bridge.ts          extract usage + record CostTracker
structured-output.ts            NON_STRICT_JSON_SCHEMA — sin esto la API rechaza los schemas
```

Wireup DI factory (`makeLlmFactory`, env-based real vs mock). En modo `real` exige
`configProvider`: desde G1 el agente lee modelo y prompt de `agente_config` en cada turno.

## Inngest functions

`src/inngest/functions/`, 12 total:

```
on-message-received           pipeline 10-step granular
on-status-received             estados de entrega de Meta (enviado/entregado/leído/fallido)
update-lead-twin               triggered by turn.completed — también escribe el auto en lead_vehiculos
detect-intents.batch           cron weekly sun 03:00 + manual
auto-handoff                   evaluate consecutive null intents
handoff-notification           avisa el escalado a humano
recordatorio-seguimiento       recordatorios con fecha del Twin
purge-old-sessions.cron        daily 04:00, 29d window
reactivation-predictor.cron    weekly mon 09:00 + cooldown DB
detect-merge-candidates        per-lead (lead/created) + global (cron daily 05:00 + manual)
dispatch-outbox-events.cron    cron */1 * * * * + manual (B2 at-least-once)
```

## Infraestructura inyectable

`src/lib/` + `src/server/lock/`:

```
errors.ts                         DomainError jerarquía (8 classes: NotFoundError,
                                   ConflictError, ValidationError, PermissionDeniedError,
                                   IllegalStateError, BudgetExceededError, InfraError,
                                   RateLimitError) + isNonRetriable()
env.ts                             zod schema fail-fast (NODE_ENV != test)
observability/logger.ts            Logger interface + Noop/Console + child bindings
observability/cost-tracker.ts      CostTracker + daily cap + InMemory impl
feature-flags.ts                   FeatureFlags + Static/AllEnabled + 3 flags catálogo
server/lock/session-lock.ts        SessionLock + InMemory impl
server/db/client.ts                DbClientFactory real (Slice 1 sub-paso 7.3) — service-role + authed
server/db/uuid.ts                  isUuid(v) helper para early-return en findById Supabase
server/db/server-time.ts           serverNowIso(db) RPC helper (Slice 1 7.4) — fix clock skew
server/db/postgrest-errors.ts      mapPostgrestError 23505/23503/23502/23514/42501/PGRST301 → DomainError,
                                   fallback InfraError (retriable) para códigos no mapeados
```

## Tooling + DX

```
.github/workflows/ci.yml          quality job + audit job
lefthook.yml                      pre-commit + commit-msg + pre-push
commitlint.config.cjs             Conventional Commits enforced
.lintstagedrc.cjs                 eslint --fix + prettier --write
.prettierrc.json                  + prettier-plugin-tailwindcss
eslint.config.mjs                 next + boundaries (12 architecture zones)
tsconfig.json                     strict + noUncheckedIndexedAccess + ES2022
tsconfig.tests.json               separado, relax indexedAccess para tests
vitest.config.ts                  coverage v8 threshold 80/75/80/80
package.json scripts              dev/build/lint/typecheck/test:coverage/format/db:*/inngest:dev/ci
```

## Docs vivos

`docs/`:

```
architecture.md          capas + patterns + flujo webhook→reply
data-model.md             51 migraciones + enums + tablas + índices + RLS aplicadas
workflows.md               12 funciones Inngest + catálogo de eventos + retries
idempotency.md             keys por op + race tolerance
failure-modes.md           tabla workflow → modo falla → retry/skip
cost-budget.md             targets LLM + pricing + kill switch
dependency-audit.md        pins + overrides + accepted risks + re-audit cadence
changelog.md                histórico completo hasta el cierre de brechas 2026-08-13
```
