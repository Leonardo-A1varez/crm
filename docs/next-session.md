# Cómo retomar la sesión

> Última actualización: 2026-07-16. **Fase 10 Leads COMPLETA** (11/11 tasks, plan `docs/superpowers/plans/2026-07-15-slice2-fase10-leads.md`, ledger `.superpowers/sdd/progress.md`). Final whole-branch review: "Ready to merge — Yes" (0 Critical; 1 Important + 2 plan-mandated fixeados en `ec5ddfa`+`b91b2e7`, re-verdict clean). Unit 747/747 · integration leads 16/16 + lead-session 21/21 · browser 7/7 + E2E merge 22/22 ×2 · coverage 90.7/84.7/89.0/91.7. **Users dev: `admin-dev@crm.local` / `dev-admin-2026!` · `vendedor-dev@crm.local` / `dev-vendedor-2026!`.** **Pendiente manual: dashboard Supabase → Advisors.**

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Política firme:

- Secrets (`OPENAI_API_KEY`, `service_role`, `sb_secret_*`, `META_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## ⚠️ Footgun entorno: integration suites limpian `public.usuarios`

Las suites de integration **borran los usuarios dev de `public.usuarios`** (las filas de `auth.users` quedan). Sin re-backfill, el merge de leads muere en el audit (FK 23503) con toast engañoso "par ya resuelto" (deuda `mapPostgrestError` 23503→ConflictError). **Fix: correr `node .superpowers/sdd/scripts/seed-merge-e2e.js` (incluye ensure-usuarios idempotente) tras CUALQUIER `npm run test:integration`.** En prod no aplica: el trigger auth→usuarios crea la fila al alta (verificado empírico).

---

## Estado del trabajo

| Sub-paso                                 | Estado       | Notas                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-Slice 1 (A+ y B+) + Slice 1 completo | ✅ Completo  | Foundation + repos Supabase + LLM factory + Meta 3 canales + Inngest serve + webhook + smoke. Detalle → `docs/changelog.md`.                                                                                                 |
| Slice 2 core 8.1-8.8                     | ✅ Completo  | Inbox + conversación + twin + actions write + poller + tabs. Validado browser.                                                                                                                                               |
| Slice 3 Auth + RLS (9.1-9.4)             | ✅ Completo  | 43 policies + suite RLS 11/11 + panel authed + STRIDE.                                                                                                                                                                       |
| Slice 4a hardening (10.1-10.7)           | ✅ Completo  | Pino · Sentry · OTel · /api/health · UpstashCostTracker · purge real · reactivación real.                                                                                                                                    |
| Slice 2 fase 9 Productos                 | ✅ Completo  | Lista+búsqueda · CRUD admin · import CSV. 19 commits `629c647..2d205d9`.                                                                                                                                                     |
| **Slice 2 fase 10 Leads**                | ✅ Completo  | Lista+búsqueda+banner · detalle+sesiones · merge backend replay-safe audit-first · merge UI + duplicado manual · detector respeta rejected · 2 migraciones (DELETE leads, INSERT admin_actions). Commits `9381265..b91b2e7`. |
| **Slice 2 fase 11 Intents+Reglas**       | 🟡 Siguiente | Spec padre aprobado (`2026-07-14-slice2-vistas-9-12-design.md` §Fase 11). Falta: addendum de contratos → plan → ejecución.                                                                                                   |
| Slice 2 fase 12 Tags+Métricas+Ajustes    | ⚪ Pendiente | Spec padre §Fase 12.                                                                                                                                                                                                         |
| **Slice 4b — deploy + soft launch**      | ⚪ Pendiente | Bloqueado por acciones usuario (creds/cuentas). Checklist Opción A.                                                                                                                                                          |

---

## Decisiones sesión 2026-07-16 (charla creds + plan deploy) — retomar desde acá

Charla posterior al cierre de fase 10. Decisiones tomadas para Slice 4b:

1. **LLM: OpenAI primero, NO Claude.** Código ya cableado a `@ai-sdk/openai` + pricing + cost-tracker calibrados a `gpt-4o-mini` ($0.15/$0.60 por M). Claude más barato (Haiku 4.5) cuesta ~7-8× más y requiere trabajo (dep `@ai-sdk/anthropic` + pricing.ts + factory). Claude queda como plan B solo si la key de OpenAI falla.
2. **Key OpenAI "Sub Business" del usuario:** es una key de organización — funciona igual que cualquier `sk-...`, factura a esa org. **Pendiente usuario:** (a) verificar en platform.openai.com → Billing que la org tenga crédito, (b) confirmar permiso de uso si la org es de un tercero, (c) si no hay crédito → cargar $5 en cuenta propia (sobra para todo 4b + semanas de dev). **Aclarado: suscripción ChatGPT ≠ créditos API — son billing separados; la API necesita crédito propio prepago.**
3. **Meta: número de prueba SÍ sirve para 4b, NO para soft launch.** Test number (app Meta → WhatsApp → API Setup): ideal para deploy + webhook + smoke E2E + health, pero solo mensajea hasta 5 destinatarios verificados. Para soft launch 10 leads reales: número real dedicado a Cloud API (sin WhatsApp app activo en ese número — si tiene, borrar esa cuenta primero) vinculado a un Meta Business. Sin verificar el business alcanza tier ~250 conversaciones/día — suficiente para soft launch; verificación después para escalar.
4. **Plan acordado:** Slice 4b ahora con número de prueba + key OpenAI → validar toda la cadena → conseguir número real recién antes del soft launch. Nota: `.vercel/` ya existe en el repo (link a Vercel hecho); deploy no arrancó.

**Primer paso al retomar:** usuario pone `OPENAI_API_KEY` + creds Meta del test number (`META_APP_SECRET/VERIFY_TOKEN/WHATSAPP_*`) directo en `.env.local` con notepad (jamás al chat) → validar key con llamada mínima → seguir checklist Opción A.

---

## Cómo continuar (próxima sesión)

### Opción A — Slice 4b: deploy + soft launch (recomendado; checklist usuario primero)

> **Acciones del usuario (secrets SIEMPRE directo a `.env.local`/Vercel, jamás al chat):**
>
> 1. Creds reales en `.env.local`: `META_APP_SECRET/VERIFY_TOKEN/WHATSAPP_*` (app Meta + número WhatsApp Business), `OPENAI_API_KEY`, `INNGEST_EVENT_KEY/SIGNING_KEY`, `UPSTASH_REDIS_REST_*` (free), `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (cuenta free).
> 2. Cuenta Vercel + proyecto linkeado.
>
> **Después, juntos:** validar send outbound real local → deploy preview → env vars Vercel → webhook Meta apuntando al deploy → smoke E2E real (mensaje WhatsApp entra y la IA responde) → `/api/health` = ok → monitor externo → templates Meta para reactivación → revisar Advisors + checklist threat model pre-launch → soft launch 10 leads.

### Opción B — Slice 2 fase 11 Intents+Reglas (arrancar acá si no hay creds)

> Patrón fase 10: **(1) addendum de contratos** sobre spec padre §Fase 11 (verificar assumptions contra repo antes de planear — el gap de policy INSERT admin_actions en fase 10 salió de NO verificar) → aprobar → **(2) `superpowers:writing-plans`** → **(3) subagent-driven-development** (extraer TODOS los briefs al inicio; regla aprendida en fase 10 T9).

### Backlog fase 11 (triage del final review fase 10 — no dejar evaporar)

**Primeros items (al arrancar fase 11):**

1. **Helper compartido canales/vehiculo** — 3 copias idénticas: `LeadFicha.tsx:19-31`, `DuplicadosSection.tsx` (ResumenLead), `default-leads.service.ts` (`canalesDe`/`vehiculoDe`). Helper puro en `src/lib/` sirve a las tres dentro de boundaries.
2. **Extensión matriz RLS:** test two-client `leads.delete` deny vendedor (único path defense-in-depth sin coverage) + check vendedor invoca actions admin (criterio 9 fase 10).
3. **Batch tests baratos:** reassign "s1 cerrada" asserta campos no-lead_id intactos · Q_MAX truncation · vehiculo vacío · pin reasons/score/createdAt duplicados · tiebreak determinista (5 leads frozen clock).

**Deuda `InfraError`/`mapPostgrestError` (Slice 4b hardening o fase 11):** default branch lanza `Error` plano · `err.details` interpolado en messages puede contener valores de columnas (PII dormida — `postgrest-errors.ts:40`; `redactPii` es key-based, no cubre strings) · disambiguar 23503 (FK) vs 23505 (unique): hoy FK muestra copy "par ya resuelto" engañosa · `isUuid` guard en `reassignLead`.

**Menores acumulados:** `searchLeadsAction` sin admin gate (gatear o comentar por qué — asimetría invita copy-paste) · detector `checkForDuplicates` propone pares rejected phantom que `recordCandidate` rechaza (alinear) · `SearchLeadsSchema` copy incorrecta para q>100 chars · LeadsTable dead branch `instanceof Date` · header "1 leads" sin singular · filtros `q`+`duplicados` no se preservan entre sí · dialog confirm-merge sin `open` controlado (queda abierto on error) · `findAnyPair` sin ORDER (agregar `created_at DESC` cuando se wire superseded).

**Carry-over fase 9 (siguen pendientes):** extraer `toActionError` compartido (productos ≈ inbox ≈ leads) + portar cause-gate ValidationError a inbox · Zod locale `es` (errores CSV mezclan inglés) · fase 12 a11y pass (aria-live, `scope="col"`, aria-hidden íconos, EmptyState búsqueda-sin-resultados) · `previewImport` → `validosCount` · COLUMNAS/MAX_CSV_BYTES a `src/lib/` · índice `(nombre, codigo_interno)` si llega paginación.

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md` y `docs/next-session.md`. Confirmá estado fase 10 Leads completa y continuemos con [opción A deploy / opción B fase 11 Intents+Reglas]. Para fase 11: addendum de contratos sobre `docs/superpowers/specs/2026-07-14-slice2-vistas-9-12-design.md` §Fase 11 + backlog listado arriba. Para entrar al panel local: `admin-dev@crm.local` / `dev-admin-2026!`.

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

# Run unit tests
npm test

# Run integration tests (necesita SUPABASE_TEST_* en .env.local)
# ⚠️ Después SIEMPRE: node .superpowers/sdd/scripts/seed-merge-e2e.js (re-backfill usuarios dev)
npm run test:integration

# Full CI local
npm run ci

# Migrations Supabase
supabase migration list --linked

# Regenerar types.gen.ts si cambias migrations
supabase gen types typescript --linked | Out-File -Encoding utf8 src/server/db/types.gen.ts
```

---

## Historial de commits (fase 10 completa, más recientes primero)

```
b91b2e7 test(leads): cubre RejectMergeSchema y doc delete de leads.repo
ec5ddfa fix(leads): copy de contrato para candidate ya resuelto en toActionError
e143e08 chore(eslint): ignora .superpowers en lint
bdac413 docs(agents,next-session): pausa fase 10 en 9/11 con guia de retome
1bacf84 fix(ui): card review con canales vehiculo fecha + toast con nombre
b652250 fix(db): policy insert admin_actions para audit de merge
07a72db feat(ui): fase 10.D review merge + duplicado manual
86e4086 fix(ui): alinea detalle lead al brief real 10.B
4155d14 feat(ui): fase 10.B detalle leads [id] + sesiones + baja stub API
dc405e2 feat(ui): fase 10.A lista leads con busqueda y banner duplicados
18740cf fix(leads): copys verbatim spec + self-pair guard + un solo auth fetch
b810b00 feat(leads): schemas + bootstrap + actions merge y busqueda
3f4b7e2 fix(leads): detector no re-propone pares rechazados
6c613fd test(leads): pin orden merge + fill-patch completo y entityId
476351d feat(leads): MergeExecutorService replay-safe con audit primero
239a33d feat(leads): LeadsService lista + detalle con duplicados
c02eddf feat(repo,db): leads.delete con policy admin y baja de mergeInto
41aa19f feat(repo): listByLeadId + reassignLead en lead-session
712bca4 test(repo): endurece tests orden y escape de leads.list
9381265 feat(repo): leads.list orden estable + busqueda literal escapada
```

Migraciones nuevas fase 10: `20260715140738_leads_delete_admin.sql` · `20260716001443_admin_actions_insert_admin.sql` (ambas aplicadas a crm-dev).

---

## Conexión Supabase actual (referencia)

- Proyecto: `crm-dev` (recreado 2026-07-13 en cuenta main; el viejo `edlranjncwpxkyllopfa` quedó INACTIVE en cuenta vieja y se auto-borra ~90d, sin data valiosa)
- Reference ID: `emubzkouwvuzlrtsgorx`
- Org: `ufmftdzojedsyujtsjqx` (misma que Genuino_app — límite free: 2 proyectos activos por org)
- Postgres 17, Plan Free, Linked CLI ✅ (token CLI = cuenta main desde 2026-07-13)
- Migrations aplicadas: 18/18 (16 base + 2 fase 10)
- ⚠️ Free tier auto-pausa tras ~1 semana idle. Mitigación: keepalive GitHub Action 2x/semana.
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
