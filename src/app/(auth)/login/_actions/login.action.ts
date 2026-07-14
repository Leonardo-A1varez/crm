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
