# Cómo retomar la sesión

> Última pausa: 2026-07-13 (cont.). **Slice 2 8.3 Lead Twin panel COMPLETO + validado browser.** TwinPanel secciones condicionales + TwinEmptyState + StageBadge color-coded (reuso InboxListItem) + aside 320px + `(panel)/error.tsx` + fix XSS `safeHttpUrl` sobre comprobante. 605 unit verde, typecheck/lint/format limpios, Playwright contra Supabase real (fixture twin enriquecida vía script service-role). Commits `ed4a6da` + `5b1f5b3` + `6653be8` + docs. Pendientes no-blocker: 7.7.B/C/D observability + Path B smoke.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`OPENAI_API_KEY`, `service_role`, `sb_secret_*`, `META_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado               | Notas                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo          | 4 docs + outbox + security headers + rate limiter + threat model + SLO + runbooks + backup                                                                                                                                                                                                                                                    |
| Slice 1 7.1+7.2 Supabase setup + config        | ✅ Completo          | 16 migrations aplicadas a `crm-dev`                                                                                                                                                                                                                                                                                                           |
| Slice 1 7.3 DB client wireup                   | ✅ Completo          | `src/server/db/client.ts` real                                                                                                                                                                                                                                                                                                                |
| Slice 1 7.4 14/14 repos Supabase impl          | ✅ Completo          | leads · tags · productos · users · intents · reglas · conversations · messages · lead-session · tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox. 154 integration verde.                                                                                                                             |
| Backup remoto git                              | ✅ Completo          | `https://github.com/Leonardo-A1varez/crm.git` privado, master sync                                                                                                                                                                                                                                                                            |
| Slice 1 7.5 AI SDK + 5 LLM impls reales        | ✅ Completo          | OpenAI vía `ai@6.0.180` + `@ai-sdk/openai@3.0.63`. intent-classifier · twin-extractor · conversation-summarizer · intent-batch-detector · ai-agent. Infra pricing + cost-tracker bridge. 27 unit tests LLM.                                                                                                                                   |
| Slice 1 7.6 Meta Cloud API real                | ✅ Completo          | WA real (`46234e8`) + IG + FB Messenger (`ad7f254`). Env opcionales `META_IG_*` + `META_FB_*`. 19/19 unit tests. Doc `docs/meta-webhook-payloads.md`.                                                                                                                                                                                         |
| Reglas oro 9-11 + quick wins §0.9 PII          | ✅ Completo          | `redactPii` util + wireup `ConsoleLogger` runtime + ESLint `no-console` + vitest exclude supabase repos (fix coverage 59.96→88.99).                                                                                                                                                                                                           |
| Slice 1 7.7.A LLM Factory env-based            | ✅ Completo          | `LLM_MODE=real\|mock` selector. `makeLlmFactory` retorna `LlmBundle` (5 LLMs). 5 `InMemory*LLM` mocks deterministic. `ef6e60d`. 12 tests.                                                                                                                                                                                                     |
| Slice 1 7.8 Inngest serve wireup               | ✅ Completo          | Bootstrap `makeInngestDeps` wirea 11 repos + 8 services + LlmBundle + GraphApiMetaClient + 4 callbacks. `/api/webhooks/inngest` mounta 9 functions. `ce3d24d`. 9 tests bootstrap.                                                                                                                                                             |
| Slice 1 7.7.B PinoLogger (producción)          | ⚪ Pendiente         | Pino wrapper + Vercel Log Drains hook + factory `getLogger(env)`. Mantiene `redactPii` mismo pattern.                                                                                                                                                                                                                                         |
| Slice 1 7.7.C OTel SDK + spans                 | ⚪ Pendiente         | `@vercel/otel` + custom spans webhook/inngest/llm/db.                                                                                                                                                                                                                                                                                         |
| Slice 1 7.7.D Sentry uncaught tracking         | ⚪ Pendiente         | `@sentry/nextjs` config client + server + edge.                                                                                                                                                                                                                                                                                               |
| Slice 1 7.9 Webhook Meta route                 | ✅ Completo          | `/api/webhooks/meta` HMAC verify + parse + emit `meta/message.received`. 12 tests. `62f8fbf`.                                                                                                                                                                                                                                                 |
| Slice 1 7.10 E2E smoke Path A                  | ✅ Completo          | InMemory bootstrap + signed payload assertions. 6 tests. `d886fed`.                                                                                                                                                                                                                                                                           |
| **Slice 2 8.1 inbox read-only list**           | ✅ Completo          | Backend `InboxService.listActiveLeads` orquesta leads+sessions+convs+messages. UI: PanelLayout+SideNav 7 items + inbox/page RSC fetch + InboxList+InboxListItem (canal dots wa/ig/fb, stage badge, ultima_actividad relativa) + EmptyState + loading.tsx. 12 commits `11b9e78..f04f382`.                                                      |
| **Slice 2 8.2 conversation view**              | ✅ Completo (código) | `MessagesRepository.listBySessionId` (ASC cross-conv) + `InboxService.getConversation` → `ConversationView`. UI: ChannelIcons SVG + MessageBubble + ChatThread (col-reverse) + RelativeTime + ConversationHeader + `[leadId]/page` RSC + loading. Commits `6712613..27dd5a7`. 605 unit verde. Browser validation gated por Supabase INACTIVE. |
| ~~Restore Supabase~~ → migrado cuenta main     | ✅ Resuelto          | Nuevo `crm-dev` ref `emubzkouwvuzlrtsgorx`, 16/16 migrations, keepalive GitHub Action 2x/semana.                                                                                                                                                                                                                                              |
| Slice 2 8.3 Lead Twin panel + error.tsx        | ✅ Completo          | TwinPanel (consulta/urgencia/cotización/bloqueador/pago/extras/context_summary condicionales) + TwinEmptyState + StageBadge 8 colores (reuso InboxListItem) + aside `w-80 max-lg:hidden` + `(panel)/error.tsx` digest + XSS guard `safeHttpUrl`. Validado Playwright browser 2026-07-13. Commits `ed4a6da..6653be8`.                          |
| Slice 2 8.4-8.5 Server Actions write           | 🟡 Siguiente         | MessageInput + send-message.action + HandoffToggle + CloseSessionButton + toggle-handoff/close-session actions. Zod parse línea 1. Send outbound real requiere `META_*` reales (hoy `dev-placeholder`).                                                                                                                                       |

---

## Cómo continuar (próxima sesión)

### Paso 0 — ~~Restore Supabase~~ RESUELTO 2026-07-13

> Proyecto migrado a cuenta main: nuevo `crm-dev` ref `emubzkouwvuzlrtsgorx`. 16 migrations pusheadas, `.env.local` actualizado (keys formato nuevo `sb_publishable_`/`sb_secret_`), CLI re-linkeado. Ver sección "Conexión Supabase actual".

### Opción A — Slice 2 8.4-8.5 Server Actions write path (recomendado)

> Sub-pasos 8.4 + 8.5 — MessageInput client + send-message.action + HandoffToggle + CloseSessionButton + toggle-handoff.action + close-session.action. Zod parse línea 1 (regla §0.9.3). Validar manual: enviar mensaje real outbound Meta + pausar IA + cerrar sesión. **Requiere `META_*` reales en `.env.local` (hoy `dev-placeholder`) para validar send.**

### Opción B — Slice 1 7.7.B PinoLogger producción

> Continuá 7.7.B — PinoLogger wrapper + factory `getLogger(env)`. NODE_ENV=production → Pino, else → ConsoleLogger. Aplica `redactPii` mismo lugar. Hook Vercel Log Drains JSON. Pre-Slice 4 launch obligatorio.

### Opción C — Slice 1 7.10 Path B full E2E smoke

> Extender 7.10 a Path B — webhook → emit → invocar directamente `onMessageReceivedHandler` con InMemory bootstrap + spy metaClient. Asserts: lead creado + sesión activa + mock LLM response + `metaApi.sendOutbound` capturado + idempotency replay.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/superpowers/specs/2026-05-17-slice2-ui-core-design.md`. Confirmá estado Slice 2 8.3 completo y continuemos con [opción A/B/C].

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
6653be8 feat(ui): Slice 2 8.3 error boundary (panel) con digest
5b1f5b3 feat(ui): Slice 2 8.3 TwinPanel secciones + TwinEmptyState + aside
ed4a6da feat(ui): Slice 2 8.3 StageBadge color-coded + reuso en InboxListItem
d5839b8 ci(supabase): guard secrets faltantes en keepalive con mensaje claro
e907e9f docs: Supabase migrado a cuenta main + 8.2 validado browser + drift spec
79d5131 chore(ui): metadata real reemplaza Create Next App default
25f3c7a ci(supabase): keepalive cron 2x/semana anti auto-pause free tier
5f393ea chore(vitest): integration timeouts 120s + retry 1 (red residencial)
1053dd2 docs(agents,next-session): Slice 2 8.2 COMPLETO codigo + bloqueo Supabase
27dd5a7 feat(ui): Slice 2 8.2 inbox/[leadId] RSC fetch getConversation + loading
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
