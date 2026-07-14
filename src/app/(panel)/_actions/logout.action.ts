"use server";

import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import type { ActionResult } from "@/types/inbox";

export async function logoutAction(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return { ok: true };
}
