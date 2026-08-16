import { ConflictError, NotFoundError, PermissionDeniedError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { TagSource } from "@/types/domain";
import type { LeadTag, Tag, UUID } from "@/types/entities";
import type { AssignedTag, TagInsert, TagUpdate, TagsRepository } from "./tags.repo";

type TagDbUpdate = Database["public"]["Tables"]["tags"]["Update"];

/**
 * Supabase impl TagsRepository. Slice 1 sub-paso 7.4 repo 2.
 *
 * Receives AppClient (preferably service-role para workflows + repos backend).
 * Authed client funcionará si RLS policies habilitan acceso al rol (Slice 3+).
 *
 * isUuid early-return en lecturas — evita PG 22P02 cuando caller pasa string
 * no-UUID; alinea contract semantics con InMemory (returns null/[]).
 * Writes (create/update/assignToLead) dejan throw natural — error semantics
 * apropiadas para writes inválidos.
 */
export class SupabaseTagsRepository implements TagsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: TagInsert): Promise<Tag> {
    const { data, error } = await this.db
      .from("tags")
      .insert({
        nombre: input.nombre,
        color: input.color,
        descripcion: input.descripcion,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(
          `nombre tag duplicado: ${input.nombre}`,
          "duplicate_tag_nombre",
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "tag" });
    }
    return mapTagRow(data);
  }

  async findById(id: UUID): Promise<Tag | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("tags").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "tag" });
    return data ? mapTagRow(data) : null;
  }

  async findByNombre(nombre: string): Promise<Tag | null> {
    const { data, error } = await this.db.from("tags").select().eq("nombre", nombre).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "tag" });
    return data ? mapTagRow(data) : null;
  }

  async update(id: UUID, patch: TagUpdate): Promise<Tag> {
    const updatePayload: TagDbUpdate = {};
    if (patch.nombre !== undefined) updatePayload.nombre = patch.nombre;
    if (patch.color !== undefined) updatePayload.color = patch.color;
    if (patch.descripcion !== undefined) updatePayload.descripcion = patch.descripcion;

    const { data, error } = await this.db
      .from("tags")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "tag" });
    if (data === null) {
      throw new NotFoundError(`tag no encontrado: ${id}`, "tag", id);
    }
    return mapTagRow(data);
  }

  async list(): Promise<Tag[]> {
    const { data, error } = await this.db.from("tags").select();
    if (error) throw mapPostgrestError(error, { resource: "tag" });
    return (data ?? []).map(mapTagRow);
  }

  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { data, error } = await this.db.from("tags").delete().eq("id", id).select();
    if (error) throw mapPostgrestError(error, { resource: "tag" });
    if ((data ?? []).length === 0) {
      // 0 filas sin error: inexistente (ok, replay) O la policy DELETE filtró.
      // El SELECT lo ven ambos roles → si sigue visible, fue RLS. Sin esta
      // sonda la pantalla avisaría "etiqueta borrada" sobre un no-op silencioso.
      const visible = await this.findById(id);
      if (visible) {
        throw new PermissionDeniedError(`delete de tag denegado por RLS: ${id}`);
      }
    }
  }

  async assignToLead(
    leadId: UUID,
    tagId: UUID,
    source: TagSource,
    assignedBy: UUID | null = null,
  ): Promise<LeadTag> {
    // Idempotente: upsert con ignoreDuplicates preserva row original (source/assigned_by/assigned_at).
    // Insertion vacía si conflict; siempre re-SELECT para devolver row vigente.
    const { error: upsertErr } = await this.db.from("lead_tags").upsert(
      [
        {
          lead_id: leadId,
          tag_id: tagId,
          source,
          assigned_by: assignedBy,
        },
      ],
      { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
    );
    if (upsertErr) throw mapPostgrestError(upsertErr, { resource: "lead_tag" });

    // Revivir una descartada es potestad de una persona: una regla que la
    // devolviera haría inútil sacarla a mano —volvería en el próximo mensaje
    // del cliente—. El UPDATE va condicionado a `quitada_at not null` para no
    // pisar `assigned_at` de una fila que ya estaba puesta.
    if (source === "manual") {
      const { error: revivirErr } = await this.db
        .from("lead_tags")
        .update({
          source,
          assigned_by: assignedBy,
          assigned_at: new Date().toISOString(),
          quitada_at: null,
          quitada_por: null,
        })
        .eq("lead_id", leadId)
        .eq("tag_id", tagId)
        .not("quitada_at", "is", null);
      if (revivirErr) throw mapPostgrestError(revivirErr, { resource: "lead_tag" });
    }

    const { data, error } = await this.db
      .from("lead_tags")
      .select()
      .eq("lead_id", leadId)
      .eq("tag_id", tagId)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "lead_tag" });
    return mapLeadTagRow(data);
  }

  async removeFromLead(leadId: UUID, tagId: UUID, quitadaPor: UUID | null = null): Promise<void> {
    if (!isUuid(leadId) || !isUuid(tagId)) return;
    // Marca, no borra: la fila es la prueba de que una persona la sacó y es lo
    // que impide que una regla la vuelva a colgar. `is null` mantiene la
    // idempotencia sin pisar la fecha del primer descarte.
    const { error } = await this.db
      .from("lead_tags")
      .update({ quitada_at: new Date().toISOString(), quitada_por: quitadaPor })
      .eq("lead_id", leadId)
      .eq("tag_id", tagId)
      .is("quitada_at", null);
    if (error) throw mapPostgrestError(error, { resource: "lead_tag" });
  }

  async listByLead(leadId: UUID): Promise<AssignedTag[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("lead_tags")
      .select("source, assigned_by, assigned_at, tags(id, nombre, color, descripcion)")
      .eq("lead_id", leadId)
      // Las descartadas siguen en la tabla para que ninguna regla las devuelva,
      // pero no están puestas: no se muestran.
      .is("quitada_at", null);
    if (error) throw mapPostgrestError(error, { resource: "lead_tag" });

    const out: AssignedTag[] = [];
    for (const row of data ?? []) {
      // FK ON DELETE CASCADE garantiza tag presente, pero defense vs race: skip si null.
      if (!row.tags) continue;
      out.push({
        id: row.tags.id,
        nombre: row.tags.nombre,
        color: row.tags.color,
        descripcion: row.tags.descripcion,
        source: row.source,
        assigned_by: row.assigned_by,
        assigned_at: new Date(row.assigned_at),
      });
    }
    return out;
  }

  async listLeadIdsByTag(tagId: UUID): Promise<UUID[]> {
    if (!isUuid(tagId)) return [];
    const { data, error } = await this.db
      .from("lead_tags")
      .select("lead_id")
      .eq("tag_id", tagId)
      .is("quitada_at", null);
    if (error) throw mapPostgrestError(error, { resource: "lead_tag" });
    return (data ?? []).map((r) => r.lead_id);
  }

  async countLeadsByTag(): Promise<Map<UUID, number>> {
    // Se agrupa en JS y no con el `count()` de PostgREST porque los agregados
    // dependen de `db-aggregates-enabled`, que este proyecto no habilita. Trae
    // una sola columna del pivot: a escala de piloto (~5K leads/mes) es una
    // consulta barata, y es lo que evita el N+1 por etiqueta.
    const { data, error } = await this.db.from("lead_tags").select("tag_id").is("quitada_at", null);
    if (error) throw mapPostgrestError(error, { resource: "lead_tag" });

    const out = new Map<UUID, number>();
    for (const row of data ?? []) {
      out.set(row.tag_id, (out.get(row.tag_id) ?? 0) + 1);
    }
    return out;
  }
}

interface TagRow {
  id: string;
  nombre: string;
  color: string;
  descripcion: string | null;
  created_at: string;
}

function mapTagRow(row: TagRow): Tag {
  return {
    id: row.id,
    nombre: row.nombre,
    color: row.color,
    descripcion: row.descripcion,
  };
}

interface LeadTagRow {
  lead_id: string;
  tag_id: string;
  source: TagSource;
  assigned_by: string | null;
  assigned_at: string;
  quitada_at: string | null;
  quitada_por: string | null;
}

function mapLeadTagRow(row: LeadTagRow): LeadTag {
  return {
    lead_id: row.lead_id,
    tag_id: row.tag_id,
    source: row.source,
    assigned_by: row.assigned_by,
    assigned_at: new Date(row.assigned_at),
    quitada_at: row.quitada_at === null ? null : new Date(row.quitada_at),
    quitada_por: row.quitada_por,
  };
}
