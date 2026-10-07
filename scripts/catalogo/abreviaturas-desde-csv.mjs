/**
 * Del CSV de abreviaturas a las filas de `catalogo_abreviaturas`.
 *
 * Es la parte pura de `cargar-abreviaturas.mjs` (sin red ni base): se prueba con
 * `tests/unit/scripts/catalogo-abreviaturas-desde-csv.test.ts`.
 *
 * El CSV (docs/catalogo/abreviaturas-sugeridas.csv) lo completa el dueño:
 *
 *   abrev       el token tal cual lo escribe el inventario (AMORTIG), o el grupo entero
 *               si es ruido (REPUESTO EMG).
 *   expansion   la palabra del cliente. Puede traer una aclaración entre paréntesis.
 *   tipo        pieza | posicion | atributo | ruido
 *   ambito      categoria | nombre | ambos
 *   confianza   alta | media | baja, de la sugerencia.
 *   CONFIRMADO  SI/sí (confirma la sugerencia), un texto (confirma y corrige la
 *               expansión), o NO (la rechaza). Vacío: queda como sugerida.
 *
 * Decisión del dueño (2026-10-05, la misma que para los modelos): la búsqueda usa lo
 * confirmado y las sugerencias con confianza `alta`; media y baja esperan confirmación.
 */
import Papa from "papaparse";

const TIPOS = new Set(["pieza", "posicion", "atributo", "ruido"]);
const AMBITOS = new Set(["categoria", "nombre", "ambos"]);
const CONFIANZAS = new Set(["alta", "media", "baja"]);
const SI = new Set(["si", "sí", "s", "x", "ok", "yes", "y", "1", "true", "confirmado"]);
const NO = new Set(["no", "n", "0", "false", "rechazado"]);

const COLUMNAS_OBLIGATORIAS = ["abrev", "expansion", "tipo", "ambito", "confianza"];

const limpio = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * @typedef {object} FilaAbreviatura
 * @property {string} abrev
 * @property {string} expansion
 * @property {"pieza" | "posicion" | "atributo" | "ruido"} tipo
 * @property {"categoria" | "nombre" | "ambos"} ambito
 * @property {"alta" | "media" | "baja"} confianza
 * @property {boolean} confirmado
 *
 * @param {string} texto contenido del CSV
 * @returns {{
 *   filas: FilaAbreviatura[],
 *   omitidas: Array<{ abrev: string, motivo: string }>,
 *   duplicadas: Array<{ abrev: string, tipo: string }>,
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
    const abrev = limpio(r["abrev"]);
    const sugerida = limpio(r["expansion"]);
    const tipo = limpio(r["tipo"]).toLowerCase();
    const ambito = limpio(r["ambito"]).toLowerCase();
    const celda = limpio(r["CONFIRMADO"]);
    const celdaMin = celda.toLowerCase();

    // Un texto en CONFIRMADO es lo último que dijo el dueño y le gana a la sugerencia.
    const textoDelDueno = celda !== "" && !SI.has(celdaMin) && !NO.has(celdaMin);
    const expansion = textoDelDueno ? celda : sugerida;

    if (abrev === "" || expansion === "") {
      omitidas.push({ abrev, motivo: "falta la abreviatura o su expansión" });
      continue;
    }
    if (!TIPOS.has(tipo)) {
      omitidas.push({ abrev, motivo: `tipo desconocido: ${tipo || "(vacío)"}` });
      continue;
    }
    if (!AMBITOS.has(ambito)) {
      omitidas.push({ abrev, motivo: `ámbito desconocido: ${ambito || "(vacío)"}` });
      continue;
    }

    const clave = `${abrev}|${tipo}`;
    if (vistas.has(clave)) {
      duplicadas.push({ abrev, tipo });
      continue;
    }
    vistas.add(clave);

    const rechazada = NO.has(celdaMin);
    if (rechazada) rechazadas += 1;
    const confianzaCsv = limpio(r["confianza"]).toLowerCase();
    const confianza = rechazada ? "baja" : CONFIANZAS.has(confianzaCsv) ? confianzaCsv : "baja";
    const confirmado = !rechazada && (textoDelDueno || SI.has(celdaMin));

    filas.push({ abrev, expansion, tipo, ambito, confianza, confirmado });
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
