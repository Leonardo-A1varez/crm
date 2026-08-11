import type { ToolExecution, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type ToolExecutionInsert = Insert<ToolExecution, "id" | "created_at">;

export interface ToolExecutionsRepository {
  create(input: ToolExecutionInsert): Promise<ToolExecution>;
  // Listing per session, orden created_at DESC. limit default 50.
  listBySession(sessionId: UUID, limit?: number): Promise<ToolExecution[]>;
  findById(id: UUID): Promise<ToolExecution | null>;
  /**
   * Las herramientas que se llamaron dentro de una ventana de la sesión, orden
   * cronológico.
   *
   * Existe porque `mensaje_id` no sirve para atar una llamada a su turno: el
   * agente audita las herramientas con `mensaje_id: null` desde Slice 1 y
   * ninguna fila lo tiene cargado. La ventana **sí** identifica el turno sin
   * ambigüedad: las herramientas corren entre que se persiste el entrante y que
   * se persiste el saliente, y el pipeline serializa por `meta_user_id`
   * (`concurrency.limit: 1`), así que dos turnos del mismo lead no se solapan.
   *
   * Bordes inclusive: las tres marcas de tiempo las pone la base con la misma
   * granularidad y un turno rápido puede empatar contra el entrante.
   */
  listBySessionEntre(sessionId: UUID, desde: Date, hasta: Date): Promise<ToolExecution[]>;
}

// Default cuando audit no se requiere (tests rapidos). Operaciones no-op.
export class NoopToolExecutionsRepository implements ToolExecutionsRepository {
  async create(input: ToolExecutionInsert): Promise<ToolExecution> {
    return {
      ...input,
      args: structuredClone(input.args),
      result: input.result === null ? null : structuredClone(input.result),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
  }
  async listBySession(_sessionId: UUID, _limit?: number): Promise<ToolExecution[]> {
    return [];
  }
  async findById(_id: UUID): Promise<ToolExecution | null> {
    return null;
  }
  async listBySessionEntre(_sessionId: UUID, _desde: Date, _hasta: Date): Promise<ToolExecution[]> {
    return [];
  }
}

function cloneToolExecution(t: ToolExecution): ToolExecution {
  return {
    ...t,
    args: structuredClone(t.args),
    result: t.result === null ? null : structuredClone(t.result),
  };
}

export class InMemoryToolExecutionsRepository implements ToolExecutionsRepository {
  private readonly store = new Map<UUID, ToolExecution>();

  async create(input: ToolExecutionInsert): Promise<ToolExecution> {
    const row: ToolExecution = {
      ...input,
      args: structuredClone(input.args),
      result: input.result === null ? null : structuredClone(input.result),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(row.id, row);
    return cloneToolExecution(row);
  }

  async findById(id: UUID): Promise<ToolExecution | null> {
    const t = this.store.get(id);
    return t ? cloneToolExecution(t) : null;
  }

  async listBySession(sessionId: UUID, limit = 50): Promise<ToolExecution[]> {
    return Array.from(this.store.values())
      .filter((t) => t.lead_session_id === sessionId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map(cloneToolExecution);
  }

  async listBySessionEntre(sessionId: UUID, desde: Date, hasta: Date): Promise<ToolExecution[]> {
    return Array.from(this.store.values())
      .filter(
        (t) =>
          t.lead_session_id === sessionId &&
          t.created_at.getTime() >= desde.getTime() &&
          t.created_at.getTime() <= hasta.getTime(),
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(cloneToolExecution);
  }
}
