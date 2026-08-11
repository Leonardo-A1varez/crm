import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { LlmUsage, UUID } from "@/types/entities";
import type {
  LlmUsageInsert,
  LlmUsageRepository,
  ResumenGastoOpciones,
  ResumenGastoSesion,
} from "./llm-usage.repo";

interface LlmUsageRow {
  id: string;
  lead_session_id: string | null;
  mensaje_id: string | null;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  costo_usd: number | string;
  workflow: string;
  created_at: string;
}

/**
 * `costo_usd` es `numeric` en Postgres y PostgREST lo serializa como string
 * cuando la precisión no entra en un double: se parsea acá y no en el consumidor
 * para que nadie termine concatenando strings al sumar.
 */
function mapRow(row: LlmUsageRow): LlmUsage {
  return {
    id: row.id,
    lead_session_id: row.lead_session_id,
    mensaje_id: row.mensaje_id,
    modelo: row.modelo,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    costo_usd: typeof row.costo_usd === "string" ? Number(row.costo_usd) : row.costo_usd,
    workflow: row.workflow,
    created_at: new Date(row.created_at),
  };
}

/** Supabase impl de `LlmUsageRepository`. Append-only: solo insert y lectura. */
export class SupabaseLlmUsageRepository implements LlmUsageRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: LlmUsageInsert): Promise<LlmUsage> {
    const { data, error } = await this.db
      .from("llm_usage")
      .insert({
        lead_session_id: input.lead_session_id,
        mensaje_id: input.mensaje_id,
        modelo: input.modelo,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        costo_usd: input.costo_usd,
        workflow: input.workflow,
        ...(input.created_at ? { created_at: input.created_at.toISOString() } : {}),
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return mapRow(data as LlmUsageRow);
  }

  async resumenPorLeadSession(
    leadSessionId: UUID,
    opts: ResumenGastoOpciones = {},
  ): Promise<ResumenGastoSesion> {
    if (!isUuid(leadSessionId)) return { usd: 0, llamadas: 0 };
    const { data, error } = await this.db
      .from("llm_usage")
      .select("costo_usd, workflow")
      .eq("lead_session_id", leadSessionId);
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });

    // El filtro se aplica acá y no en el `select`: son decenas de filas por
    // sesión, y armar a mano el `not.in.(…)` de PostgREST con nombres que vienen
    // del caller es más frágil que descartarlas después de leerlas.
    const excluidos = new Set(opts.excluirWorkflows ?? []);
    let usd = 0;
    let llamadas = 0;
    for (const r of data ?? []) {
      if (excluidos.has(r.workflow)) continue;
      usd += typeof r.costo_usd === "string" ? Number(r.costo_usd) : r.costo_usd;
      // El conteo sale de las mismas filas y no de un `count` aparte: dos
      // queries podrían responder cosas distintas si entra una fila en el
      // medio, y de ahí saldría un "0 llamadas" con plata al lado.
      llamadas++;
    }
    return { usd, llamadas };
  }

  async primerRegistroAt(): Promise<Date | null> {
    // El índice `llm_usage_created_idx` es `created_at desc`; Postgres lo
    // recorre al revés para este orden, así que sigue siendo una sola fila
    // leída y no un scan de la tabla.
    const { data, error } = await this.db
      .from("llm_usage")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return data ? new Date(data.created_at) : null;
  }

  async listDesde(desde: Date): Promise<LlmUsage[]> {
    const { data, error } = await this.db
      .from("llm_usage")
      .select()
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return (data ?? []).map((r) => mapRow(r as LlmUsageRow));
  }

  async listByMensajeId(mensajeId: UUID): Promise<LlmUsage[]> {
    if (!isUuid(mensajeId)) return [];
    const { data, error } = await this.db
      .from("llm_usage")
      .select()
      .eq("mensaje_id", mensajeId)
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "llm_usage" });
    return (data ?? []).map((r) => mapRow(r as LlmUsageRow));
  }
}
