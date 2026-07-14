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
