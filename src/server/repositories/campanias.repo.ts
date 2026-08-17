import { NotFoundError } from "@/lib/errors";
import type { Campania, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type CampaniaInsert = Insert<Campania, "id" | "created_at">;
export type CampaniaUpdate = Update<Campania, "id" | "created_at">;

export interface CampaniasRepository {
  create(input: CampaniaInsert): Promise<Campania>;
  findById(id: UUID): Promise<Campania | null>;
  update(id: UUID, patch: CampaniaUpdate): Promise<Campania>;
  list(): Promise<Campania[]>;
  /** Idempotente: borrar una inexistente no es error. `leads.campania_id` cae a null por la FK. */
  delete(id: UUID): Promise<void>;
}

export class InMemoryCampaniasRepository implements CampaniasRepository {
  private readonly campanias = new Map<UUID, Campania>();

  async create(input: CampaniaInsert): Promise<Campania> {
    const campania: Campania = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.campanias.set(campania.id, campania);
    return { ...campania };
  }

  async findById(id: UUID): Promise<Campania | null> {
    const c = this.campanias.get(id);
    return c ? { ...c } : null;
  }

  async update(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    const current = this.campanias.get(id);
    if (!current) throw new NotFoundError(`campaña no encontrada: ${id}`, "campania", id);
    const next: Campania = { ...current, ...patch, id: current.id };
    this.campanias.set(id, next);
    return { ...next };
  }

  async list(): Promise<Campania[]> {
    return Array.from(this.campanias.values()).map((c) => ({ ...c }));
  }

  async delete(id: UUID): Promise<void> {
    this.campanias.delete(id);
  }
}
