# Cómo retomar la sesión

> Última pausa: 2026-05-17. **Slice 2 8.1 inbox read-only list COMPLETO** end-to-end (backend `InboxService.listActiveLeads` + UI inbox/page RSC + SideNav + InboxList). 597 unit verde, coverage 87.71/80.8/84.69/88.77 > threshold. Falta validación manual browser + Slice 2 8.2 conversation view. Pendientes no-blocker: 7.7.B/C/D observability + Path B smoke (full E2E).

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`OPENAI_API_KEY`, `service_role`, `sb_secret_*`, `META_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado       | Notas                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo  | 4 docs + outbox + security headers + rate limiter + threat model + SLO + runbooks + backup                                                                                                                                                                                                                                                |
| Slice 1 7.1+7.2 Supabase setup + config        | ✅ Completo  | 16 migrations aplicadas a `crm-dev`                                                                                                                                                                                                                                                                                                       |
| Slice 1 7.3 DB client wireup                   | ✅ Completo  | `src/server/db/client.ts` real                                                                                                                                                                                                                                                                                                            |
| Slice 1 7.4 14/14 repos Supabase impl          | ✅ Completo  | leads · tags · productos · users · intents · reglas · conversations · messages · lead-session · tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox. 154 integration verde.                                                                                                                         |
| Backup remoto git                              | ✅ Completo  | `https://github.com/Leonardo-A1varez/crm.git` privado, master sync                                                                                                                                                                                                                                                                        |
| Slice 1 7.5 AI SDK + 5 LLM impls reales        | ✅ Completo  | OpenAI vía `ai@6.0.180` + `@ai-sdk/openai@3.0.63`. intent-classifier · twin-extractor · conversation-summarizer · intent-batch-detector · ai-agent. Infra pricing + cost-tracker bridge. 27 unit tests LLM.                                                                                                                               |
| Slice 1 7.6 Meta Cloud API real                | ✅ Completo  | WA real (`46234e8`) + IG + FB Messenger (`ad7f254`). Env opcionales `META_IG_*` + `META_FB_*`. 19/19 unit tests. Doc `docs/meta-webhook-payloads.md`.                                                                                                                                                                                     |
| Reglas oro 9-11 + quick wins §0.9 PII          | ✅ Completo  | `redactPii` util + wireup `ConsoleLogger` runtime + ESLint `no-console` + vitest exclude supabase repos (fix coverage 59.96→88.99).                                                                                                                                                                                                       |
| Slice 1 7.7.A LLM Factory env-based            | ✅ Completo  | `LLM_MODE=real\|mock` selector. `makeLlmFactory` retorna `LlmBundle` (5 LLMs). 5 `InMemory*LLM` mocks deterministic. `ef6e60d`. 12 tests.                                                                                                                                                                                                 |
| Slice 1 7.8 Inngest serve wireup               | ✅ Completo  | Bootstrap `makeInngestDeps` wirea 11 repos + 8 services + LlmBundle + GraphApiMetaClient + 4 callbacks. `/api/webhooks/inngest` mounta 9 functions. `ce3d24d`. 9 tests bootstrap.                                                                                                                                                         |
| Slice 1 7.7.B PinoLogger (producción)          | ⚪ Pendiente | Pino wrapper + Vercel Log Drains hook + factory `getLogger(env)`. Mantiene `redactPii` mismo pattern.                                                                                                                                                                                                                                     |
| Slice 1 7.7.C OTel SDK + spans                 | ⚪ Pendiente | `@vercel/otel` + custom spans webhook/inngest/llm/db.                                                                                                                                                                                                                                                                                     |
| Slice 1 7.7.D Sentry uncaught tracking         | ⚪ Pendiente | `@sentry/nextjs` config client + server + edge.                                                                                                                                                                                                                                                                                           |
| Slice 1 7.9 Webhook Meta route                 | ✅ Completo  | `/api/webhooks/meta` HMAC verify + parse + emit `meta/message.received`. 12 tests. `62f8fbf`.                                                                                                                                                                                                                                             |
| Slice 1 7.10 E2E smoke Path A                  | ✅ Completo  | InMemory bootstrap + signed payload assertions. 6 tests. `d886fed`.                                                                                                                                                                                                                                                                       |
| **Slice 2 8.1 inbox read-only list**           | ✅ Completo  | Backend `InboxService.listActiveLeads` orquesta leads+sessions+convs+messages. UI: PanelLayout+SideNav 7 items + inbox/page RSC fetch + InboxList+InboxListItem (canal dots wa/ig/fb, stage badge, ultima_actividad relativa) + EmptyState + loading.tsx. 12 commits `11b9e78..f04f382`. 597 unit verde, coverage 87.71/80.8/84.69/88.77. |
| Slice 2 8.2 conversation view                  | 🟡 Siguiente | `/inbox/[leadId]` RSC fetch lead+session+messages+convs → ConversationHeader+ChatThread+MessageBubble+ChannelIcons+RelativeTime. InboxService.getConversation(leadId).                                                                                                                                                                    |

---

## Cómo continuar (próxima sesión)

### Opción A — Slice 2 8.2 Conversation view (recomendado)

Slice 2 8.1 inbox list COMPLETO (12 commits, 597 unit verde, coverage 87.71/80.8/84.69/88.77). Siguiente sub-paso atómico per plan `docs/superpowers/plans/2026-05-17-slice2-81-inbox-list.md` y spec `docs/superpowers/specs/2026-05-17-slice2-ui-core-design.md` §7:

> Continuá Slice 2 8.2 — `/inbox/[leadId]` RSC fetch lead+session+conversations+messages → ConversationHeader (lead.nombre + ChannelIcons + StageBadge + acciones placeholder) + ChatThread (ScrollArea + MessageBubble[] auto-scroll fin) + MessageBubble (in/out alignment + body + timestamp + delivery status) + ChannelIcons (WA/IG/FB SVG con activo grande/vinculados chico) + RelativeTime client. Agregar método `InboxService.getConversation(leadId): Promise<ConversationView>` orquestador. Sin Server Actions todavía (8.4).

El asistente hará:

1. Skills cargadas (`vercel:nextjs` + `vercel:shadcn` + `frontend-design`) — recargar si sesión nueva.
2. TDD service first: getConversation + 4-6 tests InMemory.
3. Bootstrap factory ya existe (`getInboxService`) — agregar método si necesita o reusar instance.
4. Components nuevos en `src/components/inbox/` siguiendo pattern InboxListItem (server por default, client solo cuando necesite interactividad).
5. ConversationHeader: server. RelativeTime: client (auto-refresh 30s).
6. Commits incrementales (1 per task), pausa regla §5 o batch si user pide.

### Opción B — Slice 2 8.3 Lead Twin panel

> Sub-paso 8.3 — TwinPanel server component render `lead_session.extras` jsonb + StageBadge color-coded + TwinEmptyState. Integrar dentro de `/inbox/[leadId]` page layout (right sidebar 320px). Sin Server Actions todavía.

### Opción C — Slice 2 8.4-8.5 Server Actions write path

> Sub-pasos 8.4 + 8.5 combinados — MessageInput client + send-message.action + HandoffToggle + CloseSessionButton + toggle-handoff.action + close-session.action. Zod parse línea 1 (regla §0.9.3). Validar manual: enviar mensaje real outbound Meta + pausar IA + cerrar sesión.

### Opción D — Slice 1 7.7.B PinoLogger producción

> Continuá 7.7.B — PinoLogger wrapper + factory `getLogger(env)`. NODE_ENV=production → Pino, else → ConsoleLogger. Aplica `redactPii` mismo lugar. Hook Vercel Log Drains JSON. Pre-Slice 4 launch obligatorio.

### Opción E — Validación manual browser 8.1

> Antes de seguir, validar `/inbox` en browser local. `npm run dev` puerto 3001 → ver SideNav 7 items + EmptyState (DB vacía) o lista poblada (insertar fixture SQL en spec §11 plan). Confirmar que no rompió antes de seguir 8.2.

### Opción B — Slice 1 7.7.B PinoLogger producción

> Continuá 7.7.B — PinoLogger wrapper + factory `getLogger(env)`. NODE_ENV=production → Pino, else → ConsoleLogger. Aplica `redactPii` mismo lugar. Hook Vercel Log Drains JSON. Pre-Slice 4 launch obligatorio.

### Opción C — Slice 1 7.10 Path B full E2E smoke

> Extender 7.10 a Path B — webhook → emit → invocar directamente `onMessageReceivedHandler` con InMemory bootstrap + spy metaClient. Asserts: lead creado en repo + sesión activa + mock LLM response generado + `metaApi.sendOutbound` capturado + idempotency replay (mismo meta_message_id → no duplicate).

### Opción D — Slice 1 7.7.C OTel SDK + spans

> Continuá 7.7.C — `@vercel/otel` install + spans `webhook.meta.received`, `inngest.<function>.step`, `llm.<workflow>.generate`, `db.<repo>.<op>`. Vercel native exporter auto-detect.

### Opción E — Atacar issues LOW/MEDIUM del audit B+

Ver `docs/security-threat-model.md`, `docs/data-model.md`, `docs/database-tuning.md` known issues.

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

## Historial de commits (últimos 15)

```
d886fed test(smoke): Slice 1 7.10 E2E inbound recv loop (Path A minimal)
62f8fbf feat(webhooks): Slice 1 7.9 /api/webhooks/meta route (HMAC + parse + emit)
ddccb19 docs(agents,next-session): Slice 1 7.7.A + 7.8 COMPLETO + drift fix
ce3d24d feat(inngest): Slice 1 7.8 serve route wireup + bootstrap (DI factories)
ef6e60d feat(llm): Slice 1 7.7.A LLM Factory env-based (LLM_MODE selector)
2faa4f9 docs(agents,next-session): Slice 1 7.6 COMPLETE + quick wins §0.9 PII
6e56a2d docs(meta): webhook payloads + outbound shapes WA/IG/FB
ad7f254 feat(meta): Slice 1 7.6 IG + FB Messenger send (COMPLETE)
7b3bfb0 chore(eslint,vitest): no-console rule + exclude supabase repos coverage
c36a5be feat(observability): redactPii util + wireup ConsoleLogger (regla §0.9.1)
91e5138 docs(agents): drop rule 6 + nuevas reglas oro 9-11
46234e8 feat(meta): Slice 1 7.6 GraphApiMetaClient (WA real, IG/FB stub)
f0955a4 docs(agents): Slice 1 7.5 COMPLETO 5/5 LLM impls + infra
0db4e07 feat(llm): Slice 1 7.5 OpenAiAgentLLM — 5/5 LLMs COMPLETE
139cfa0 feat(llm): Slice 1 7.5 OpenAiIntentBatchDetectorLLM + interface refactor
```

---

## Conexión Supabase actual (referencia)

- Proyecto: `crm-dev`
- Region: East US (Ohio) `us-east-2`
- Reference ID: `edlranjncwpxkyllopfa`
- Postgres 17, Plan Free, Linked CLI ✅
- Migrations aplicadas: 16/16
- Advisors clean: ✅
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
