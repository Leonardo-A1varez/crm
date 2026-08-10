import { ConflictError, NotFoundError } from "@/lib/errors";
import { ADMIN_ACTIONS } from "@/server/services/admin-audit.service";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Tag, UUID } from "@/types/entities";
import type { TagListItem } from "@/types/tags";

export interface CrearTagInput {
  nombre: string;
  color: string;
  descripcion: string | null;
}

export interface EditarTagInput extends CrearTagInput {
  id: UUID;
}

export interface BorrarTagResultado {
  /** Cuántos leads perdieron la etiqueta. Se mide antes del borrado. */
  leadsAfectados: number;
  nombre: string;
}

export interface TagsAdminService {
  listar(): Promise<TagListItem[]>;
  crear(input: CrearTagInput): Promise<Tag>;
  editar(input: EditarTagInput): Promise<Tag>;
  borrar(id: UUID, actorUserId: UUID | null): Promise<BorrarTagResultado>;
}

export class DefaultTagsAdminService implements TagsAdminService {
  constructor(private readonly deps: { tags: TagsRepository; audit: AdminAuditService }) {}

  async listar(): Promise<TagListItem[]> {
    const [tags, usos] = await Promise.all([
      this.deps.tags.list(),
      this.deps.tags.countLeadsByTag(),
    ]);

    return tags
      .map((tag) => ({
        id: tag.id,
        nombre: tag.nombre,
        color: tag.color,
        descripcion: tag.descripcion,
        leadsUsando: usos.get(tag.id) ?? 0,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  async crear(input: CrearTagInput): Promise<Tag> {
    const nombre = input.nombre.trim();
    // `tags.nombre` es UNIQUE: sin este chequeo el alta explota con un 23505
    // que el operador lee como error genérico. La carrera entre dos admins
    // sigue cayendo en el ConflictError que el repo levanta desde ese 23505.
    const existente = await this.deps.tags.findByNombre(nombre);
    if (existente) {
      throw new ConflictError(`ya existe una etiqueta llamada ${nombre}`, "tag_nombre_duplicado");
    }

    return this.deps.tags.create({
      nombre,
      color: input.color,
      descripcion: input.descripcion,
    });
  }

  async editar(input: EditarTagInput): Promise<Tag> {
    const nombre = input.nombre.trim();
    // Renombrar a un nombre libre o dejar el propio sin tocar es válido; lo que
    // no se puede es pisar el nombre de otra etiqueta.
    const existente = await this.deps.tags.findByNombre(nombre);
    if (existente && existente.id !== input.id) {
      throw new ConflictError(`ya existe una etiqueta llamada ${nombre}`, "tag_nombre_duplicado");
    }

    return this.deps.tags.update(input.id, {
      nombre,
      color: input.color,
      descripcion: input.descripcion,
    });
  }

  async borrar(id: UUID, actorUserId: UUID | null): Promise<BorrarTagResultado> {
    const tag = await this.deps.tags.findById(id);
    if (!tag) throw new NotFoundError(`etiqueta no encontrada: ${id}`, "tag", id);

    // El conteo se toma antes del DELETE: después el CASCADE ya se llevó los
    // `lead_tags` y no queda forma de saber a cuántos leads afectó.
    const leadsAfectados = (await this.deps.tags.listLeadIdsByTag(id)).length;

    // Auditar antes de borrar, como el merge de leads: la baja es irreversible
    // y una fila de auditoría de un intento fallido molesta menos que un
    // borrado sin rastro porque el insert de auditoría falló después.
    await this.deps.audit.recordAction({
      actorUserId,
      action: ADMIN_ACTIONS.TAG_DELETE,
      entityType: "tag",
      entityId: id,
      payload: { nombre: tag.nombre, color: tag.color, leadsAfectados },
    });

    await this.deps.tags.delete(id);

    return { leadsAfectados, nombre: tag.nombre };
  }
}
