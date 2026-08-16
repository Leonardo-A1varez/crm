import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { runLlmUsageContract } from "../repositories/llm-usage.contract";

runLlmUsageContract(() => new InMemoryLlmUsageRepository());
