import { NotFoundError } from "@/lib/errors";
import type { Regla, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type ReglaInsert = Insert<Regla, "id" | "created_at">;
export type ReglaUpdate = Update<Regla, "id" | "created_at" | "intent_id">;

export interface ReglaListFilter {
  intentId?: UUID;
  activa?: boolean;
}

export interface RulesRepository {
  create(input: ReglaInsert): Promise<Regla>;
  findById(id: UUID): Promise<Regla | null>;
  update(id: UUID, patch: ReglaUpdate): Promise<Regla>;
  // Hot path pre-LLM: solo activa=true, orden prioridad DESC, tie-break created_at ASC.
  listActiveByIntent(intentId: UUID): Promise<Regla[]>;
  list(filter?: ReglaListFilter): Promise<Regla[]>;
}

function cloneCondiciones(c: Record<string, unknown> | null): Record<string, unknown> | null {
  if (c === null) return null;
  return structuredClone(c);
}

function cloneRegla(r: Regla): Regla {
  return { ...r, condiciones_extra: cloneCondiciones(r.condiciones_extra) };
}

export class InMemoryRulesRepository implements RulesRepository {
  private readonly store = new Map<UUID, Regla>();

  async create(input: ReglaInsert): Promise<Regla> {
    const regla: Regla = {
      ...input,
      condiciones_extra: cloneCondiciones(input.condiciones_extra),
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(regla.id, regla);
    return cloneRegla(regla);
  }

  async findById(id: UUID): Promise<Regla | null> {
    const r = this.store.get(id);
    return r ? cloneRegla(r) : null;
  }

  async update(id: UUID, patch: ReglaUpdate): Promise<Regla> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`regla no encontrada: ${id}`, "regla", id);
    const next: Regla = {
      ...current,
      ...patch,
      condiciones_extra:
        "condiciones_extra" in patch
          ? cloneCondiciones(patch.condiciones_extra ?? null)
          : cloneCondiciones(current.condiciones_extra),
      id: current.id,
      created_at: current.created_at,
      intent_id: current.intent_id,
    };
    this.store.set(id, next);
    return cloneRegla(next);
  }

  async listActiveByIntent(intentId: UUID): Promise<Regla[]> {
    const rows = Array.from(this.store.values()).filter(
      (r) => r.intent_id === intentId && r.activa,
    );
    rows.sort((a, b) => {
      if (b.prioridad !== a.prioridad) return b.prioridad - a.prioridad;
      return a.created_at.getTime() - b.created_at.getTime();
    });
    return rows.map(cloneRegla);
  }

  async list(filter: ReglaListFilter = {}): Promise<Regla[]> {
    let rows = Array.from(this.store.values());
    if (filter.intentId !== undefined) {
      rows = rows.filter((r) => r.intent_id === filter.intentId);
    }
    if (filter.activa !== undefined) {
      rows = rows.filter((r) => r.activa === filter.activa);
    }
    return rows.map(cloneRegla);
  }
}
