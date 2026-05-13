import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Canal } from "@/types/domain";
import type { Lead, MetaUserIds, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type LeadInsert = Insert<Lead, "id" | "created_at" | "updated_at">;
export type LeadUpdate = Update<Lead, "id" | "created_at" | "updated_at">;

export interface LeadListFilter {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface LeadsRepository {
  create(input: LeadInsert): Promise<Lead>;
  findById(id: UUID): Promise<Lead | null>;
  findByTelefono(telefono: string): Promise<Lead | null>;
  findByMetaUserId(canal: Canal, metaUserId: string): Promise<Lead | null>;
  update(id: UUID, patch: LeadUpdate): Promise<Lead>;
  list(filter?: LeadListFilter): Promise<Lead[]>;
  // Merge: copia meta_user_ids del src al dst (dst gana en conflicto), borra src. Devuelve dst actualizado.
  mergeInto(srcId: UUID, dstId: UUID): Promise<Lead>;
}

const META_KEY_BY_CANAL: Record<Canal, keyof MetaUserIds> = {
  wa: "wa",
  ig: "ig",
  fb: "fb",
};

// Deep clone defensivo de meta_user_ids (jsonb nested). Garantiza parity con Supabase
// que siempre devuelve objetos nuevos. Sin esto, mutación externa contaminaría storage.
function cloneLead(l: Lead): Lead {
  return { ...l, meta_user_ids: { ...l.meta_user_ids } };
}

export class InMemoryLeadsRepository implements LeadsRepository {
  private readonly store = new Map<UUID, Lead>();

  async create(input: LeadInsert): Promise<Lead> {
    for (const existing of this.store.values()) {
      if (existing.telefono === input.telefono) {
        throw new ConflictError(`telefono duplicado: ${input.telefono}`, "duplicate_telefono");
      }
    }
    const now = new Date();
    const lead: Lead = {
      ...input,
      meta_user_ids: { ...input.meta_user_ids },
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };
    this.store.set(lead.id, lead);
    return cloneLead(lead);
  }

  async findById(id: UUID): Promise<Lead | null> {
    const l = this.store.get(id);
    return l ? cloneLead(l) : null;
  }

  async findByTelefono(telefono: string): Promise<Lead | null> {
    for (const lead of this.store.values()) {
      if (lead.telefono === telefono) return cloneLead(lead);
    }
    return null;
  }

  async findByMetaUserId(canal: Canal, metaUserId: string): Promise<Lead | null> {
    const key = META_KEY_BY_CANAL[canal];
    for (const lead of this.store.values()) {
      if (lead.meta_user_ids[key] === metaUserId) return cloneLead(lead);
    }
    return null;
  }

  async update(id: UUID, patch: LeadUpdate): Promise<Lead> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`lead no encontrado: ${id}`, "lead", id);
    const next: Lead = {
      ...current,
      ...patch,
      meta_user_ids: patch.meta_user_ids
        ? { ...patch.meta_user_ids }
        : { ...current.meta_user_ids },
      id: current.id,
      created_at: current.created_at,
      updated_at: new Date(),
    };
    this.store.set(id, next);
    return cloneLead(next);
  }

  async list(filter: LeadListFilter = {}): Promise<Lead[]> {
    let rows = Array.from(this.store.values());
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (l) => l.nombre.toLowerCase().includes(q) || l.telefono.toLowerCase().includes(q),
      );
    }
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map(cloneLead);
  }

  async mergeInto(srcId: UUID, dstId: UUID): Promise<Lead> {
    const src = this.store.get(srcId);
    const dst = this.store.get(dstId);
    if (!src) throw new NotFoundError(`src no encontrado: ${srcId}`, "lead", srcId);
    if (!dst) throw new NotFoundError(`dst no encontrado: ${dstId}`, "lead", dstId);
    const mergedMeta: MetaUserIds = { ...src.meta_user_ids, ...dst.meta_user_ids };
    const merged: Lead = {
      ...dst,
      meta_user_ids: mergedMeta,
      updated_at: new Date(),
    };
    this.store.set(dstId, merged);
    this.store.delete(srcId);
    return cloneLead(merged);
  }
}
