import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { runRuleExecutionsContract } from "../repositories/rule-executions.contract";

runRuleExecutionsContract(() => new InMemoryRuleExecutionsRepository());
