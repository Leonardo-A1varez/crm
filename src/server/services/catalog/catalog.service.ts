import type { Producto, UUID } from "@/types/entities";
import type {
  OpcionesFacetaEntrada,
  ProductosFiltrosEntrada,
} from "@/lib/validation/productos-filtros.schema";
import type { Faceta, ImportPreview, ImportResult, LoteProductos } from "@/types/productos";

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
   * Un lote de la carga completa del catálogo: `LOTE_TAMANO` (1.000) filas del
   * conjunto filtrado y ordenado, con el total REAL del filtro. La pantalla pide el
   * lote 1 y después los demás, y los junta: no hay paginación.
   *
   * `filtros` son los `searchParams` de la URL tal cual (strings) o valores ya
   * tipados; se valida con Zod antes de tocar nada y tira `ValidationError` si algo
   * no cumple (rangos invertidos, listas de más de 300…). El orden son los niveles
   * `orden`/`dir` (hasta tres) y siempre cierra con el código, que es único.
   */
  loteProductos(filtros: ProductosFiltrosEntrada, lote?: unknown): Promise<LoteProductos>;

  /**
   * Los valores distintos de UNA columna con su cantidad, para su lista de filtro.
   * Se calcula con todos los filtros activos menos los de su propia columna; el orden
   * no cuenta. Mismo input y mismo `ValidationError` que `loteProductos`.
   *
   * `opciones` es estado del panel, no va en la URL: `columna`, `q` (búsqueda dentro
   * de la lista, hasta 100 caracteres, antes del límite; exacta en el código) y
   * `limite` (1 a 3000, por defecto 500).
   */
  facetaProductos(
    filtros: ProductosFiltrosEntrada,
    opciones: OpcionesFacetaEntrada,
  ): Promise<Faceta>;

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
