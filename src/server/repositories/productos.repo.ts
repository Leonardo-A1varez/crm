import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Producto, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type ProductoInsert = Insert<Producto, "id" | "created_at" | "updated_at">;
export type ProductoUpdate = Update<
  Producto,
  "id" | "created_at" | "updated_at" | "codigo_interno"
>;

export interface ProductoListFilter {
  q?: string;
  activo?: boolean;
  limit?: number;
  offset?: number;
}

export interface ProductsRepository {
  create(input: ProductoInsert): Promise<Producto>;
  findById(id: UUID): Promise<Producto | null>;
  findByCodigoInterno(codigo: string): Promise<Producto | null>;
  update(id: UUID, patch: ProductoUpdate): Promise<Producto>;
  list(filter?: ProductoListFilter): Promise<Producto[]>;
  // Upsert masivo por codigo_interno. Throws si hay codigo_interno duplicado en el input.
  // Preserva orden del input en el array de retorno.
  bulkUpsert(items: ProductoInsert[]): Promise<Producto[]>;
}

// Deep clone defensivo de compatibilidad (jsonb array) para evitar mutación cruzada de refs.
function cloneProducto(p: Producto): Producto {
  return {
    ...p,
    compatibilidad: p.compatibilidad.map((c) => ({ ...c })),
  };
}

export class InMemoryProductsRepository implements ProductsRepository {
  private readonly store = new Map<UUID, Producto>();

  async create(input: ProductoInsert): Promise<Producto> {
    const existing = await this.findByCodigoInterno(input.codigo_interno);
    if (existing) {
      throw new ConflictError(
        `codigo_interno duplicado: ${input.codigo_interno}`,
        "duplicate_codigo_interno",
      );
    }
    const now = new Date();
    const prod: Producto = {
      ...input,
      compatibilidad: input.compatibilidad.map((c) => ({ ...c })),
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };
    this.store.set(prod.id, prod);
    return cloneProducto(prod);
  }

  async findById(id: UUID): Promise<Producto | null> {
    const p = this.store.get(id);
    return p ? cloneProducto(p) : null;
  }

  async findByCodigoInterno(codigo: string): Promise<Producto | null> {
    for (const p of this.store.values()) {
      if (p.codigo_interno === codigo) return cloneProducto(p);
    }
    return null;
  }

  async update(id: UUID, patch: ProductoUpdate): Promise<Producto> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`producto no encontrado: ${id}`, "producto", id);
    const next: Producto = {
      ...current,
      ...patch,
      compatibilidad: patch.compatibilidad
        ? patch.compatibilidad.map((c) => ({ ...c }))
        : current.compatibilidad.map((c) => ({ ...c })),
      id: current.id,
      codigo_interno: current.codigo_interno,
      created_at: current.created_at,
      updated_at: new Date(),
    };
    this.store.set(id, next);
    return cloneProducto(next);
  }

  async list(filter: ProductoListFilter = {}): Promise<Producto[]> {
    let rows = Array.from(this.store.values());
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q),
      );
    }
    if (filter.activo !== undefined) {
      rows = rows.filter((p) => p.activo === filter.activo);
    }
    // Orden estable nombre + codigo_interno (paridad con ORDER BY de Supabase impl).
    rows.sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre) || a.codigo_interno.localeCompare(b.codigo_interno),
    );
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map(cloneProducto);
  }

  async bulkUpsert(items: ProductoInsert[]): Promise<Producto[]> {
    if (items.length === 0) return [];

    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.codigo_interno)) {
        throw new ValidationError(`codigo_interno duplicado en input bulk: ${item.codigo_interno}`);
      }
      seen.add(item.codigo_interno);
    }

    const result: Producto[] = [];
    for (const item of items) {
      const existing = await this.findByCodigoInterno(item.codigo_interno);
      if (existing) {
        const { codigo_interno: _ignore, ...rest } = item;
        const updated = await this.update(existing.id, rest);
        result.push(updated);
      } else {
        const created = await this.create(item);
        result.push(created);
      }
    }
    return result;
  }
}
