import { NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { RespuestaTipo } from "@/types/domain";
import type { Regla, UUID } from "@/types/entities";
import type { ReglaInsert, ReglaListFilter, ReglaUpdate, RulesRepository } from "./rules.repo";

type ReglaDbUpdate = Database["public"]["Tables"]["reglas"]["Update"];

/**
 * Supabase impl RulesRepository. Slice 1 sub-paso 7.4 repo 6.
 *
 * FK intent_id → intents.id ON DELETE CASCADE. Update bloquea cambio de
 * intent_id (defensa runtime). condiciones_extra jsonb deep-clone post-fetch.
 *
 * listActiveByIntent hot path: usa index parcial `reglas_activa_prioridad_idx`
 * (intent_id, prioridad DESC) WHERE activa = true. Postgres ORDER BY explícito
 * matchea contract (prioridad DESC, created_at ASC).
 */
export class SupabaseRulesRepository implements RulesRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ReglaInsert): Promise<Regla> {
    const { data, error } = await this.db
      .from("reglas")
      .insert({
        intent_id: input.intent_id,
        condiciones_extra: input.condiciones_extra as never,
        respuesta_tipo: input.respuesta_tipo,
        respuesta_contenido: input.respuesta_contenido,
        prioridad: input.prioridad,
        activa: input.activa,
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "regla" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Regla | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("reglas").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "regla" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: ReglaUpdate): Promise<Regla> {
    const updatePayload: ReglaDbUpdate = {};
    // intent_id NO mapeado — bloquea cambio (defense runtime).
    if (patch.condiciones_extra !== undefined) {
      updatePayload.condiciones_extra = patch.condiciones_extra as never;
    }
    if (patch.respuesta_tipo !== undefined) updatePayload.respuesta_tipo = patch.respuesta_tipo;
    if (patch.respuesta_contenido !== undefined) {
      updatePayload.respuesta_contenido = patch.respuesta_contenido;
    }
    if (patch.prioridad !== undefined) updatePayload.prioridad = patch.prioridad;
    if (patch.activa !== undefined) updatePayload.activa = patch.activa;

    const { data, error } = await this.db
      .from("reglas")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "regla" });
    if (data === null) {
      throw new NotFoundError(`regla no encontrada: ${id}`, "regla", id);
    }
    return mapRow(data);
  }

  async listActiveByIntent(intentId: UUID): Promise<Regla[]> {
    if (!isUuid(intentId)) return [];
    const { data, error } = await this.db
      .from("reglas")
      .select()
      .eq("intent_id", intentId)
      .eq("activa", true)
      .order("prioridad", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "regla" });
    return (data ?? []).map(mapRow);
  }

  async list(filter: ReglaListFilter = {}): Promise<Regla[]> {
    let query = this.db.from("reglas").select();
    if (filter.intentId !== undefined) {
      if (!isUuid(filter.intentId)) return [];
      query = query.eq("intent_id", filter.intentId);
    }
    if (filter.activa !== undefined) {
      query = query.eq("activa", filter.activa);
    }
    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "regla" });
    return (data ?? []).map(mapRow);
  }
}

interface ReglaRow {
  id: string;
  intent_id: string;
  condiciones_extra: unknown;
  respuesta_tipo: RespuestaTipo;
  respuesta_contenido: string;
  prioridad: number;
  activa: boolean;
  created_at: string;
}

function mapRow(row: ReglaRow): Regla {
  return {
    id: row.id,
    intent_id: row.intent_id,
    condiciones_extra: cloneCondiciones(row.condiciones_extra),
    respuesta_tipo: row.respuesta_tipo,
    respuesta_contenido: row.respuesta_contenido,
    prioridad: row.prioridad,
    activa: row.activa,
    created_at: new Date(row.created_at),
  };
}

function cloneCondiciones(c: unknown): Record<string, unknown> | null {
  if (c === null || c === undefined) return null;
  // Deep clone vs caller mutation post-fetch.
  return structuredClone(c) as Record<string, unknown>;
}
