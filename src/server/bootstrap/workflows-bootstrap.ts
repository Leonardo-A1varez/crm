import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseWorkflowRunsRepository } from "@/server/repositories/workflow-runs.supabase.repo";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { AppClient } from "@/server/db/client";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";

export function makeWorkflowsAdminService(db: AppClient): WorkflowsAdminService {
  return new DefaultWorkflowsAdminService({
    workflows: new SupabaseWorkflowsRepository(db),
    workflowRuns: new SupabaseWorkflowRunsRepository(db),
    leads: new SupabaseLeadsRepository(db),
  });
}

export async function getWorkflowsAdminServiceForRequest(): Promise<WorkflowsAdminService> {
  const db = await createSupabaseServerClient();
  return makeWorkflowsAdminService(db);
}

export async function getWorkflowRunsRepoForRequest(): Promise<WorkflowRunsRepository> {
  const db = await createSupabaseServerClient();
  return new SupabaseWorkflowRunsRepository(db);
}
