import { compatibleCon, puntaje } from "@/lib/catalogo/puntaje";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Producto, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

// `codigo_fabrica` y `otros_codigos` van opcionales a propósito: en la DB son
// nullable y `default '{}'`. Dejarlos requeridos obligaría a tocar todos los
// llamadores que ya existen —el alta manual, el import CSV, los tests— para
// que escriban un dato que todavía nadie tiene: el import que los llena es un
// paso posterior.
export type ProductoInsert = Omit<
  Insert<Producto, "id" | "created_at" | "updated_at">,
  "codigo_fabrica" | "otros_codigos"
> & {
  codigo_fabrica?: string | null;
  otros_codigos?: string[];
};

export type ProductoUpdate = Update<
  Producto,
  "id" | "created_at" | "updated_at" | "codigo_interno"
>;

/** Lo que se le pregunta al catálogo. Espeja los parámetros de `buscar_productos`. */
export interface ProductoSearchInput {
  /** Texto libre del cliente. Puede ser un código dictado o una frase. */
  q: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  /** Tope de filas. La DB lo recorta a 50 como máximo. */
  tope?: number;
}

/** Una fila del resultado, ya puntuada y ordenada. */
export interface ProductoSearchHit {
  id: UUID;
  codigo_interno: string;
  codigo_fabrica: string | null;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  precio: number;
  stock: number;
  puntaje: number;
}

// Item de upsert masivo con scope CSV import: solo las columnas del archivo.
// Update NO toca compatibilidad / imagen_url / activo (se preservan); insert
// usa defaults (compatibilidad [], imagen_url null, activo true).
export type ProductoBulkUpsertItem = Omit<
  ProductoInsert,
  "compatibilidad" | "imagen_url" | "activo"
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
  /**
   * Búsqueda puntuada del catálogo: por número de fábrica, código interno,
   * códigos alternos y texto.
   *
   * Existe porque `list()` NO sirve para esto. Un `list` sin `limit` no aplica
   * ningún `range`, así que manda el tope del servidor PostgREST —1.000 filas—
   * y el filtrado quedaba del otro lado de la red, en memoria. Con 21.009
   * productos eso significa que el agente ve 1.000 ordenados alfabéticamente y
   * contesta "no tenemos" sin un solo error en ningún log. Ya pasó una vez.
   */
  search(input: ProductoSearchInput): Promise<ProductoSearchHit[]>;
  // Upsert masivo por codigo_interno (import CSV). Throws si hay codigo_interno
  // duplicado en el input. Preserva orden del input en el array de retorno.
  bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]>;
}

// Deep clone defensivo de compatibilidad (jsonb array) para evitar mutación cruzada de refs.
function cloneProducto(p: Producto): Producto {
  return {
    ...p,
    compatibilidad: p.compatibilidad.map((c) => ({ ...c })),
    otros_codigos: [...p.otros_codigos],
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
      codigo_fabrica: input.codigo_fabrica ?? null,
      otros_codigos: [...(input.otros_codigos ?? [])],
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
      otros_codigos: patch.otros_codigos ? [...patch.otros_codigos] : [...current.otros_codigos],
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

  async search(input: ProductoSearchInput): Promise<ProductoSearchHit[]> {
    const tope = Math.max(1, Math.min(input.tope ?? 20, 50));
    const hits: ProductoSearchHit[] = [];

    for (const p of this.store.values()) {
      if (!p.activo) continue;
      if (!compatibleCon(p.compatibilidad, input.marca, input.modelo, input.anio)) continue;
      const score = puntaje(p, input.q);
      if (score <= 0) continue;
      hits.push({
        id: p.id,
        codigo_interno: p.codigo_interno,
        codigo_fabrica: p.codigo_fabrica,
        nombre: p.nombre,
        categoria: p.categoria,
        descripcion: p.descripcion,
        precio: p.precio,
        stock: p.stock,
        puntaje: score,
      });
    }

    // Mismo desempate que el `order by` de `buscar_productos`: puntaje, después
    // stock —lo que se puede despachar hoy va arriba— y al final el nombre para
    // que el orden sea estable.
    hits.sort(
      (a, b) => b.puntaje - a.puntaje || b.stock - a.stock || a.nombre.localeCompare(b.nombre),
    );
    return hits.slice(0, tope);
  }

  async bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]> {
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
        const created = await this.create({
          ...item,
          compatibilidad: [],
          imagen_url: null,
          activo: true,
        });
        result.push(created);
      }
    }
    return result;
  }
}
