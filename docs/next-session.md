# Cómo retomar la sesión

> Última pausa: 2026-07-14 (cont. 2). **Slice 4a Hardening COMPLETO** (mismo día que Slice 3 completo). Pino+getLogger · Sentry env-gated · OTel+withSpan · `/api/health` (curl 200 degraded ✅) · CostTracker Upstash (fix kill-switch serverless) · purge real con storage cleanup · reactivación real con templates por motivo. 666 unit verdes; migrations 18/18. **Usuario dev local: `admin-dev@crm.local` / `dev-admin-2026!` (solo crm-dev).** Siguiente: **Slice 4b deploy+launch (checklist Opción A)** o vistas Slice 2 9-12. **Pendiente manual: dashboard → Advisors (CLI 403 free tier).**

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`OPENAI_API_KEY`, `service_role`, `sb_secret_*`, `META_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                        | Estado               | Notas                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening)  | ✅ Completo          | 4 docs + outbox + security headers + rate limiter + threat model + SLO + runbooks + backup                                                                                                                                                                                                                                                    |
| Slice 1 7.1+7.2 Supabase setup + config         | ✅ Completo          | 16 migrations aplicadas a `crm-dev`                                                                                                                                                                                                                                                                                                           |
| Slice 1 7.3 DB client wireup                    | ✅ Completo          | `src/server/db/client.ts` real                                                                                                                                                                                                                                                                                                                |
| Slice 1 7.4 14/14 repos Supabase impl           | ✅ Completo          | leads · tags · productos · users · intents · reglas · conversations · messages · lead-session · tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox. 154 integration verde.                                                                                                                             |
| Backup remoto git                               | ✅ Completo          | `https://github.com/Leonardo-A1varez/crm.git` privado, master sync                                                                                                                                                                                                                                                                            |
| Slice 1 7.5 AI SDK + 5 LLM impls reales         | ✅ Completo          | OpenAI vía `ai@6.0.180` + `@ai-sdk/openai@3.0.63`. intent-classifier · twin-extractor · conversation-summarizer · intent-batch-detector · ai-agent. Infra pricing + cost-tracker bridge. 27 unit tests LLM.                                                                                                                                   |
| Slice 1 7.6 Meta Cloud API real                 | ✅ Completo          | WA real (`46234e8`) + IG + FB Messenger (`ad7f254`). Env opcionales `META_IG_*` + `META_FB_*`. 19/19 unit tests. Doc `docs/meta-webhook-payloads.md`.                                                                                                                                                                                         |
| Reglas oro 9-11 + quick wins §0.9 PII           | ✅ Completo          | `redactPii` util + wireup `ConsoleLogger` runtime + ESLint `no-console` + vitest exclude supabase repos (fix coverage 59.96→88.99).                                                                                                                                                                                                           |
| Slice 1 7.7.A LLM Factory env-based             | ✅ Completo          | `LLM_MODE=real\|mock` selector. `makeLlmFactory` retorna `LlmBundle` (5 LLMs). 5 `InMemory*LLM` mocks deterministic. `ef6e60d`. 12 tests.                                                                                                                                                                                                     |
| Slice 1 7.8 Inngest serve wireup                | ✅ Completo          | Bootstrap `makeInngestDeps` wirea 11 repos + 8 services + LlmBundle + GraphApiMetaClient + 4 callbacks. `/api/webhooks/inngest` mounta 9 functions. `ce3d24d`. 9 tests bootstrap.                                                                                                                                                             |
| Slice 1 7.7.B PinoLogger (producción)           | ✅ Completo (4a)     | `PinoLogger` + `getLogger(env)`; paridad `redactPii` testeada. `ea46c84`.                                                                                                                                                                                                                                                                     |
| Slice 1 7.7.C OTel SDK + spans                  | ✅ Completo (4a)     | `@vercel/otel` + `withSpan` (webhook/llm/meta). `7e9a89f`.                                                                                                                                                                                                                                                                                    |
| Slice 1 7.7.D Sentry uncaught tracking          | ✅ Completo (4a)     | `@sentry/nextjs` env-gated client/server/edge + redact. `33b3ef8`.                                                                                                                                                                                                                                                                            |
| Slice 1 7.9 Webhook Meta route                  | ✅ Completo          | `/api/webhooks/meta` HMAC verify + parse + emit `meta/message.received`. 12 tests. `62f8fbf`.                                                                                                                                                                                                                                                 |
| Slice 1 7.10 E2E smoke Path A                   | ✅ Completo          | InMemory bootstrap + signed payload assertions. 6 tests. `d886fed`.                                                                                                                                                                                                                                                                           |
| **Slice 2 8.1 inbox read-only list**            | ✅ Completo          | Backend `InboxService.listActiveLeads` orquesta leads+sessions+convs+messages. UI: PanelLayout+SideNav 7 items + inbox/page RSC fetch + InboxList+InboxListItem (canal dots wa/ig/fb, stage badge, ultima_actividad relativa) + EmptyState + loading.tsx. 12 commits `11b9e78..f04f382`.                                                      |
| **Slice 2 8.2 conversation view**               | ✅ Completo (código) | `MessagesRepository.listBySessionId` (ASC cross-conv) + `InboxService.getConversation` → `ConversationView`. UI: ChannelIcons SVG + MessageBubble + ChatThread (col-reverse) + RelativeTime + ConversationHeader + `[leadId]/page` RSC + loading. Commits `6712613..27dd5a7`. 605 unit verde. Browser validation gated por Supabase INACTIVE. |
| ~~Restore Supabase~~ → migrado cuenta main      | ✅ Resuelto          | Nuevo `crm-dev` ref `emubzkouwvuzlrtsgorx`, 16/16 migrations, keepalive GitHub Action 2x/semana.                                                                                                                                                                                                                                              |
| Slice 2 8.3 Lead Twin panel + error.tsx         | ✅ Completo          | TwinPanel (consulta/urgencia/cotización/bloqueador/pago/extras/context_summary condicionales) + TwinEmptyState + StageBadge 8 colores (reuso InboxListItem) + aside `w-80 max-lg:hidden` + `(panel)/error.tsx` digest + XSS guard `safeHttpUrl`. Validado Playwright browser 2026-07-13. Commits `ed4a6da..6653be8`.                          |
| Slice 2 8.4-8.5 Server Actions write            | ✅ Completo          | InboxService.sendMessage/toggleHandoff/closeSession (delegación, 24 tests TDD) + 3 actions `_actions/` Zod línea 1 + ActionResult + MessageInput/HandoffToggle/CloseSessionButton + Toaster + lang=es. Validado browser (fixture "María López" uuid RFC — zod 4 rechaza lead legacy `1111...`). Commits `81a44ce..3322ae9`.                   |
| Slice 2 8.6 RefreshPoller                       | ✅ Completo          | 5s en `/inbox` + `/inbox/[leadId]`; skip `document.hidden` + re-sync visibilitychange. Validado: INSERT externo visible ≤5s sin F5. `442e046`.                                                                                                                                                                                                |
| Slice 2 8.7 ChannelTabs                         | ✅ Completo          | Links server `?canal=wa\|ig\|fb` + filtro post-fetch `CanalSchema.safeParse` (inválido → todos). Validado browser. `8b6a5b3`.                                                                                                                                                                                                                 |
| Slice 2 8.8 tests full InboxService             | ✅ Completo          | +3 edge cases listActiveLeads (fallback started_at, cross-canal ambos órdenes, contenido null). 37/37 branches. `eb3a0c4`.                                                                                                                                                                                                                    |
| **Slice 3 Auth + RLS (9.1-9.4)**                | ✅ Completo          | 9.1 @supabase/ssr + login/logout + proxy gate (validado browser 6/6). 9.2 migration 43 policies + storage + `MIN_RLS_POLICIES=40` + suite RLS 11/11. 9.3 panel authed per-request (`makeInboxService`/`getInboxServiceForRequest`), smoke browser con RLS activo. 9.4 STRIDE + review 0 findings. Spec+plan en `docs/superpowers/`.           |
| **Slice 4a — hardening pre-launch (10.1-10.7)** | ✅ Completo          | Pino paridad-redact · Sentry DSN-gated · OTel spans calientes · /api/health anon-ping · UpstashCostTracker (fallback dev) · repo.delete + purge storage-cleanup replay-safe · reactivación templates + skips bounced/cooldown. Spec+plan `docs/superpowers/*slice4a*`.                                                                        |
| **Slice 4b — deploy + soft launch**             | 🟡 Siguiente         | Checklist Opción A. Bloqueado por acciones usuario (creds/cuentas).                                                                                                                                                                                                                                                                           |

---

## Cómo continuar (próxima sesión)

### Paso 0 — ~~Restore Supabase~~ RESUELTO 2026-07-13

> Proyecto migrado a cuenta main: nuevo `crm-dev` ref `emubzkouwvuzlrtsgorx`. 16 migrations pusheadas, `.env.local` actualizado (keys formato nuevo `sb_publishable_`/`sb_secret_`), CLI re-linkeado. Ver sección "Conexión Supabase actual".

### Opción A — Slice 4b: deploy + soft launch (recomendado; checklist usuario primero)

> **Acciones del usuario (secrets SIEMPRE directo a `.env.local`/Vercel, jamás al chat):**
>
> 1. Creds reales en `.env.local`: `META_APP_SECRET/VERIFY_TOKEN/WHATSAPP_*` (app Meta + número WhatsApp Business), `OPENAI_API_KEY`, `INNGEST_EVENT_KEY/SIGNING_KEY`, `UPSTASH_REDIS_REST_*` (free), `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (cuenta free).
> 2. Cuenta Vercel + proyecto linkeado.
>
> **Después, juntos:** validar send outbound real local → deploy preview → env vars Vercel → webhook Meta apuntando al deploy → smoke E2E real (mensaje WhatsApp entra y la IA responde) → `/api/health` = ok → monitor externo → templates Meta para reactivación → revisar Advisors + checklist threat model pre-launch → soft launch 10 leads.

### Opción B — Vistas Slice 2 9-12 (leads/productos/intents-reglas/tags/métricas/ajustes)

> UI restante del panel sin dependencia de creds. Cada vista = spec corta + sub-pasos como 8.x.

### Opción C — Slice 1 7.10 Path B full E2E smoke

> Extender 7.10 a Path B — webhook → emit → invocar directamente `onMessageReceivedHandler` con InMemory bootstrap + spy metaClient. Asserts: lead creado + sesión activa + mock LLM response + `metaApi.sendOutbound` capturado + idempotency replay.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/superpowers/specs/2026-07-14-slice4a-hardening-design.md`. Confirmá estado Slice 4a completo y continuemos con [opción A/B/C]. Para entrar al panel local: `admin-dev@crm.local` / `dev-admin-2026!`.

---

## Pattern arquitectural LLM impls (7.5) — referencia futuras

Cada impl en `src/server/services/llm/openai-<name>.ts`:

1. **Config**: `{ model: LanguageModel; modelName: string; costTracker: CostTracker; ...optionals }`.
2. **System prompt**: específico al dominio (CRM repuestos LATAM). Constraints claras (longitud respuesta, output format, fallback handoff).
3. **Output estructurado**:
   - `generateObject` + zod schema (intent-classifier, twin-extractor, intent-batch-detector).
   - `generateText` (conversation-summarizer texto libre, ai-agent tool calling).
4. **Wrapper schema para arrays**: en lugar de `output: "array"` del SDK, usar `z.object({ <key>: z.array(...) })` — patrón object-with-array-key matchea naturalmente LLMs + más predecible para mocking.
5. **Cost-tracking**: `await recordLlmUsage(tracker, result, { model, workflow, sessionId? })` post-call. workflow = nombre LLM (para attribution).
6. **Tests unitarios**: `MockLanguageModelV3` con `doGenerate` returning V3 protocol shape (`content: [{type:'text', text: JSON.stringify(obj)}]` para JSON outputs). Para tool calling end-to-end, defer a integration suite (V3 protocol complejo).
7. **Boundaries ESLint**: interfaces compartidas server-services/inngest → vivir en `server-services/` (zone server-services NO puede importar de inngest). Inngest re-exporta via `export type` si necesita backward-compat.

---

## Comandos útiles para verificar estado

```powershell
# Ver últimos 10 commits
git log --oneline -10

# Run unit tests (incluye LLM impls)
npm test

# Run integration tests (necesita SUPABASE_TEST_* en .env.local)
npm run test:integration

# Full CI local
npm run ci

# Migrations Supabase
supabase migration list --linked

# Regenerar types.gen.ts si cambias migrations
supabase gen types typescript --linked | Out-File -Encoding utf8 src/server/db/types.gen.ts
```

---

## Historial de commits (últimos 10)

```
a7c882e feat(inngest): Slice 4a 10.7 reactivacion real templates por motivo
eba1f48 feat(inngest): Slice 4a 10.6 purge real con storage cleanup
d6f14f1 feat(repo): Slice 4a 10.6 LeadSessionRepository.delete idempotente
93a3969 feat(obs): Slice 4a 10.5 CostTracker Upstash persistente + factory
440f051 feat(ops): Slice 4a 10.4 /api/health + grant server_now anon
7e9a89f feat(obs): Slice 4a 10.3 OTel registerOTel + withSpan puntos calientes
33b3ef8 feat(obs): Slice 4a 10.2 Sentry env-gated + redact PII
ea46c84 feat(obs): Slice 4a 10.1 PinoLogger + getLogger env-based
4a05894 docs(plan): Slice 4a hardening plan 9 tasks
35c83a6 docs(spec): Slice 4a hardening pre-launch design spec
```

---

## Conexión Supabase actual (referencia)

- Proyecto: `crm-dev` (**NUEVO 2026-07-13** — recreado en cuenta main; el viejo `edlranjncwpxkyllopfa` quedó INACTIVE en cuenta vieja y se auto-borra ~90d, sin data valiosa)
- Reference ID: `emubzkouwvuzlrtsgorx`
- Org: `ufmftdzojedsyujtsjqx` (misma que Genuino_app — límite free: 2 proyectos activos por org)
- Postgres 17, Plan Free, Linked CLI ✅ (token CLI = cuenta main desde 2026-07-13)
- Migrations aplicadas: 16/16 (push 2026-07-13, types.gen.ts idéntico verificado)
- ⚠️ Free tier auto-pausa tras ~1 semana idle — mismo riesgo que mató al anterior. Mitigación pendiente: keepalive cron (GitHub Action ping semanal) o upgrade Pro.
- ⚠️ Latencia REST residencial 0.4-1s/req → integration timeouts 120s + retry 1 (`vitest.integration.config.ts`)
- Remoto git: `https://github.com/Leonardo-A1varez/crm.git` (privado, master sync)

---

## Deps relevantes nuevas (7.5)

- `ai@6.0.180` — Vercel AI SDK core (`generateObject`, `generateText`, `tool`, `MockLanguageModelV3`)
- `@ai-sdk/openai@3.0.63` — Provider OpenAI (`openai()` singleton lee `OPENAI_API_KEY`)

Modelos OpenAI con pricing definido (`src/server/services/llm/pricing.ts`):

- `gpt-4o-mini` (default) — $0.15/M in, $0.60/M out
- `gpt-4o` — $2.50/M in, $10.00/M out
- `gpt-4.1-mini` — $0.40/M in, $1.60/M out
- `gpt-4.1` — $2.00/M in, $8.00/M out
