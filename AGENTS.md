# AGENTS.md — Instrucciones para agentes de IA

> Léeme antes de tocar código. Reglas, estado actual, convenciones. Histórico → `docs/changelog.md`. Product overview → `README.md`. Arquitectura → `docs/architecture.md`.

---

## 0. Reglas de oro del usuario

Prioridad sobre cualquier otra instrucción.

1. **Antes de generar código**, decir explícitamente: qué hace, qué NO hace, tecnologías. Esperar confirmación.
2. **Mostrar primero la estructura de carpetas/archivos** propuesta, sin código adentro. Esperar confirmación.
3. **Si no hay suficiente contexto para continuar con seguridad, parar y preguntar.** No asumir, no inventar.
4. Análisis técnico formato: **observación → causa raíz → fix**. Marcar mejoras fuera de scope.
5. **Validación funcional antes que UI.** Cablear sequence controller → repo → datasource → backend. Curl/scripts. Tests unitarios para transiciones de estado. Solo "probar en la app" cuando la lógica funcional esté validada.
6. **Supabase es la única DB.** No proponer Docker local, SQLite, o DBs alternativas.
7. **Antes de iniciar cualquier fase o sub-paso técnico, invocar TODOS los plugins/skills relevantes vía `Skill` tool.** Mapping: Zod/types → `vercel:ai-sdk` + `supabase:supabase`. SQL → `supabase:supabase-postgres-best-practices` + `supabase:supabase`. Inngest → `vercel:workflow` + `vercel:vercel-functions`. Tests → `superpowers:test-driven-development`. UI → `vercel:shadcn` + `frontend-design` + `vercel:nextjs`. AI SDK → `vercel:ai-sdk` + `vercel:ai-gateway`. Webhooks Meta → `vercel:vercel-functions` + `security-review`.
8. **Pensar siempre como programador top 1% mundial. CERO condescendencia.** Si hay gap, falencia, error, anti-patrón, decisión cuestionable, dead code, abstraction prematura, dependency obsoleta, herramienta sub-óptima, estructura desordenada, regla rota, test ausente, doc inconsistente, falta de observabilidad, falta de seguridad, o cualquier desviación de práctica de élite — **decirlo claramente y sin filtros antes de proponer solución**. Aplica a TODO: arquitectura, stack, herramientas, lenguaje, configs, dependencies, naming, estructura carpetas, docs, tests, CI, performance, security, DX, observability. Patrón: **(1) listar falencias reales encontradas → (2) explicar impacto concreto → (3) proponer solución priorizada por ROI**. No suavizar. No callar gaps por evitar fricción. Decir "esto está mal porque X" > "esto se puede mejorar". El usuario quiere producto profesional perfecto — eso requiere honestidad técnica brutal.
9. **Seguridad + Compliance Latam obligatorio.** No-negociable por LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia. Aplicar SIEMPRE:
   - **PII redaction en logs.** Nunca loggear `telefono`, `mensaje.body`, `email`, `meta_user_ids` raw. Usar `redactPii()` util (`src/lib/observability/redact.ts`). ESLint rule custom o checklist en code review.
   - **Webhook entrante = HMAC verify primera línea.** Toda route `/api/webhooks/**` debe importar `verifyHmac()` antes de parsear payload. Sin verify = reject 401.
   - **Server Actions = Zod parse primera línea.** Toda `'use server'` action: `const input = Schema.parse(formData)` antes de cualquier lógica. Sin excepción.
   - **Secrets rotation 90d.** `META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY` rotan cada 90 días. Runbook en `docs/runbooks/secrets-rotation.md`.
   - **`console.log` prohibido en `src/**`.** Solo `logger.info|warn|error|debug`. ESLint `no-console: error`. Razón: PII leak + logs sin structured fields.
10. **Reliability + Ops obligatorio.** Toda nueva integración debe cumplir:
    - **Cost-tracking en TODA llamada LLM.** `recordLlmUsage(tracker, result, { model, workflow, sessionId? })` post-call obligatorio. ESLint rule en `src/server/services/llm/**`. Razón: daily cap kill-switch no funciona si se bypassa.
    - **Idempotency-key explícito en `step.run()` Inngest + toda cron function.** Pattern: `${functionName}-${date.toISOString().slice(0,10)}-${entityId}`. No auto-gen. Replay tests obligatorios.
    - **`DomainError` jerarquía siempre.** Prohibido `throw new Error('msg')` en `src/server/**`. Clases reales (`src/lib/errors.ts`): `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`. (`InfraError`/`RateLimitError` NO existen aún — backlog Slice 4b; `mapPostgrestError` default branch todavía lanza `Error` plano, misma deuda.) ESLint rule. Razón: retry semantics dependen de error type.
    - **`/api/health` endpoint live.** Verifica DB ping + Inngest reachability + OpenAI ping. Vercel monitor wire. Pre-Slice 4 obligatorio.
    - **Error tracking (Sentry o equivalente) pre-Slice 4 launch.** Uncaught exceptions + unhandled rejections → tracked. Razón: silent failures = lost revenue.
11. **Skill discipline workflow.** Invocar superpowers skills vía `Skill` tool en estos triggers:
    - **Feature nueva (crear componente/route/service/workflow)** → `superpowers:brainstorming` primero. Explora intent + requirements + diseño antes de tocar código.
    - **Bug / test fail / behavior inesperado** → `superpowers:systematic-debugging` antes de proponer fix. Evidence-based diagnosis.
    - **Claim "completo" / "fixed" / "passing"** → `superpowers:verification-before-completion` antes del claim. Run verification commands + confirm output.
    - **Business logic en services + repos** → `superpowers:test-driven-development`. Test antes que implementación. Red → green → refactor.

---

## 1. Resumen ejecutivo

CRM conversacional **single-org self-hosted white-label**, venta de **repuestos automotrices**. Target market: **Latam aftermarket parts** (Brasil, México, Argentina, Chile, Colombia, Perú). Modelo deployment: **1 instalación per cliente empresa** (no multi-tenant SaaS).

**Pilot tier inicial (Slice 1-4):**

- 30 vendedores per cliente.
- Peak 50 msg/sec / sostenido 2-5 msg/sec per instancia.
- ~5K leads/mes per cliente.
- Conversaciones cortas (5-15 mensajes).
- Hosting cost ~$100-300 USD/mes per instancia (Supabase Pro + Inngest Free/Hobby + Vercel Hobby + OpenAI pay-as-you-go).

**Tiers escalables post-launch:**

- Mediana: 50-100 vendedores / peak 200 msg/sec → Supabase Pro/Team + Inngest Pro (~$500-1.5K/mes).
- Grande: 100-200 vendedores / peak 500 msg/sec → Supabase Team + read replicas + Inngest Pro (~$1.5-3K/mes).

**Features:**

- Multi-canal Meta: WhatsApp + Instagram + Facebook Messenger (caps por canal → `docs/meta-platform-limits.md`).
- Agente IA seller GPT-4 con catálogo + tool calling (Vercel AI SDK).
- Lead Twin estructurado, extractado por LLM.
- Motor intents + reglas IF/THEN pre-LLM (ahorra cost).
- Multi-sesiones históricas, purge automática >29 días.
- Workflows durables Inngest + outbox pattern para state consistency.

Diferenciadores: **sin kanban manual** (auto-stage), **Lead Twin**, **reglas IF/THEN** para reducir cost LLM, **reactivación predictiva**, **catálogo conectado al agente**.

**Revenue model (negocio):**

- Licencia setup: $5K-50K USD per cliente (one-time).
- Ops mensual: $1K-5K USD per cliente (hosting + SLA + soporte).
- Add-ons: training data custom, integración ERP, custom workflows.
- TAM/SAM/SOM análisis → `docs/business-plan.md`.

**Compliance Latam:**

- LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia.
- Detalle + right-to-erasure design → `docs/data-retention.md`.

---

## 2. Estado actual

**Fase actual:** `Slice 2 vistas — fase 10 Leads COMPLETA (2026-07-16). Siguiente: fase 11 Intents+Reglas (spec §Fase 11 aprobado, falta contratos+plan) o Slice 4b deploy. Retomar: docs/next-session.md.`
**Sub-paso actual:** **Fase 10 Leads COMPLETA (subagent-driven, commits `ddb7e05..HEAD`).** T1 `leads.list` orden determinístico (`updated_at DESC, id ASC`) + búsqueda literal `ilikeContains` cap 100 · T2 `listByLeadId`+`reassignLead` · T3 `leads.delete` (no-op non-UUID, probe RLS→PermissionDenied) + policy DELETE admin (migración `20260715140738`) + baja `mergeInto` · T4 `types/leads.ts` + `LeadsService` · T5 `MergeExecutorService` approve/reject/manual (audit-first replay-safe: audit → fill-nulls ganador → reassign sesiones/convs → delete perdedor CASCADE candidates; orden pinneado con `invocationCallOrder`) · T6 detector respeta `rejected` (`findAnyPair`) · T7 4 Server Actions + schemas (copys verbatim addendum §2.A; `merge_candidate` not-found → copy "par ya resuelto") · T8 UI `/leads` lista+búsqueda+banner duplicados · T9 UI `/leads/[id]` ficha+sesiones · T10 UI review duplicados + duplicado manual + policy INSERT `admin_actions` (migración `20260716001443`, gap del plan detectado por E2E). Validado: browser 7/7 + E2E merge 22/22 ×2 · integration leads 16/16 + lead-session 21/21 · final whole-branch review (fable): 0 Critical, 1 Important fixeado (`ec5ddfa`) + 2 plan-mandated (`b91b2e7`), re-verdict clean. Backlog fase 11 triageado → `docs/next-session.md`.
**Sub-paso previo:** **Slice 4a Hardening COMPLETO (2026-07-14).** 10.1 `PinoLogger`+`getLogger(env)` (paridad redactPii testeada; prod=Pino JSON, dev=Console; call sites swapeados). 10.2 Sentry env-gated (`SENTRY*DSN`opcional;`beforeSend`redacta + elimina`request.data`; traces 0). 10.3 OTel `@vercel/otel`en`instrumentation.ts`+`withSpan`(spans:`webhook.meta.post`, `llm.ai-agent`, `meta.sendText`; no-op local). 10.4 `/api/health`(ping DB anon + grant`server_now()`a anon migration`20260714182011`; checks externos `skipped`con placeholders; curl 200 degraded verificado). 10.5`UpstashCostTracker`(fix kill-switch roto en serverless: INCRBYFLOAT por día + TTL 48h; factory fallback InMemory+warn) swapeado en bootstrap. 10.6`LeadSessionRepository.delete`(contract+integration 17/17) + purge real (storage cleanup pre-delete, degrada con warn, replay-safe). 10.7 reactivación real (templates es por`motivo_perdida`; skips → `bounced`con template`skip*\*`= cooldown; idempotency`react-<sessionId>`; ValidationError→bounced, resto rethrow). **Slice 3 previo mismo día:** auth+RLS completo (43 policies, panel authed, 11/11 matriz). Usuario dev: `admin-dev@crm.local`. **Siguiente: Slice 4b launch** — checklist en next-session (creds reales META/OPENAI/INNGEST/UPSTASH + cuenta Sentry + deploy Vercel + webhook público + templates Meta + monitores + pen test).
**Última acción completada (sesión 2026-08-08):** **Rediseño "sala de control" — sub-proyecto A (base visual) COMPLETO**, rama `rediseno-a-base-visual` (11 commits, `88fd1cf..fd9319a`). Handoff de diseño descompuesto en 7 sub-proyectos A-G (`docs/superpowers/specs/2026-08-07-rediseno-a-base-visual-design.md` §1); **G se solapa con la fase 11 Intents+Reglas — tratar como un solo trabajo**. A entregó: tokens del handoff sobre los nombres semánticos de shadcn (los ~30 componentes vendorizados adoptan el diseño sin editarlos) + tokens propios en `@theme` · modo oscuro forzado · alias de íconos sobre lucide (`src/components/icons.ts`; se descartó Material Symbols para no abrir la CSP de B3) · lógica pura en `src/lib/ui/` con la regla del embudo (`perdido`/`requiere_humano` son desvíos, NO pasos 7 y 8) · 5 primitivas compartidas · SideNav de 222px · shell del panel · raíz redirige a `/inbox`. Ejecutado con subagent-driven-development: 9 tareas, cada una con revisión independiente. **2 defectos del plan detectados por el proceso:** (1) la secuencia Task 6→7 era incommiteable porque el hook `pre-commit` typechequea todo el proyecto — se fusionaron en un commit; (2) `<main className="flex ...">` convertía el main en contenedor flex y rompía las 7 pantallas del panel (medido: `/metricas` 236px de 1218 disponibles, `/inbox` recortado sin scrollbar) — lo encontró un revisor midiendo en el navegador, no leyendo el diff. **Pendiente de A:** comparación visual humana contra el prototipo `CRM Repuestos v2.dc.html` (los chequeos fueron programáticos sobre el DOM, sin capturas) · 5 SVG huérfanos en `public/` de la plantilla de Next. **Siguiente sub-proyecto: B — Bandeja unificada de 3 paneles.**

**Acción previa (sesión 2026-08-07):** **Slice 4b — cadena WhatsApp E2E real validada.** Creds cargadas (OpenAI org verificada con llamada real · app Meta `Crm Genuino` 1570589244491707 + número de prueba `+1 555 667-7618` phone_number_id `1278451868684287` + WABA `906018605389495` · token de usuario del sistema sin caducidad). Outbound OK (`scripts/smoke-meta-send.mjs`, plantilla `hello_world` entregada). Inbound OK vía túnel cloudflared: handshake 200 · HMAC rechaza 401 sin firma · `messages` suscrito a nivel app Y de WABA (faltaba el segundo — los mensajes iban a la consola de Meta). Pipeline completo verde: lead + conversación + 4 mensajes + sesión + 2 `tool_executions`, agente responde por WhatsApp. **3 bugs de fondo encontrados y arreglados:** (1) `inngest.send()` iba a Inngest Cloud con key dummy → 401 → webhook 500 → Meta reintentaba; fix `INNGEST_DEV` + var agregada a `env.ts`/example — `NODE_ENV=development` NO alcanza. (2) los 3 schemas LLM eran incompatibles con Structured Outputs strict (`format:uri` de `.url()` · `propertyNames` de `z.record()` · campos `.optional()` ausentes de `required`) → **`update-lead-twin` nunca completó una ejecución desde Slice 1**, invisible porque los tests usan `MockLanguageModelV3`; fix `strictJsonSchema:false` (`structured-output.ts`) + suite de contrato contra OpenAI real (`tests/integration/llm-schemas.openai.test.ts`). (3) vars opcionales declaradas vacías tumbaban el boot (`.optional()` de Zod no acepta `""`); fix `stripEmpty()` en `env.ts`. Además: modelo OpenAI configurable por workflow (`OPENAI_MODEL*` + `resolveLlmModels` con validación fail-fast contra `OPENAI_PRICING`), pricing actualizado con 5 modelos verificados, `inngest:dev` con `-u` (auto-discovery escanea 3000, la app corre en 3001). **Pendiente: catálogo vacío** (`productos`/`intents`/`reglas` en 0 — el agente no tiene qué vender). Detalle Slice 1 histórico → `docs/changelog.md`.

**Acción previa (sesión 2026-07-16):** cierre fase 10 Leads (T10 re-review clean + T11: CI verde tras 2 fixes de entorno [eslint ignore `.superpowers/**` + coverage exclude UI fases 9-10 por política browser/E2E] · final whole-branch review fable "ready with fixes" → 3 must-fix aplicados (`ec5ddfa`+`b91b2e7`) → re-verdict "Yes" · docs).

**PENDIENTE USUARIO antes de continuar:** ninguno (pendiente manual: dashboard Supabase → Advisors, CLI 403 free tier).

**Siguiente sub-paso:** **fase 11 Intents+Reglas (contratos sobre spec `2026-07-14-slice2-vistas-9-12-design.md` §Fase 11 → `superpowers:writing-plans` → ejecución; backlog triageado en `docs/next-session.md` — primer item: helper 3-way canales/vehiculo)** **o Slice 4b — deploy + soft launch** (requiere del usuario: creds reales META/OPENAI/INNGEST/UPSTASH en `.env.local`, cuenta Vercel, cuenta Sentry free, número WhatsApp Business).

### Tabla de progreso

| Fase                                                       | Estado         | Notas                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-6 — Foundation mock-first                                | 🟢 completo    | Bootstrap → workflows. 236/236 tests pre-REPAIR. Ver `docs/changelog.md`.                                                                                                                                                                                                                                                                                                                |
| REPAIR R1-R12                                              | 🟢 completo    | 11 migrations, +135 tests, error taxonomy + idempotency + audit                                                                                                                                                                                                                                                                                                                          |
| Pre-Slice docs (failure-modes/idempotency/cost-budget)     | 🟢 completo    | Brief design docs                                                                                                                                                                                                                                                                                                                                                                        |
| **Pre-Slice 1 hardening A1-A10 (Camino A+)**               | 🟢 completo    | 13 migrations + error taxonomy + CI + lefthook + zod env + tsconfig strict++ + ESLint boundaries + Prettier + docs split + dep audit                                                                                                                                                                                                                                                     |
| **Pre-Slice 1 Industrial Hardening B0-B6+B+R (Camino B+)** | 🟢 completo    | Business spec lock + migration timestamps + outbox B2 + security headers + Upstash rate limit + RLS CI gate + threat model + perf tuning + SLO + runbooks + backup strategy. 16 issues HIGH del audit profundo. 423/423 tests.                                                                                                                                                           |
| **Slice 1 — Real DB + LLM + Meta sandbox**                 | 🟢 funcional   | 7.1-7.6 ✅. 7.7.A LLM factory ✅. 7.8 Inngest serve ✅. 7.9 webhook Meta ✅. 7.10 E2E smoke Path A ✅. 7.7.B Pino + 7.7.C OTel + 7.7.D Sentry pendientes (pre-Slice 4 launch).                                                                                                                                                                                                           |
| **Slice 2 — UI + Realtime + Server Actions**               | 🟡 en progreso | Core 8.x ✅ (inbox+conversación+twin+actions+poller+tabs). **Vistas: fase 9 Productos ✅ 2026-07-15** (`629c647..2d205d9`) · **fase 10 Leads ✅ 2026-07-16** (`9381265..b91b2e7`, plan `docs/superpowers/plans/2026-07-15-slice2-fase10-leads.md`, browser 7/7 + E2E merge 22/22 ×2 + integration 37/37). Fases 11-12 (Intents+Reglas/Tags+Métricas+Ajustes) pendientes — spec aprobado. |
| **Slice 3 — Auth + RLS audited**                           | 🟢 completo    | 9.1 auth+login+proxy ✅ · 9.2 43 policies + suite RLS 11/11 ✅ · 9.3 panel authed client ✅ · 9.4 STRIDE + security review ✅. Spec+plan en `docs/superpowers/`.                                                                                                                                                                                                                         |
| **Slice 4a — Hardening pre-launch**                        | 🟢 completo    | 10.1 Pino ✅ 10.2 Sentry ✅ 10.3 OTel ✅ 10.4 /api/health ✅ 10.5 CostTracker Upstash ✅ 10.6 purge real ✅ 10.7 reactivación real ✅. Spec+plan en `docs/superpowers/`.                                                                                                                                                                                                                 |
| **Slice 4b — Deploy + soft launch**                        | 🟡 en progreso | **Cadena WhatsApp E2E real validada local 2026-08-07** (creds OpenAI+Meta test number, outbound+inbound+pipeline+respuesta IA). Falta: catálogo cargado · Upstash · Sentry · deploy Vercel · webhook público estable (hoy túnel cloudflared efímero) · templates Meta · monitores · número real para soft launch.                                                                        |

**Métricas actuales:** 956/956 unit tests pass (en la rama de G1; 779 en master) · RLS matriz 11/11 integration · integration leads 16/16 + lead-session 21/21 + productos 20/20 contra Supabase real (timeouts 120s + retry 1) · browser validation 8.1-8.7 + fase 9 (25 checks) + fase 10 (7/7 + E2E merge 22/22 ×2) ✅ Playwright · 0 typecheck errors · 0 lint errors (warnings boundaries pre-existentes) · format clean · coverage 90.7/84.7/89.0/91.7 (threshold 80/75/80/80; UI client excluida por política browser/E2E) · **remoto `https://github.com/Leonardo-A1varez/crm.git` (privado)**.

> **Cuando completes una acción, actualiza la tabla + "Última acción completada".**

### 2.1 Plan re-shape post-REPAIR (decisión 2026-05-12)

Plan original (Fases 7-14) reemplazado por **4 slices verticales** + **Pre-Slice 1 hardening A1-A10**. Razón: gap-analysis detectó 25 carencias post-Fase 6; foundation enterprise-grade antes de wireup real evita rework Slice 2-4.

| Slice | Duración | Scope                                                                                                                 |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | 3 sem    | Supabase project + branch + migrations + repos + LLM impls + Meta sandbox + Inngest serve + E2E smoke + observability |
| 2     | 2 sem    | UI completa + Realtime + Server Actions                                                                               |
| 3     | 1 sem    | Auth + RLS audited + STRIDE walkthrough                                                                               |
| 4     | 1 sem    | Cron real wireup + soft launch 10 leads                                                                               |

### 2.2 Inventario técnico actual (post Pre-Slice 1 hardening)

Lo que está LISTO en repo, agrupado por capa:

**Migraciones SQL** (16, `supabase/migrations/`. **16/16 aplicadas a Supabase crm-dev (verificado `supabase migration list --linked` 2026-05-15).** Renombradas B1 a timestamp format `YYYYMMDDHHMMSS_<name>.sql` Supabase CLI v2+ standard):

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

**Repositorios** (`src/server/repositories/`, interface + InMemory impl + Supabase impl + contract tests reusables):

```
leads · lead-session · conversations · messages · productos · intents · rules
tags · users · tool-executions · admin-audit · merge-candidates · reactivation-dispatches
event-outbox (B2)
```

**Todos 14 con Supabase impl** (`<name>.supabase.repo.ts`) + integration test (`tests/integration/<name>.supabase.test.ts`) + contract reusable (`tests/repositories/<name>.contract.ts`) con fixtures inyectables para FKs (default strings preserva InMemory tests). Pattern detalle → commits Slice 1 7.4 (`91e711d`..`73337f6`).

**Servicios** (`src/server/services/`, interface + Default impl + DI):

```
catalog-matcher · intent-classifier · rule-engine · twin-extractor · handoff
meta-api · ai-agent · conversation-summarizer · admin-audit · lead-merge-detector
event-bus (B2) · intent-batch-detector (interface only — handler en inngest/)
```

**LLM real impls** (`src/server/services/llm/`, OpenAI vía AI SDK v6):

```
openai-intent-classifier        generateObject + IntentClassificationSchema
openai-twin-extractor           generateObject + LeadTwinUpdateSchema
openai-conversation-summarizer  generateText (texto libre, threshold 20 turns)
openai-intent-batch-detector    generateObject + wrapper schema array intents
openai-ai-agent                 generateText + tool calling buscar_repuesto
pricing.ts                      4 modelos USD/1M tokens (gpt-4o-mini default)
cost-tracker-bridge.ts          extract usage + record CostTracker
```

Wireup DI factory (env-based real vs mock) → pendiente Slice 1 7.7+ junto con observability.

**Inngest functions** (`src/inngest/functions/`, 9 total):

```
on-message-received           pipeline 10-step granular
update-lead-twin              triggered by turn.completed
detect-intents.batch          cron weekly sun 03:00 + manual
auto-handoff                  evaluate consecutive null intents
purge-old-sessions.cron       daily 04:00, 29d window
reactivation-predictor.cron   weekly mon 09:00 + cooldown DB
detect-merge-candidates-per-lead  triggered by lead/created
detect-merge-candidates-global    cron daily 05:00 + manual
dispatch-outbox-events.cron       cron */1 * * * * + manual (B2 at-least-once)
```

**Infraestructura inyectable** (`src/lib/` + `src/server/lock/`):

```
errors.ts                         DomainError jerarquía (6 classes) + isNonRetriable()
env.ts                            zod schema fail-fast (NODE_ENV != test)
observability/logger.ts           Logger interface + Noop/Console + child bindings
observability/cost-tracker.ts     CostTracker + daily cap + InMemory impl
feature-flags.ts                  FeatureFlags + Static/AllEnabled + 3 flags catálogo
server/lock/session-lock.ts       SessionLock + InMemory impl
server/db/client.ts               DbClientFactory real (Slice 1 sub-paso 7.3) — service-role + authed
server/db/uuid.ts                 isUuid(v) helper para early-return en findById Supabase
server/db/server-time.ts          serverNowIso(db) RPC helper (Slice 1 7.4) — fix clock skew
server/db/postgrest-errors.ts     mapPostgrestError 23505/23503/23502/23514/42501/PGRST301 → DomainError
```

**Tooling + DX**:

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

**Docs vivos** (`docs/`):

```
architecture.md          capas + patterns + flujo webhook→reply
data-model.md            13 migrations + enums + tablas + indexes + RLS planificadas
workflows.md             8 Inngest functions + events catalog + retry semantics
idempotency.md           keys por op + race tolerance
failure-modes.md         tabla workflow → modo falla → retry/skip
cost-budget.md           targets LLM + pricing + kill switch
dependency-audit.md      pins + overrides + accepted risks + re-audit cadence
changelog.md             histórico completo Fases 0-6 + REPAIR + Pre-Slice 1
```

---

## 3. Decisiones bloqueadas (no re-preguntar)

Lista cerrada. No re-abrir sin pedido explícito.

### Producto

- **Single-org self-hosted white-label**. NO multi-tenant SaaS.
- **Target market: Latam aftermarket parts mid-large** (Brasil/México/Argentina/Chile/Colombia/Perú).
- **Deployment model: 1 instalación per cliente empresa.** Cada empresa cliente paga licencia + setup + ops mensual.
- **Pilot tier:** 30 vendedores / peak 50 msg/sec / ~5K leads/mes per instancia. Tiers Mediana/Grande post-launch (`docs/business-plan.md`).
- Conversaciones cortas (5-15 mensajes), repuestos automotrices exclusivo.
- Sin pipeline kanban, sin deals, sin tareas.
- Multi-sesiones históricas por lead, **máximo 1 sesión activa simultánea por lead**.
- Purge cron diario: sesiones cerradas con `closed_at < now() - 29 días` se borran (CASCADE mensajes + cleanup Storage).
- Tags: auto vía workflows + manuales editables.
- Comprobante pago: solo URL imagen. Sin monto/verificación.
- Lead Twin = sólo campos dinámicos de la sesión actual (`lead_session`).
- Productos: `codigo_interno` único de la casa + `sku_proveedor` opcional.
- Foto-to-SKU **diferido a v2**.
- **Multi-canal restrictions:** WhatsApp + IG + FB Messenger tienen caps + windows distintos por plataforma. Detalle → `docs/meta-platform-limits.md`.
- **Compliance Latam:** LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia. Right-to-erasure obligatorio. Detalle → `docs/data-retention.md`.

### Multi-canal

- Reconocimiento mismo lead via `leads.telefono` (WA) o `meta_user_ids` jsonb (IG/FB).
- Merge manual desde UI cuando IG/FB no exponen teléfono.
- UI estilo WhatsApp Web: ícono grande canal activo + íconos pequeños canales vinculados.

### Stack

- **Next.js 16 App Router** + RSC + Server Actions. **Sin NestJS.**
- Tailwind v4 + shadcn/ui.
- Supabase (DB + Auth + Storage + Realtime). Única DB.
- Inngest (workflows + cola + cron). Free → Hobby cuando topea.
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai`) sobre GPT-4.x. AI Gateway diferido post-Slice 1.
- Meta Cloud API oficial. No BSP, no Baileys.
- Zod validación, Vitest tests, Prettier formato, ESLint + boundaries arquitectura.
- Hosting: Vercel.
- Pre-Slice 1 tooling: lefthook hooks, commitlint, @vitest/coverage-v8, GitHub Actions CI.

### Arquitectura

- Capas: API/Action → Service → Repository → DB. **Nunca saltar capas.**
- Repos: interface + impl (in-memory tests, Supabase prod).
- Services no tocan DB directo; DI repos.
- Inngest functions sólo orquestan, delegan a services.
- Webhook Meta responde 200 inmediato + emite event Inngest.
- Service-role vs authed clients separados. ESLint boundaries enforce.

### Integraciones reales

- Pre-Slice 1 = todo mock in-memory.
- Slice 1 = swap impl por reales (Supabase + AI SDK + Meta).
- Razón: validar lógica + UI sin depender de credenciales/cuotas.

### RLS (planificadas Slice 3)

- Admin: RW sobre TODO.
- Vendedor: RW sobre leads/sesiones/conversaciones/mensajes/lead_tags/comprobantes Storage.
- Vendedor: solo R sobre productos/intents/reglas/tags/usuarios.

---

## 4. Convenciones de código

### Idioma

- UI, comentarios, commits: **español**.
- Identificadores técnicos genéricos: inglés (`leadId`, `messageRepo`, `useEffect`).
- Identificadores de dominio: español (`lead_session`, `bloqueador`, `motivo_perdida`).

### TypeScript

- `strict: true` + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` + `noImplicitOverride` + `forceConsistentCasingInFileNames`.
- No `any`. Si imprescindible, comentar por qué.
- Tipos de dominio en `src/types/`. Generados Supabase en `src/server/db/types.gen.ts` (Slice 1 sub-paso 7.3).
- Inferir tipos donde sea posible.

### Validación

- Zod en TODOS los inputs HTTP (API routes + Server Actions).
- Schemas en `src/lib/validation/`.
- Tipos derivados via `z.infer<typeof Schema>`.
- Env validation via zod fail-fast (`src/lib/env.ts`).

### Componentes React

- Server Components por defecto. `'use client'` sólo cuando hay interactividad.
- Composición sobre herencia. Props tipadas con interfaces.
- shadcn como base; extender vía composición, no editar `src/components/ui/`.

### Tests

- Vitest. Coverage threshold 80/75/80/80 (statements/branches/functions/lines).
- Repos mockeados con impl in-memory.
- Contract tests `runXContract(makeRepo)` reusables in-memory ↔ Supabase.
- Sin mocks en código de producción.

### Commits

- Conventional Commits (enforced via commitlint).
- `feat:` `fix:` `chore:` `refactor:` `test:` `docs:` `perf:` `build:` `ci:` `revert:` `style:`.
- Subject ≤72 chars, español.
- Body sólo si el "por qué" no es obvio.

### Estructura de imports

1. Bibliotecas externas (react, next, zod…)
2. Imports absolutos `@/...`
3. Imports relativos `./...`
4. Imports de tipos al final con `import type`

### Architecture zones (eslint-plugin-boundaries)

- `app/**` puede importar: components, server-services, server-auth, lib, types, hooks, stores.
- `components/**`: components, lib, types, hooks, stores.
- `inngest/**`: server-services, server-repositories, server-db, server-lock, lib, types.
- `server-services/**`: server-repositories, server-lock, lib, types.
- `server-repositories/**`: server-db, lib, types.
- `lib/**`: lib, types.
- Resto: ver `eslint.config.mjs`.

---

## 5. Cómo trabajar paso a paso

1. **Anunciar** sub-paso a ejecutar.
2. **Ejecutar** acción mínima (un solo sub-paso).
3. **Validar** según criterio plan.
4. **Reportar** 2-3 líneas.
5. **Esperar** confirmación antes del siguiente. No encadenar varios sin pausa.

### Excepciones

- Sub-pasos triviales atómicamente relacionados (deps install).
- Usuario dice explícitamente "haz toda la fase X" o "no preguntes en cada paso".

### Cuando falla un sub-paso

- No avanzar.
- Diagnosticar causa raíz.
- Proponer fix al usuario.
- Aplicar tras confirmación si toca config global o instala algo nuevo.

---

## 6. Qué NO hacer

- ❌ Escribir código antes de confirmar scope/stack/estructura con usuario.
- ❌ Conectar Supabase/OpenAI/Meta/Inngest reales hasta Slice 1+.
- ❌ Proponer DBs alternativas a Supabase.
- ❌ Agregar deps sin justificación + aprobación.
- ❌ Crear docs adicionales sin pedir.
- ❌ Commitear sin que usuario lo pida.
- ❌ Saltar capas (API → DB directo).
- ❌ Emojis en código/commits salvo que usuario pida.
- ❌ Comentarios obvios. Sólo "por qué" no obvio.
- ❌ Backwards-compat shims, abstractions prematuras, handling de casos imposibles.

---

## 7. Cómo retomar sesión nueva

1. Lee `README.md` (product overview).
2. Lee este `AGENTS.md` completo (reglas + estado).
3. **Lee `docs/next-session.md` para resume instructions step-by-step + acción pendiente usuario.**
4. `docs/changelog.md` para histórico detallado si necesitas contexto fases pasadas.
5. `docs/architecture.md`, `docs/data-model.md`, `docs/idempotency.md`, `docs/failure-modes.md`, `docs/cost-budget.md`, `docs/workflows.md`, `docs/security-threat-model.md`, `docs/database-tuning.md`, `docs/slo.md`, `docs/backup-strategy.md`, `docs/business-plan.md`, `docs/meta-platform-limits.md`, `docs/data-retention.md` para diseño + business + ops.
6. Si código no concuerda con doc, preguntar antes de actuar.
7. Continuar desde "Siguiente sub-paso" §2 o seguir guía `docs/next-session.md`.

---

## 8. Glosario rápido

- **Lead Twin** — Ficha estructurada de la sesión activa, mantenida por LLM extractor. Vive en `lead_session`.
- **Auto-stage** — `current_stage` clasificada por IA tras cada turno (sin kanban manual).
- **Sesión** — Conversación atómica con lead que termina en `exito` o `perdido`. Multi-sesiones históricas por lead.
- **Handoff** — Transferencia IA → humano. Manual (botón) o automática (regla).
- **Regla IF/THEN** — Mapping `intent + condiciones → respuesta fija`. Pre-LLM.
- **Intent** — Categoría semántica de mensaje del lead.
- **Conversación** — Hilo persistente por canal. Persiste; sesiones internas se purgan.
- **Reactivación predictiva** — Cron semanal sobre leads perdidos segmentados por `motivo_perdida`.

---

## 9. Preferencias del usuario

- Idioma interacción: español.
- Validación funcional (curl/tests) antes que UI manual.
- Backend lo arranca el usuario.
- Análisis formato: observación → causa raíz → fix.
- Preguntas explícitas si ambigüedad antes que asumir.

---

**Historial completo:** `docs/changelog.md`.
