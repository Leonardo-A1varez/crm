# Slice 3 — Auth + RLS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel protegido con Supabase Auth (email+password) y RLS efectivo end-to-end: RSC/actions con cliente authed por cookies, policies SQL por rol, tests de integración de la matriz, STRIDE actualizado.

**Architecture:** `@supabase/ssr` crea un client per-request desde cookies; `src/proxy.ts` (Next 16) refresca sesión y redirige sin login; una migration agrega todas las policies (`TO authenticated` + helpers `is_admin()`/`is_vendedor()` ya migrados); `getInboxService()` singleton se reemplaza por factory per-request. Inngest/webhooks siguen service-role.

**Tech Stack:** Next 16.2.6 App Router · @supabase/ssr (dep nueva) · supabase-js v2 · Zod 4 · Vitest · Playwright MCP para validación browser.

## Global Constraints

- Spec fuente: `docs/superpowers/specs/2026-07-14-slice3-auth-rls-design.md`. Matriz RLS congelada (spec §2).
- Español en UI/comentarios/commits; Conventional Commits subject ≤72; body líneas ≤100 (commitlint).
- Zod `safeParse` línea 1 en toda Server Action (AGENTS §0.9.3).
- `logger.*` únicamente; `console.*` prohibido en `src/**`.
- Server authz: **siempre `auth.getUser()`**, nunca `getSession()` solo.
- Rol SOLO desde `app_metadata` (jamás `user_metadata`).
- Zones ESLint: helpers auth en `src/server/auth/` (zona `server-auth`, importable desde `app`); **desviación de spec §3 que decía `lib/supabase/` — imposible: `lib` no puede importar `Database` de `server-db`.**
- Policies: predicados envueltos en `(select ...)` — initplan caching, advisor-friendly.
- Cada task termina con typecheck+lint+tests verdes y un commit.

---

### Task 1: Dep `@supabase/ssr` + clients server-auth

**Files:**

- Modify: `package.json` (dep nueva)
- Create: `src/server/auth/supabase-ssr.ts`
- Create: `src/server/auth/middleware-session.ts`

**Interfaces:**

- Produces: `createSupabaseServerClient(): Promise<AppClient>` (RSC/actions, cookies request) · `getAuthenticatedUser(): Promise<User | null>` · `updateSession(request: NextRequest): Promise<{ response: NextResponse; user: User | null }>`.

- [ ] **Step 1: Instalar dep**

```powershell
npm install @supabase/ssr
```

Verificar en `package.json` que quedó pinneada con `^` (lockfile commiteado). Versión esperada ≥0.7.

- [ ] **Step 2: Client server per-request**

`src/server/auth/supabase-ssr.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { AppClient } from "@/server/db/client";
import type { Database } from "@/server/db/types.gen";
import type { User } from "@supabase/supabase-js";

/**
 * Client Supabase authed por cookies del request (RSC / Server Actions).
 * Sujeto a RLS. Un client por request es el patrón oficial @supabase/ssr.
 * setAll lanza en RSC (no puede escribir cookies): se ignora — el refresh
 * de sesión lo hace el proxy, acá solo leemos.
 */
export async function createSupabaseServerClient(): Promise<AppClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // RSC: solo lectura de cookies; el proxy refresca la sesión.
          }
        },
      },
    },
  );
}

/** getUser() valida el JWT contra el Auth server — único check válido para authz. */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
```

- [ ] **Step 3: Helper de sesión para proxy**

`src/server/auth/middleware-session.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "@/server/db/types.gen";
import type { User } from "@supabase/supabase-js";

/**
 * Refresca la sesión en el edge del request y expone el user validado.
 * Patrón oficial @supabase/ssr: las cookies refrescadas se copian a la
 * response para que el browser las persista.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  return { response, user: data.user ?? null };
}
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npx eslint src/server/auth`
Expected: 0 errors (si boundaries queja por zona nueva `server-auth`, revisar `eslint.config.mjs`: la zona ya existe per AGENTS §4; si el path pattern no matchea `src/server/auth/**`, agregarlo al config igual que `server-db`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/auth/
git commit -m "feat(auth): Slice 3 9.1 clients @supabase/ssr per-request"
```

---

### Task 2: LoginSchema (TDD)

**Files:**

- Create: `tests/unit/auth-schema.test.ts`
- Create: `src/lib/validation/auth.schema.ts`

**Interfaces:**

- Produces: `LoginSchema` (zod) · `LoginInput = { email: string; password: string }`.

- [ ] **Step 1: Test que falla**

`tests/unit/auth-schema.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { LoginSchema } from "@/lib/validation/auth.schema";

describe("LoginSchema", () => {
  test("acepta email válido y password no vacía, normaliza email a lowercase", () => {
    const parsed = LoginSchema.parse({ email: "Admin@Empresa.COM", password: "secreta123" });
    expect(parsed.email).toBe("admin@empresa.com");
  });

  test("rechaza email inválido", () => {
    expect(LoginSchema.safeParse({ email: "no-email", password: "x".repeat(8) }).success).toBe(
      false,
    );
  });

  test("rechaza password menor a 8", () => {
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "corta" }).success).toBe(false);
  });

  test("rechaza password mayor a 72 (límite bcrypt)", () => {
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "x".repeat(73) }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Verificar RED**

Run: `npx vitest run tests/unit/auth-schema.test.ts`
Expected: FAIL (módulo `auth.schema` no existe).

- [ ] **Step 3: Schema mínimo**

`src/lib/validation/auth.schema.ts`:

```ts
import { z } from "zod";

// 8-72: mínimo razonable + tope bcrypt de Supabase Auth.
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
});
export type LoginInput = z.infer<typeof LoginSchema>;
```

- [ ] **Step 4: Verificar GREEN**

Run: `npx vitest run tests/unit/auth-schema.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/auth-schema.test.ts src/lib/validation/auth.schema.ts
git commit -m "feat(auth): Slice 3 9.1 LoginSchema zod (TDD)"
```

---

### Task 3: Actions login/logout + página login + logout en panel

**Files:**

- Create: `src/app/(auth)/login/_actions/login.action.ts`
- Create: `src/app/(panel)/_actions/logout.action.ts`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/components/auth/LogoutButton.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(panel)/layout.tsx`

**Interfaces:**

- Consumes: `createSupabaseServerClient`, `getAuthenticatedUser` (Task 1) · `LoginSchema`, `LoginInput` (Task 2) · `ActionResult` (`@/types/inbox`, existente).
- Produces: `loginAction(raw: unknown): Promise<ActionResult>` · `logoutAction(): Promise<ActionResult>`.

- [ ] **Step 1: login action**

`src/app/(auth)/login/_actions/login.action.ts`:

```ts
"use server";

import { LoginSchema } from "@/lib/validation/auth.schema";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import type { ActionResult } from "@/types/inbox";

export async function loginAction(raw: unknown): Promise<ActionResult> {
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Email o contraseña con formato inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Mensaje fijo: no revelar si el email existe (enumeración de cuentas).
    return { ok: false, error: "Credenciales inválidas." };
  }
  return { ok: true };
}
```

- [ ] **Step 2: logout action**

`src/app/(panel)/_actions/logout.action.ts`:

```ts
"use server";

import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import type { ActionResult } from "@/types/inbox";

export async function logoutAction(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return { ok: true };
}
```

Nota: las actions SÍ pueden escribir cookies (el `setAll` de Task 1 no lanza en ese contexto).

- [ ] **Step 3: LoginForm client**

`src/components/auth/LoginForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LoginInput } from "@/lib/validation/auth.schema";
import type { ActionResult } from "@/types/inbox";

export function LoginForm({ onLogin }: { onLogin: (input: LoginInput) => Promise<ActionResult> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onLogin({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/inbox");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex w-80 flex-col gap-3">
      <h1 className="text-lg font-semibold">CRM Repuestos</h1>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs">Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          disabled={isPending}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs">Contraseña</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: LogoutButton client**

`src/components/auth/LogoutButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/types/inbox";

export function LogoutButton({ onLogout }: { onLogout: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      className="w-full justify-start gap-3"
      onClick={() =>
        startTransition(async () => {
          await onLogout();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <LogOut className="h-4 w-4" />
      Cerrar sesión
    </Button>
  );
}
```

- [ ] **Step 5: Página login + layout panel**

`src/app/(auth)/login/page.tsx` (reemplazo completo):

```tsx
import { LoginForm } from "@/components/auth/LoginForm";
import { loginAction } from "./_actions/login.action";

export default function LoginPage() {
  return <LoginForm onLogin={loginAction} />;
}
```

`src/app/(panel)/layout.tsx` (reemplazo completo — async, muestra email + logout):

```tsx
import { SideNav } from "@/components/shared/SideNav";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { logoutAction } from "./_actions/logout.action";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-56 flex-col border-r">
        <div className="border-sidebar-border border-b p-4">
          <span className="text-base font-semibold">CRM Repuestos</span>
        </div>
        <div className="flex-1">
          <SideNav />
        </div>
        <div className="border-sidebar-border border-t p-2">
          {user?.email ? (
            <p className="text-muted-foreground truncate px-3 pb-1 text-xs">{user.email}</p>
          ) : null}
          <LogoutButton onLogout={logoutAction} />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npx eslint src/app src/components/auth && npx prettier --check "src/**/*.{ts,tsx}"`
Expected: limpio (formatear con `--write` si hace falta).

- [ ] **Step 7: Commit**

```bash
git add src/app/(auth) src/app/(panel)/_actions src/app/(panel)/layout.tsx src/components/auth
git commit -m "feat(auth): Slice 3 9.1 login/logout + LoginForm + email en panel"
```

---

### Task 4: `src/proxy.ts` session gate + validación browser 9.1

**Files:**

- Create: `src/proxy.ts`
- Create (temporal, se borra): `.tmp-create-test-user.mjs`

**Interfaces:**

- Consumes: `updateSession` (Task 1).

- [ ] **Step 1: proxy**

`src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/server/auth/middleware-session";

// Next 16: middleware se llama proxy. Gate de sesión del panel; webhooks
// quedan fuera del matcher (HMAC propio) igual que assets estáticos.
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isLogin = pathname === "/login";
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Todo salvo: api (webhooks HMAC), estáticos Next, favicon, archivos con extensión.
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
```

Nota: si Next 16 exige `proxyConfig` en lugar de `config` (referencia skill lo sugiere), el Step 4 lo detecta — el redirect no ocurriría; renombrar el export y re-verificar.

- [ ] **Step 2: Usuario de test en Supabase**

`.tmp-create-test-user.mjs` (raíz del repo; se ejecuta y borra):

```js
import { createClient } from "@supabase/supabase-js";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const { data, error } = await db.auth.admin.createUser({
  email: "admin-dev@crm.local",
  password: "dev-admin-2026!",
  email_confirm: true,
  app_metadata: { rol: "admin", nombre: "Admin Dev" },
});
if (error && !error.message.includes("already")) throw new Error(error.message);
console.log("usuario admin-dev listo:", data?.user?.id ?? "(ya existía)");
```

Run: `node --env-file=.env.local .tmp-create-test-user.mjs` y luego borrar el archivo.
Credencial documentada solo para dev local (proyecto crm-dev). NO es un secret de producción.

- [ ] **Step 3: Levantar dev server**

Run (background): `npm run dev` (puerto 3001).

- [ ] **Step 4: Validación browser (Playwright MCP)**

1. `GET /inbox` sin cookies → termina en `/login` (redirect proxy).
2. Login con `admin-dev@crm.local` / `dev-admin-2026!` → redirect `/inbox`, sidebar muestra email + "Cerrar sesión".
3. `GET /login` ya logueado → redirect `/inbox`.
4. Click "Cerrar sesión" → `/login`; volver a `/inbox` → redirect `/login`.
5. Login con password mala → mensaje "Credenciales inválidas." inline, sin redirect.
6. Console browser: 0 errors.

Expected: los 6 puntos verdes. Nota: el panel sigue leyendo con service-role hasta Task 7, así que los datos se ven igual que antes — acá se valida SOLO el gate de sesión.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(auth): Slice 3 9.1 proxy session gate + redirects login"
```

---

### Task 5: Migration RLS policies + grants + storage + CI gate

**Files:**

- Create: `supabase/migrations/<timestamp>_slice3_rls_policies.sql` (crear con `supabase migration new slice3_rls_policies`)
- Modify: `.github/workflows/ci.yml` (env `MIN_RLS_POLICIES`)

**Interfaces:**

- Consumes: helpers SQL existentes `public.is_admin()`, `public.is_vendedor()` (migration 0004).

- [ ] **Step 1: Crear archivo migration**

Run: `supabase migration new slice3_rls_policies`
Expected: crea `supabase/migrations/<ts>_slice3_rls_policies.sql` vacío.

- [ ] **Step 2: Escribir SQL completo**

Contenido del archivo (predicados con `(select ...)` para initplan caching; W admin-only donde la matriz dice R vendedor):

```sql
-- Slice 3 — RLS policies por rol (matriz docs/data-model.md, spec 2026-07-14).
-- Fail-closed: usuario authenticated SIN app_metadata.rol no matchea ninguna policy.
-- Tablas infra (event_outbox, reactivation_dispatches, rule_executions) quedan
-- deny-all para authenticated: solo service-role (bypassa RLS) las toca.

-- ===== helpers: grants (por si migrations previas no los dieron) =====
grant execute on function public.server_now() to authenticated;

-- ===== macro-predicados =====
-- R ambos roles:  (select public.is_admin()) or (select public.is_vendedor())
-- W solo admin:   (select public.is_admin())

-- ===== empresas: R ambos / W admin =====
create policy empresas_select on public.empresas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy empresas_insert_admin on public.empresas
  for insert to authenticated
  with check ((select public.is_admin()));
create policy empresas_update_admin on public.empresas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== leads: RW ambos =====
create policy leads_select on public.leads
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy leads_insert on public.leads
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy leads_update on public.leads
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== lead_session: RW ambos =====
create policy lead_session_select on public.lead_session
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_session_insert on public.lead_session
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_session_update on public.lead_session
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== conversaciones: RW ambos =====
create policy conversaciones_select on public.conversaciones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy conversaciones_insert on public.conversaciones
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy conversaciones_update on public.conversaciones
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== mensajes: RW ambos =====
create policy mensajes_select on public.mensajes
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy mensajes_insert on public.mensajes
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy mensajes_update on public.mensajes
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== productos: R ambos / W admin =====
create policy productos_select on public.productos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy productos_insert_admin on public.productos
  for insert to authenticated
  with check ((select public.is_admin()));
create policy productos_update_admin on public.productos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== intents: R ambos / W admin =====
create policy intents_select on public.intents
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy intents_insert_admin on public.intents
  for insert to authenticated
  with check ((select public.is_admin()));
create policy intents_update_admin on public.intents
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== reglas: R ambos / W admin =====
create policy reglas_select on public.reglas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy reglas_insert_admin on public.reglas
  for insert to authenticated
  with check ((select public.is_admin()));
create policy reglas_update_admin on public.reglas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== tags: R ambos / W admin =====
create policy tags_select on public.tags
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy tags_insert_admin on public.tags
  for insert to authenticated
  with check ((select public.is_admin()));
create policy tags_update_admin on public.tags
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== lead_tags: RW ambos (sin DELETE hasta que exista flujo en panel) =====
create policy lead_tags_select on public.lead_tags
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_tags_insert on public.lead_tags
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_tags_update on public.lead_tags
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== usuarios: R ambos (W = dashboard Supabase, sin policy) =====
create policy usuarios_select on public.usuarios
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== tool_executions: R ambos =====
create policy tool_executions_select on public.tool_executions
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== admin_actions: R solo admin =====
create policy admin_actions_select_admin on public.admin_actions
  for select to authenticated
  using ((select public.is_admin()));

-- ===== merge_candidates: R ambos / W admin =====
create policy merge_candidates_select on public.merge_candidates
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy merge_candidates_insert_admin on public.merge_candidates
  for insert to authenticated
  with check ((select public.is_admin()));
create policy merge_candidates_update_admin on public.merge_candidates
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== storage.objects: por bucket =====
-- comprobantes_pago: R + upsert vendedor/admin (upsert = INSERT+SELECT+UPDATE).
create policy storage_comprobantes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_comprobantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_comprobantes_update on storage.objects
  for update to authenticated
  using (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())))
  with check (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));

-- productos: R ambos / W admin.
create policy storage_productos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'productos'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_productos_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productos' and (select public.is_admin()));
create policy storage_productos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'productos' and (select public.is_admin()))
  with check (bucket_id = 'productos' and (select public.is_admin()));

-- mensajes_media: R ambos (INSERT lo hace service-role vía webhook pipeline).
create policy storage_mensajes_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mensajes_media'
    and ((select public.is_admin()) or (select public.is_vendedor())));
```

Antes de dar por bueno el SQL: verificar contra `supabase/migrations/20260514000016_repo_helpers.sql` el nombre exacto de la función (`server_now`) y contra `20260512000005_storage_buckets.sql` los nombres exactos de buckets (`comprobantes_pago`, `productos`, `mensajes_media`) — ajustar si difieren.

- [ ] **Step 3: Aplicar y auditar**

Run:

```powershell
npm run db:push        # o: supabase db push --linked
supabase migration list --linked
```

Expected: 17/17 aplicadas.

Run advisors (CLI ≥2.81.3): `supabase db advisors` (fallback: revisar dashboard → Advisors).
Expected: 0 errors nuevos; si advisor pide índices/ajustes en policies, aplicarlos en la misma migration ANTES de commitear (la migration todavía no está en remoto git).

- [ ] **Step 4: CI gate**

En `.github/workflows/ci.yml`, localizar el step que corre `scripts/verify-rls-policies.sh` y setear:

```yaml
env:
  MIN_RLS_POLICIES: "40"
```

(La migration trae 43 `create policy`; 40 deja margen sin dejar pasar un borrado accidental masivo.)

- [ ] **Step 5: Integration tests existentes siguen verdes**

Run: `npm run test:integration`
Expected: 157+ pass (service-role bypassa RLS; nada cambia).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations .github/workflows/ci.yml
git commit -m "feat(db): Slice 3 9.2 RLS policies por rol + storage + CI gate"
```

---

### Task 6: Integration suite RLS (matriz real)

**Files:**

- Create: `tests/integration/rls-policies.supabase.test.ts`

**Interfaces:**

- Consumes: `makeTestSupabaseClient`, `cleanupTestDb` (`tests/integration/setup.ts`) · env `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Escribir suite completa**

`tests/integration/rls-policies.supabase.test.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { Database } from "@/server/db/types.gen";

/**
 * Matriz RLS (spec Slice 3). Convenciones PostgREST:
 *  - SELECT denegado  → data [] (0 rows), SIN error.
 *  - INSERT denegado  → error code 42501 (RLS violation).
 *  - UPDATE denegado  → 0 rows afectadas, SIN error (trampa conocida).
 */

type AuthedClient = SupabaseClient<Database>;

const PASSWORD = "rls-test-2026!secret";
const EMAILS = {
  admin: "rls-admin-test@crm.local",
  vendedor: "rls-vendedor-test@crm.local",
  sinRol: "rls-sinrol-test@crm.local",
} as const;

let service: TestClient;
let admin: AuthedClient;
let vendedor: AuthedClient;
let sinRol: AuthedClient;
let anon: AuthedClient;
let leadId: string;
const userIds: string[] = [];

function anonClient(): AuthedClient {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function loginAs(email: string): Promise<AuthedClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login test user ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);

  for (const [key, email] of Object.entries(EMAILS)) {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: key === "sinRol" ? {} : { rol: key === "admin" ? "admin" : "vendedor" },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    userIds.push(data.user.id);
  }

  admin = await loginAs(EMAILS.admin);
  vendedor = await loginAs(EMAILS.vendedor);
  sinRol = await loginAs(EMAILS.sinRol);
  anon = anonClient();

  // Fixture mínima por service-role.
  const { data: lead, error: e } = await service
    .from("leads")
    .insert({
      nombre: "Lead RLS",
      telefono: "+595981000111",
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa",
      meta_user_ids: {},
    })
    .select()
    .single();
  if (e) throw new Error(e.message);
  leadId = lead.id;

  const { error: e2 } = await service.from("productos").insert({
    codigo_interno: "RLS-TEST-1",
    nombre: "Producto RLS",
    compatibilidad: [],
    precio: 1000,
    stock: 5,
    activo: true,
  });
  if (e2) throw new Error(e2.message);

  const { error: e3 } = await service.from("admin_actions").insert({
    actor: "system",
    action: "rls-fixture",
    target_type: "test",
    target_id: leadId,
    detalle: {},
  });
  if (e3) throw new Error(e3.message);
}, 120_000);

afterAll(async () => {
  for (const id of userIds) {
    await service.auth.admin.deleteUser(id);
  }
  await cleanupTestDb(service);
}, 120_000);

describe("RLS — vendedor", () => {
  test("SELECT leads permitido", async () => {
    const { data, error } = await vendedor.from("leads").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });

  test("INSERT + UPDATE lead permitidos", async () => {
    const { data: created, error } = await vendedor
      .from("leads")
      .insert({
        nombre: "Lead Vendedor",
        telefono: "+595981000222",
        vehiculo_marca: "Kia",
        vehiculo_modelo: "Rio",
        vehiculo_anio: 2019,
        canal_origen: "wa",
        meta_user_ids: {},
      })
      .select()
      .single();
    expect(error).toBeNull();

    const { data: updated, error: e2 } = await vendedor
      .from("leads")
      .update({ nombre: "Lead Vendedor 2" })
      .eq("id", created!.id)
      .select();
    expect(e2).toBeNull();
    expect(updated).toHaveLength(1);
  });

  test("SELECT productos permitido, INSERT denegado (42501)", async () => {
    const { data, error } = await vendedor.from("productos").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);

    const { error: e2 } = await vendedor.from("productos").insert({
      codigo_interno: "RLS-DENY-1",
      nombre: "No debería",
      compatibilidad: [],
      precio: 1,
      stock: 0,
      activo: true,
    });
    expect(e2?.code).toBe("42501");
  });

  test("UPDATE productos denegado silencioso (0 rows)", async () => {
    const { data, error } = await vendedor
      .from("productos")
      .update({ precio: 9999 })
      .eq("codigo_interno", "RLS-TEST-1")
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("admin_actions invisible (0 rows)", async () => {
    const { data, error } = await vendedor.from("admin_actions").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("event_outbox deny-all (SELECT 0 rows, INSERT 42501)", async () => {
    const { data } = await vendedor.from("event_outbox").select("id");
    expect(data ?? []).toHaveLength(0);
    const { error } = await vendedor
      .from("event_outbox")
      .insert({ event_name: "x", event_data: {}, event_id: null });
    expect(error?.code).toBe("42501");
  });
});

describe("RLS — admin", () => {
  test("INSERT + UPDATE productos permitidos", async () => {
    const { error } = await admin.from("productos").insert({
      codigo_interno: "RLS-ADMIN-1",
      nombre: "Producto Admin",
      compatibilidad: [],
      precio: 500,
      stock: 2,
      activo: true,
    });
    expect(error).toBeNull();

    const { data, error: e2 } = await admin
      .from("productos")
      .update({ precio: 750 })
      .eq("codigo_interno", "RLS-ADMIN-1")
      .select();
    expect(e2).toBeNull();
    expect(data).toHaveLength(1);
  });

  test("admin_actions visible", async () => {
    const { data, error } = await admin.from("admin_actions").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("RLS — fail-closed", () => {
  test("anon: SELECT leads vacío", async () => {
    const { data } = await anon.from("leads").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  test("authenticated sin rol: SELECT leads vacío (fail-closed)", async () => {
    const { data, error } = await sinRol.from("leads").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("authenticated sin rol: INSERT lead denegado (42501)", async () => {
    const { error } = await sinRol.from("leads").insert({
      nombre: "No entra",
      telefono: "+595981000333",
      vehiculo_marca: "X",
      vehiculo_modelo: "Y",
      vehiculo_anio: 2020,
      canal_origen: "wa",
      meta_user_ids: {},
    });
    expect(error?.code).toBe("42501");
  });
});
```

Antes de correr: verificar columnas exactas de `admin_actions` en `types.gen.ts` (nombres `actor/action/target_type/target_id/detalle` pueden diferir) y ajustar el insert de fixture.

- [ ] **Step 2: Correr**

Run: `npm run test:integration -- rls-policies`
Expected: suite completa verde. Si `UPDATE productos` denegado devolviera error en vez de 0 rows, revisar que la policy `productos_select` exista (UPDATE necesita SELECT).

- [ ] **Step 3: Suite integration completa**

Run: `npm run test:integration`
Expected: todas verdes (las previas usan service-role).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/rls-policies.supabase.test.ts
git commit -m "test(db): Slice 3 9.2 suite integración matriz RLS"
```

---

### Task 7: Swap panel a authed client

**Files:**

- Modify: `src/server/bootstrap/inbox-bootstrap.ts`
- Modify: `src/app/(panel)/inbox/page.tsx:19` (llamada al service)
- Modify: `src/app/(panel)/inbox/[leadId]/page.tsx:22` (ídem)
- Modify: `src/app/(panel)/inbox/_actions/send-message.action.ts`
- Modify: `src/app/(panel)/inbox/_actions/toggle-handoff.action.ts`
- Modify: `src/app/(panel)/inbox/_actions/close-session.action.ts`

**Interfaces:**

- Consumes: `createSupabaseServerClient` (Task 1).
- Produces: `getInboxServiceForRequest(): Promise<InboxService>` (reemplaza `getInboxService()`; el nombre viejo desaparece — actualizar TODOS los call sites).

- [ ] **Step 1: Bootstrap per-request**

`src/server/bootstrap/inbox-bootstrap.ts` (reemplazo completo):

```ts
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import type { AppClient } from "@/server/db/client";
import type { InboxService } from "@/server/services/inbox/inbox.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeInboxService(db: AppClient): InboxService {
  const convs = new SupabaseConversationsRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  const sessions = new SupabaseLeadSessionRepository(db);

  const metaClient = new GraphApiMetaClient({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    igPageId: env.META_IG_PAGE_ID,
    igAccessToken: env.META_IG_ACCESS_TOKEN,
    fbPageId: env.META_FB_PAGE_ID,
    fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
  });

  return new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, metaClient),
    handoff: new DefaultHandoffService(sessions),
  });
}

/**
 * Slice 3: el panel consume la DB con el client authed del request (RLS real).
 * Un service nuevo por request — construcción barata, el pool vive en PostgREST.
 */
export async function getInboxServiceForRequest(): Promise<InboxService> {
  const db = await createSupabaseServerClient();
  return makeInboxService(db);
}
```

- [ ] **Step 2: Call sites**

En `src/app/(panel)/inbox/page.tsx` y `src/app/(panel)/inbox/[leadId]/page.tsx`:

```ts
// antes
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";
const items = await getInboxService().listActiveLeads();
// después
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
const svc = await getInboxServiceForRequest();
const items = await svc.listActiveLeads();
```

(En `[leadId]/page.tsx` es `view = await (await getInboxServiceForRequest()).getConversation(leadId)` — mantener el try/catch NotFoundError existente.)

En las 3 actions (`send-message`, `toggle-handoff`, `close-session`):

```ts
// antes
await getInboxService().sendMessage({...});
// después
const svc = await getInboxServiceForRequest();
await svc.sendMessage({...});
```

- [ ] **Step 3: Verificar unit + typecheck**

Run: `npm run typecheck && npm test`
Expected: 0 errors, 636+ tests verdes (los unit usan InMemory — no tocan bootstrap).
Run: `npx eslint src` — si boundaries bloquea `server-bootstrap → server-auth`, agregar `server-auth` a los imports permitidos de la zona del bootstrap en `eslint.config.mjs` (cambio de config legítimo, documentarlo en el commit).

- [ ] **Step 4: Validación browser full (RLS activo)**

Con dev server corriendo y logueado como `admin-dev@crm.local`:

1. `/inbox` lista leads fixture (ahora vía authed client + policies).
2. `/inbox/<leadId Juan>` thread + TwinPanel visibles.
3. Enviar mensaje → toast "El canal de mensajería rechazó la autenticación..." (Meta placeholder; el INSERT no llega — orden send-first) — igual que antes del swap.
4. Pausar IA → badge aparece (UPDATE lead_session vía authed ✓).
5. Logout → login → todo repetible.
6. Console 0 errors.

Expected: paridad funcional total con service-role. Si la lista aparece vacía estando logueado → el JWT no trae `app_metadata.rol` (recrear usuario con app_metadata; ver runbook spec §6).

- [ ] **Step 5: Commit**

```bash
git add src/server/bootstrap/inbox-bootstrap.ts "src/app/(panel)/inbox"
git commit -m "feat(auth): Slice 3 9.3 panel consume DB con client authed (RLS real)"
```

---

### Task 8: STRIDE walkthrough + security review + docs

**Files:**

- Modify: `docs/security-threat-model.md` (nueva sección estado post-Slice 3)
- Modify: `AGENTS.md` (§2 estado + tabla)
- Modify: `docs/next-session.md`

- [ ] **Step 1: STRIDE**

Agregar al final de `docs/security-threat-model.md` sección `## Estado post-Slice 3 (2026-07-14)` con la tabla STRIDE → mitigación implementada → gap restante:

| Amenaza                | Mitigación implementada                                                                      | Gap restante                                            |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Spoofing               | Supabase Auth email+password; `getUser()` server-side; proxy gate                            | MFA (post-launch); rate-limit login = built-in Supabase |
| Tampering              | RLS por rol fail-closed; HMAC webhooks; Zod en actions                                       | —                                                       |
| Repudiation            | `admin_actions` + `tool_executions` (read-only panel)                                        | Sentry (7.7.D) para trail de errores                    |
| Information disclosure | RLS; `redactPii` en logs; toasts curados; deny-all infra tables                              | OTel spans sin PII (7.7.C)                              |
| DoS                    | Rate limiter Upstash webhook; Vercel edge; caps LLM diarios                                  | Rate limit por usuario panel (post-launch)              |
| Elevation of privilege | Rol solo en `app_metadata`; helpers fail-closed; service-role solo server; ESLint boundaries | Revisión periódica de grants (runbook secrets-rotation) |

- [ ] **Step 2: Security review skill**

Invocar Skill `security-review` sobre los cambios del slice. Triage findings: fix inmediato los reales, documentar los aceptados en el threat model.

- [ ] **Step 3: Docs estado**

- `AGENTS.md`: Fase actual → `Slice 3 COMPLETO`; sub-paso actual (resumen 9.1-9.4 + commits); tabla progreso Slice 3 🟢; métricas (tests nuevos, "browser validation auth ✅"); siguiente → Slice 4 (cron real + 7.7.B/C/D + launch).
- `docs/next-session.md`: header, tabla (9.1-9.4 ✅), opciones próximas (A: Slice 4 / B: vistas 9-12 / A': META reales), historial commits, y **nota runbook alta usuarios** (spec §6) + credencial dev `admin-dev@crm.local` documentada como local-only.

- [ ] **Step 4: Verificación final completa**

Run: `npm run ci` (typecheck + lint + format:check + coverage)
Expected: verde con coverage sobre thresholds.
Run: `npm run test:integration`
Expected: verde.

- [ ] **Step 5: Commit + push**

```bash
git add docs/security-threat-model.md AGENTS.md docs/next-session.md
git commit -m "docs(security,agents): Slice 3 STRIDE post-implementación + estado"
git push
```

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura spec:** login (T2-T3), proxy (T4), policies+storage+grants+CI (T5), tests matriz incl. sin-rol/anon (T6), swap authed (T7), STRIDE+review (T8). Runbook alta usuarios ya vive en spec §6; next-session lo referencia (T8).
- **Desviación registrada:** `lib/supabase/` → `src/server/auth/` por zones (spec §3 anotada arriba en Global Constraints).
- **Consistencia de nombres:** `createSupabaseServerClient` / `updateSession` / `getInboxServiceForRequest` / `makeInboxService` usados idénticos en T1/T3/T4/T7.
- **Verificaciones runtime marcadas:** `config` vs `proxyConfig` (T4), columnas `admin_actions` (T6), nombres buckets + `server_now` (T5), zona `server-auth` en eslint (T1/T7).
