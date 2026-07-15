import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import { DefaultMergeExecutorService } from "@/server/services/leads/merge-executor.service";
import type { AppClient } from "@/server/db/client";
import type { LeadsService } from "@/server/services/leads/leads.service";
import type { MergeExecutorService } from "@/server/services/leads/merge-executor.service";

/** Composición pura (authed o service-role en tests). */
export function makeLeadsService(db: AppClient): LeadsService {
  return new DefaultLeadsService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    candidates: new SupabaseMergeCandidatesRepository(db),
    tags: new SupabaseTagsRepository(db),
  });
}

export function makeMergeExecutorService(db: AppClient): MergeExecutorService {
  return new DefaultMergeExecutorService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    convs: new SupabaseConversationsRepository(db),
    tags: new SupabaseTagsRepository(db),
    candidates: new SupabaseMergeCandidatesRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
  });
}

/** Panel: client authed del request (RLS real). Uno por request. */
export async function getLeadsServiceForRequest(): Promise<LeadsService> {
  return makeLeadsService(await createSupabaseServerClient());
}

export async function getMergeExecutorForRequest(): Promise<MergeExecutorService> {
  return makeMergeExecutorService(await createSupabaseServerClient());
}
