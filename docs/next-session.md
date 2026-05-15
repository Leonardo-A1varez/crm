# Cómo retomar la sesión

> Última pausa: 2026-05-15 mediodía. **Slice 1 sub-paso 7.5 COMPLETO**: 5/5 LLM impls reales OpenAI vía AI SDK v6 + infra cost-tracker bridge + pricing. 466 unit tests + 154 integration verde. Siguiente: **Slice 1 sub-paso 7.6** — Meta Cloud API real con HMAC verify + send/recv.

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
| Slice 1 7.6 Meta Cloud API real                | 🟡 Siguiente | HMAC verify webhook + send/recv WhatsApp + IG + FB Messenger                                                                                                                                                      |
| Slice 1 7.7 Observability + DI wireup          | ⚪ Pendiente | OTel traces + Logger producción + LLM factory env-based real vs mock                                                                                                                                              |
| Slice 1 7.8 Inngest serve                      | ⚪ Pendiente | Mount handlers en `/api/inngest` route + register events                                                                                                                                                          |
| Slice 1 7.9 Webhook Meta route                 | ⚪ Pendiente | `/api/webhooks/meta` con HMAC + emit `message.received`                                                                                                                                                           |
| Slice 1 7.10 E2E smoke                         | ⚪ Pendiente | Lead manual → response real → close session. Sandbox Meta.                                                                                                                                                        |

---

## Cómo continuar (próxima sesión)

### Opción A — Slice 1 7.6 Meta Cloud API (recomendado)

Decirle al asistente:

> Arrancá Slice 1 sub-paso 7.6 — implementar Meta Cloud API real con HMAC signature verify en webhook + send/recv WhatsApp Business + IG + FB Messenger. Mantener interface `MetaApiService` actual (swap-impl). Tests con mocks. NO usar API keys reales en CI.

El asistente hará:

1. Leer `meta-api.service.ts` (interface actual).
2. Crear `DefaultMetaApiService` (impl real):
   - HMAC SHA-256 verify usando `META_APP_SECRET`.
   - `fetch` directo a Graph API `v21.0+` (versión via env `META_GRAPH_API_VERSION`).
   - send template + send text + send media (por canal).
   - parse webhook payload → eventos normalizados (`InboundMessage`).
3. Schemas zod para webhook payloads (WhatsApp/IG/FB formats distintos).
4. Tests unitarios con mock `fetch` + golden payloads sample (sin API key real).
5. Doc `docs/meta-webhook-payloads.md` con shapes esperados.
6. 1 commit per canal (3 commits: WhatsApp, IG, FB) o 1 grande si tightly coupled.

### Opción B — Slice 1 7.7 Observability + DI wireup primero

Decirle al asistente:

> Saltá 7.6 (Meta) y arrancá 7.7 — wireup DI factories para que servicies reciban LLM impls reales en prod (via env) y mocks en tests. Setup OTel traces básico.

**Riesgo:** sin wireup real, los LLM impls no se usan en runtime. Útil hacer 7.7 cerca de 7.5 mientras el contexto está fresco. Recomendado.

### Opción C — Atacar issues LOW/MEDIUM del audit B+

Ver `docs/security-threat-model.md`, `docs/data-model.md`, `docs/database-tuning.md` known issues.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/changelog.md`. Confirmá estado y continuemos con [opción A/B/C].

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
0db4e07 feat(llm): Slice 1 7.5 OpenAiAgentLLM — 5/5 LLMs COMPLETE
139cfa0 feat(llm): Slice 1 7.5 OpenAiIntentBatchDetectorLLM + interface refactor
3612a90 feat(llm): Slice 1 7.5 OpenAiConversationSummarizerLLM
526fea4 feat(llm): Slice 1 7.5 OpenAiTwinExtractorLLM
00e366e feat(llm): Slice 1 7.5 OpenAiIntentClassifierLLM
200aff2 feat(llm): install AI SDK + cost-tracker bridge + OpenAI pricing
4c6a804 docs(agents): Slice 1 7.4 COMPLETO 14/14 + 16 migrations + 154 integration
73337f6 feat(repos): Slice 1 7.4 SupabaseEventOutboxRepository — 14/14 COMPLETE
63428c1 feat(repos): Slice 1 7.4 SupabaseReactivationDispatchesRepository + contract fixtures
70d4c52 feat(repos): Slice 1 7.4 SupabaseMergeCandidatesRepository + contract
aada1eb feat(repos): Slice 1 7.4 SupabaseAdminAuditRepository + contract
5d05f6b feat(repos): Slice 1 7.4 SupabaseToolExecutionsRepository + contract
b649105 feat(repos): Slice 1 7.4 SupabaseLeadSessionRepository + contract fixtures
db08c4d feat(repos): Slice 1 7.4 SupabaseMessagesRepository + contract fixtures
2f6a194 feat(repos): Slice 1 7.4 SupabaseConversationsRepository + contract fixtures
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
