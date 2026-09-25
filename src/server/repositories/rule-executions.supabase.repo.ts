import type { AppClient } from "@/server/db/client";
import { leerPorKeyset } from "@/server/db/paginar";
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
    // Una fila por turno que contestó la regla: una regla popular pasa las
    // 1.000 y PostgREST cortaría ahí sin avisar (lección 12).
    const filas = await leerPorKeyset({
      recurso: "rule_executions",
      clave: (r: { id: string }) => r.id,
      pagina: (despuesDe, tamanio) => {
        let q = this.db.from("rule_executions").select().eq("regla_id", reglaId);
        if (despuesDe !== null) q = q.gt("id", despuesDe);
        return q.order("id", { ascending: true }).limit(tamanio);
      },
    });
    return filas
      .map((r) => mapRow(r as RuleExecutionRow))
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  async findByMensajeId(mensajeId: UUID): Promise<RuleExecution | null> {
    if (!isUuid(mensajeId)) return null;
    // `limit(1)` y no `maybeSingle()`: sin UNIQUE sobre `mensaje_id`, dos filas
    // de un replay viejo harían fallar el single en vez de contestar.
    const { data, error } = await this.db
      .from("rule_executions")
      .select()
      .eq("mensaje_id", mensajeId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw mapPostgrestError(error, { resource: "rule_executions" });
    const fila = (data ?? [])[0];
    return fila ? mapRow(fila as RuleExecutionRow) : null;
  }
}
