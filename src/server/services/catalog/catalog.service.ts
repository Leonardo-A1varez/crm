import type { Producto, UUID } from "@/types/entities";
import type { ProductosFiltrosEntrada } from "@/lib/validation/productos-filtros.schema";
import type {
  ImportPreview,
  ImportResult,
  ProductosFacetas,
  ProductosPagina,
} from "@/types/productos";

export interface CatalogListInput {
  q?: string;
}

export interface FacetasOpciones {
  /** Tope de valores por lista de facetas: entero entre 1 y 3000. Por defecto 500. */
  limite?: number;
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

  /**
   * Una página del catálogo filtrado (estilo Excel) con el total REAL del
   * filtro. Acepta tal cual los `searchParams` de la URL (strings) o valores ya
   * tipados; valida con Zod antes de tocar nada y tira `ValidationError` si algo
   * no cumple (rangos invertidos, `porPagina` > 100, listas de más de 300…).
   * Orden `nombre`, `codigo_interno`. Reemplaza al tope de 1.000 de `listProductos`.
   */
  buscarProductos(filtros: ProductosFiltrosEntrada): Promise<ProductosPagina>;

  /**
   * Valores distintos de categoría y de marca con su cantidad, para las listas
   * del filtro. Cada lista se calcula con todos los filtros activos menos el de
   * su propia columna; `pagina` y `porPagina` no cuentan. Mismo input y mismo
   * `ValidationError` que `buscarProductos`.
   */
  facetasProductos(
    filtros: ProductosFiltrosEntrada,
    opciones?: FacetasOpciones,
  ): Promise<ProductosFacetas>;

  /** Alta manual. Defaults no-form: activo=true, compatibilidad=[], imagen_url=null. */
  createProducto(input: CreateProductoServiceInput): Promise<Producto>;

  /** Edición manual. No toca codigo_interno (inmutable) ni activo (usar setProductoActivo). */
  updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto>;

  /** Baja/alta lógica — catálogo referenciado por sesiones históricas, sin delete físico. */
  setProductoActivo(id: UUID, activo: boolean): Promise<Producto>;

  /** Parse + validación por fila del CSV. Puro (no toca DB). ValidationError si estructura inválida. */
  previewImport(csvText: string): ImportPreview;

  /** Re-parsea y upserta solo filas válidas por codigo_interno; omite filas con error. */
  confirmImport(csvText: string): Promise<ImportResult>;
}
