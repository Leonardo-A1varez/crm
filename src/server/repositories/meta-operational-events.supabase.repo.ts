import { InfraError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import {
  acotarLimite,
  type MetaOperationalEvent,
  type MetaOperationalEventInsert,
  type MetaOperationalEventsRepository,
} from "./meta-operational-events.repo";

const COLS = "id, campo, evento, objeto_id, objeto_nombre, payload, ocurrido_at, created_at";

interface Fila {
  id: string;
  campo: string;
  evento: string | null;
  objeto_id: string | null;
  objeto_nombre: string | null;
  payload: unknown;
  ocurrido_at: string | null;
  created_at: string;
}

function mapEvento(row: Fila): MetaOperationalEvent {
  return {
    id: row.id,
    campo: row.campo,
    evento: row.evento,
    objeto_id: row.objeto_id,
    objeto_nombre: row.objeto_nombre,
    // El CHECK de la tabla garantiza que es un objeto; el `?? {}` cubre una
    // fila escrita antes de ese CHECK sin romper el recorrido.
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    ocurrido_at: row.ocurrido_at === null ? null : new Date(row.ocurrido_at),
    created_at: new Date(row.created_at),
  };
}

export class SupabaseMetaOperationalEventsRepository implements MetaOperationalEventsRepository {
  constructor(private readonly db: AppClient) {}

  async registrar(input: MetaOperationalEventInsert): Promise<MetaOperationalEvent> {
    const { data, error } = await this.db
      .from("meta_operational_events")
      .insert({
        campo: input.campo,
        evento: input.evento,
        objeto_id: input.objeto_id,
        objeto_nombre: input.objeto_nombre,
        // `Json` de la codegen no acepta `Record<string, unknown>` por
        // estrictez de forma, no por nulabilidad. Mismo cast que usa el
        // `grafo` de workflows y el `extras` de lead-session.
        payload: input.payload as never,
        ocurrido_at: input.ocurrido_at?.toISOString() ?? null,
      })
      .select(COLS)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "meta_operational_events" });
    if (!data) throw new InfraError("el insert no devolvió la fila", "postgrest");
    return mapEvento(data as Fila);
  }

  async listarRecientes(opciones?: {
    campo?: string;
    limite?: number;
  }): Promise<MetaOperationalEvent[]> {
    const limite = acotarLimite(opciones?.limite);
    let q = this.db
      .from("meta_operational_events")
      .select(COLS)
      .order("created_at", { ascending: false })
      // Rango explícito: sin él PostgREST corta en 1.000 filas y no avisa.
      .range(0, limite - 1);
    if (opciones?.campo !== undefined) q = q.eq("campo", opciones.campo);

    const { data, error } = await q;
    if (error) throw mapPostgrestError(error, { resource: "meta_operational_events" });
    return (data ?? []).map((r) => mapEvento(r as Fila));
  }
}
