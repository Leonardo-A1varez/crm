# Cómo retomar la sesión

> Última pausa: 2026-07-13. **Slice 2 8.2 conversation view COMPLETO (código).** Backend `listBySessionId` + `getConversation` + UI completa `/inbox/[leadId]`. 605 unit verde. Fix time bomb test merge-detector. **BLOQUEO: Supabase `crm-dev` INACTIVE (auto-pause free tier) — restore manual en dashboard requerido para browser validation 8.1+8.2 + integration tests (esperado 157). Deadline: free tier borra proyectos pausados ~90d (~fines agosto 2026).** Pendientes no-blocker: 7.7.B/C/D observability + Path B smoke.

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
| Restore Supabase `crm-dev`                     | 🔴 BLOQUEANTE        | Dashboard → proyecto `edlranjncwpxkyllopfa` → Restore. Sin esto: no browser validation, no integration tests, y el proyecto se borra ~90d post-pausa.                                                                                                                                                                                         |
| Slice 2 8.3 Lead Twin panel                    | 🟡 Siguiente         | TwinPanel server render `lead_session` campos + extras jsonb + StageBadge color-coded + TwinEmptyState. Sidebar derecha 320px en `/inbox/[leadId]`.                                                                                                                                                                                           |

---

## Cómo continuar (próxima sesión)

### Paso 0 — Restore Supabase (BLOQUEANTE, manual usuario)

> Dashboard https://supabase.com/dashboard/project/edlranjncwpxkyllopfa → **Restore project** (~2-5 min). Después: `npm run test:integration` (esperado 157 verde, incluye 3 nuevos listBySessionId).

### Opción A — Validación browser 8.1 + 8.2 (recomendado post-restore)

> `npm run dev` (puerto 3001) → `/inbox`: SideNav 7 items + EmptyState (DB vacía) o lista poblada (fixture SQL spec §11). Click lead → `/inbox/[leadId]`: header (nombre + íconos canal + stage) + thread burbujas bottom-anchored. Lead inexistente → 404. Confirmar antes de 8.3.

### Opción B — Slice 2 8.3 Lead Twin panel

> Sub-paso 8.3 — TwinPanel server component render campos `lead_session` + `extras` jsonb + StageBadge color-coded + TwinEmptyState. Integrar en `/inbox/[leadId]` layout (right sidebar 320px). Sin Server Actions todavía.

### Opción C — Slice 2 8.4-8.5 Server Actions write path

> Sub-pasos 8.4 + 8.5 — MessageInput client + send-message.action + HandoffToggle + CloseSessionButton + toggle-handoff.action + close-session.action. Zod parse línea 1 (regla §0.9.3). Validar manual: enviar mensaje real outbound Meta + pausar IA + cerrar sesión.

### Opción D — Slice 1 7.7.B PinoLogger producción

> Continuá 7.7.B — PinoLogger wrapper + factory `getLogger(env)`. NODE_ENV=production → Pino, else → ConsoleLogger. Aplica `redactPii` mismo lugar. Hook Vercel Log Drains JSON. Pre-Slice 4 launch obligatorio.

### Opción E — Slice 1 7.10 Path B full E2E smoke

> Extender 7.10 a Path B — webhook → emit → invocar directamente `onMessageReceivedHandler` con InMemory bootstrap + spy metaClient. Asserts: lead creado + sesión activa + mock LLM response + `metaApi.sendOutbound` capturado + idempotency replay.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md`, `docs/superpowers/specs/2026-05-17-slice2-ui-core-design.md` y `docs/superpowers/plans/2026-05-17-slice2-81-inbox-list.md`. Confirmá estado Slice 2 8.1 completo y continuemos con [opción A/B/C/D/E].

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
27dd5a7 feat(ui): Slice 2 8.2 inbox/[leadId] RSC fetch getConversation + loading
22fca97 feat(ui): Slice 2 8.2 componentes conversación (bubbles + thread + header + icons)
c8da21f feat(svc): InboxService.getConversation + ConversationView + 5 tests
6712613 feat(repo): MessagesRepository.listBySessionId (thread ASC cross-conv) + 3 tests
227a211 fix(inngest): clock inyectable en per-lead merge detector (time bomb test)
b55d24f docs(agents,next-session): Slice 2 8.1 inbox read-only list COMPLETO
f04f382 feat(ui): Slice 2 8.1 inbox/page RSC fetch + render
6ef736e feat(ui): inbox loading.tsx skeleton (6 placeholder rows)
4008226 chore(ui): delete ChatList stub (reemplazado por InboxList)
d15fbfa feat(ui): InboxList server component reemplaza stub
```

---

## Conexión Supabase actual (referencia)

- Proyecto: `crm-dev`
- Region: East US (Ohio) `us-east-2`
- Reference ID: `edlranjncwpxkyllopfa`
- Postgres 17, Plan Free, Linked CLI ✅
- **Status: INACTIVE desde ~2026-05-25 (free tier auto-pause). RESTORE PENDIENTE — dashboard → Restore project. Free tier borra pausados ~90d.**
- Migrations aplicadas: 16/16
- Advisors clean: ✅ (re-verificar post-restore)
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
