import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadMergeRepository } from "@/server/repositories/lead-merge.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import {
  DefaultMergeExecutorService,
  TransactionalMergeExecutorService,
} from "@/server/services/leads/merge-executor.service";
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
    messages: new SupabaseMessagesRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
    merge: new SupabaseLeadMergeRepository(db),
    identificadores: new SupabaseLeadIdentificadoresRepository(db),
  });
}

export function makeMergeExecutorService(db: AppClient): MergeExecutorService {
  const delegate = new DefaultMergeExecutorService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    convs: new SupabaseConversationsRepository(db),
    tags: new SupabaseTagsRepository(db),
    candidates: new SupabaseMergeCandidatesRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
  });
  return new TransactionalMergeExecutorService(new SupabaseLeadMergeRepository(db), delegate);
}

/** Panel: client authed del request (RLS real). Uno por request. */
export async function getLeadsServiceForRequest(): Promise<LeadsService> {
  return makeLeadsService(await createSupabaseServerClient());
}

export async function getMergeExecutorForRequest(): Promise<MergeExecutorService> {
  return makeMergeExecutorService(await createSupabaseServerClient());
}
