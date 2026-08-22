import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { AppClient } from "@/server/db/client";
import type { WorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";

export function makeWorkflowsAdminService(db: AppClient): WorkflowsAdminService {
  return new DefaultWorkflowsAdminService({ workflows: new SupabaseWorkflowsRepository(db) });
}

export async function getWorkflowsAdminServiceForRequest(): Promise<WorkflowsAdminService> {
  const db = await createSupabaseServerClient();
  return makeWorkflowsAdminService(db);
}
