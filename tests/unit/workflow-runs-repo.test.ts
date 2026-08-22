import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { runWorkflowRunsContract } from "../repositories/workflow-runs.contract";

runWorkflowRunsContract(async () => ({
  repo: new InMemoryWorkflowRunsRepository(),
  versionId: "version-1",
  leadId: "lead-1",
}));
