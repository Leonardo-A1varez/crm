import { NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { ReglaEtiqueta, UUID } from "@/types/entities";
import type {
  ReglaEtiquetaInsert,
  ReglaEtiquetaUpdate,
  ReglasEtiquetaRepository,
} from "./reglas-etiqueta.repo";

type DbUpdate = Database["public"]["Tables"]["reglas_etiqueta"]["Update"];

/**
 * Supabase impl de `ReglasEtiquetaRepository`.
 *
 * `listActiveByIntent` es camino caliente —corre en cada turno del agente— y usa
 * el índice parcial `reglas_etiqueta_intent_idx (intent_id) WHERE activa`.
 *
 * `create` puede chocar contra `reglas_etiqueta_par_unico`: el mismo intent con
 * la misma etiqueta dos veces la colgaría dos veces. Sale como `ConflictError`
 * por `mapPostgrestError` y la pantalla lo traduce.
 */
export class SupabaseReglasEtiquetaRepository implements ReglasEtiquetaRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ReglaEtiquetaInsert): Promise<ReglaEtiqueta> {
    const { data, error } = await this.db
      .from("reglas_etiqueta")
      .insert({
        intent_id: input.intent_id,
        tag_id: input.tag_id,
        condiciones_extra: input.condiciones_extra as never,
        activa: input.activa,
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<ReglaEtiqueta | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("reglas_etiqueta")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: ReglaEtiquetaUpdate): Promise<ReglaEtiqueta> {
    const payload: DbUpdate = {};
    if (patch.tag_id !== undefined) payload.tag_id = patch.tag_id;
    if (patch.activa !== undefined) payload.activa = patch.activa;
    if ("condiciones_extra" in patch) {
      payload.condiciones_extra = (patch.condiciones_extra ?? null) as never;
    }

    const { data, error } = await this.db
      .from("reglas_etiqueta")
      .update(payload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
    if (data === null)
      throw new NotFoundError(`regla de etiqueta no encontrada: ${id}`, "regla", id);
    return mapRow(data);
  }

  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.from("reglas_etiqueta").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
  }

  async listActiveByIntent(intentId: UUID): Promise<ReglaEtiqueta[]> {
    if (!isUuid(intentId)) return [];
    const { data, error } = await this.db
      .from("reglas_etiqueta")
      .select()
      .eq("intent_id", intentId)
      .eq("activa", true)
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
    return (data ?? []).map(mapRow);
  }

  async list(): Promise<ReglaEtiqueta[]> {
    const { data, error } = await this.db
      .from("reglas_etiqueta")
      .select()
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "regla_etiqueta" });
    return (data ?? []).map(mapRow);
  }
}

interface Row {
  id: string;
  intent_id: string;
  tag_id: string;
  condiciones_extra: unknown;
  activa: boolean;
  created_at: string;
}

function mapRow(row: Row): ReglaEtiqueta {
  return {
    id: row.id,
    intent_id: row.intent_id,
    tag_id: row.tag_id,
    condiciones_extra:
      row.condiciones_extra === null || typeof row.condiciones_extra !== "object"
        ? null
        : (structuredClone(row.condiciones_extra) as Record<string, unknown>),
    activa: row.activa,
    created_at: new Date(row.created_at),
  };
}
