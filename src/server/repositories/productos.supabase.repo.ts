import {
  ConflictError,
  InfraError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import type { OpcionesFacetas, ProductosFiltros } from "@/lib/validation/productos-filtros.schema";
import type { AppClient } from "@/server/db/client";
import { FILAS_POR_PAGINA } from "@/server/db/paginar";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { ilikeContains } from "@/server/db/postgrest-like";
import { serverNowIso } from "@/server/db/server-time";
import type { Database, Json } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { CompatibilidadEntry, Producto, UUID } from "@/types/entities";
import type { Faceta, ProductosFacetas, ProductosPagina } from "@/types/productos";
import type {
  ProductoBulkUpsertItem,
  ProductoInsert,
  ProductoListFilter,
  ProductoSearchHit,
  ProductoSearchInput,
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
    const offset = filter.offset ?? 0;
    const limit = filter.limit;
    if (limit !== undefined) return this.pagina(filter, offset, limit);
    if (offset > 0) return this.pagina(filter, offset, FILAS_POR_PAGINA);

    // Sin límite, "todo el catálogo" tiene que ser todo: PostgREST cortaba en
    // 1.000 filas alfabéticas y el resto del catálogo no existía (lección 12).
    //
    // Por rango y no por keyset: el orden es `nombre` con la collation de la
    // base, y reordenar en JS lo cambiaría. `codigo_interno` es UNIQUE, así
    // que (nombre, codigo_interno) es un orden total y las páginas no se
    // pisan. Lo único que un rango no cubre es un alta o baja en medio de la
    // lectura, que puede correr una fila de página.
    const out: Producto[] = [];
    for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
      const filas = await this.pagina(filter, desde, FILAS_POR_PAGINA);
      out.push(...filas);
      if (filas.length < FILAS_POR_PAGINA) return out;
    }
  }

  private async pagina(
    filter: ProductoListFilter,
    desde: number,
    cantidad: number,
  ): Promise<Producto[]> {
    let query = this.db
      .from("productos")
      .select()
      .order("nombre", { ascending: true })
      .order("codigo_interno", { ascending: true });

    if (filter.q) {
      const pat = ilikeContains(filter.q);
      query = query.or(`nombre.ilike.${pat},codigo_interno.ilike.${pat}`);
    }
    if (filter.activo !== undefined) {
      query = query.eq("activo", filter.activo);
    }

    const { data, error } = await query.range(desde, desde + cantidad - 1);
    if (error) throw mapPostgrestError(error, { resource: "producto" });
    return (data ?? []).map(mapRow);
  }

  /**
   * Delega en `public.buscar_productos`, que puntúa dentro de Postgres.
   *
   * No usa `list()` a propósito: un `list` sin `limit` no aplica ningún
   * `range`, así que rige el tope del servidor PostgREST y con 21.009
   * productos el filtrado veía 1.000 filas alfabéticas. La RPC además usa los
   * índices —GIN trigram sobre `busqueda`, btree sobre los códigos plegados—
   * que desde el lado del cliente no los tocaba nadie.
   */
  async search(input: ProductoSearchInput): Promise<ProductoSearchHit[]> {
    const { data, error } = await this.db.rpc("buscar_productos", {
      p_q: input.q,
      p_marca: input.marca ?? undefined,
      p_modelo: input.modelo ?? undefined,
      p_anio: input.anio ?? undefined,
      p_tope: input.tope ?? undefined,
    });
    if (error) throw mapPostgrestError(error, { resource: "producto" });
    return (data ?? []).map((row) => ({
      id: row.id,
      codigo_interno: row.codigo_interno,
      codigo_fabrica: row.codigo_fabrica,
      nombre: row.nombre,
      categoria: row.categoria,
      descripcion: row.descripcion,
      precio: row.precio,
      stock: row.stock,
      puntaje: row.puntaje,
    }));
  }

  /**
   * Delega en `public.productos_listar`: filtro, orden, página y total se
   * resuelven en Postgres y a Next solo llegan `porPagina` filas. No pasa por
   * `.list()`, que o corta en 1.000 (lección 12) o trae todo el catálogo.
   */
  async listarFiltrado(filtros: ProductosFiltros): Promise<ProductosPagina> {
    const { data, error } = await this.db.rpc("productos_listar", {
      p_filtros: filtrosAJson(filtros),
      p_pagina: filtros.pagina,
      p_por_pagina: filtros.porPagina,
    });
    if (error) throw mapPostgrestError(error, { resource: "producto" });

    const sobre = data as { total?: unknown; items?: unknown } | null;
    if (
      sobre === null ||
      typeof sobre !== "object" ||
      typeof sobre.total !== "number" ||
      !Array.isArray(sobre.items)
    ) {
      throw new InfraError("productos_listar devolvió un resultado con forma inesperada", "db");
    }
    return {
      items: (sobre.items as ProductoRow[]).map(mapRow),
      total: sobre.total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    };
  }

  /**
   * Delega en `public.productos_facetas`: el conteo, la búsqueda dentro de la
   * lista y el recorte los hace Postgres.
   */
  async facetas(filtros: ProductosFiltros, opciones: OpcionesFacetas): Promise<ProductosFacetas> {
    const json = filtrosAJson(filtros) as Record<string, Json>;
    if (opciones.qCategoria !== undefined) json["q_categoria"] = opciones.qCategoria;
    if (opciones.qMarca !== undefined) json["q_marca"] = opciones.qMarca;
    const { data, error } = await this.db.rpc("productos_facetas", {
      p_filtros: json,
      p_limite: opciones.limite,
    });
    if (error) throw mapPostgrestError(error, { resource: "producto" });

    const categorias: Faceta = { valores: [], distintos: 0 };
    const marcas: Faceta = { valores: [], distintos: 0 };
    // bigint llega como número en el JSON de PostgREST.
    for (const fila of data ?? []) {
      const faceta = fila.columna === "categoria" ? categorias : marcas;
      faceta.valores.push({ valor: fila.valor, cantidad: Number(fila.cantidad) });
      faceta.distintos = Number(fila.distintos);
    }
    return { categorias, marcas };
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
    // Opcionales en `ProductoInsert` porque en la DB son nullable y
    // `default '{}'`; acá se materializan para que el payload sea explícito.
    // Esto solo lo usa `create()`: `bulkUpsert` arma su propio payload con las
    // columnas del CSV, así que un reimport no las pisa.
    codigo_fabrica: input.codigo_fabrica ?? null,
    otros_codigos: input.otros_codigos ?? [],
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

/**
 * Filtros validados → el jsonb que leen `productos_filtrados` y sus hermanas.
 * Las claves ausentes significan "sin filtro", por eso solo se agregan las que
 * tienen valor.
 */
function filtrosAJson(f: ProductosFiltros): Json {
  const j: Record<string, Json> = {};
  if (f.q !== undefined) j["q"] = f.q;
  if (f.codigo !== undefined) {
    j["codigo"] = f.codigo;
    j["codigo_modo"] = f.codigoModo;
  }
  if (f.descripcion !== undefined) {
    j["descripcion"] = f.descripcion;
    j["descripcion_modo"] = f.descripcionModo;
  }
  if (f.categorias.length > 0) j["categorias"] = f.categorias;
  if (f.sinCategorias.length > 0) j["sin_categorias"] = f.sinCategorias;
  if (f.marcas.length > 0) j["marcas"] = f.marcas;
  if (f.sinMarcas.length > 0) j["sin_marcas"] = f.sinMarcas;
  if (f.precioMin !== undefined) j["precio_min"] = f.precioMin;
  if (f.precioMax !== undefined) j["precio_max"] = f.precioMax;
  if (f.stockMin !== undefined) j["stock_min"] = f.stockMin;
  if (f.stockMax !== undefined) j["stock_max"] = f.stockMax;
  if (f.conStock !== null) j["con_stock"] = f.conStock;
  if (f.estado !== null) j["estado"] = f.estado;
  return j;
}

interface ProductoRow {
  id: string;
  codigo_interno: string;
  codigo_fabrica: string | null;
  otros_codigos: string[] | null;
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
    codigo_fabrica: row.codigo_fabrica,
    otros_codigos: [...(row.otros_codigos ?? [])],
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
