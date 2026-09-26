import { InfraError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import { MOTIVOS_INTERCEPCION, type TurnoInterceptado, type UUID } from "@/types/entities";
import type {
  TurnoInterceptadoInsert,
  TurnosInterceptadosRepository,
} from "./turnos-interceptados.repo";

interface TurnoInterceptadoRow {
  id: string;
  mensaje_id: string;
  workflow_id: string | null;
  workflow_version_id: string | null;
  workflow_run_id: string | null;
  motivo: string;
  created_at: string;
}

function mapRow(row: TurnoInterceptadoRow): TurnoInterceptado {
  const motivo = MOTIVOS_INTERCEPCION.find((m) => m === row.motivo);
  // El CHECK de la tabla lo impide: otro valor es la base y el código divergiendo.
  if (motivo === undefined) {
    throw new InfraError(`turnos_interceptados.motivo desconocido: ${row.motivo}`);
  }
  return {
    id: row.id,
    mensaje_id: row.mensaje_id,
    workflow_id: row.workflow_id,
    workflow_version_id: row.workflow_version_id,
    workflow_run_id: row.workflow_run_id,
    motivo,
    created_at: new Date(row.created_at),
  };
}

/**
 * Tope de `listByMensajeIds`: el hilo del Inbox trae hasta 200 mensajes. Se
 * deja explícito por el corte silencioso de PostgREST en 1.000 filas
 * (AGENTS.md, lección 12).
 */
const MAX_POR_CONSULTA = 500;

export class SupabaseTurnosInterceptadosRepository implements TurnosInterceptadosRepository {
  constructor(private readonly db: AppClient) {}

  async registrar(input: TurnoInterceptadoInsert): Promise<TurnoInterceptado> {
    const { data, error } = await this.db
      .from("turnos_interceptados")
      .insert({
        mensaje_id: input.mensaje_id,
        workflow_id: input.workflow_id,
        workflow_version_id: input.workflow_version_id,
        workflow_run_id: input.workflow_run_id,
        motivo: input.motivo,
      })
      .select()
      .single();
    if (error) {
      // UNIQUE (mensaje_id): el reintento del step ya lo había anotado.
      if (error.code === "23505") {
        const [existente] = await this.listByMensajeIds([input.mensaje_id]);
        if (existente) return existente;
      }
      throw mapPostgrestError(error, { resource: "turnos_interceptados" });
    }
    return mapRow(data as TurnoInterceptadoRow);
  }

  async listByMensajeIds(mensajeIds: readonly UUID[]): Promise<TurnoInterceptado[]> {
    const ids = mensajeIds.filter(isUuid);
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("turnos_interceptados")
      .select()
      .in("mensaje_id", ids)
      .range(0, MAX_POR_CONSULTA - 1);
    if (error) throw mapPostgrestError(error, { resource: "turnos_interceptados" });
    return ((data ?? []) as TurnoInterceptadoRow[]).map(mapRow);
  }
}
