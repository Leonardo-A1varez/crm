#!/usr/bin/env node
/**
 * Carga el diccionario de modelos (CSV) en `catalogo_modelos`.
 *
 *   node scripts/catalogo/cargar-modelos.mjs                       dry-run (default)
 *   CONFIRMO_ESCRITURA=1 node scripts/catalogo/cargar-modelos.mjs --aplicar
 *
 * Opciones:
 *   --csv <ruta>         default docs/catalogo/diccionario-modelos-sugerido.csv
 *   --aplicar            escribe. Sin esto no se toca la base, ni se conecta.
 *   --permitir-remoto    habilita escribir contra una URL que no es loopback.
 *
 * Seguridad:
 *   - `--aplicar` exige CONFIRMO_ESCRITURA=1 en el entorno.
 *   - Contra el stack local alcanza con eso. Contra cualquier otra base
 *     (crm-dev, producción) además exige `--permitir-remoto`: es una escritura
 *     sobre datos reales y la decide una persona, no un script de otro agente.
 *   - La clave de servicio se lee del entorno (SUPABASE_SERVICE_ROLE_KEY) y no
 *     se imprime nunca.
 *
 * Contra el stack local, con las variables ya armadas:
 *   CONFIRMO_ESCRITURA=1 node scripts/con-stack-local.mjs -- \
 *     node scripts/catalogo/cargar-modelos.mjs --aplicar
 *
 * Es un upsert por (marca, sigla_modelo): se puede correr las veces que haga
 * falta, y volver a correrlo con el CSV corregido actualiza las filas. No borra
 * nada: una sigla que sale del CSV queda en la tabla.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { filasDesdeCsv } from "./modelos-desde-csv.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOTE = 200;

function leerArgs(argv) {
  const out = {
    csv: resolve(raiz, "docs/catalogo/diccionario-modelos-sugerido.csv"),
    aplicar: false,
    remoto: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--aplicar") out.aplicar = true;
    else if (a === "--permitir-remoto") out.remoto = true;
    else if (a === "--dry-run") out.aplicar = false;
    else if (a === "--csv") {
      const ruta = argv[++i];
      if (!ruta) throw new Error("--csv necesita una ruta");
      out.csv = resolve(process.cwd(), ruta);
    } else throw new Error(`argumento desconocido: ${a}`);
  }
  return out;
}

function esLoopback(url) {
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function informe(r) {
  const { resumen } = r;
  console.log(
    `${resumen.total} modelos a cargar: ${resumen.activas} entran a la búsqueda (confirmados o confianza alta), ` +
      `${resumen.inactivas} esperan confirmación.`,
  );
  if (r.rechazadas > 0) console.log(`${r.rechazadas} rechazadas por el dueño (quedan inactivas).`);
  if (r.duplicadas.length > 0) {
    console.log(`${r.duplicadas.length} (marca, sigla) repetidas en el CSV; se carga la primera:`);
    for (const d of r.duplicadas) console.log(`  - ${d.marca} / ${d.sigla}`);
  }
  if (r.omitidas.length > 0) {
    console.log(`${r.omitidas.length} filas omitidas:`);
    for (const o of r.omitidas)
      console.log(`  - ${o.marca || "(sin marca)"} / ${o.sigla || "(sin sigla)"}: ${o.motivo}`);
  }
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const resultado = filasDesdeCsv(readFileSync(args.csv, "utf8"));
  console.log(`CSV: ${args.csv}`);
  informe(resultado);

  if (!args.aplicar) {
    console.log("\nDry-run: no se escribió nada. Para cargar: CONFIRMO_ESCRITURA=1 ... --aplicar");
    return;
  }

  if (process.env.CONFIRMO_ESCRITURA !== "1") {
    throw new Error("--aplicar necesita CONFIRMO_ESCRITURA=1 en el entorno.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (url === "" || clave === "") {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }
  if (!esLoopback(url) && !args.remoto) {
    throw new Error(
      `La URL (${new URL(url).hostname}) no es del stack local. Escribir ahí exige --permitir-remoto.`,
    );
  }

  const db = createClient(url, clave, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  for (let i = 0; i < resultado.filas.length; i += LOTE) {
    const lote = resultado.filas.slice(i, i + LOTE);
    const { error } = await db
      .from("catalogo_modelos")
      .upsert(lote, { onConflict: "marca,sigla_modelo" });
    if (error) throw new Error(`upsert del lote ${i / LOTE + 1}: ${error.message}`);
  }
  const { count, error } = await db
    .from("catalogo_modelos")
    .select("id", { count: "exact", head: true })
    .eq("activo", true);
  if (error) throw new Error(`conteo: ${error.message}`);
  console.log(
    `\nCargadas ${resultado.filas.length} filas en ${new URL(url).host}. Activas en la tabla: ${count}.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
