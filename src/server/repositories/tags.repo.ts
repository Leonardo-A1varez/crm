import { NotFoundError } from "@/lib/errors";
import type { TagSource } from "@/types/domain";
import type { LeadTag, Tag, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type TagInsert = Insert<Tag, "id">;
export type TagUpdate = Update<Tag, "id">;

// Tag + metadata de asignación al lead. Join virtual para evitar segundo fetch.
export interface AssignedTag extends Tag {
  source: TagSource;
  assigned_by: UUID | null;
  assigned_at: Date;
}

export interface TagsRepository {
  // Tag CRUD
  create(input: TagInsert): Promise<Tag>;
  findById(id: UUID): Promise<Tag | null>;
  findByNombre(nombre: string): Promise<Tag | null>;
  update(id: UUID, patch: TagUpdate): Promise<Tag>;
  list(): Promise<Tag[]>;
  /**
   * Borra el tag. Los `lead_tags` que lo referencian caen con él (FK ON DELETE
   * CASCADE): la baja saca la etiqueta de todos los leads que la tenían y eso
   * no se deshace. Idempotente: borrar uno inexistente no es error.
   */
  delete(id: UUID): Promise<void>;

  // LeadTag operaciones. assignToLead es idempotente: no sobrescribe source/assigned_by/assigned_at si ya existe.
  assignToLead(
    leadId: UUID,
    tagId: UUID,
    source: TagSource,
    assignedBy?: UUID | null,
  ): Promise<LeadTag>;
  removeFromLead(leadId: UUID, tagId: UUID): Promise<void>;
  listByLead(leadId: UUID): Promise<AssignedTag[]>;
  listLeadIdsByTag(tagId: UUID): Promise<UUID[]>;
  /**
   * Cuántos leads usan cada tag, en una sola consulta. Existe para que la
   * pantalla de administración no haga un `listLeadIdsByTag` por fila: los ids
   * no le sirven de nada y el N+1 crece con el catálogo de etiquetas.
   * Los tags sin uso no aparecen en el mapa — el consumidor asume 0.
   */
  countLeadsByTag(): Promise<Map<UUID, number>>;
}

function leadTagKey(leadId: UUID, tagId: UUID): string {
  return `${leadId}|${tagId}`;
}

export class InMemoryTagsRepository implements TagsRepository {
  private readonly tags = new Map<UUID, Tag>();
  private readonly leadTags = new Map<string, LeadTag>();

  async create(input: TagInsert): Promise<Tag> {
    const tag: Tag = { ...input, id: crypto.randomUUID() };
    this.tags.set(tag.id, tag);
    return { ...tag };
  }

  async findById(id: UUID): Promise<Tag | null> {
    const t = this.tags.get(id);
    return t ? { ...t } : null;
  }

  async findByNombre(nombre: string): Promise<Tag | null> {
    for (const t of this.tags.values()) {
      if (t.nombre === nombre) return { ...t };
    }
    return null;
  }

  async update(id: UUID, patch: TagUpdate): Promise<Tag> {
    const current = this.tags.get(id);
    if (!current) throw new NotFoundError(`tag no encontrado: ${id}`, "tag", id);
    const next: Tag = { ...current, ...patch, id: current.id };
    this.tags.set(id, next);
    return { ...next };
  }

  async list(): Promise<Tag[]> {
    return Array.from(this.tags.values()).map((t) => ({ ...t }));
  }

  async delete(id: UUID): Promise<void> {
    this.tags.delete(id);
    // Emula el ON DELETE CASCADE de `lead_tags`: sin esto quedarían asignaciones
    // apuntando a un tag inexistente y el contract divergiría de Supabase.
    for (const [key, lt] of this.leadTags) {
      if (lt.tag_id === id) this.leadTags.delete(key);
    }
  }

  async assignToLead(
    leadId: UUID,
    tagId: UUID,
    source: TagSource,
    assignedBy: UUID | null = null,
  ): Promise<LeadTag> {
    const key = leadTagKey(leadId, tagId);
    const existing = this.leadTags.get(key);
    if (existing) return { ...existing };
    const lt: LeadTag = {
      lead_id: leadId,
      tag_id: tagId,
      source,
      assigned_by: assignedBy,
      assigned_at: new Date(),
    };
    this.leadTags.set(key, lt);
    return { ...lt };
  }

  async removeFromLead(leadId: UUID, tagId: UUID): Promise<void> {
    this.leadTags.delete(leadTagKey(leadId, tagId));
  }

  async listByLead(leadId: UUID): Promise<AssignedTag[]> {
    const out: AssignedTag[] = [];
    for (const lt of this.leadTags.values()) {
      if (lt.lead_id !== leadId) continue;
      const tag = this.tags.get(lt.tag_id);
      if (!tag) continue; // FK roto — silenciosamente skip (Supabase ON DELETE CASCADE limpia esto).
      out.push({
        ...tag,
        source: lt.source,
        assigned_by: lt.assigned_by,
        assigned_at: lt.assigned_at,
      });
    }
    return out;
  }

  async listLeadIdsByTag(tagId: UUID): Promise<UUID[]> {
    const out: UUID[] = [];
    for (const lt of this.leadTags.values()) {
      if (lt.tag_id === tagId) out.push(lt.lead_id);
    }
    return out;
  }

  async countLeadsByTag(): Promise<Map<UUID, number>> {
    const out = new Map<UUID, number>();
    for (const lt of this.leadTags.values()) {
      out.set(lt.tag_id, (out.get(lt.tag_id) ?? 0) + 1);
    }
    return out;
  }
}
