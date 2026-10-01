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
// Catálogo de /productos: carga completa por lotes y listas de valores.
// (Filtros y orden en `@/lib/validation/productos-filtros.schema`.)
// ---------------------------------------------------------------------------

/**
 * Una fila de la tabla: lo que se ve y lo que pide el formulario de edición. No
 * lleva `compatibilidad`, `imagen_url` ni fechas: con 21.000 filas cada byte de más
 * se paga 21.000 veces en la carga completa.
 */
export interface ProductoFila {
  id: string;
  codigo_interno: string;
  codigo_fabrica: string | null;
  otros_codigos: string[];
  sku_proveedor: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  precio: number;
  stock: number;
  activo: boolean;
}

/** Un lote de la carga completa: `LOTE_TAMANO` filas del conjunto filtrado y ordenado. */
export interface LoteProductos {
  filas: ProductoFila[];
  /** Total del filtro entero, no del lote. */
  total: number;
  /** El lote pedido (1-based), aunque esté fuera de rango y `filas` venga vacío. */
  lote: number;
  /** Posición (0-based) de la primera fila de este lote dentro del conjunto. */
  desde: number;
}

export interface FacetaValor {
  valor: string;
  /** Productos con ese valor bajo los demás filtros activos. 0 si es un valor seleccionado sin filas. */
  cantidad: number;
}

export interface Faceta {
  /**
   * Cantidad desc, y a igual cantidad por valor (numérico en el código, binario en
   * el resto). Recortada al límite pedido, salvo los valores seleccionados, que
   * siempre vienen.
   */
  valores: FacetaValor[];
  /** Cuántos valores distintos hay en total: si supera `valores.length`, la lista está recortada. */
  distintos: number;
}
