/**
 * Factory de clients Supabase con separación estricta service-role vs authed.
 *
 * Zone rules (enforce vía ESLint en A7):
 *   - `service_role` client → solo `src/server/inngest/**`, `src/server/repositories/**`,
 *     `src/inngest/**`, cron handlers. NUNCA en `src/app/**` (UI/Server Actions).
 *   - `authed` client → solo `src/app/**` (Server Components / Server Actions /
 *     route handlers). Per-request, lleva el JWT del usuario para RLS.
 *
 * Defense-in-depth: si UI bug llama a service_role, todo el filtro RLS se bypassa
 * = data exfiltration silenciosa. La regla ESLint detiene el import antes de runtime.
 *
 * Real wireup: Slice 1 sub-paso 7.3 instalará `@supabase/supabase-js` + `gen types` →
 * reemplaza el placeholder `AppClient = unknown` por `SupabaseClient<Database>`.
 */

import { env } from "@/lib/env";

// Placeholder hasta `supabase gen types` (Slice 1 sub-paso 7.3).
// Reemplazar por: `import type { SupabaseClient } from "@supabase/supabase-js";`
// `import type { Database } from "./types.gen";`
// `export type AppClient = SupabaseClient<Database>;`
export type AppClient = unknown;

export interface DbClientsConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface DbClientFactory {
  serviceRole(): AppClient;
  authed(accessToken: string): AppClient;
}

const STUB_MSG =
  "Slice 1 sub-paso 7.3 pendiente: install @supabase/supabase-js + gen types + reemplazar stub";

/**
 * Factory pura — recibe config (test inyectable). Usar `defaultDbClientFactory()`
 * para singleton runtime que lee env validado.
 */
export function makeDbClientFactory(_cfg: DbClientsConfig): DbClientFactory {
  return {
    serviceRole() {
      throw new Error(`makeDbClientFactory.serviceRole: ${STUB_MSG}`);
    },
    authed(_accessToken: string) {
      throw new Error(`makeDbClientFactory.authed: ${STUB_MSG}`);
    },
  };
}

let _default: DbClientFactory | null = null;

/**
 * Singleton para runtime. Lee env (validado por src/lib/env.ts en A6).
 * Lazy: no inicializa hasta primer call → tests no pagan setup cost.
 */
export function defaultDbClientFactory(): DbClientFactory {
  if (_default === null) {
    _default = makeDbClientFactory({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  return _default;
}

/** Test-only: resetear singleton entre tests si se inyecta factory custom. */
export function __resetDefaultDbClientFactoryForTests(): void {
  _default = null;
}
