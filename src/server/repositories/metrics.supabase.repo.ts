import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Canal, CurrentStage, Sender } from "@/types/domain";
import type {
  FilaIntentMetrica,
  FilaLeadMetrica,
  FilaMensajeMetrica,
  FilaReglaActivaMetrica,
  FilaRuleExecutionMetrica,
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
  MetricsRepository,
} from "./metrics.repo";

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
      .select("id, current_stage, resultado, motivo_perdida, started_at")
      .gte("started_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map((r) => ({
      id: r.id,
      current_stage: r.current_stage as CurrentStage,
      resultado: r.resultado as "exito" | "perdido" | null,
      motivo_perdida: r.motivo_perdida,
      started_at: new Date(r.started_at),
    }));
  }

  /**
   * El canal no vive en `mensajes` sino en la conversación que lo contiene, así
   * que se embebe con `!inner`: es un join, no una segunda vuelta a la base.
   */
  async listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]> {
    const { data, error } = await this.db
      .from("mensajes")
      .select("sender, created_at, lead_session_id, conversaciones!inner(canal)")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return (data ?? []).map((r) => ({
      sender: r.sender as Sender,
      created_at: new Date(r.created_at),
      canal: r.conversaciones.canal as Canal,
      lead_session_id: r.lead_session_id,
    }));
  }

  async listLeadsDesde(desde: Date): Promise<FilaLeadMetrica[]> {
    const { data, error } = await this.db
      .from("leads")
      .select("created_at")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "leads" });
    return (data ?? []).map((r) => ({ created_at: new Date(r.created_at) }));
  }

  async listRuleExecutionsDesde(desde: Date): Promise<FilaRuleExecutionMetrica[]> {
    const { data, error } = await this.db
      .from("rule_executions")
      .select("created_at")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "rule_executions" });
    return (data ?? []).map((r) => ({ created_at: new Date(r.created_at) }));
  }

  async listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]> {
    const { data, error } = await this.db
      .from("tool_executions")
      .select("tool_name, created_at, error")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "tool_executions" });
    return (data ?? []).map((r) => ({
      tool_name: r.tool_name,
      created_at: new Date(r.created_at),
      error: r.error,
    }));
  }

  async listIntentsActivos(): Promise<FilaIntentMetrica[]> {
    const { data, error } = await this.db
      .from("intents")
      .select("id, nombre, descripcion, auto_detectado, created_at")
      .eq("activo", true);
    if (error) throw mapPostgrestError(error, { resource: "intents" });
    return (data ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      auto_detectado: r.auto_detectado,
      created_at: new Date(r.created_at),
    }));
  }

  async listReglasActivas(): Promise<FilaReglaActivaMetrica[]> {
    const { data, error } = await this.db.from("reglas").select("intent_id").eq("activa", true);
    if (error) throw mapPostgrestError(error, { resource: "reglas" });
    return (data ?? []).map((r) => ({ intent_id: r.intent_id }));
  }
}
