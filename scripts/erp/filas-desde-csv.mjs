/**
 * Del CSV del catálogo del ERP (`crm_catalogo_erp.csv`, export de Bodega Web) a
 * las filas jsonb que recibe `erp_sync_cargar`. Es la parte pura de
 * `cargar-csv-local.mjs` (sin red ni base) y, de paso, la referencia ejecutable
 * del contrato (docs/integraciones/erp-oracle-contrato-crm.md): cada fila que sale
 * de acá es una fila válida para la RPC.
 *
 * Formato del CSV (lo fija Bodega Web): UTF-8 con BOM, separador `;`, CRLF, punto
 * decimal, vacío = null, campos con `;` o `"` entre comillas (RFC 4180), y el texto
 * que empieza con `= + - @` prefijado con `'` para que Excel no lo tome por fórmula.
 * Ese apóstrofo es del CSV, no del ERP: se saca acá. La RPC recibe los valores
 * crudos y por eso NO lo saca.
 *
 * Probado en `tests/unit/scripts/erp-filas-desde-csv.test.ts`.
 */
import Papa from "papaparse";

export const COLUMNAS = [
  "no_item",
  "codigo",
  "otros_codigos",
  "n_grupo",
  "grupo",
  "descripcion",
  "descripcion_auxiliar",
  "existencias_total",
  "precio_matriz",
  "precio_magdalena",
  "precio_koreanos",
  "precio_sas_repuestos",
  "codigo_difiere",
];

const NUMERICAS = new Set([
  "existencias_total",
  "precio_matriz",
  "precio_magdalena",
  "precio_koreanos",
  "precio_sas_repuestos",
]);

const NUMERO = /^-?\d+(\.\d+)?$/;

/** `'+20` → `+20`. Solo delante de los cuatro caracteres que escapa el export. */
function sinEscapeCsv(v) {
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

/**
 * @param {string} texto contenido del CSV
 * @returns {{ filas: Array<Record<string, string | number | null>>,
 *             errores: Array<{ linea: number, motivo: string }> }}
 */
export function filasErpDesdeCsv(texto) {
  const parsed = Papa.parse(texto.replace(/^﻿/, ""), {
    delimiter: ";",
    skipEmptyLines: true,
  });
  const [encabezado, ...datos] = parsed.data;
  if (!encabezado || encabezado.join(";") !== COLUMNAS.join(";")) {
    throw new Error(`El encabezado no es el del contrato: se esperaba ${COLUMNAS.join(";")}`);
  }

  const filas = [];
  const errores = [];
  datos.forEach((celdas, i) => {
    const linea = i + 2;
    if (celdas.length !== COLUMNAS.length) {
      errores.push({ linea, motivo: `tiene ${celdas.length} columnas, no ${COLUMNAS.length}` });
      return;
    }
    const fila = {};
    let motivo = null;
    COLUMNAS.forEach((col, j) => {
      const crudo = sinEscapeCsv(celdas[j] ?? "");
      if (NUMERICAS.has(col)) {
        if (crudo === "") fila[col] = null;
        else if (NUMERO.test(crudo)) fila[col] = Number(crudo);
        else motivo ??= `${col} no es un número: ${crudo.slice(0, 20)}`;
      } else {
        fila[col] =
          col === "no_item" || col === "descripcion" ? crudo : crudo === "" ? null : crudo;
      }
    });
    if (motivo) errores.push({ linea, motivo });
    else filas.push(fila);
  });
  return { filas, errores };
}

/** Parte un arreglo en lotes de `tamano`. */
export function lotes(xs, tamano) {
  const out = [];
  for (let i = 0; i < xs.length; i += tamano) out.push(xs.slice(i, i + tamano));
  return out;
}
