import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { RuleExecution, UUID } from "@/types/entities";
import type { RuleExecutionInsert, RuleExecutionsRepository } from "./rule-executions.repo";

interface RuleExecutionRow {
  id: string;
  regla_id: string;
  mensaje_id: string;
  matched_intent_id: string;
  created_at: string;
}

function mapRow(row: RuleExecutionRow): RuleExecution {
  return {
    id: row.id,
    regla_id: row.regla_id,
    mensaje_id: row.mensaje_id,
    matched_intent_id: row.matched_intent_id,
    created_at: new Date(row.created_at),
  };
}

export class SupabaseRuleExecutionsRepository implements RuleExecutionsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: RuleExecutionInsert): Promise<RuleExecution> {
    const { data, error } = await this.db
      .from("rule_executions")
      .insert({
        regla_id: input.regla_id,
        mensaje_id: input.mensaje_id,
        matched_intent_id: input.matched_intent_id,
      })
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "rule_executions" });
    return mapRow(data as RuleExecutionRow);
  }

  async listByRegla(reglaId: UUID): Promise<RuleExecution[]> {
    if (!isUuid(reglaId)) return [];
    const { data, error } = await this.db
      .from("rule_executions")
      .select()
      .eq("regla_id", reglaId)
      .order("created_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "rule_executions" });
    return (data ?? []).map((r) => mapRow(r as RuleExecutionRow));
  }
}
