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
 * Pre-Slice 3: RLS policies aún no escritas → authed client retorna 0 rows para
 * mayoría queries. Service-role obligatorio mientras tanto. Ver docs/security-threat-model.md.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./types.gen";

export type AppClient = SupabaseClient<Database>;

export interface DbClientsConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface DbClientFactory {
  /**
   * Service-role bypass RLS. Solo workflows/repos backend.
   * NUNCA expone en código UI/Server Actions (ESLint enforce).
   */
  serviceRole(): AppClient;

  /**
   * Authed client con JWT user. Sujeto a RLS policies.
   * Para Server Components / Server Actions / API routes user-scoped.
   */
  authed(accessToken: string): AppClient;
}

const SUPABASE_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  db: {
    schema: "public" as const,
  },
} as const;

/**
 * Factory pura — recibe config (test inyectable). Usar `defaultDbClientFactory()`
 * para singleton runtime que lee env validado.
 *
 * Singletons internos: 1 instancia service-role reusada (connection pool Supabase
 * client maneja conexiones). 1 nueva instancia authed per request (carry JWT).
 */
export function makeDbClientFactory(cfg: DbClientsConfig): DbClientFactory {
  let serviceRoleSingleton: AppClient | null = null;

  return {
    serviceRole() {
      if (serviceRoleSingleton === null) {
        serviceRoleSingleton = createClient<Database>(cfg.url, cfg.serviceRoleKey, {
          ...SUPABASE_OPTIONS,
          global: {
            headers: {
              "x-client-info": "crm-service-role",
            },
          },
        });
      }
      return serviceRoleSingleton;
    },

    authed(accessToken: string) {
      return createClient<Database>(cfg.url, cfg.anonKey, {
        ...SUPABASE_OPTIONS,
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-client-info": "crm-authed",
          },
        },
      });
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
