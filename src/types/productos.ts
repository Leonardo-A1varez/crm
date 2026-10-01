import type { Producto } from "@/types/entities";

export interface CsvProductoRow {
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  sku_proveedor: string | null;
  precio: number;
  stock: number;
}
export interface CsvRowError {
  fila: number; // número de línea del archivo (header = línea 1, primera fila de datos = 2)
  errores: string[];
}
export interface ImportPreview {
  total: number;
  validos: CsvProductoRow[];
  errores: CsvRowError[];
}
export interface ImportResult {
  importados: number;
  omitidos: number;
}
export type ImportPreviewActionResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string };
export type ImportConfirmActionResult =
  | { ok: true; result: ImportResult }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Listado filtrado y paginado de /productos (filtros en `@/lib/validation/productos-filtros.schema`).
// ---------------------------------------------------------------------------

/** Una página del catálogo filtrado. `total` es el del filtro entero, no el de la página. */
export interface ProductosPagina {
  items: Producto[];
  total: number;
  /** La página pedida (1-based), aunque esté fuera de rango y `items` venga vacío. */
  pagina: number;
  porPagina: number;
}

export interface FacetaValor {
  valor: string;
  /** Productos con ese valor bajo los demás filtros activos. 0 si es un valor seleccionado sin filas. */
  cantidad: number;
}

export interface Faceta {
  /**
   * Cantidad desc, y a igual cantidad por valor en orden binario. Recortada al
   * límite pedido, salvo los valores seleccionados, que siempre vienen.
   */
  valores: FacetaValor[];
  /** Cuántos valores distintos hay en total: si supera `valores.length`, la lista está recortada. */
  distintos: number;
}

export interface ProductosFacetas {
  categorias: Faceta;
  /** El valor `SIN_MARCA` agrupa a los productos con `descripcion` nula o en blanco. */
  marcas: Faceta;
}
