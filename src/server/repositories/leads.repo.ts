import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Canal } from "@/types/domain";
import type { Lead, MetaUserIds, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

// `nombre_perfil` y `datos_extra` quedan opcionales: los dos tienen default en
// la tabla (null y '{}') y solo los escribe quien los tiene — el pipeline de
// WhatsApp el primero, el vendedor el segundo.
export type LeadInsert = Insert<
  Lead,
  "id" | "created_at" | "updated_at" | "nombre_perfil" | "datos_extra"
> &
  Partial<Pick<Lead, "nombre_perfil" | "datos_extra">>;
export type LeadUpdate = Update<Lead, "id" | "created_at" | "updated_at">;

export interface LeadListFilter {
  /**
   * Texto libre contra las columnas con las que el vendedor reconoce al lead:
   * nombre de la casa, nombre de perfil de Meta, teléfono, marca y modelo.
   * El código de producto cotizado NO está acá: vive en `lead_session` y entra
   * por `idsExtra`.
   */
  q?: string;
  /**
   * Leads que entran al resultado aunque `q` no matchee ninguna de sus
   * columnas. Es la mitad de la búsqueda que resuelve otra tabla —hoy, los
   * leads cuyo código cotizado coincide—. Sin `q` no tiene efecto: filtrar solo
   * por esta lista sería otra consulta, no una búsqueda.
   */
  idsExtra?: UUID[];
  canal?: Canal;
  /** Cotas sobre `updated_at`: alimentan el filtro de última actividad. */
  actualizadoDesde?: Date;
  actualizadoHasta?: Date;
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
  /**
   * Varios leads por id, de una sola consulta.
   *
   * Existe para la bandeja: `listActive()` devuelve sesiones y de cada una hay
   * que llegar al lead. Con un `findById` por sesión eso es una consulta por
   * fila de la pantalla, y el poller la repite cada 5 segundos.
   *
   * Ids inexistentes o no-UUID simplemente no aparecen: no es un error, entre
   * dos consultas alguien pudo borrar el lead. Mismo criterio que
   * `LeadSessionRepository.listByIds`.
   */
  listByIds(ids: UUID[]): Promise<Lead[]>;
  // Borra el lead (merge: perdedor post-reasignación). Id inexistente o
  // no-UUID = no-op (replay-safe). FK CASCADE limpia merge_candidates del
  // lead. Con cliente authed (vendedor), si RLS deniega el DELETE lanza
  // PermissionDeniedError (distinguido de no-op vía SELECT posterior).
  delete(id: UUID): Promise<void>;
}

const META_KEY_BY_CANAL: Record<Canal, keyof MetaUserIds> = {
  wa: "wa",
  ig: "ig",
  fb: "fb",
};

// Deep clone defensivo de los jsonb (meta_user_ids, datos_extra). Garantiza
// parity con Supabase que siempre devuelve objetos nuevos. Sin esto, mutación
// externa contaminaría storage.
function cloneLead(l: Lead): Lead {
  return { ...l, meta_user_ids: { ...l.meta_user_ids }, datos_extra: { ...l.datos_extra } };
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
      nombre_perfil: input.nombre_perfil ?? null,
      meta_user_ids: { ...input.meta_user_ids },
      datos_extra: { ...(input.datos_extra ?? {}) },
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
      datos_extra: patch.datos_extra ? { ...patch.datos_extra } : { ...current.datos_extra },
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
      const extra = new Set(filter.idsExtra ?? []);
      rows = rows.filter(
        (l) =>
          extra.has(l.id) ||
          [l.nombre, l.nombre_perfil, l.telefono, l.vehiculo_marca, l.vehiculo_modelo].some(
            (campo) => (campo ?? "").toLowerCase().includes(q),
          ),
      );
    }
    if (filter.canal) {
      rows = rows.filter((l) => l.canal_origen === filter.canal);
    }
    if (filter.actualizadoDesde) {
      const desde = filter.actualizadoDesde.getTime();
      rows = rows.filter((l) => l.updated_at.getTime() >= desde);
    }
    if (filter.actualizadoHasta) {
      const hasta = filter.actualizadoHasta.getTime();
      rows = rows.filter((l) => l.updated_at.getTime() < hasta);
    }
    // Orden estable: updated_at DESC, id ASC para tiebreak
    rows.sort(
      (a, b) => b.updated_at.getTime() - a.updated_at.getTime() || a.id.localeCompare(b.id),
    );
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map(cloneLead);
  }

  async listByIds(ids: UUID[]): Promise<Lead[]> {
    if (ids.length === 0) return [];
    const buscados = new Set(ids);
    return Array.from(this.store.values())
      .filter((l) => buscados.has(l.id))
      .map(cloneLead);
  }

  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }
}
