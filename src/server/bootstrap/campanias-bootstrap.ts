import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseCampaniasRepository } from "@/server/repositories/campanias.supabase.repo";
import { DefaultCampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";
import type { AppClient } from "@/server/db/client";
import type { CampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";

export function makeCampaniasAdminService(db: AppClient): CampaniasAdminService {
  return new DefaultCampaniasAdminService({ campanias: new SupabaseCampaniasRepository(db) });
}

export async function getCampaniasAdminServiceForRequest(): Promise<CampaniasAdminService> {
  const db = await createSupabaseServerClient();
  return makeCampaniasAdminService(db);
}
