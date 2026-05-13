import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { runRulesContract } from "../repositories/rules.contract";

runRulesContract(() => new InMemoryRulesRepository());
