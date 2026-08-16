import { NotFoundError } from "@/lib/errors";
import type { ReglaEtiqueta, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type ReglaEtiquetaInsert = Insert<ReglaEtiqueta, "id" | "created_at">;
export type ReglaEtiquetaUpdate = Update<ReglaEtiqueta, "id" | "created_at" | "intent_id">;

export interface ReglasEtiquetaRepository {
  create(input: ReglaEtiquetaInsert): Promise<ReglaEtiqueta>;
  findById(id: UUID): Promise<ReglaEtiqueta | null>;
  update(id: UUID, patch: ReglaEtiquetaUpdate): Promise<ReglaEtiqueta>;
  delete(id: UUID): Promise<void>;
  /**
   * Las activas de ese intent. Camino caliente: corre en cada turno del agente.
   *
   * Devuelve **todas**, no la de mayor prioridad como su prima `reglas`: acá no
   * compiten por el único lugar de la respuesta, así que un lead puede quedar
   * con varias etiquetas del mismo mensaje.
   */
  listActiveByIntent(intentId: UUID): Promise<ReglaEtiqueta[]>;
  /** Todas, para la pantalla de administración. */
  list(): Promise<ReglaEtiqueta[]>;
}

function clonar(r: ReglaEtiqueta): ReglaEtiqueta {
  return {
    ...r,
    condiciones_extra: r.condiciones_extra === null ? null : structuredClone(r.condiciones_extra),
  };
}

export class InMemoryReglasEtiquetaRepository implements ReglasEtiquetaRepository {
  private readonly store = new Map<UUID, ReglaEtiqueta>();

  async create(input: ReglaEtiquetaInsert): Promise<ReglaEtiqueta> {
    const regla: ReglaEtiqueta = {
      ...input,
      condiciones_extra:
        input.condiciones_extra === null ? null : structuredClone(input.condiciones_extra),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(regla.id, regla);
    return clonar(regla);
  }

  async findById(id: UUID): Promise<ReglaEtiqueta | null> {
    const r = this.store.get(id);
    return r ? clonar(r) : null;
  }

  async update(id: UUID, patch: ReglaEtiquetaUpdate): Promise<ReglaEtiqueta> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`regla de etiqueta no encontrada: ${id}`, "regla", id);
    const next: ReglaEtiqueta = {
      ...current,
      ...patch,
      condiciones_extra:
        "condiciones_extra" in patch
          ? patch.condiciones_extra === null || patch.condiciones_extra === undefined
            ? null
            : structuredClone(patch.condiciones_extra)
          : current.condiciones_extra === null
            ? null
            : structuredClone(current.condiciones_extra),
      id: current.id,
      intent_id: current.intent_id,
      created_at: current.created_at,
    };
    this.store.set(id, next);
    return clonar(next);
  }

  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }

  async listActiveByIntent(intentId: UUID): Promise<ReglaEtiqueta[]> {
    return Array.from(this.store.values())
      .filter((r) => r.intent_id === intentId && r.activa)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(clonar);
  }

  async list(): Promise<ReglaEtiqueta[]> {
    return Array.from(this.store.values())
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(clonar);
  }
}
