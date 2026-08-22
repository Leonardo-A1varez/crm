import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { runWorkflowsContract } from "../repositories/workflows.contract";

runWorkflowsContract(() => new InMemoryWorkflowsRepository());
