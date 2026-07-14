import type { Producto, UUID } from "@/types/entities";

export interface CatalogListInput {
  q?: string;
}

export interface CreateProductoServiceInput {
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  sku_proveedor: string | null;
  precio: number;
  stock: number;
}

export type UpdateProductoServiceInput = Omit<CreateProductoServiceInput, "codigo_interno">;

export interface CatalogService {
  /**
   * Catálogo completo (activos + inactivos) ordenado por nombre asc (orden lo
   * garantiza el repo). `q` filtra por nombre o codigo_interno case-insensitive.
   * Cap 1000 filas — pilot ~5K SKUs, la búsqueda acota; paginación diferida.
   */
  listProductos(input?: CatalogListInput): Promise<Producto[]>;

  /** Alta manual. Defaults no-form: activo=true, compatibilidad=[], imagen_url=null. */
  createProducto(input: CreateProductoServiceInput): Promise<Producto>;

  /** Edición manual. No toca codigo_interno (inmutable) ni activo (usar setProductoActivo). */
  updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto>;

  /** Baja/alta lógica — catálogo referenciado por sesiones históricas, sin delete físico. */
  setProductoActivo(id: UUID, activo: boolean): Promise<Producto>;
}
