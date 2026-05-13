# CRM Repuestos Automotrices

CRM conversacional single-org self-hosted con agente IA seller multi-canal (WhatsApp, Instagram, Facebook), motor de intents + reglas, Lead Twin estructurado y workflows durables en Inngest.

> **Estado actual:** Foundation completa (Fases 0-6 + REPAIR R1-R12 + Pre-Slice 1 hardening A1-A9). 394/394 tests pass, coverage 89%, 0 typecheck errors, CI verde. Integraciones reales con Supabase + OpenAI + Meta se conectan en **Slice 1** (siguiente). Detalle progreso → `AGENTS.md §2`. Histórico → `docs/changelog.md`.

---

## Tabla de contenidos

- [Visión del producto](#visión-del-producto)
- [Qué hace](#qué-hace)
- [Qué NO hace](#qué-no-hace)
- [Stack](#stack)
- [Cómo correr](#cómo-correr)
- [Documentación técnica](#documentación-técnica)
- [Convenciones](#convenciones)
- [Variables de entorno](#variables-de-entorno)
- [Glosario](#glosario)

---

## Visión del producto

Negocio: venta de **repuestos automotrices**. Volumen objetivo: ~1000 leads/semana. Conversaciones cortas (5-15 mensajes). Equipo: 3-4 usuarios internos (admin + vendedores).

Diferenciadores frente a CRMs tradicionales (HubSpot, Pipedrive, Kommo):

1. **Sin pipeline kanban manual.** Las "etapas" se infieren automáticamente por la IA en cada turno (`current_stage`). El vendedor humano filtra, no arrastra cards.
2. **Lead Twin.** Cada lead tiene una ficha estructurada que un LLM extractor mantiene actualizada en cada turno. El vendedor no scrollea 30 mensajes; lee el Twin.
3. **Motor de reglas IF/THEN pre-LLM.** Intents recurrentes (saludo, pregunta de horario, objeción típica) se responden con plantillas sin invocar GPT-4. Reduce costo y latencia.
4. **Reactivación predictiva.** Leads perdidos se segmentan por motivo y se reactivan automáticamente con cron + plantillas.
5. **Catálogo conectado al agente.** El agente IA tiene tool `buscar_repuesto(query)` (definida con Zod via Vercel AI SDK) que devuelve SKU interno, stock y precio reales; nunca alucina datos.

---

## Qué hace

- Inbox unificado WhatsApp + Instagram + Facebook Messenger (Meta Cloud API oficial).
- Reconocimiento de mismo lead a través de canales (vinculación por teléfono cuando WA, merge manual cuando IG/FB).
- UI inbox tipo WhatsApp Web: lista de chats, conversación central, panel **Lead Twin** a la derecha. Header muestra ícono del canal activo + íconos pequeños de canales vinculados.
- Agente IA seller con OpenAI GPT-4.x via **Vercel AI SDK** (tools + multi-step). Mantiene contexto, consulta catálogo, decide cuándo escalar a humano.
- **Auto-stage**: agente clasifica sesión actual en `nuevo → identificando → cotizado → negociando → esperando_pago → cerrado | perdido | requiere_humano` tras cada turno.
- **Lead Twin**: tabla `lead_session` se actualiza por step paralelo del workflow (LLM extractor) con consulta, producto cotizado, urgencia, bloqueador, comprobante pago, resultado, etc.
- **Motor intents + reglas IF/THEN**: cron semanal detecta intents recurrentes; admin aprueba; reglas ejecutan respuestas fijas antes de invocar LLM.
- **Handoff humano**: manual (botón pausar) o automático (N intents desconocidos consecutivos).
- **Tags** auto-asignados por workflows + editables manualmente.
- **Reactivación predictiva**: cron semanal sobre leads perdidos segmentados por `motivo_perdida` con cooldown en `reactivation_dispatches` table.
- **Multi-sesiones históricas**: 1 sesión activa simultánea por lead. Cron diario purga sesiones cerradas con `closed_at < now() - 29 días`.
- **Merge auto-detection**: heurística cross-canal (nombre exacto + canales distintos + window 7d + sin conflicto vehículo) marca pares como `pending` en `merge_candidates` para revisión admin.

---

## Qué NO hace

- Multi-tenancy (single-org).
- Pipeline kanban arrastrable, deals, tareas/recordatorios.
- Email, SMS, llamadas.
- Fine-tuning de modelos, RAG vectorial.
- Workflows visuales tipo n8n (solo reglas IF/THEN).
- BSPs (Twilio, 360dialog, Gupshup), WhatsApp no oficial (Baileys).
- Foto-to-SKU (identificar pieza por imagen). Diferido v2.
- App móvil nativa.
- Integraciones con CRMs externos.
- Reportes BI avanzados.
- Billing, suscripciones.

---

## Stack

| Capa                           | Tecnología                                               | Razón                                                                                   |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Frontend + API                 | **Next.js 16** App Router + RSC + Server Actions + TS    | Único framework. Sin NestJS.                                                            |
| UI                             | **Tailwind v4 + shadcn/ui**                              | Copy-paste, accesibles.                                                                 |
| DB + Auth + Storage + Realtime | **Supabase (Postgres)**                                  | Única DB. RLS, Realtime, Storage.                                                       |
| Workflows + cron               | **Inngest v4**                                           | Durable, retries, replay, dashboard.                                                    |
| LLM                            | **Vercel AI SDK** (`@ai-sdk/openai`, GPT-4.x)            | `generateObject` Zod-typed, tool calling, multi-step `stopWhen`. Provider swap 1 línea. |
| Mensajería                     | **Meta Cloud API** (WhatsApp Business + Graph API IG/FB) | Oficial.                                                                                |
| Observability                  | Logger interface + Pino + Vercel Log Drains (Slice 1)    | Structured JSON.                                                                        |
| Cost tracking                  | CostTracker + Vercel KV (Slice 1)                        | Daily cap kill switch.                                                                  |
| Feature flags                  | FeatureFlags + Edge Config (Slice 1)                     | Hot reload sin redeploy.                                                                |
| Locking                        | SessionLock + Postgres advisory lock (Slice 1)           | Single-flight twin extractor.                                                           |
| Validación                     | **Zod** + zod env fail-fast                              | Schemas + runtime env.                                                                  |
| Tests                          | **Vitest** + coverage v8 (threshold 80%)                 | Rápido, ESM nativo.                                                                     |
| Formato                        | **Prettier** + prettier-plugin-tailwindcss               | Sort classes auto.                                                                      |
| Lint                           | **ESLint** + eslint-plugin-boundaries                    | Architecture zones enforced.                                                            |
| Hooks                          | **lefthook** + commitlint conventional                   | Pre-commit + commit-msg + pre-push.                                                     |
| CI                             | **GitHub Actions** + npm audit                           | Typecheck + lint + tests + coverage threshold.                                          |
| Hosting                        | **Vercel**                                               | Next.js + Inngest nativos.                                                              |

Arquitectura por capas: API/Action → Service → Repository → DB. **Nunca saltar capas.** Detalle → `docs/architecture.md`.

---

## Cómo correr

> Disponible cuando Slice 1 esté completo. Hasta entonces todo corre mock in-memory.

```bash
cd C:\Users\Tinki\Proyectos\crm
npm install                         # incluye lefthook install via prepare
cp .env.local.example .env.local    # editar valores
npm run dev                         # Next.js dev server (puerto 3001)
npm run typecheck                   # tsc (src + tests separados)
npm run lint                        # eslint + boundaries
npm run format                      # prettier write
npm test                            # vitest 394 tests
npm run test:coverage               # con threshold 80/75/80/80
npm run ci                          # typecheck + lint + format:check + test:coverage
npm run inngest:dev                 # Inngest Dev Server localhost:8288
```

Scripts Supabase (Slice 1+): `npm run db:push`, `db:gen-types`, `db:advisors`, `db:reset`.

---

## Documentación técnica

| Documento               | Contenido                                                          |
| ----------------------- | ------------------------------------------------------------------ |
| `AGENTS.md`             | Reglas de oro, estado actual, convenciones código, qué NO hacer.   |
| `docs/architecture.md`  | Capas, patterns, flujo webhook→reply, AI SDK integration.          |
| `docs/data-model.md`    | 13 migrations, enums, tablas, indexes, RLS planificadas.           |
| `docs/workflows.md`     | 8 Inngest functions, events catalog, retry semantics.              |
| `docs/idempotency.md`   | Keys por operación, race tolerance, dedup strategy.                |
| `docs/failure-modes.md` | Tabla por workflow → modo de falla → retry/skip/alert.             |
| `docs/cost-budget.md`   | Targets LLM, pricing tables, kill switch, alert thresholds.        |
| `docs/changelog.md`     | Histórico completo: Fases 0-6 + REPAIR + Pre-Slice 1 + decisiones. |

---

## Convenciones

- **Idioma:** español en UI, comentarios, commits. Identificadores técnicos en inglés; identificadores de dominio en español (`lead_session`, `bloqueador`).
- **Arquitectura:** API/Action → Service → Repository → DB. Saltar capas prohibido. Service-role vs authed clients separados (ESLint boundaries enforce).
- **Validación:** Zod en TODOS los inputs HTTP.
- **Tests:** Vitest, repos mockeados in-memory, contract tests `runXContract(makeRepo)` reusables in-memory ↔ Supabase.
- **Commits:** Conventional Commits (commitlint enforce). Subject ≤72 chars, español.
- **TypeScript:** strict + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` + `noImplicitOverride`. No `any`.
- **Server Components por defecto.** `'use client'` sólo cuando interactividad.

---

## Variables de entorno

Plantilla en `.env.local.example`. Validación runtime con zod fail-fast (`src/lib/env.ts`).

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# OpenAI (vía Vercel AI SDK)
OPENAI_API_KEY=

# Meta Cloud API
META_APP_SECRET=
META_VERIFY_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_GRAPH_API_VERSION=v21.0

# LLM cost guard
LLM_DAILY_CAP_USD=10
```

---

## Glosario

- **Lead Twin** — Ficha estructurada de la sesión actual del lead, mantenida por LLM extractor. Vive en `lead_session`.
- **Auto-stage** — `current_stage` clasificada automáticamente por la IA tras cada turno.
- **Sesión** — Conversación atómica con un lead que termina en `exito` o `perdido`. Multi-sesiones históricas.
- **Handoff** — Transferencia de control IA → humano. Manual (botón) o automática (regla).
- **Regla IF/THEN** — Mapping `intent + condiciones → respuesta fija`. Pre-LLM.
- **Intent** — Categoría semántica de un mensaje del lead.
- **Conversación** — Hilo persistente por canal con un lead. Persiste; sesiones internas se purgan.
- **Reactivación predictiva** — Cron semanal sobre leads perdidos segmentados por `motivo_perdida` con cooldown DB.
