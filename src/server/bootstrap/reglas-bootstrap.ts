import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseIntentsRepository } from "@/server/repositories/intents.supabase.repo";
import { SupabaseReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.supabase.repo";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultReglasAdminService } from "@/server/services/reglas/reglas-admin.service";
import type { AppClient } from "@/server/db/client";
import type { ReglasAdminService } from "@/server/services/reglas/reglas-admin.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeReglasAdminService(db: AppClient): ReglasAdminService {
  return new DefaultReglasAdminService({
    intents: new SupabaseIntentsRepository(db),
    rules: new SupabaseRulesRepository(db),
    reglasEtiqueta: new SupabaseReglasEtiquetaRepository(db),
    tags: new SupabaseTagsRepository(db),
  });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getReglasAdminServiceForRequest(): Promise<ReglasAdminService> {
  const db = await createSupabaseServerClient();
  return makeReglasAdminService(db);
}
