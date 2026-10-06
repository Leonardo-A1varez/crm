/**
 * Del CSV del diccionario de modelos a las filas de `catalogo_modelos`.
 *
 * Es la parte pura de `cargar-modelos.mjs` (sin red ni base): se prueba con
 * `tests/unit/scripts/catalogo-modelos-desde-csv.test.ts`.
 *
 * El CSV (docs/catalogo/diccionario-modelos-sugerido.csv) lo completa el dueño:
 *
 *   MODELO_REAL_ESCRIBIR_ACA  lo que escribió el dueño. Si está lleno, ese es
 *                             el nombre real y la fila cuenta como confirmada.
 *   MODELO_SUGERIDO           la sugerencia del análisis.
 *   CONFIANZA                 alta | media | baja, de la sugerencia.
 *   CONFIRMADO                SI/sí (confirma la sugerencia), un nombre (confirma
 *                             y lo corrige), o NO (la rechaza).
 *
 * Decisión del dueño (2026-10-05): la búsqueda usa lo confirmado y las
 * sugerencias con confianza `alta`; media y baja esperan confirmación.
 */
import Papa from "papaparse";

const CONFIANZAS = new Set(["alta", "media", "baja"]);
const SI = new Set(["si", "sí", "s", "x", "ok", "yes", "y", "1", "true", "confirmado"]);
const NO = new Set(["no", "n", "0", "false", "rechazado"]);

const COLUMNAS_OBLIGATORIAS = ["marca", "modelo_en_catalogo", "MODELO_SUGERIDO", "CONFIANZA"];

/** Lo que el inventario usa como "modelo" pero no es un vehículo. */
const NO_ES_MODELO = [/no es un modelo/i, /\?\?\?/, /^motor\b/i];

const limpio = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * @typedef {object} FilaModelo
 * @property {string} marca
 * @property {string} sigla_modelo
 * @property {string} nombre_real
 * @property {"alta" | "media" | "baja"} confianza
 * @property {boolean} confirmado
 *
 * @param {string} texto contenido del CSV
 * @returns {{
 *   filas: FilaModelo[],
 *   omitidas: Array<{ marca: string, sigla: string, motivo: string }>,
 *   duplicadas: Array<{ marca: string, sigla: string }>,
 *   rechazadas: number,
 *   resumen: { total: number, activas: number, inactivas: number },
 * }}
 */
export function filasDesdeCsv(texto) {
  const parsed = Papa.parse(texto.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const columnas = parsed.meta.fields ?? [];
  const faltan = COLUMNAS_OBLIGATORIAS.filter((c) => !columnas.includes(c));
  if (faltan.length > 0) {
    throw new Error(`El CSV no trae las columnas esperadas: faltan ${faltan.join(", ")}`);
  }

  const filas = [];
  const omitidas = [];
  const duplicadas = [];
  const vistas = new Set();
  let rechazadas = 0;

  for (const r of parsed.data) {
    const marca = limpio(r["marca"]);
    const sigla = limpio(r["modelo_en_catalogo"]);
    const dueno = limpio(r["MODELO_REAL_ESCRIBIR_ACA"]);
    const sugerido = limpio(r["MODELO_SUGERIDO"]);
    const celdaConfirmado = limpio(r["CONFIRMADO"]);
    const confirmadoMin = celdaConfirmado.toLowerCase();

    // Un nombre en CONFIRMADO es lo último que dijo el dueño y le gana a todo.
    const nombreEnConfirmado =
      celdaConfirmado !== "" && !SI.has(confirmadoMin) && !NO.has(confirmadoMin);
    const nombre = nombreEnConfirmado ? celdaConfirmado : dueno !== "" ? dueno : sugerido;
    const escritoPorElDueno = nombreEnConfirmado || dueno !== "";

    if (marca === "" || sigla === "" || nombre === "") {
      omitidas.push({ marca, sigla, motivo: "falta marca, sigla o nombre" });
      continue;
    }
    if (limpio(r["tipo"]).toUpperCase() === "ALCANCE") {
      omitidas.push({ marca, sigla, motivo: "es un alcance (TODOS/TODAS), no un modelo" });
      continue;
    }
    if (!escritoPorElDueno && NO_ES_MODELO.some((re) => re.test(nombre))) {
      omitidas.push({ marca, sigla, motivo: `no es un modelo: ${nombre}` });
      continue;
    }

    const clave = `${marca}|${sigla}`;
    if (vistas.has(clave)) {
      duplicadas.push({ marca, sigla });
      continue;
    }
    vistas.add(clave);

    const rechazada = NO.has(confirmadoMin);
    if (rechazada) rechazadas += 1;
    const confianzaCsv = limpio(r["CONFIANZA"]).toLowerCase();
    const confianza = rechazada ? "baja" : CONFIANZAS.has(confianzaCsv) ? confianzaCsv : "baja";
    const confirmado = !rechazada && (escritoPorElDueno || SI.has(confirmadoMin));

    filas.push({ marca, sigla_modelo: sigla, nombre_real: nombre, confianza, confirmado });
  }

  const activas = filas.filter((f) => f.confirmado || f.confianza === "alta").length;
  return {
    filas,
    omitidas,
    duplicadas,
    rechazadas,
    resumen: { total: filas.length, activas, inactivas: filas.length - activas },
  };
}
