import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Canal, CurrentStage, Sender } from "@/types/domain";
import type {
  FilaCampaniaMetrica,
  FilaIntentMetrica,
  FilaLeadMetrica,
  FilaLlmUsageMetrica,
  FilaMensajeMetrica,
  FilaReglaActivaMetrica,
  FilaRuleExecutionMetrica,
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
  FilaTurnClassificationMetrica,
  FilaUsuarioMetrica,
  FilaHandoffMetrica,
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

  /**
   * `precio_cotizado` es `numeric` en Postgres — mismo riesgo de serialización
   * como string que `costo_usd` (ver `listLlmUsageDesde`); se normaliza igual.
   */
  async listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]> {
    const { data, error } = await this.db
      .from("lead_session")
      .select(
        "id, current_stage, resultado, motivo_perdida, started_at, precio_cotizado, codigo_interno, closed_at, cantidad",
      )
      .gte("started_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map((r) => ({
      id: r.id,
      current_stage: r.current_stage as CurrentStage,
      resultado: r.resultado as "exito" | "perdido" | null,
      motivo_perdida: r.motivo_perdida,
      started_at: new Date(r.started_at),
      precio_cotizado:
        typeof r.precio_cotizado === "string" ? Number(r.precio_cotizado) : r.precio_cotizado,
      codigo_interno: r.codigo_interno,
      closed_at: r.closed_at ? new Date(r.closed_at) : null,
      cantidad: r.cantidad,
    }));
  }

  /**
   * El canal no vive en `mensajes` sino en la conversación que lo contiene, así
   * que se embebe con `!inner`: es un join, no una segunda vuelta a la base.
   */
  async listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]> {
    const { data, error } = await this.db
      .from("mensajes")
      .select(
        "sender, created_at, platform_created_at, lead_session_id, sender_user_id, conversaciones!inner(canal)",
      )
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return (data ?? []).map((r) => ({
      sender: r.sender as Sender,
      created_at: new Date(r.created_at),
      canal: r.conversaciones.canal as Canal,
      lead_session_id: r.lead_session_id,
      sender_user_id: r.sender_user_id,
      platform_created_at: r.platform_created_at ? new Date(r.platform_created_at) : null,
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

  async listTurnClassificationsDesde(desde: Date): Promise<FilaTurnClassificationMetrica[]> {
    const { data, error } = await this.db
      .from("turn_classifications")
      .select("intent_id, created_at")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "turn_classifications" });
    return (data ?? []).map((r) => ({
      intent_id: r.intent_id,
      created_at: new Date(r.created_at),
    }));
  }

  async listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]> {
    const { data, error } = await this.db
      .from("tool_executions")
      .select("tool_name, created_at, error, args")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "tool_executions" });
    return (data ?? []).map((r) => ({
      tool_name: r.tool_name,
      created_at: new Date(r.created_at),
      error: r.error,
      args:
        r.tool_name === "buscar_repuesto" && r.args && typeof r.args === "object"
          ? (r.args as { query?: string; marca?: string; modelo?: string })
          : null,
    }));
  }

  /**
   * `costo_usd` es `numeric`: PostgREST lo puede serializar como string y sumar
   * strings daría una concatenación silenciosa. Se normaliza acá.
   */
  async listLlmUsageDesde(desde: Date): Promise<FilaLlmUsageMetrica[]> {
    const { data, error } = await this.db
      .from("llm_usage")
      .select(
        "lead_session_id, modelo, input_tokens, output_tokens, costo_usd, workflow, created_at",
      )
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return (data ?? []).map((r) => ({
      lead_session_id: r.lead_session_id,
      modelo: r.modelo,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      costo_usd: typeof r.costo_usd === "string" ? Number(r.costo_usd) : r.costo_usd,
      workflow: r.workflow,
      created_at: new Date(r.created_at),
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

  async listUsuarios(): Promise<FilaUsuarioMetrica[]> {
    // Sin filtrar por `activo`: las sesiones que atendió alguien dado de baja
    // siguen siendo suyas, y esconder la fila haría desaparecer trabajo hecho.
    const { data, error } = await this.db.from("usuarios").select("id, nombre");
    if (error) throw mapPostgrestError(error, { resource: "usuarios" });
    return (data ?? []).map((r) => ({ id: r.id, nombre: r.nombre }));
  }

  async listHandoffsDesde(desde: Date): Promise<FilaHandoffMetrica[]> {
    const { data, error } = await this.db
      .from("handoff_events")
      .select("lead_session_id, action, reason_code, created_at")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "handoff_events" });
    return (data ?? []).map((row) => ({
      lead_session_id: row.lead_session_id,
      action: row.action as "pause" | "resume",
      reason_code: row.reason_code,
      created_at: new Date(row.created_at),
    }));
  }

  async listCampanias(): Promise<FilaCampaniaMetrica[]> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta")
      .order("desde", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return (data ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      desde: new Date(r.desde),
      hasta: new Date(r.hasta),
    }));
  }
}
