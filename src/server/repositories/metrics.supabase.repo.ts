import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { CurrentStage, Sender } from "@/types/domain";
import type { FilaMensajeMetrica, FilaSesionMetrica, MetricsRepository } from "./metrics.repo";

/**
 * Supabase impl de MetricsRepository. Selecciona solo las columnas que se
 * cuentan, no la fila entera: el corte de mensajes recorre todo el período y
 * traer `contenido` multiplicaría el payload sin que nadie lo lea.
 *
 * RLS aplica igual: con el client authed del panel, un vendedor ve lo que sus
 * policies le dejan ver, así que las métricas nunca filtran filas ajenas.
 */
export class SupabaseMetricsRepository implements MetricsRepository {
  constructor(private readonly db: AppClient) {}

  async listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]> {
    const { data, error } = await this.db
      .from("lead_session")
      .select("current_stage, resultado, motivo_perdida, started_at")
      .gte("started_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map((r) => ({
      current_stage: r.current_stage as CurrentStage,
      resultado: r.resultado as "exito" | "perdido" | null,
      motivo_perdida: r.motivo_perdida,
      started_at: new Date(r.started_at),
    }));
  }

  async listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]> {
    const { data, error } = await this.db
      .from("mensajes")
      .select("sender, created_at")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return (data ?? []).map((r) => ({
      sender: r.sender as Sender,
      created_at: new Date(r.created_at),
    }));
  }
}
