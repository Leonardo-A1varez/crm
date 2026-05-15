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
6. **Backend/servidor lo arranca el usuario manualmente.** No iniciar servidores, no reiniciar.
7. **Supabase es la única DB.** No proponer Docker local, SQLite, o DBs alternativas.
8. **Antes de iniciar cualquier fase o sub-paso técnico, invocar TODOS los plugins/skills relevantes vía `Skill` tool.** Mapping: Zod/types → `vercel:ai-sdk` + `supabase:supabase`. SQL → `supabase:supabase-postgres-best-practices` + `supabase:supabase`. Inngest → `vercel:workflow` + `vercel:vercel-functions`. Tests → `superpowers:test-driven-development`. UI → `vercel:shadcn` + `frontend-design` + `vercel:nextjs`. AI SDK → `vercel:ai-sdk` + `vercel:ai-gateway`. Webhooks Meta → `vercel:vercel-functions` + `security-review`.
9. **Pensar siempre como programador top 1% mundial. CERO condescendencia.** Si hay gap, falencia, error, anti-patrón, decisión cuestionable, dead code, abstraction prematura, dependency obsoleta, herramienta sub-óptima, estructura desordenada, regla rota, test ausente, doc inconsistente, falta de observabilidad, falta de seguridad, o cualquier desviación de práctica de élite — **decirlo claramente y sin filtros antes de proponer solución**. Aplica a TODO: arquitectura, stack, herramientas, lenguaje, configs, dependencies, naming, estructura carpetas, docs, tests, CI, performance, security, DX, observability. Patrón: **(1) listar falencias reales encontradas → (2) explicar impacto concreto → (3) proponer solución priorizada por ROI**. No suavizar. No callar gaps por evitar fricción. Decir "esto está mal porque X" > "esto se puede mejorar". El usuario quiere producto profesional perfecto — eso requiere honestidad técnica brutal.

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

**Fase actual:** `Slice 1 — Real DB + LLM + Meta sandbox (en progreso)`
**Sub-paso actual:** **7.5 COMPLETO 5/5 LLM impls reales OpenAI + 466/466 unit tests verde.** Restantes: 7.6 Meta Cloud API real + 7.7-7.10 observability + Inngest serve + webhook + E2E smoke.
**Última acción completada (sesión 2026-05-15):** 5 LLM impls reales OpenAI vía AI SDK v6 (`ai@6.0.180` + `@ai-sdk/openai@3.0.63`):

- `OpenAiIntentClassifierLLM` (generateObject + IntentClassificationSchema)
- `OpenAiTwinExtractorLLM` (generateObject + LeadTwinUpdateSchema)
- `OpenAiConversationSummarizerLLM` (generateText, texto libre)
- `OpenAiIntentBatchDetectorLLM` (generateObject + wrapper schema)
- `OpenAiAgentLLM` (generateText + tool calling buscar_repuesto)

Infra: `src/server/services/llm/pricing.ts` (4 modelos OpenAI USD/1M tokens), `cost-tracker-bridge.ts` (extract usage + record vía existing `CostTracker`). Boundary refactor: interfaces de intent-batch-detector extraídas a `src/server/services/intent-batch-detector.service.ts` (server-services NO puede importar de inngest). lead-merge-detector NO migrado a LLM (heurística determinista). 7 commits Slice 1 7.5. ESLint warnings deprecation pre-existentes.

**PENDIENTE USUARIO antes de continuar:** ninguno (5 LLMs + infra commiteado, push sync).

**Siguiente sub-paso:** **Slice 1 sub-paso 7.6** — Meta Cloud API real con HMAC signature verify en webhook + send/recv real (WhatsApp Business + IG + FB Messenger). Después 7.7 observability + 7.8 Inngest serve + 7.9 webhook + 7.10 E2E smoke.

### Tabla de progreso

| Fase                                                       | Estado         | Notas                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0-6 — Foundation mock-first                                | 🟢 completo    | Bootstrap → workflows. 236/236 tests pre-REPAIR. Ver `docs/changelog.md`.                                                                                                                                                      |
| REPAIR R1-R12                                              | 🟢 completo    | 11 migrations, +135 tests, error taxonomy + idempotency + audit                                                                                                                                                                |
| Pre-Slice docs (failure-modes/idempotency/cost-budget)     | 🟢 completo    | Brief design docs                                                                                                                                                                                                              |
| **Pre-Slice 1 hardening A1-A10 (Camino A+)**               | 🟢 completo    | 13 migrations + error taxonomy + CI + lefthook + zod env + tsconfig strict++ + ESLint boundaries + Prettier + docs split + dep audit                                                                                           |
| **Pre-Slice 1 Industrial Hardening B0-B6+B+R (Camino B+)** | 🟢 completo    | Business spec lock + migration timestamps + outbox B2 + security headers + Upstash rate limit + RLS CI gate + threat model + perf tuning + SLO + runbooks + backup strategy. 16 issues HIGH del audit profundo. 423/423 tests. |
| **Slice 1 — Real DB + LLM + Meta sandbox**                 | 🟡 en progreso | 7.1+7.2 Supabase setup + 16 migrations ✅. 7.3 DB client ✅. 7.4 14/14 repos + 154 integration ✅. 7.5 5/5 LLM OpenAI impls ✅. 7.6+ pendiente.                                                                                |
| **Slice 2 — UI + Realtime + Server Actions**               | ⚪ pendiente   | Inbox + Lead Twin panel + Server Actions                                                                                                                                                                                       |
| **Slice 3 — Auth + RLS audited**                           | ⚪ pendiente   | Policies + STRIDE walkthrough                                                                                                                                                                                                  |
| **Slice 4 — Cron real + hardening + launch**               | ⚪ pendiente   | Soft launch monitoreado                                                                                                                                                                                                        |

**Métricas actuales:** 466/466 unit tests pass (439 pre-7.5 + 27 LLM impls + bridge) · 154/154 integration tests verde contra Supabase real · 0 typecheck errors · 0 lint errors (warnings boundaries/element-types deprecation pre-existentes) · format clean · 34 commits conventional history (último: `0db4e07 feat(llm): Slice 1 7.5 OpenAiAgentLLM — 5/5 LLMs COMPLETE`) · **remoto `https://github.com/Leonardo-A1varez/crm.git` configurado (privado, master sync)**.

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
- ❌ Iniciar `npm run dev` o `next dev` automáticamente. Usuario arranca.
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
