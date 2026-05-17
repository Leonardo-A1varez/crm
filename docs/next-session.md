# Cómo retomar la sesión

> Última pausa: 2026-05-16 cont. **Slice 1 7.7.A + 7.8 COMPLETO**: LLM Factory env-based (LLM_MODE=real|mock + 5 InMemory mocks) + Inngest serve wireup `/api/webhooks/inngest` (bootstrap 11 repos + 8 services + 5 LLMs + 4 callbacks). 569 unit + 154 integration verde, coverage 89.4/83.54/86.73/90.48 > threshold. Siguiente: **Slice 1 sub-paso 7.9** — Webhook `/api/webhooks/meta` (HMAC verify + parse-webhook + emit `meta/message.received`). Util HMAC + parser ya existen.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`OPENAI_API_KEY`, `service_role`, `sb_secret_*`, `META_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado       | Notas                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo  | 4 docs + outbox + security headers + rate limiter + threat model + SLO + runbooks + backup                                                                                                                        |
| Slice 1 7.1+7.2 Supabase setup + config        | ✅ Completo  | 16 migrations aplicadas a `crm-dev`                                                                                                                                                                               |
| Slice 1 7.3 DB client wireup                   | ✅ Completo  | `src/server/db/client.ts` real                                                                                                                                                                                    |
| Slice 1 7.4 14/14 repos Supabase impl          | ✅ Completo  | leads · tags · productos · users · intents · reglas · conversations · messages · lead-session · tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox. 154 integration verde. |
| Backup remoto git                              | ✅ Completo  | `https://github.com/Leonardo-A1varez/crm.git` privado, master sync                                                                                                                                                |
| Slice 1 7.5 AI SDK + 5 LLM impls reales        | ✅ Completo  | OpenAI vía `ai@6.0.180` + `@ai-sdk/openai@3.0.63`. intent-classifier · twin-extractor · conversation-summarizer · intent-batch-detector · ai-agent. Infra pricing + cost-tracker bridge. 27 unit tests LLM.       |
| Slice 1 7.6 Meta Cloud API real                | ✅ Completo  | WA real (`46234e8`) + IG + FB Messenger (`ad7f254`). Env opcionales `META_IG_*` + `META_FB_*`. 19/19 unit tests. Doc `docs/meta-webhook-payloads.md`.                                                             |
| Reglas oro 9-11 + quick wins §0.9 PII          | ✅ Completo  | `redactPii` util + wireup `ConsoleLogger` runtime + ESLint `no-console` + vitest exclude supabase repos (fix coverage 59.96→88.99).                                                                               |
| Slice 1 7.7.A LLM Factory env-based            | ✅ Completo  | `LLM_MODE=real\|mock` selector. `makeLlmFactory` retorna `LlmBundle` (5 LLMs). 5 `InMemory*LLM` mocks deterministic. `ef6e60d`. 12 tests.                                                                         |
| Slice 1 7.8 Inngest serve wireup               | ✅ Completo  | Bootstrap `makeInngestDeps` wirea 11 repos + 8 services + LlmBundle + GraphApiMetaClient + 4 callbacks. `/api/webhooks/inngest` mounta 9 functions. `ce3d24d`. 9 tests bootstrap.                                 |
| Slice 1 7.7.B PinoLogger (producción)          | ⚪ Pendiente | Pino wrapper + Vercel Log Drains hook + factory `getLogger(env)`. Mantiene `redactPii` mismo pattern.                                                                                                             |
| Slice 1 7.7.C OTel SDK + spans                 | ⚪ Pendiente | `@vercel/otel` + custom spans webhook/inngest/llm/db.                                                                                                                                                             |
| Slice 1 7.7.D Sentry uncaught tracking         | ⚪ Pendiente | `@sentry/nextjs` config client + server + edge.                                                                                                                                                                   |
| Slice 1 7.9 Webhook Meta route                 | 🟡 Siguiente | `/api/webhooks/meta` con HMAC verify + parse + emit `meta/message.received`. Util HMAC + parser ya existen (`src/lib/meta/`). Skill `security-review` pre-merge.                                                  |
| Slice 1 7.10 E2E smoke                         | ⚪ Pendiente | Lead manual → response real → close session. Sandbox Meta.                                                                                                                                                        |

---

## Cómo continuar (próxima sesión)

### Opción A — Slice 1 7.9 Webhook `/api/webhooks/meta` (recomendado)

Decirle al asistente:

> Arrancá Slice 1 sub-paso 7.9 — webhook route `/api/webhooks/meta` con HMAC verify primera línea + parse-webhook + emit Inngest event `meta/message.received`. Skill `security-review` pre-merge obligatorio (regla §0.9.2 HMAC enforce). GET handshake `hub.mode=subscribe` + `hub.verify_token` check.

El asistente hará:

1. Leer `src/lib/meta/verify-signature.ts` (HMAC SHA-256 + timing-safe ya existe).
2. Leer `src/lib/meta/parse-webhook.ts` (parser WA/IG/FB → `ParsedMessage[]` ya existe).
3. Crear `src/app/api/webhooks/meta/route.ts`:
   - GET handler: handshake `hub.mode=subscribe` + `hub.verify_token === env.META_VERIFY_TOKEN` → 200 `hub.challenge`. Else 403.
   - POST handler: rawBody read (Request.text() pre JSON.parse) + `verifyMetaSignature(rawBody, header, env.META_APP_SECRET)` → 401 si fail. Parse → emit per ParsedMessage. 200 inmediato.
4. Upstash rate-limit (B3 ya existe `src/lib/rate-limit/`) — fail-open en dev (NoopRateLimiter).
5. Tests: GET handshake OK/403, POST HMAC fail 401, POST OK emit, POST multi-message batch.
6. 1 commit `feat(webhooks): Slice 1 7.9 /api/webhooks/meta route (HMAC + parse + emit)`.

### Opción B — Slice 1 7.7.B PinoLogger producción

> Continuá 7.7.B — PinoLogger wrapper + factory `getLogger(env)`. NODE_ENV=production → Pino, else → ConsoleLogger. Aplica `redactPii` mismo lugar. Hook Vercel Log Drains JSON.

### Opción C — Slice 1 7.10 E2E smoke (skip a launch path)

> Smoke test manual: lead via WA sandbox → webhook /api/webhooks/meta recibe → Inngest pipeline corre con LLM_MODE=mock → mock response sale via metaApi.sendOutbound. Validar `purgeSession` + `sendReactivation` stubs no rompen.

### Opción D — Atacar issues LOW/MEDIUM del audit B+

Ver `docs/security-threat-model.md`, `docs/data-model.md`, `docs/database-tuning.md` known issues.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/changelog.md`. Confirmá estado y continuemos con [opción A/B/C/D].

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
3612a90 feat(llm): Slice 1 7.5 OpenAiConversationSummarizerLLM
526fea4 feat(llm): Slice 1 7.5 OpenAiTwinExtractorLLM
00e366e feat(llm): Slice 1 7.5 OpenAiIntentClassifierLLM
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
