import type { Producto } from "@/types/entities";

export interface CatalogListInput {
  q?: string;
}

export interface CatalogService {
  /**
   * Catálogo completo (activos + inactivos) ordenado por nombre asc (orden lo
   * garantiza el repo). `q` filtra por nombre o codigo_interno case-insensitive.
   * Cap 1000 filas — pilot ~5K SKUs, la búsqueda acota; paginación diferida.
   */
  listProductos(input?: CatalogListInput): Promise<Producto[]>;
}
