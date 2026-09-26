import type { TurnoInterceptado, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type TurnoInterceptadoInsert = Insert<TurnoInterceptado, "id" | "created_at">;

/**
 * Los turnos que contestó un flujo en lugar del agente
 * (`lib/workflows/interceptar.ts`). Mismo contrato que
 * `TurnClassificationsRepository`: solo append, idempotente por `mensaje_id`
 * (UNIQUE en la base), así que el reintento del step devuelve la fila que ya
 * estaba.
 */
export interface TurnosInterceptadosRepository {
  registrar(input: TurnoInterceptadoInsert): Promise<TurnoInterceptado>;
  /** Los de estos mensajes, para marcarlos en el hilo del Inbox. */
  listByMensajeIds(mensajeIds: readonly UUID[]): Promise<TurnoInterceptado[]>;
}

export class InMemoryTurnosInterceptadosRepository implements TurnosInterceptadosRepository {
  private readonly store = new Map<UUID, TurnoInterceptado>();

  async registrar(input: TurnoInterceptadoInsert): Promise<TurnoInterceptado> {
    const existente = [...this.store.values()].find((t) => t.mensaje_id === input.mensaje_id);
    if (existente) return { ...existente };
    const fila: TurnoInterceptado = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.store.set(fila.id, fila);
    return { ...fila };
  }

  async listByMensajeIds(mensajeIds: readonly UUID[]): Promise<TurnoInterceptado[]> {
    const ids = new Set(mensajeIds);
    return [...this.store.values()].filter((t) => ids.has(t.mensaje_id)).map((t) => ({ ...t }));
  }
}
