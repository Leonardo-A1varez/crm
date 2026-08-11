import type { RuleExecution, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type RuleExecutionInsert = Insert<RuleExecution, "id" | "created_at">;

/**
 * Auditoría de qué regla contestó qué mensaje. Es solo append: sirve para
 * responder "por qué el cliente recibió esto", y reescribirla borraría la
 * única evidencia de una respuesta que ya salió.
 */
export interface RuleExecutionsRepository {
  create(input: RuleExecutionInsert): Promise<RuleExecution>;
  listByRegla(reglaId: UUID): Promise<RuleExecution[]>;
  /**
   * La regla que contestó ese mensaje entrante, si hubo alguna. Devuelve una
   * sola: el pipeline audita una vez por turno y `rule_executions` es la mitad
   * excluyente de `turn_classifications`. La tabla no tiene UNIQUE sobre
   * `mensaje_id` (deuda anotada en la migración de `turn_classifications`), así
   * que un replay viejo puede haber dejado dos filas idénticas; se devuelve la
   * primera, que dice lo mismo que la segunda.
   */
  findByMensajeId(mensajeId: UUID): Promise<RuleExecution | null>;
}

export class InMemoryRuleExecutionsRepository implements RuleExecutionsRepository {
  private readonly store = new Map<UUID, RuleExecution>();

  async create(input: RuleExecutionInsert): Promise<RuleExecution> {
    const row: RuleExecution = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.store.set(row.id, row);
    return { ...row };
  }

  async listByRegla(reglaId: UUID): Promise<RuleExecution[]> {
    return Array.from(this.store.values())
      .filter((r) => r.regla_id === reglaId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((r) => ({ ...r }));
  }

  async findByMensajeId(mensajeId: UUID): Promise<RuleExecution | null> {
    for (const r of this.store.values()) {
      if (r.mensaje_id === mensajeId) return { ...r };
    }
    return null;
  }
}
