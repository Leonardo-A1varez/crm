import type { TurnClassification, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type TurnClassificationInsert = Insert<TurnClassification, "id" | "created_at">;

/**
 * Auditoría de los turnos que resolvió el LLM: con qué intent los clasificó y
 * con cuánta confianza. Es el complemento de `RuleExecutionsRepository` — entre
 * las dos cubren todos los turnos que contestó el agente.
 *
 * Solo append. `create` es idempotente por `mensaje_id` (UNIQUE en DB): un
 * replay del workflow devuelve la fila que ya estaba en vez de duplicar el
 * turno, que inflaría el conteo de uso de un intent.
 */
export interface TurnClassificationsRepository {
  create(input: TurnClassificationInsert): Promise<TurnClassification>;
  findByMensajeId(mensajeId: UUID): Promise<TurnClassification | null>;
}

export class InMemoryTurnClassificationsRepository implements TurnClassificationsRepository {
  private readonly store = new Map<UUID, TurnClassification>();

  async create(input: TurnClassificationInsert): Promise<TurnClassification> {
    const existente = await this.findByMensajeId(input.mensaje_id);
    if (existente) return existente;
    const row: TurnClassification = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findByMensajeId(mensajeId: UUID): Promise<TurnClassification | null> {
    for (const r of this.store.values()) {
      if (r.mensaje_id === mensajeId) return { ...r };
    }
    return null;
  }
}
