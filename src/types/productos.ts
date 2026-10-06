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
  /** El más barato de los cuatro precios del ERP que no sean 0; `null` es "a consultar". */
  precio: number | null;
  /**
   * Precio por empresa del ERP. Opcionales: los trae `productos_listar` una vez que
   * la base los expone; si faltan, la tabla los muestra como "sin precio".
   */
  precio_matriz?: number | null;
  precio_magdalena?: number | null;
  precio_koreanos?: number | null;
  precio_sas_repuestos?: number | null;
  /** El código del ERP no coincide con `codigo_interno`. */
  codigo_difiere?: boolean;
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

/**
 * Una búsqueda del agente (`buscar_repuesto`) que el catálogo no encontró,
 * agrupada por texto plegado + marca + modelo + año.
 */
export interface BusquedaSinResultado {
  /** Texto buscado, plegado (minúsculas, sin tildes) y recortado. */
  busqueda: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  veces: number;
  ultima_vez: Date;
}
