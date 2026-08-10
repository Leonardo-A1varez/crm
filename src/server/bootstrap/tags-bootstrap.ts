import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultTagsAdminService } from "@/server/services/tags/tags-admin.service";
import type { AppClient } from "@/server/db/client";
import type { TagsAdminService } from "@/server/services/tags/tags-admin.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeTagsAdminService(db: AppClient): TagsAdminService {
  return new DefaultTagsAdminService({
    tags: new SupabaseTagsRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
  });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getTagsAdminServiceForRequest(): Promise<TagsAdminService> {
  return makeTagsAdminService(await createSupabaseServerClient());
}
