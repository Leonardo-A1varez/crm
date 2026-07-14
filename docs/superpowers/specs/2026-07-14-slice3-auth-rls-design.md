# Slice 3 — Auth + RLS — Design Spec

> **Fecha:** 2026-07-14
> **Estado:** aprobado en diseño (pendiente review spec escrita)
> **Fase padre:** Slice 3 — Auth + RLS audited + STRIDE walkthrough (AGENTS.md §2.1)

---

## 1. Scope

### Qué hace

Panel protegido por Supabase Auth (email + password) con RLS efectivo end-to-end: RSC y Server Actions consumen la DB con cliente autenticado por cookies (las policies aplican de verdad), Inngest/webhooks siguen con service-role. Login/logout, middleware de sesión, policies SQL por rol según matriz `data-model.md`, tests de integración de la matriz, STRIDE walkthrough actualizado.

### Qué NO hace

- UI de gestión de usuarios (alta/baja/rol) — alta vía dashboard Supabase (decisión pilot). Vista Ajustes llega en Slice 2 9-12.
- Password reset self-service, magic links, OTP, MFA — pilot: reset por admin en dashboard.
- Asignación de leads por vendedor — single-org: todos los vendedores ven todos los leads (decisión §3 AGENTS).
- Supabase Realtime — polling 5s sigue; Realtime es mejora posterior si el polling duele.
- Multi-tenancy, invitaciones por email, signup abierto.
- DELETE desde panel — purge y merge corren por service-role (Inngest); sin DELETE policies para `authenticated`.

### Decisiones tomadas (brainstorming 2026-07-14)

1. **Login: email + password.** Magic link descartado: email built-in de Supabase free tier limita ~2/h; exigiría SMTP custom ya.
2. **Alta usuarios: dashboard Supabase.** Admin crea usuario en Auth con `app_metadata: {"rol": "admin"|"vendedor", "nombre": "..."}`. El trigger `private.handle_new_auth_user()` (migration 0004) sincroniza a `public.usuarios`.
3. **Panel 100% authed client.** Sin esto las policies son decorativas para el panel.

### Tecnologías

| Capa         | Decisión                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Session      | `@supabase/ssr` (dep nueva aprobada) — cookies pattern `getAll`/`setAll` (API actual; `get/set/remove` está deprecado) |
| Middleware   | Convención Next 16 (`proxy.ts` si aplica al runtime actual; verificar file-convention exacta al implementar)           |
| Server check | **Siempre `auth.getUser()`** en server para authz (valida JWT contra Auth server); jamás `getSession()` solo           |
| Rol          | JWT `app_metadata.rol` → helpers SQL existentes `public.current_rol()` / `is_admin()` / `is_vendedor()`                |
| UI login     | shadcn Card + Input + Button, español, Server Action con Zod línea 1                                                   |
| Tests        | Integration suite RLS contra Supabase real (2 usuarios test creados por admin API) + unit login action                 |

---

## 2. Arquitectura

### Session flow

```
[Browser] request /inbox
   │
   ▼
[middleware/proxy]  createServerClient(cookies) → auth.getUser()
   │  sin user → redirect /login
   │  con user → refresh cookies si toca → continue
   ▼
[RSC page]  getInboxServiceForRequest()
   │           └── createServerClient(cookies del request) → repos Supabase authed
   ▼
[Postgres]  RLS policies evalúan JWT (rol en app_metadata)
```

### Login flow

```
[/login form] email+password
   │
   ▼
[login.action.ts 'use server']
   1. LoginSchema.parse (línea 1, regla §0.9.3)
   2. supabase.auth.signInWithPassword(...)   ← client ssr per-request
   3. error → return { ok:false, error: "Credenciales inválidas" } (sin detalle)
   4. ok → redirect('/inbox')
```

Logout: botón en SideNav → `logout.action.ts` → `auth.signOut()` → redirect `/login`.

### Clientes DB: quién usa cuál

| Consumidor                        | Cliente                    |
| --------------------------------- | -------------------------- |
| RSC pages panel                   | **authed** (cookies)       |
| Server Actions panel              | **authed** (cookies)       |
| Inngest functions (bootstrap 7.8) | service-role (sin cambio)  |
| Webhook Meta                      | service-role (sin cambio)  |
| Integration tests repos           | service-role (sin cambio)  |
| Integration tests RLS (nuevos)    | authed por usuario de test |

`getInboxService()` singleton muere → `makeInboxService(db)` puro + `getInboxServiceForRequest()` que construye el client ssr del request. Un client Supabase por request es el patrón oficial ssr (liviano; el pool vive en PostgREST).

### RLS: matriz (fuente `docs/data-model.md`, congelada)

| Tabla            | Admin | Vendedor |
| ---------------- | ----- | -------- |
| empresas         | RW    | R        |
| leads            | RW    | RW       |
| lead_session     | RW    | RW       |
| conversaciones   | RW    | RW       |
| mensajes         | RW    | RW       |
| productos        | RW    | R        |
| intents          | RW    | R        |
| reglas           | RW    | R        |
| tags             | RW    | R        |
| lead_tags        | RW    | RW       |
| usuarios         | R     | R        |
| tool_executions  | R     | R        |
| admin_actions    | R     | —        |
| merge_candidates | RW    | R        |

- **R** = policy `FOR SELECT TO authenticated USING (is_admin() [or is_vendedor()])`.
- **W** = `FOR INSERT ... WITH CHECK` + `FOR UPDATE ... USING + WITH CHECK` (ambas cláusulas obligatorias).
- `usuarios`: W ninguna desde panel (alta/rol = dashboard). Matriz data-model decía admin RW; se ajusta a R+R porque no existe flujo de escritura en el panel — escribir policy W sin consumidor es superficie gratuita. (Desviación documentada.)
- Tablas infra **sin policies** (deny-all a `authenticated`, solo service-role): `event_outbox`, `reactivation_dispatches`, `rule_executions`.
- Storage (`storage.objects` por bucket): `comprobantes_pago` R+INSERT+UPDATE authenticated (upsert exige las tres con SELECT); `productos` R authenticated + W admin; `mensajes_media` R authenticated (INSERT lo hace service-role).
- `server_now()` RPC y helpers de rol: verificar `GRANT EXECUTE TO authenticated` (repos authed los invocan).
- Naming: `<tabla>_<select|insert|update>_<policy>`. Migration única `supabase migration new slice3_rls_policies`.
- Post-migration: `supabase db advisors` + fix findings.

### Riesgo clave documentado

Usuario creado **sin** `app_metadata.rol` → `current_rol()` = null → deny-all (ve panel vacío, no error). Mitigación: runbook de alta en este spec §6 + mensaje en README ops. No se agrega fallback en SQL: fail-closed es el comportamiento correcto.

---

## 3. Estructura archivos

```
src/
├── proxy.ts (o middleware.ts según Next 16)        [NEW] session gate panel
├── lib/supabase/
│   ├── server.ts                                   [NEW] createServerClient cookies (RSC/actions)
│   └── middleware.ts                               [NEW] updateSession helper para proxy
├── app/(auth)/login/
│   ├── page.tsx                                    [MOD] form real
│   └── _actions/login.action.ts                    [NEW]
├── app/(panel)/
│   └── _actions/logout.action.ts                   [NEW]
├── components/shared/SideNav.tsx                   [MOD] botón logout + usuario actual
├── lib/validation/auth.schema.ts                   [NEW] LoginSchema
├── server/bootstrap/inbox-bootstrap.ts             [MOD] singleton → per-request authed
└── server/db/client.ts                             [MOD solo si el tipo AppClient no acepta el client de @supabase/ssr; ambos son SupabaseClient<Database>, esperado sin cambio]

supabase/migrations/<ts>_slice3_rls_policies.sql    [NEW] policies + grants + storage

tests/
├── unit/auth-schema.test.ts                        [NEW]
└── integration/rls-policies.supabase.test.ts       [NEW] matriz admin/vendedor real

.github/workflows/ci.yml                            [MOD] MIN_RLS_POLICIES=N (count exacto de policies de la migration, se fija en 9.2)
docs/security-threat-model.md                       [MOD] STRIDE post-Slice 3
```

---

## 4. Sub-pasos (cadencia §5)

| Sub-paso | Scope                                                                                             | Validación                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **9.1**  | `@supabase/ssr` + clients + middleware/proxy + login page + login/logout actions + SideNav logout | Browser: sin session `/inbox`→`/login`; login usuario test → `/inbox`; logout → `/login`. Unit schema. |
| **9.2**  | Migration policies + grants + storage + advisors + CI gate bump                                   | `supabase db advisors` limpio; integration RLS suite verde (matriz completa admin/vendedor).           |
| **9.3**  | Swap panel a authed client (bootstrap per-request) + ajustes actions                              | Browser con login: inbox/conversación/send/handoff/close funcionan con RLS activo. 632+ unit verde.    |
| **9.4**  | STRIDE walkthrough doc + `security-review` skill + docs estado                                    | Threat model actualizado; findings triaged; AGENTS/next-session al día.                                |

Orden 9.2 antes de 9.3: si el swap va primero, el panel queda deny-all (policies aún no existen).

---

## 5. Testing

- **Integration RLS (la que importa):** `beforeAll` crea `admin-test@` y `vendedor-test@` vía `auth.admin.createUser` (service-role, `email_confirm: true`, `app_metadata.rol`), login real `signInWithPassword` → 2 clients authed. Asserts por la matriz: vendedor SELECT productos ✓ / UPDATE productos ✗ (0 rows, sin error — trampa RLS conocida: se asserta count) / SELECT admin_actions ✗ / RW leads ✓; admin UPDATE productos ✓; anon SELECT leads ✗. `afterAll` borra usuarios test.
- **Unit:** LoginSchema + login action error mapping (credenciales inválidas → mensaje fijo, sin filtrar si el email existe).
- **Browser:** flujo login/logout + smoke del panel completo autenticado (9.3).

---

## 6. Runbook alta de usuarios (pilot)

1. Dashboard → Authentication → Users → Add user → email + password.
2. **Antes del primer login:** editar el usuario → App Metadata → `{"rol": "vendedor", "nombre": "Juan Vendedor"}` (o `"admin"`).
3. El trigger crea la fila en `public.usuarios` automáticamente.
4. Si el usuario ya inició sesión antes de tener rol: cerrar sesión y volver a entrar (el JWT cachea `app_metadata` hasta refresh).

---

## 7. Out of scope explícito

Realtime, gestión usuarios UI, reset password self-service, MFA, rate-limit de login custom (Supabase Auth trae protección built-in), RLS per-vendedor (ownership), auditoría de sesiones.

---

**FIN SPEC.**
