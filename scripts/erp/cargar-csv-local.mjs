#!/usr/bin/env node
/**
 * Carga el CSV del catálogo del ERP en el stack LOCAL por el mismo camino que el
 * extractor de Bodega Web: clave anon + `erp_sync_cargar` en lotes, con la
 * clave de sincronización. Sirve para medir la carga real (tiempos, conteos) y
 * como ejemplo ejecutable del contrato.
 *
 *   node scripts/con-stack-local.mjs -- node scripts/erp/cargar-csv-local.mjs \
 *     --archivo="C:/ruta/crm_catalogo_erp.csv" [--lote=5000]
 *
 * Solo contra loopback: se niega con cualquier otra URL. Genera una clave
 * efímera y fija su hash con la service role (pisa la clave local anterior). La
 * clave no se imprime.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { filasErpDesdeCsv, lotes } from "./filas-desde-csv.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fallar(msg) {
  console.error(msg);
  process.exit(1);
}

let archivo = null;
let tamanoLote = 5000;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--archivo=")) archivo = a.slice("--archivo=".length);
  else if (a.startsWith("--lote=")) tamanoLote = Number(a.slice("--lote=".length));
  else fallar(`Argumento desconocido: ${a}`);
}
if (!archivo) fallar("Falta --archivo=<csv>.");
if (!Number.isInteger(tamanoLote) || tamanoLote < 1 || tamanoLote > 5000) {
  fallar("--lote tiene que ser un entero de 1 a 5000.");
}

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !anonKey || !serviceKey) {
  fallar(
    "Faltan NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (usá con-stack-local).",
  );
}
let host = null;
try {
  host = new URL(url).hostname;
} catch {
  host = null;
}
if (!host || !LOOPBACK.has(host)) fallar("Solo carga en el stack local (URL de loopback). Aborto.");

const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, opciones);
const anon = createClient(url, anonKey, opciones);

const clave = randomBytes(32).toString("base64url");
{
  const hash = createHash("sha256").update(clave).digest("hex");
  const { error } = await service.rpc("erp_sync_clave_fijar", { p_clave_hash: hash });
  if (error) fallar(`erp_sync_clave_fijar: ${error.message}`);
}

const t0 = performance.now();
const { filas, errores } = filasErpDesdeCsv(readFileSync(archivo, "utf8"));
const tParse = performance.now() - t0;
console.log(
  `CSV: ${filas.length} filas válidas, ${errores.length} con error (${tParse.toFixed(0)} ms).`,
);
for (const e of errores.slice(0, 10)) console.log(`  línea ${e.linea}: ${e.motivo}`);

async function estado(fase, extra = {}) {
  const { error } = await anon.rpc("erp_sync_estado_fijar", {
    p_clave: clave,
    p_fase: fase,
    ...extra,
  });
  if (error) fallar(`erp_sync_estado_fijar(${fase}): ${error.code} ${error.message}`);
}

await estado("inicio");
let cambiadas = 0;
const tCarga = performance.now();
for (const [i, lote] of lotes(filas, tamanoLote).entries()) {
  const t = performance.now();
  const { data, error } = await anon.rpc("erp_sync_cargar", {
    p_clave: clave,
    p_tabla: "productos",
    p_filas: lote,
  });
  const ms = performance.now() - t;
  if (error) {
    await estado("fin", { p_ok: false, p_error: `lote ${i + 1}: ${error.code} ${error.message}` });
    fallar(
      `lote ${i + 1} (${lote.length} filas) falló en ${ms.toFixed(0)} ms: ${error.code} ${error.message}`,
    );
  }
  cambiadas += data;
  console.log(
    `lote ${i + 1}: ${lote.length} filas, ${data} insertadas o cambiadas, ${ms.toFixed(0)} ms`,
  );
}
const totalMs = performance.now() - tCarga;
await estado("fin", { p_ok: true, p_filas_cargadas: cambiadas });
console.log(
  `Carga: ${cambiadas} filas insertadas o cambiadas en ${(totalMs / 1000).toFixed(1)} s.`,
);

async function contar(filtro) {
  let q = service.from("productos").select("id", { count: "exact", head: true });
  q = filtro(q);
  const { count, error } = await q;
  if (error) fallar(error.message);
  return count;
}
const conteos = {
  total: await contar((q) => q),
  activos: await contar((q) => q.eq("activo", true)),
  con_stock: await contar((q) => q.gt("stock", 0)),
  precio_a_consultar: await contar((q) => q.is("precio", null)),
  codigo_difiere: await contar((q) => q.eq("codigo_difiere", true)),
  compatibilidad_pendiente: await contar((q) => q.eq("compatibilidad_pendiente", true)),
  con_otros_codigos: await contar((q) => q.neq("otros_codigos", "{}")),
};
console.log("Conteos en productos:", JSON.stringify(conteos));
