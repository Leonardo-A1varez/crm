import { BuscarRepuestoInputSchema } from "@/lib/validation/ai";
import type { AppClient } from "@/server/db/client";
import { leerPorKeyset } from "@/server/db/paginar";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Canal, CurrentStage, Sender } from "@/types/domain";
import type {
  ConteoClasificacionMetrica,
  ConteoPausaMetrica,
  FilaIntentMetrica,
  FilaMensajeMetrica,
  FilaReglaActivaMetrica,
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
  FilaUsuarioMetrica,
  GastoWorkflowMetrica,
  MetricsRepository,
} from "./metrics.repo";

function leerArgsBuscarRepuesto(
  args: unknown,
): { query?: string; marca?: string; modelo?: string } | null {
  const parsed = BuscarRepuestoInputSchema.safeParse(args);
  if (!parsed.success) return null;
  return { query: parsed.data.query, marca: parsed.data.marca, modelo: parsed.data.modelo };
}

/**
 * `numeric` y `bigint` pueden viajar como string en el JSON de PostgREST
 * cuando no entran en un double; sumar strings daría una concatenación
 * silenciosa. Se normaliza en el borde.
 */
function aNumero(v: number | string): number {
  return typeof v === "string" ? Number(v) : v;
}

/**
 * Supabase impl de MetricsRepository. Selecciona solo las columnas que se
 * cuentan, no la fila entera: el corte de mensajes recorre todo el período y
 * traer `contenido` multiplicaría el payload sin que nadie lo lea.
 *
 * Las lecturas de filas se paginan por keyset sobre `id`: una ventana de 30
 * días pasa las 1.000 filas y PostgREST cortaba ahí sin avisar (lección 12).
 * Los agregados van por `count` exacto o por RPC (`metricas_*`, migración
 * `20260925143000`).
 *
 * RLS aplica igual: con el client authed del panel, un vendedor ve lo que sus
 * policies le dejan ver —los RPC son `security invoker`—, así que las métricas
 * nunca filtran filas ajenas.
 */
export class SupabaseMetricsRepository implements MetricsRepository {
  constructor(private readonly db: AppClient) {}

  /**
   * `precio_cotizado` es `numeric` en Postgres: mismo riesgo de serialización
   * como string que `costo_usd`; se normaliza igual.
   */
  async listSesionesDesde(desde: Date, hasta: Date): Promise<FilaSesionMetrica[]> {
    const filas = await leerPorKeyset({
      recurso: "lead_session",
      clave: (r: { id: string }) => r.id,
      pagina: (despuesDe, tamanio) => {
        let q = this.db
          .from("lead_session")
          .select(
            "id, current_stage, resultado, motivo_perdida, started_at, precio_cotizado, codigo_interno, closed_at, cantidad",
          )
          .gte("started_at", desde.toISOString())
          .lt("started_at", hasta.toISOString());
        if (despuesDe !== null) q = q.gt("id", despuesDe);
        return q.order("id", { ascending: true }).limit(tamanio);
      },
    });
    return filas.map((r) => ({
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
   *
   * El `id` viaja solo como cursor de la paginación. El orden de las filas no
   * importa: el service ordena cada hilo por `created_at`.
   */
  async listMensajesDesde(desde: Date, hasta: Date): Promise<FilaMensajeMetrica[]> {
    const filas = await leerPorKeyset({
      recurso: "mensajes",
      clave: (r: { id: string }) => r.id,
      pagina: (despuesDe, tamanio) => {
        let q = this.db
          .from("mensajes")
          .select(
            "id, sender, created_at, platform_created_at, lead_session_id, sender_user_id, conversaciones!inner(canal)",
          )
          .gte("created_at", desde.toISOString())
          .lt("created_at", hasta.toISOString());
        if (despuesDe !== null) q = q.gt("id", despuesDe);
        return q.order("id", { ascending: true }).limit(tamanio);
      },
    });
    return filas.map((r) => ({
      sender: r.sender as Sender,
      created_at: new Date(r.created_at),
      canal: r.conversaciones.canal as Canal,
      lead_session_id: r.lead_session_id,
      sender_user_id: r.sender_user_id,
      platform_created_at: r.platform_created_at ? new Date(r.platform_created_at) : null,
    }));
  }

  /**
   * `args` es `jsonb`: lo escribió el LLM y nadie garantiza su forma. Un cast a
   * ciegas hacía que un `marca: 42` guardado en cualquier fila vieja explotara
   * más tarde en `.trim()` dentro del service y se llevara puesta la pantalla
   * entera de Métricas con un 500. Se valida con el mismo schema con el que se
   * declara la tool, y lo que no pasa viaja como `null` — una fila con la
   * demanda irreconocible no vale un tablero caído.
   *
   * Filas y no un agregado: esa validación con Zod es parte de la métrica y en
   * SQL solo se podría imitar.
   */
  async listToolExecutionsDesde(desde: Date, hasta: Date): Promise<FilaToolExecutionMetrica[]> {
    const filas = await leerPorKeyset({
      recurso: "tool_executions",
      clave: (r: { id: string }) => r.id,
      pagina: (despuesDe, tamanio) => {
        let q = this.db
          .from("tool_executions")
          .select("id, tool_name, created_at, error, args")
          .gte("created_at", desde.toISOString())
          .lt("created_at", hasta.toISOString());
        if (despuesDe !== null) q = q.gt("id", despuesDe);
        return q.order("id", { ascending: true }).limit(tamanio);
      },
    });
    return filas.map((r) => ({
      tool_name: r.tool_name,
      created_at: new Date(r.created_at),
      error: r.error,
      args: r.tool_name === "buscar_repuesto" ? leerArgsBuscarRepuesto(r.args) : null,
    }));
  }

  async contarLeadsDesde(desde: Date, hasta: Date): Promise<number> {
    const { count, error } = await this.db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", desde.toISOString())
      .lt("created_at", hasta.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "leads" });
    return count ?? 0;
  }

  async contarRuleExecutionsDesde(desde: Date, hasta: Date): Promise<number> {
    const { count, error } = await this.db
      .from("rule_executions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", desde.toISOString())
      .lt("created_at", hasta.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "rule_executions" });
    return count ?? 0;
  }

  async contarClasificacionesPorIntent(
    desde: Date,
    hasta: Date,
  ): Promise<ConteoClasificacionMetrica[]> {
    const { data, error } = await this.db.rpc(
      "metricas_clasificaciones_por_intent",
      ventana(desde, hasta),
    );
    if (error) throw mapPostgrestError(error, { resource: "turn_classifications" });
    return (data ?? []).map((r) => ({ intent_id: r.intent_id, turnos: aNumero(r.turnos) }));
  }

  async contarPausasPorMotivo(desde: Date, hasta: Date): Promise<ConteoPausaMetrica[]> {
    const { data, error } = await this.db.rpc("metricas_pausas_por_motivo", ventana(desde, hasta));
    if (error) throw mapPostgrestError(error, { resource: "handoff_events" });
    return (data ?? []).map((r) => ({ reason_code: r.reason_code, cantidad: aNumero(r.cantidad) }));
  }

  /**
   * La suma de `costo_usd` la hace Postgres en `numeric`, sin el error de
   * redondeo binario que acumulaba sumar miles de doubles en JS; se convierte a
   * `number` una sola vez, al final.
   */
  async resumirGastoPorWorkflow(desde: Date, hasta: Date): Promise<GastoWorkflowMetrica[]> {
    const { data, error } = await this.db.rpc("metricas_gasto_por_workflow", ventana(desde, hasta));
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return (data ?? []).map((r) => ({
      workflow: r.workflow,
      llamadas: aNumero(r.llamadas),
      costo_usd: aNumero(r.costo_usd),
      input_tokens: aNumero(r.input_tokens),
      output_tokens: aNumero(r.output_tokens),
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
}

/** Los RPC `metricas_*` cortan `[p_desde, p_hasta)`, igual que las lecturas de filas. */
function ventana(desde: Date, hasta: Date): { p_desde: string; p_hasta: string } {
  return { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() };
}
