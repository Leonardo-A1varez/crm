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
