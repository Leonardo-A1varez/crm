import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryToolExecutionsRepository } from "@/server/repositories/tool-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";

/**
 * Las cinco dependencias de `DefaultInboxService` que solo lee
 * `getAuditoriaTurno`. Vacías sirven para todas las suites que ejercitan el
 * resto del service: nada más las toca.
 */
export function reposAuditoria() {
  return {
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    toolExecutions: new InMemoryToolExecutionsRepository(),
    rules: new InMemoryRulesRepository(),
    intents: new InMemoryIntentsRepository(),
  };
}
