import { NotFoundError } from "@/lib/errors";
import type { Intent, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type IntentInsert = Insert<Intent, "id">;
export type IntentUpdate = Update<Intent, "id">;

export interface IntentListFilter {
  activo?: boolean;
}

export interface IntentsRepository {
  create(input: IntentInsert): Promise<Intent>;
  findById(id: UUID): Promise<Intent | null>;
  // Primer match por nombre (SQL: LIMIT 1). Helper para que el service decida prevenir dups.
  findByNombre(nombre: string): Promise<Intent | null>;
  update(id: UUID, patch: IntentUpdate): Promise<Intent>;
  list(filter?: IntentListFilter): Promise<Intent[]>;
}

function cloneIntent(i: Intent): Intent {
  return { ...i, ejemplos: [...i.ejemplos] };
}

export class InMemoryIntentsRepository implements IntentsRepository {
  private readonly store = new Map<UUID, Intent>();

  async create(input: IntentInsert): Promise<Intent> {
    const intent: Intent = {
      ...input,
      ejemplos: [...input.ejemplos],
      id: crypto.randomUUID(),
    };
    this.store.set(intent.id, intent);
    return cloneIntent(intent);
  }

  async findById(id: UUID): Promise<Intent | null> {
    const i = this.store.get(id);
    return i ? cloneIntent(i) : null;
  }

  async findByNombre(nombre: string): Promise<Intent | null> {
    for (const i of this.store.values()) {
      if (i.nombre === nombre) return cloneIntent(i);
    }
    return null;
  }

  async update(id: UUID, patch: IntentUpdate): Promise<Intent> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`intent no encontrado: ${id}`, "intent", id);
    const next: Intent = {
      ...current,
      ...patch,
      ejemplos: patch.ejemplos ? [...patch.ejemplos] : [...current.ejemplos],
      id: current.id,
    };
    this.store.set(id, next);
    return cloneIntent(next);
  }

  async list(filter: IntentListFilter = {}): Promise<Intent[]> {
    let rows = Array.from(this.store.values());
    if (filter.activo !== undefined) {
      rows = rows.filter((i) => i.activo === filter.activo);
    }
    return rows.map(cloneIntent);
  }
}
