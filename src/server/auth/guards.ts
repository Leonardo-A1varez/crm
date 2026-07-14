import { RolUsuarioSchema } from "@/lib/validation/schemas";
import { getAuthenticatedUser } from "./supabase-ssr";
import type { RolUsuario } from "@/types/domain";
import type { User } from "@supabase/supabase-js";

/**
 * Rol desde app_metadata (solo seteable server-side; user_metadata es editable
 * por el cliente — nunca leer rol de ahí). Fallback vendedor = mínimo
 * privilegio. Solo para UI rol-aware — la authz real la enforcea RLS.
 */
export function rolFromUser(user: User | null): RolUsuario {
  const parsed = RolUsuarioSchema.safeParse(user?.app_metadata?.rol);
  return parsed.success ? parsed.data : "vendedor";
}

/** Rol del usuario autenticado del request actual (RSC / Server Action). */
export async function getCurrentRol(): Promise<RolUsuario> {
  return rolFromUser(await getAuthenticatedUser());
}
