import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";
import { CsvProductoRowSchema } from "@/lib/validation/productos.schema";
import type { CsvProductoRow, CsvRowError, ImportPreview } from "@/types/productos";

export const CSV_HEADERS_REQUERIDOS = ["codigo_interno", "nombre", "precio", "stock"] as const;

/**
 * Parsea CSV de catálogo. Columnas: codigo_interno,nombre,descripcion,categoria,
 * precio,stock,sku_proveedor (headers case-insensitive; extras se ignoran).
 * Estructura inválida (vacío / faltan headers requeridos) → ValidationError.
 * Errores por fila → `errores` con número de línea real (header = línea 1).
 */
export function parseProductosCsv(csvText: string): ImportPreview {
  // BOM UTF-8 (U+FEFF) rompería el matching del primer header. Se recorta por
  // charCode — un literal BOM en regex/string es invisible y frágil en el source.
  const sinBom = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const parsed = Papa.parse<Record<string, string>>(sinBom, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fields = parsed.meta.fields ?? [];
  const faltantes = CSV_HEADERS_REQUERIDOS.filter((h) => !fields.includes(h));
  if (faltantes.length > 0) {
    throw new ValidationError(`CSV inválido: faltan columnas requeridas (${faltantes.join(", ")})`);
  }
  if (parsed.data.length === 0) {
    throw new ValidationError("CSV vacío: no hay filas de datos.");
  }

  // Errores estructurales de papaparse (comillas rotas, etc.), indexados por fila de datos.
  const papaErroresPorFila = new Map<number, string[]>();
  for (const err of parsed.errors) {
    if (typeof err.row !== "number") continue;
    // papaparse indexa FieldMismatch relativo a parsed.data, pero Quotes usa el
    // conteo crudo que incluye el header → normalizar a índice de datos.
    const rowIdx = err.type === "Quotes" ? err.row - 1 : err.row;
    if (rowIdx < 0) continue; // error en la línea de header
    const list = papaErroresPorFila.get(rowIdx) ?? [];
    list.push(err.message);
    papaErroresPorFila.set(rowIdx, list);
  }

  const validos: CsvProductoRow[] = [];
  const errores: CsvRowError[] = [];
  const vistos = new Set<string>();

  parsed.data.forEach((raw, i) => {
    // header ocupa la línea 1. Limitación conocida: skipEmptyLines descuenta
    // líneas en blanco intercaladas → fila puede correrse en ese caso raro
    // (trailing blanks no afectan).
    const fila = i + 2;

    const papaErrs = papaErroresPorFila.get(i);
    if (papaErrs) {
      errores.push({ fila, errores: papaErrs });
      return;
    }

    const row = CsvProductoRowSchema.safeParse(raw);
    if (!row.success) {
      errores.push({
        fila,
        errores: row.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`),
      });
      return;
    }

    if (vistos.has(row.data.codigo_interno)) {
      errores.push({
        fila,
        errores: [`codigo_interno duplicado en el archivo: ${row.data.codigo_interno}`],
      });
      return;
    }

    vistos.add(row.data.codigo_interno);
    validos.push(row.data);
  });

  return { total: parsed.data.length, validos, errores };
}
