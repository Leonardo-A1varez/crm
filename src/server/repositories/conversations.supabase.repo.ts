import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { Canal } from "@/types/domain";
import type { Conversacion, UUID } from "@/types/entities";
import type {
  ConversacionInsert,
  ConversacionUpdate,
  ConversationsRepository,
} from "./conversations.repo";

type ConversacionDbUpdate = Database["public"]["Tables"]["conversaciones"]["Update"];

// Mismo tope que `IDS_POR_TANDA` de lead_session y por el mismo motivo: 100
// uuids son ~3,7 KB de query string y entran holgados en cualquier proxy.
const LEAD_IDS_POR_TANDA = 100;

/**
 * Supabase impl ConversationsRepository. Slice 1 sub-paso 7.4 repo 7.
 *
 * FK lead_id → leads.id ON DELETE CASCADE. UNIQUE (canal, canal_thread_id) →
 * 23505 → ConflictError. update bloquea canal + canal_thread_id (defense).
 *
 * upsertByCanalThread: SELECT-then-CREATE (no atómico — race window pequeña).
 * Si la race ocurre, la INSERT subsecuente cae en 23505 y mapea a
 * "duplicate_canal_thread", caller ve mismo error que duplicado intencional.
 * Aceptable para Slice 1; si volume alto requerir, migrar a CTE atómica RPC.
 */
export class SupabaseConversationsRepository implements ConversationsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ConversacionInsert): Promise<Conversacion> {
    const { data, error } = await this.db
      .from("conversaciones")
      .insert({
        lead_id: input.lead_id,
        canal: input.canal,
        canal_thread_id: input.canal_thread_id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(
          `(canal, canal_thread_id) duplicado: (${input.canal}, ${input.canal_thread_id})`,
          "duplicate_canal_thread",
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "conversacion" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Conversacion | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("conversaciones")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "conversacion" });
    return data ? mapRow(data) : null;
  }

  async findByCanalThread(canal: Canal, canalThreadId: string): Promise<Conversacion | null> {
    const { data, error } = await this.db
      .from("conversaciones")
      .select()
      .eq("canal", canal)
      .eq("canal_thread_id", canalThreadId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "conversacion" });
    return data ? mapRow(data) : null;
  }

  async findByLeadId(leadId: UUID): Promise<Conversacion[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("conversaciones")
      .select()
      .eq("lead_id", leadId)
      .order("ultima_actividad_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "conversacion" });
    return (data ?? []).map(mapRow);
  }

  async listByLeadIds(leadIds: UUID[]): Promise<Conversacion[]> {
    const limpios = leadIds.filter(isUuid);
    if (limpios.length === 0) return [];

    // Mismo criterio que `LeadSessionRepository.listByIds`: `.in()` viaja en la
    // query string, así que se parte en tandas para no pasarse del largo de URL
    // que acepta el proxy (414). Cada tanda es UNA consulta, nunca una por lead.
    const out: Conversacion[] = [];
    for (let i = 0; i < limpios.length; i += LEAD_IDS_POR_TANDA) {
      const { data, error } = await this.db
        .from("conversaciones")
        .select()
        .in("lead_id", limpios.slice(i, i + LEAD_IDS_POR_TANDA))
        .order("ultima_actividad_at", { ascending: false });
      if (error) throw mapPostgrestError(error, { resource: "conversacion" });
      for (const row of data ?? []) out.push(mapRow(row));
    }
    // Re-ordenar: cada tanda vino ordenada por su cuenta y concatenarlas no
    // conserva el orden global.
    return out.sort((a, b) => b.ultima_actividad_at.getTime() - a.ultima_actividad_at.getTime());
  }

  async upsertByCanalThread(
    canal: Canal,
    canalThreadId: string,
    leadId: UUID,
  ): Promise<Conversacion> {
    const existing = await this.findByCanalThread(canal, canalThreadId);
    if (existing) {
      if (existing.lead_id !== leadId) {
        throw new ConflictError(
          `(${canal}, ${canalThreadId}) ya pertenece a lead ${existing.lead_id} (esperado ${leadId})`,
          "conv_belongs_other_lead",
        );
      }
      return existing;
    }
    return this.create({ canal, canal_thread_id: canalThreadId, lead_id: leadId });
  }

  async touch(id: UUID, at?: Date): Promise<Conversacion> {
    // Server-side now() cuando no hay `at` explícito — evita clock skew.
    const ts = at ? at.toISOString() : await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("conversaciones")
      .update({ ultima_actividad_at: ts })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "conversacion" });
    if (data === null) {
      throw new NotFoundError(`conversación no encontrada: ${id}`, "conversacion", id);
    }
    return mapRow(data);
  }

  async update(id: UUID, patch: ConversacionUpdate): Promise<Conversacion> {
    const updatePayload: ConversacionDbUpdate = {};
    // canal + canal_thread_id NO mapeados — bloquea cambio (defense runtime).
    if (patch.lead_id !== undefined) updatePayload.lead_id = patch.lead_id;
    if (patch.ultima_actividad_at !== undefined) {
      updatePayload.ultima_actividad_at = patch.ultima_actividad_at.toISOString();
    }

    const { data, error } = await this.db
      .from("conversaciones")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "conversacion" });
    if (data === null) {
      throw new NotFoundError(`conversación no encontrada: ${id}`, "conversacion", id);
    }
    return mapRow(data);
  }
}

interface ConversacionRow {
  id: string;
  lead_id: string;
  canal: Canal;
  canal_thread_id: string;
  ultima_actividad_at: string;
  created_at: string;
}

function mapRow(row: ConversacionRow): Conversacion {
  return {
    id: row.id,
    lead_id: row.lead_id,
    canal: row.canal,
    canal_thread_id: row.canal_thread_id,
    ultima_actividad_at: new Date(row.ultima_actividad_at),
  };
}
