# Cómo retomar la sesión

> Última pausa: 2026-05-14 (sesión nocturna corta). Slice 1 sub-paso 7.4 piloto leads sigue completo. Bloqueador: integration tests sin verificar todavía (`.env.local` no seteado). Próximo: setup `.env.local` + verificar piloto + replicar pattern a 13 repos restantes.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Sesión 2026-05-14 hubo incidente: usuario pegó `sb_secret_*` por error → secret rotado pero el chat ya viajó a servers de Anthropic. Política firme:

- Secrets (`service_role`, `sb_secret_*`, API keys reales) → directo a `.env.local` con `notepad`/editor. JAMÁS al asistente.
- Si el asistente "necesita ver" un secret para diagnosticar algo, **rechazar**. Pedirle que diagnostique a partir del comportamiento (error messages, output truncado, etc.), no del valor.

---

## Estado del trabajo

| Sub-paso                                       | Estado        | Notas                                                                                                                                                                                          |
| ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0-B6 + B+R (Pre-Slice 1 Industrial Hardening) | ✅ Completo   | 4 docs nuevos + outbox pattern + security headers + rate limiter Upstash + threat model + SLO + runbooks + backup strategy                                                                     |
| Slice 1 7.1 Supabase setup                     | ✅ Completo   | 15 migrations aplicadas a `crm-dev` Supabase project (us-east-2, ref `edlranjncwpxkyllopfa`)                                                                                                   |
| Slice 1 7.2 config audit                       | ✅ Completo   | `supabase/config.toml` generado proper                                                                                                                                                         |
| Slice 1 7.3 DB client wireup                   | ✅ Completo   | `src/server/db/client.ts` con `SupabaseClient<Database>` real                                                                                                                                  |
| Slice 1 7.4 leads piloto                       | ✅ Completo   | `SupabaseLeadsRepository` + integration test infrastructure                                                                                                                                    |
| Slice 1 7.4 vitest config fix                  | ✅ Completo   | Commit `369d708` — `loadEnv` para que vitest lea `.env.local`                                                                                                                                  |
| **Verificar piloto leads integration**         | 🔴 Bloqueador | Usuario debe setup `.env.local` + correr `npm run test:integration`. Sin esto, no se replica pattern (riesgo propagar bug 13 veces)                                                            |
| Borrar proyecto Supabase duplicado             | 🟡 Pendiente  | Usuario creó `xwcsovqhyclvdpoacgfh` por error el 2026-05-14 03:41 UTC. Borrar desde dashboard (free tier 2 slots ocupados)                                                                     |
| Slice 1 7.4 resto (13 repos)                   | 🟡 Pendiente  | Replicar pattern leads a tags, productos, users, intents, reglas, conversations, messages, lead-session, tool-executions, admin-audit, merge-candidates, reactivation-dispatches, event-outbox |
| Slice 1 7.5 AI SDK + LLM impls                 | ⚪ Pendiente  | Instalar `ai@6.0.180` + `@ai-sdk/openai@3.0.63`, implementar 5 LLMs                                                                                                                            |
| Slice 1 7.6 Meta Cloud API real                | ⚪ Pendiente  | HMAC verify + send/recv                                                                                                                                                                        |
| Slice 1 7.7-7.10                               | ⚪ Pendiente  | Observability + Inngest serve + webhook + E2E smoke                                                                                                                                            |

---

## Acción pendiente del usuario antes de continuar

### 1. Verificar que los integration tests funcionan localmente

Los tests de integración se conectan al Supabase real (`crm-dev` ref `edlranjncwpxkyllopfa`). Necesitan 2 valores secretos en un archivo local llamado `.env.local`. Pasos:

#### Paso 1 — Obtener el `service_role` (o `sb_secret_*`) del Supabase dashboard

1. Abrí el navegador en https://supabase.com/dashboard/project/edlranjncwpxkyllopfa (tu proyecto `crm-dev` viejo, NO el duplicado).
2. En el menú izquierdo abajo, click **"Project Settings"** (ícono engranaje).
3. En el submenu, click **"API"** o **"API Keys"**.
4. Buscar la key con permisos full bypass-RLS. Supabase tiene 2 formatos en transición:
   - **Formato viejo (JWT, deprecating):** `service_role` `secret` que empieza con `eyJhbGc...`. Click "Reveal" 👁️ → Copy.
   - **Formato nuevo (New API Keys, 2025+):** `sb_secret_*` (no JWT). Mismo permiso bypass RLS.
   - Ambos sirven con `@supabase/supabase-js@2.105.4` para integration tests. Si el proyecto ya migró al formato nuevo, usar `sb_secret_*`; si todavía no, JWT viejo.
5. Copiar al portapapeles. **NUNCA pegar en chat con asistente IA.** Va directo a `.env.local`.

#### Paso 2 — Crear el archivo `.env.local`

En PowerShell, desde la raíz del proyecto:

```powershell
copy .env.local.example .env.local
```

Esto crea `.env.local` con los nombres de variables pero sin valores.

#### Paso 3 — Editar `.env.local`

Abrí con notepad:

```powershell
notepad .env.local
```

Buscá las 2 últimas líneas:

```
SUPABASE_TEST_URL=
SUPABASE_TEST_SERVICE_KEY=
```

Completalas así (usando el key que copiaste en Paso 1):

```
SUPABASE_TEST_URL=https://edlranjncwpxkyllopfa.supabase.co
SUPABASE_TEST_SERVICE_KEY=eyJhbGc...ACA_PEGA_EL_KEY_LARGO...xyz
```

Guardar (Ctrl+S) + cerrar notepad.

#### Paso 4 — Correr los integration tests

```powershell
npm run test:integration
```

Esperado: 14 tests `SupabaseLeadsRepository contract` pasan contra Supabase real. Si falla algún test, pegale al asistente el output completo.

#### ¿Por qué no se commitea `.env.local`?

Contiene el `service_role` key que es **superusuario de tu DB**. Si alguien lo ve, accede a TODOS los datos sin filtros RLS. Por eso `.env.local` está en `.gitignore` (nunca se sube a git).

El archivo `.env.local.example` SÍ se commitea pero solo tiene los nombres de variables, no los valores reales.

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

### Acciones inmediatas al retomar 2026-05-14+

1. Borrar proyecto duplicado `xwcsovqhyclvdpoacgfh` del dashboard Supabase (free tier 2 slots ocupados).
2. Setup `.env.local` con credenciales del viejo `crm-dev` `edlranjncwpxkyllopfa` (instrucciones arriba).
3. `npm run test:integration` → reportar output al asistente.
4. Si 14 tests verdes → desbloqueamos replicar pattern a 13 repos. Si rojo → diagnosticamos (NO propagar pattern roto).

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
369d708 fix(test): vitest integration config carga .env.local via loadEnv
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
