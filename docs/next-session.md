# Cómo retomar la sesión

> Última pausa: 2026-05-14 (sesión tarde). Slice 1 sub-paso 7.4 piloto leads **completo + verificado integration tests 14/14 verde contra Supabase real**. Bloqueador resuelto. **Nuevo bloqueador:** repo SIN remoto git (anti-patrón disciplina — 6+ commits + 15 migrations + docs sin respaldo). Próximo: crear repo GitHub privado + push, después replicar pattern a 13 repos restantes.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Sesión 2026-05-14 hubo incidente: usuario pegó `sb_secret_*` por error → secret rotado pero el chat ya viajó a servers de Anthropic. Política firme:

- Secrets (`service_role`, `sb_secret_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado        | Notas                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo   | 4 docs nuevos + outbox pattern + security headers + rate limiter Upstash + threat model + SLO + runbooks + backup strategy                                                                                                                                                                  |
| Slice 1 7.1 Supabase setup                     | ✅ Completo   | 15 migrations aplicadas a `crm-dev` Supabase project (us-east-2, ref `edlranjncwpxkyllopfa`)                                                                                                                                                                                                |
| Slice 1 7.2 config audit                       | ✅ Completo   | `supabase/config.toml` generado proper                                                                                                                                                                                                                                                      |
| Slice 1 7.3 DB client wireup                   | ✅ Completo   | `src/server/db/client.ts` con `SupabaseClient<Database>` real                                                                                                                                                                                                                               |
| Slice 1 7.4 leads piloto                       | ✅ Completo   | `SupabaseLeadsRepository` + integration test infrastructure                                                                                                                                                                                                                                 |
| Slice 1 7.4 vitest config fix                  | ✅ Completo   | Commit `369d708` (roto) + `74f2f53` fix import `loadEnv` desde `vite` no `vitest/config`                                                                                                                                                                                                    |
| Slice 1 7.4 verificar piloto leads integration | ✅ Completo   | 14/14 verde contra Supabase `crm-dev`. Bug detectado + arreglado: `findById` UUID malformado throws PG 22P02 → fix early-return null (commit `adb5a43`)                                                                                                                                     |
| Borrar proyecto Supabase duplicado             | ✅ Completo   | Usuario borró `xwcsovqhyclvdpoacgfh` del dashboard                                                                                                                                                                                                                                          |
| **Backup remoto git**                          | 🔴 Bloqueador | Repo SIN remoto. 8 commits + trabajo sesión sin respaldo. Usuario debe crear repo privado GitHub (o GitLab/Bitbucket) + pasar URL al asistente para `remote add origin` + `push -u`                                                                                                         |
| Slice 1 7.4 resto (13 repos)                   | 🟡 Pendiente  | Tras backup remoto: replicar pattern leads a tags, productos, users, intents, reglas, conversations, messages, lead-session, tool-executions, admin-audit, merge-candidates, reactivation-dispatches, event-outbox. **Aplicar fix UUID en cada `findById` (early-return null si !isUuid).** |
| Slice 1 7.5 AI SDK + LLM impls                 | ⚪ Pendiente  | Instalar `ai@6.0.180` + `@ai-sdk/openai@3.0.63`, implementar 5 LLMs                                                                                                                                                                                                                         |
| Slice 1 7.6 Meta Cloud API real                | ⚪ Pendiente  | HMAC verify + send/recv                                                                                                                                                                                                                                                                     |
| Slice 1 7.7-7.10                               | ⚪ Pendiente  | Observability + Inngest serve + webhook + E2E smoke                                                                                                                                                                                                                                         |

---

## Acción pendiente del usuario antes de continuar

### 1. Crear repo remoto y configurar backup (BLOQUEADOR)

Repo local con 8 commits + 15 migrations + 439 unit tests + 14 integration tests + docs detalladas. **CERO respaldo remoto**. Disco crash = trabajo evaporado.

#### Paso 1 — Crear repo GitHub privado

1. Abrir https://github.com/new (si no tenés cuenta GitHub, crear primero).
2. **Repository name:** `crm` (o el que prefieras).
3. **Visibility:** ☑ **Private** (NUNCA Public — contiene secrets en docs/threat model + business plan).
4. **NO marcar:** "Add README", "Add .gitignore", "Choose license". Repo debe estar vacío para evitar conflict con commits locales.
5. Click **"Create repository"**.

#### Paso 2 — Copiar URL clone

GitHub muestra pantalla "Quick setup". Copiar URL:

- **HTTPS:** `https://github.com/<tu-user>/crm.git`
- **SSH:** `git@github.com:<tu-user>/crm.git` (si tenés SSH key configurada)

#### Paso 3 — Pasar URL al asistente

Decirle al asistente:

> URL repo creado: `https://github.com/<tu-user>/crm.git`

Asistente hace:

```powershell
git remote add origin https://github.com/<tu-user>/crm.git
git push -u origin master
```

Verificar en GitHub que los 8 commits aparecen. A partir de acá, `git push` después de cada commit nuevo.

#### Alternativa: GitLab / Bitbucket / Gitea

Mismo flujo, distinto host. Crear repo privado vacío + pasar URL.

---

## Cómo continuar (próxima sesión)

Una vez verificados los integration tests:

### Opción A — Continuar con el resto de repos (recomendado)

Decirle al asistente:

> Continuá Slice 1 sub-paso 7.4 replicando el pattern de SupabaseLeadsRepository a los 13 repos restantes. Hacelo de forma incremental, 1 repo por commit, con su integration test contract.

El asistente hará:

1. Por cada repo (orden recomendado por complejidad creciente):
   - `tags` → trivial
   - `productos` → baja
   - `users` → trivial
   - `intents` → baja
   - `reglas` → baja
   - `conversations` → baja
   - `messages` → media (idempotency + dedup)
   - `lead-session` → alta (close idempotente + extras jsonb)
   - `tool-executions` → baja
   - `admin-audit` → baja
   - `merge-candidates` → media
   - `reactivation-dispatches` → baja
   - `event-outbox` → baja
2. Escribir `src/server/repositories/<name>.supabase.repo.ts`.
3. Escribir `tests/integration/<name>.supabase.test.ts` usando `runXContract`.
4. Run `npm run test:integration` localmente para validar.
5. Run `npm run typecheck` + `npm test` para verificar unit tests siguen verde.
6. Commit conventional.

### Opción B — Saltar a Slice 1 7.5 (AI SDK + LLM impls)

Decirle al asistente:

> Saltá los 13 repos restantes de 7.4 (los hago después) y continuá con Slice 1 sub-paso 7.5 — instalar AI SDK + implementar los LLMs reales.

**Riesgo:** sin todos los repos Supabase impl, no podés correr el pipeline end-to-end. Recomendado completar 7.4 primero.

### Opción C — Pausar Slice 1 y atacar issues LOW/MEDIUM del audit B+

31 issues low/medium del audit B+ están en backlog. Decirle al asistente cuáles atacar (ver `docs/security-threat-model.md`, `docs/data-model.md`, `docs/database-tuning.md` known issues).

---

## Cómo dar contexto al asistente al volver

Decile al iniciar la sesión:

> Leé `AGENTS.md`, `docs/next-session.md` y `docs/changelog.md`. Confirmá estado y continuemos con [opción A/B/C].

El asistente leerá los docs, identificará dónde estamos, y propondrá el siguiente sub-paso para tu confirmación.

### Acciones inmediatas al retomar (post 2026-05-14 tarde)

1. **Crear repo privado GitHub** (instrucciones §"Acción pendiente del usuario antes de continuar" arriba).
2. Pasar URL al asistente para `git remote add origin <url>` + `git push -u origin master`.
3. Verificar 8 commits aparecen en GitHub.
4. Decirle al asistente: **"Arrancá Opción A, repo 2 = tags"** → replicación pattern 13 repos restantes empieza.

### Recordatorio crítico replicación 13 repos

Pattern leads piloto reveló bug: `findById` Supabase con UUID malformado lanzaba PG `22P02` cuando contract InMemory devuelve `null`. Fix: `if (!isUuid(id)) return null;` en cada `findById` Supabase. Helper en `src/server/db/uuid.ts`. **Aplicar este fix en los 13 `findById` restantes desde el primer commit (no descubrirlo de nuevo por repo).**

---

## Comandos útiles para verificar estado

```powershell
# Ver últimos 5 commits
git log --oneline -5

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

## Historial de commits hasta esta pausa

```
ecdd9ad docs(agents): corrige estado mig15 aplicada
adb5a43 fix(repos): findById Supabase devuelve null para UUID malformado
74f2f53 fix(test): import loadEnv desde vite no vitest/config
bb1fd93 docs(agents): separa Siguiente sub-paso de lista pendientes usuario
49387f1 docs: snapshot 2026-05-14 pre-pausa + warning seguridad credenciales
369d708 fix(test): vitest integration config carga .env.local via loadEnv  (BUG fix corregido por 74f2f53)
c4b20c2 docs: update estado Slice 1 7.4 piloto + next-session resume guide
03fa46b feat(repos): Slice 1 7.4 SupabaseLeadsRepository pilot + integration infra
694bb26 feat(db): Slice 1 7.3 DB client real wireup
2f02c11 feat(db): Slice 1 7.1-7.2 Supabase setup + types gen
2fac977 chore: initial foundation + Pre-Slice 1 Industrial Hardening
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
- Migrations aplicadas: 15/15
- Advisors clean: ✅ (solo `pg_trgm` extension WARN, deferred Slice 4 documented)
