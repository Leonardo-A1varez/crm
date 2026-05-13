import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import type { Canal } from "@/types/domain";
import type { Lead, MetaUserIds, UUID } from "@/types/entities";
import type { LeadInsert, LeadListFilter, LeadUpdate, LeadsRepository } from "./leads.repo";

type LeadDbUpdate = Database["public"]["Tables"]["leads"]["Update"];

const META_KEY_BY_CANAL: Record<Canal, keyof MetaUserIds> = {
  wa: "wa",
  ig: "ig",
  fb: "fb",
};

/**
 * Supabase impl LeadsRepository. Slice 1 sub-paso 7.4.
 *
 * Receives AppClient (preferably service-role para workflows + repos backend).
 * Authed client funcionará si RLS policies habilitan acceso al rol (Slice 3+).
 */
export class SupabaseLeadsRepository implements LeadsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: LeadInsert): Promise<Lead> {
    const { data, error } = await this.db
      .from("leads")
      .insert({
        nombre: input.nombre,
        telefono: input.telefono,
        email: input.email,
        direccion: input.direccion,
        vehiculo_marca: input.vehiculo_marca,
        vehiculo_modelo: input.vehiculo_modelo,
        vehiculo_anio: input.vehiculo_anio,
        vehiculo_motor: input.vehiculo_motor,
        empresa_id: input.empresa_id,
        canal_origen: input.canal_origen,
        meta_user_ids: input.meta_user_ids as never,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(
          `telefono duplicado: ${input.telefono}`,
          "duplicate_telefono",
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "lead" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Lead | null> {
    const { data, error } = await this.db.from("leads").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead" });
    return data ? mapRow(data) : null;
  }

  async findByTelefono(telefono: string): Promise<Lead | null> {
    const { data, error } = await this.db
      .from("leads")
      .select()
      .eq("telefono", telefono)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead" });
    return data ? mapRow(data) : null;
  }

  async findByMetaUserId(canal: Canal, metaUserId: string): Promise<Lead | null> {
    const key = META_KEY_BY_CANAL[canal];
    // jsonb contains operator @> via Supabase `.contains()`. Match exacto.
    const { data, error } = await this.db
      .from("leads")
      .select()
      .contains("meta_user_ids", { [key]: metaUserId })
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: LeadUpdate): Promise<Lead> {
    const updatePayload: LeadDbUpdate = {
      updated_at: new Date().toISOString(),
    };
    if (patch.nombre !== undefined) updatePayload.nombre = patch.nombre;
    if (patch.telefono !== undefined) updatePayload.telefono = patch.telefono;
    if (patch.email !== undefined) updatePayload.email = patch.email;
    if (patch.direccion !== undefined) updatePayload.direccion = patch.direccion;
    if (patch.vehiculo_marca !== undefined) updatePayload.vehiculo_marca = patch.vehiculo_marca;
    if (patch.vehiculo_modelo !== undefined) updatePayload.vehiculo_modelo = patch.vehiculo_modelo;
    if (patch.vehiculo_anio !== undefined) updatePayload.vehiculo_anio = patch.vehiculo_anio;
    if (patch.vehiculo_motor !== undefined) updatePayload.vehiculo_motor = patch.vehiculo_motor;
    if (patch.empresa_id !== undefined) updatePayload.empresa_id = patch.empresa_id;
    if (patch.canal_origen !== undefined) updatePayload.canal_origen = patch.canal_origen;
    if (patch.meta_user_ids !== undefined) {
      updatePayload.meta_user_ids = patch.meta_user_ids as never;
    }

    const { data, error } = await this.db
      .from("leads")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead" });
    if (data === null) {
      throw new NotFoundError(`lead no encontrado: ${id}`, "lead", id);
    }
    return mapRow(data);
  }

  async list(filter: LeadListFilter = {}): Promise<Lead[]> {
    let query = this.db.from("leads").select();

    if (filter.q) {
      const q = `%${filter.q}%`;
      query = query.or(`nombre.ilike.${q},telefono.ilike.${q}`);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit;
    if (limit !== undefined) {
      query = query.range(offset, offset + limit - 1);
    } else if (offset > 0) {
      query = query.range(offset, offset + 999);
    }

    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "lead" });
    return (data ?? []).map(mapRow);
  }

  async mergeInto(srcId: UUID, dstId: UUID): Promise<Lead> {
    const src = await this.findById(srcId);
    if (!src) throw new NotFoundError(`src no encontrado: ${srcId}`, "lead", srcId);
    const dst = await this.findById(dstId);
    if (!dst) throw new NotFoundError(`dst no encontrado: ${dstId}`, "lead", dstId);

    const mergedMeta: MetaUserIds = { ...src.meta_user_ids, ...dst.meta_user_ids };
    const merged = await this.update(dstId, { meta_user_ids: mergedMeta });

    const { error: delError } = await this.db.from("leads").delete().eq("id", srcId);
    if (delError) throw mapPostgrestError(delError, { resource: "lead" });

    return merged;
  }
}

interface LeadRow {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  direccion: string | null;
  vehiculo_marca: string;
  vehiculo_modelo: string;
  vehiculo_anio: number;
  vehiculo_motor: string | null;
  empresa_id: string | null;
  canal_origen: Canal;
  meta_user_ids: unknown;
  created_at: string;
  updated_at: string;
}

function mapRow(row: LeadRow): Lead {
  const meta = (row.meta_user_ids ?? {}) as MetaUserIds;
  return {
    id: row.id,
    nombre: row.nombre,
    telefono: row.telefono,
    email: row.email,
    direccion: row.direccion,
    vehiculo_marca: row.vehiculo_marca,
    vehiculo_modelo: row.vehiculo_modelo,
    vehiculo_anio: row.vehiculo_anio,
    vehiculo_motor: row.vehiculo_motor,
    empresa_id: row.empresa_id,
    canal_origen: row.canal_origen,
    meta_user_ids: { ...meta },
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
