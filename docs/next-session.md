# Cómo retomar la sesión

> Última pausa: 2026-05-15 madrugada. **Slice 1 sub-paso 7.4 COMPLETO**: los 14 repos Supabase impl + integration tests 154/154 verde contra `crm-dev`. Migration 16 aplicada (`server_now()` RPC). Repo GitHub privado configurado y sync. Siguiente: **Slice 1 sub-paso 7.5** — Vercel AI SDK + 5 LLM real impls.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`service_role`, `sb_secret_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado       | Notas                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo  | 4 docs nuevos + outbox pattern + security headers + rate limiter Upstash + threat model + SLO + runbooks + backup strategy                                                                                                  |
| Slice 1 7.1 Supabase setup                     | ✅ Completo  | 16 migrations aplicadas a `crm-dev` Supabase project (us-east-2, ref `edlranjncwpxkyllopfa`)                                                                                                                                |
| Slice 1 7.2 config audit                       | ✅ Completo  | `supabase/config.toml` generado proper                                                                                                                                                                                      |
| Slice 1 7.3 DB client wireup                   | ✅ Completo  | `src/server/db/client.ts` con `SupabaseClient<Database>` real                                                                                                                                                               |
| Slice 1 7.4 14/14 repos Supabase impl          | ✅ Completo  | leads · tags · productos · users · intents · reglas · conversations · messages · lead-session · tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox. 154/154 integration tests verde. |
| Backup remoto git                              | ✅ Completo  | `https://github.com/Leonardo-A1varez/crm.git` privado, master sync                                                                                                                                                          |
| Migration 0016 server_now() RPC                | ✅ Completo  | Fix clock skew JS↔Postgres en timestamps server-side (touch + updated_at en updates)                                                                                                                                        |
| Slice 1 7.5 AI SDK + LLM impls                 | 🟡 Siguiente | Instalar `ai@6.0.180` + `@ai-sdk/openai@3.0.63`, implementar 5 LLMs reales                                                                                                                                                  |
| Slice 1 7.6 Meta Cloud API real                | ⚪ Pendiente | HMAC verify + send/recv                                                                                                                                                                                                     |
| Slice 1 7.7-7.10                               | ⚪ Pendiente | Observability + Inngest serve + webhook + E2E smoke                                                                                                                                                                         |

---

## Cómo continuar (próxima sesión)

### Opción A — Continuar con Slice 1 7.5 (AI SDK + LLM impls) (recomendado)

Decirle al asistente:

> Arrancá Slice 1 sub-paso 7.5 — instalar Vercel AI SDK (`ai@6.0.180` + `@ai-sdk/openai@3.0.63`) e implementar los 5 LLMs reales: intent-classifier, twin-extractor, ai-agent (con tool calling + catálogo), conversation-summarizer, lead-merge-detector. Mantener interface idéntica al mock para que cambio sea swap-impl (sin tocar services consumidores).

El asistente hará:

1. `npm install ai@6.0.180 @ai-sdk/openai@3.0.63 zod` (zod ya instalado).
2. Crear `src/server/services/<name>.openai.service.ts` para cada de los 5 LLMs.
3. Schemas zod para outputs estructurados (intents catalog, lead twin fields, merge similarity).
4. Cost-tracker integration: cada call registra tokens + USD a `CostTracker`.
5. Tests unitarios con mocks `openai-mock` o golden fixtures (sin pegar API key real al asistente).
6. Update DI containers para inyectar real vs mock por env var.
7. 1 commit conventional por LLM.

### Opción B — Saltar a Slice 1 7.6 (Meta Cloud API)

Decirle al asistente:

> Saltá 7.5 (los LLMs vienen después) y arrancá 7.6 — implementar Meta Cloud API real con HMAC signature verify en el webhook + send/recv.

**Riesgo:** sin LLMs reales no podés correr el pipeline end-to-end. Recomendado completar 7.5 primero.

### Opción C — Atacar issues LOW/MEDIUM del audit B+

31 issues low/medium del audit B+ en backlog. Ver `docs/security-threat-model.md`, `docs/data-model.md`, `docs/database-tuning.md` known issues.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/changelog.md`. Confirmá estado y continuemos con [opción A/B/C].

El asistente leerá los docs, identificará dónde estamos, y propondrá el siguiente sub-paso para tu confirmación.

---

## Pattern arquitectural establecido en 7.4 (referencia futuras impls)

Cada repo Supabase sigue el siguiente pattern:

1. **Impl** en `src/server/repositories/<name>.supabase.repo.ts`:
   - Recibe `AppClient` por constructor.
   - `isUuid` early-return en lecturas (`findById`, `listByX` con id, etc.) — evita PG 22P02 cuando caller pasa string no-UUID.
   - `mapPostgrestError` mapea códigos PG a `DomainError` taxonomy.
   - `ConflictError` disambig por constraint name en error.message (ej. `uq_mensajes_meta_message_id` → `conflictType: "duplicate_meta_message_id"`).
   - `serverNowIso(db)` para columnas timestamptz updateables (`updated_at`, `ultima_actividad_at`, `closed_at`, etc.) — evita clock skew JS↔PG.
   - Update payload campo-por-campo (defense runtime contra patch.id/created_at/etc.).
   - `mapRow(row)` mapea schema PG a entity domain (parse Date, deep-clone jsonb).

2. **Contract reusable** en `tests/repositories/<name>.contract.ts`:
   - Función `runXContract(makeRepo, fixturesArg?)` con fixtures inyectables.
   - Default fixtures = strings literales (preserva test InMemory).
   - Supabase integration pasa real UUIDs.
   - Acepta value o getter `() => fixtures` para seed asíncrono en `beforeAll`.

3. **Integration test** en `tests/integration/<name>.supabase.test.ts`:
   - `beforeAll`: `cleanupTestDb` + `seedFixtures` (crea leads/usuarios/sessions FK parents).
   - `beforeEach`: cleanup table-scope-only (ej. solo `mensajes`, preserva fixtures).
   - `afterAll`: full `cleanupTestDb`.
   - `runXContract(() => new SupabaseXRepository(client), () => fixtures)`.

4. **Validación pre-commit**: `npm run typecheck && npm test && npm run test:integration && npm run lint && npm run format:check`. Todos verde antes de commit + push.

5. **Commit message**: Conventional Commits español, ≤72 chars subject, body explica WHY (FKs, constraints, race-windows, decisiones de pattern).

---

## Comandos útiles para verificar estado

```powershell
# Ver últimos 10 commits
git log --oneline -10

# Ver migrations aplicadas en Supabase
supabase migration list --linked

# Run unit tests (excluye integration)
npm test

# Run integration tests (necesita .env.local con SUPABASE_TEST_* setado)
npm run test:integration

# Run full CI local
npm run ci

# Run Supabase advisors (security/performance lints)
supabase db advisors --linked

# Regenerar types.gen.ts si cambias migrations
supabase gen types typescript --linked | Out-File -Encoding utf8 src/server/db/types.gen.ts
```

---

## Historial de commits hasta esta pausa (últimos 15)

```
73337f6 feat(repos): Slice 1 7.4 SupabaseEventOutboxRepository — 14/14 COMPLETE
63428c1 feat(repos): Slice 1 7.4 SupabaseReactivationDispatchesRepository + contract fixtures
70d4c52 feat(repos): Slice 1 7.4 SupabaseMergeCandidatesRepository + contract
aada1eb feat(repos): Slice 1 7.4 SupabaseAdminAuditRepository + contract
5d05f6b feat(repos): Slice 1 7.4 SupabaseToolExecutionsRepository + contract
b649105 feat(repos): Slice 1 7.4 SupabaseLeadSessionRepository + contract fixtures
db08c4d feat(repos): Slice 1 7.4 SupabaseMessagesRepository + contract fixtures
2f6a194 feat(repos): Slice 1 7.4 SupabaseConversationsRepository + contract fixtures
807afc1 fix(repos): server_now() RPC para evitar clock skew JS↔Postgres
3b68de6 feat(repos): Slice 1 7.4 SupabaseRulesRepository + contract fixtures
150ce60 feat(repos): Slice 1 7.4 SupabaseIntentsRepository
09bf774 feat(repos): Slice 1 7.4 SupabaseUsersRepository
82ccd09 feat(repos): Slice 1 7.4 SupabaseProductsRepository
91e711d feat(repos): Slice 1 7.4 SupabaseTagsRepository + contract fixtures
32b7dda docs: snapshot 2026-05-14 tarde + bloqueador backup remoto
```

---

## Conexión Supabase actual (referencia)

- Proyecto: `crm-dev`
- Region: East US (Ohio) `us-east-2`
- Reference ID: `edlranjncwpxkyllopfa`
- Org ID: `srpslygtollnjwlagstx`
- Postgres major version: 17
- Plan: Free tier
- Linked vía CLI: ✅
- Migrations aplicadas: 16/16
- Advisors clean: ✅ (solo `pg_trgm` extension WARN, deferred Slice 4 documented)
- Remoto git: `https://github.com/Leonardo-A1varez/crm.git` (privado, master sync)
