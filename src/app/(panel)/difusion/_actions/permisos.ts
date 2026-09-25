import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";

/**
 * Armar, programar y detener una difusión es de admin: es lo que dicen las
 * policies de `difusiones` y `difusion_envios` (sólo admin escribe), y
 * `programar_difusion()` lo vuelve a exigir en la base. Esto no reemplaza al
 * RLS: le ahorra a un vendedor un error de permisos crudo.
 */
export async function exigirAdmin(): Promise<
  { ok: true; usuarioId: string } | { ok: false; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: "Iniciá sesión para seguir." };
  if (rolFromUser(user) !== "admin") {
    return {
      ok: false,
      error: "Solo un administrador puede armar, programar o detener difusiones.",
    };
  }
  return { ok: true, usuarioId: user.id };
}
