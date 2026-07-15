import { ConflictError, NotFoundError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { CompatibilidadEntry, Producto, UUID } from "@/types/entities";
import type {
  ProductoBulkUpsertItem,
  ProductoInsert,
  ProductoListFilter,
  ProductoUpdate,
  ProductsRepository,
} from "./productos.repo";

type ProductoDbInsert = Database["public"]["Tables"]["productos"]["Insert"];
type ProductoDbUpdate = Database["public"]["Tables"]["productos"]["Update"];

/**
 * Supabase impl ProductsRepository. Slice 1 sub-paso 7.4 repo 3.
 *
 * Sin FKs externas — productos es root entity. Unique en codigo_interno.
 * CHECK constraints DB: precio >= 0, stock >= 0 — violación → mapPostgrestError
 * 23514 → ValidationError.
 */
export class SupabaseProductsRepository implements ProductsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: ProductoInsert): Promise<Producto> {
    const { data, error } = await this.db
      .from("productos")
      .insert(toDbInsert(input))
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(
          `codigo_interno duplicado: ${input.codigo_interno}`,
          "duplicate_codigo_interno",
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "producto" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Producto | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("productos").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "producto" });
    return data ? mapRow(data) : null;
  }

  async findByCodigoInterno(codigo: string): Promise<Producto | null> {
    const { data, error } = await this.db
      .from("productos")
      .select()
      .eq("codigo_interno", codigo)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "producto" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: ProductoUpdate): Promise<Producto> {
    const updatePayload: ProductoDbUpdate = {
      updated_at: await serverNowIso(this.db),
    };
    // codigo_interno no presente en ProductoUpdate (Update<..., "codigo_interno">). Defense
    // explícita: no mapear ni siquiera si caller bypass type system.
    if (patch.sku_proveedor !== undefined) updatePayload.sku_proveedor = patch.sku_proveedor;
    if (patch.nombre !== undefined) updatePayload.nombre = patch.nombre;
    if (patch.descripcion !== undefined) updatePayload.descripcion = patch.descripcion;
    if (patch.categoria !== undefined) updatePayload.categoria = patch.categoria;
    if (patch.compatibilidad !== undefined) {
      updatePayload.compatibilidad = patch.compatibilidad as never;
    }
    if (patch.precio !== undefined) updatePayload.precio = patch.precio;
    if (patch.stock !== undefined) updatePayload.stock = patch.stock;
    if (patch.imagen_url !== undefined) updatePayload.imagen_url = patch.imagen_url;
    if (patch.activo !== undefined) updatePayload.activo = patch.activo;

    const { data, error } = await this.db
      .from("productos")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "producto" });
    if (data === null) {
      // 0 filas sin error SQL: id inexistente O fila filtrada por RLS UPDATE
      // (using() filtra silencioso, no lanza 42501). SELECT sí es visible para
      // ambos roles → si existe, fue RLS: permiso denegado, no not-found.
      const visible = await this.findById(id);
      if (visible) {
        throw new PermissionDeniedError(`update de producto denegado por RLS: ${id}`);
      }
      throw new NotFoundError(`producto no encontrado: ${id}`, "producto", id);
    }
    return mapRow(data);
  }

  async list(filter: ProductoListFilter = {}): Promise<Producto[]> {
    let query = this.db
      .from("productos")
      .select()
      .order("nombre", { ascending: true })
      .order("codigo_interno", { ascending: true });

    if (filter.q) {
      const q = `%${filter.q}%`;
      query = query.or(`nombre.ilike.${q},codigo_interno.ilike.${q}`);
    }
    if (filter.activo !== undefined) {
      query = query.eq("activo", filter.activo);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit;
    if (limit !== undefined) {
      query = query.range(offset, offset + limit - 1);
    } else if (offset > 0) {
      query = query.range(offset, offset + 999);
    }

    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "producto" });
    return (data ?? []).map(mapRow);
  }

  async bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]> {
    if (items.length === 0) return [];

    // Dedup input (throws antes de tocar DB — fail-fast, mismo contract que InMemory).
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.codigo_interno)) {
        throw new ValidationError(`codigo_interno duplicado en input bulk: ${item.codigo_interno}`);
      }
      seen.add(item.codigo_interno);
    }

    const now = await serverNowIso(this.db);
    // Solo columnas CSV: el SET del ON CONFLICT se arma con las keys del payload,
    // así compatibilidad/imagen_url/activo quedan intactas en updates.
    const rows = items.map((item) => ({
      codigo_interno: item.codigo_interno,
      sku_proveedor: item.sku_proveedor,
      nombre: item.nombre,
      descripcion: item.descripcion,
      categoria: item.categoria,
      precio: item.precio,
      stock: item.stock,
      updated_at: now,
    }));

    // defaultToNull:false → columnas omitidas toman DEFAULT en el INSERT
    // (compatibilidad '[]', activo true) en vez de null (violaría NOT NULL).
    const { data, error } = await this.db
      .from("productos")
      .upsert(rows, { onConflict: "codigo_interno", defaultToNull: false })
      .select();

    if (error) throw mapPostgrestError(error, { resource: "producto" });

    // Postgres ORDER BY no garantizado en upsert — re-ordenar al orden del input
    // por codigo_interno (contract test "bulkUpsert mezcla creates + updates preservando orden").
    const byCodigo = new Map<string, (typeof data)[number]>();
    for (const row of data ?? []) byCodigo.set(row.codigo_interno, row);

    return items.map((item) => {
      const row = byCodigo.get(item.codigo_interno);
      if (!row) {
        // Inferencia (sin probe, a diferencia de update()): el upsert no lanzó
        // error SQL → la fila se escribió; su ausencia en RETURNING solo puede
        // ser filtrado RLS del SELECT implícito. Branch defensivo — con la
        // policy actual (SELECT para ambos roles) no debería ocurrir.
        throw new PermissionDeniedError(
          `bulkUpsert: row missing en respuesta para codigo_interno=${item.codigo_interno}`,
        );
      }
      return mapRow(row);
    });
  }
}

/**
 * Mapea ProductoInsert → ProductoDbInsert. id/created_at/updated_at se omiten
 * para que defaults SQL apliquen en INSERT y se preserven en UPDATE (upsert).
 */
function toDbInsert(input: ProductoInsert): ProductoDbInsert {
  return {
    codigo_interno: input.codigo_interno,
    sku_proveedor: input.sku_proveedor,
    nombre: input.nombre,
    descripcion: input.descripcion,
    categoria: input.categoria,
    compatibilidad: input.compatibilidad as never,
    precio: input.precio,
    stock: input.stock,
    imagen_url: input.imagen_url,
    activo: input.activo,
  };
}

interface ProductoRow {
  id: string;
  codigo_interno: string;
  sku_proveedor: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  compatibilidad: unknown;
  precio: number;
  stock: number;
  imagen_url: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProductoRow): Producto {
  const compat = (row.compatibilidad ?? []) as CompatibilidadEntry[];
  return {
    id: row.id,
    codigo_interno: row.codigo_interno,
    sku_proveedor: row.sku_proveedor,
    nombre: row.nombre,
    descripcion: row.descripcion,
    categoria: row.categoria,
    compatibilidad: compat.map((c) => ({ ...c })),
    precio: row.precio,
    stock: row.stock,
    imagen_url: row.imagen_url,
    activo: row.activo,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
