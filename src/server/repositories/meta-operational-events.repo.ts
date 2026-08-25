import type { UUID } from "@/types/entities";

/**
 * Un evento operativo de Meta ya persistido.
 *
 * Ver `supabase/migrations/20260825000000_meta_operational_events.sql` para el
 * porqué de cada columna. En resumen: `payload` es la fuente de verdad y el
 * resto es índice para poder consultar sin abrir el jsonb.
 */
export interface MetaOperationalEvent {
  id: UUID;
  campo: string;
  evento: string | null;
  objeto_id: string | null;
  objeto_nombre: string | null;
  payload: Record<string, unknown>;
  ocurrido_at: Date | null;
  created_at: Date;
}

export type MetaOperationalEventInsert = Omit<MetaOperationalEvent, "id" | "created_at">;

export interface MetaOperationalEventsRepository {
  registrar(input: MetaOperationalEventInsert): Promise<MetaOperationalEvent>;
  /** Los más recientes primero. `campo` filtra a un solo tipo de evento. */
  listarRecientes(opciones?: { campo?: string; limite?: number }): Promise<MetaOperationalEvent[]>;
}

const LIMITE_DEFAULT = 50;
/**
 * Tope duro. PostgREST corta en 1.000 filas sin avisar y este proyecto ya se
 * quemó con eso: un `.list()` sin rango explícito miente sobre el total en
 * cuanto la tabla crece. Acá el límite es del contrato, no del transporte.
 */
const LIMITE_MAX = 200;

export function acotarLimite(limite: number | undefined): number {
  if (limite === undefined) return LIMITE_DEFAULT;
  return Math.min(Math.max(1, Math.trunc(limite)), LIMITE_MAX);
}

export class InMemoryMetaOperationalEventsRepository implements MetaOperationalEventsRepository {
  private readonly filas: MetaOperationalEvent[] = [];

  async registrar(input: MetaOperationalEventInsert): Promise<MetaOperationalEvent> {
    const fila: MetaOperationalEvent = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date(),
      payload: { ...input.payload },
    };
    this.filas.push(fila);
    return { ...fila };
  }

  async listarRecientes(opciones?: {
    campo?: string;
    limite?: number;
  }): Promise<MetaOperationalEvent[]> {
    return this.filas
      .filter((f) => (opciones?.campo === undefined ? true : f.campo === opciones.campo))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, acotarLimite(opciones?.limite))
      .map((f) => ({ ...f }));
  }
}
