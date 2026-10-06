#!/usr/bin/env node
/**
 * Rellena `productos.compatibilidad` traduciendo `productos.nombre` (la
 * descripción comprimida del catálogo) con `traducirDescripcion` y el
 * diccionario de modelos filtrado a `confianza = alta`.
 *
 *   node scripts/catalogo/rellenar-compatibilidad.mjs [--dry-run]            (por defecto)
 *   node scripts/catalogo/rellenar-compatibilidad.mjs --aplicar              (exige CONFIRMO_ESCRITURA=1)
 *   node scripts/catalogo/rellenar-compatibilidad.mjs --archivo=nombres.txt  (dry-run sin base: un nombre por línea)
 *
 * Opciones: --diccionario=<csv> · --limite=<N> · --sobrescribir (también pisa
 * las filas que ya tienen compatibilidad; sin eso se saltean).
 *
 * Entorno (no se imprime nunca): NEXT_PUBLIC_SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY. Contra el stack local:
 *
 *   node scripts/con-stack-local.mjs -- node scripts/catalogo/rellenar-compatibilidad.mjs
 *
 * Node avisa MODULE_TYPELESS_PACKAGE_JSON al importar el .ts de src/ (el repo
 * no declara "type": "module"); es ruido, se silencia con
 * `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON ...`.
 *
 * `--dry-run` solo LEE. `--aplicar` escribe y por eso se niega sin
 * CONFIRMO_ESCRITURA=1; la URL a la que apunta se imprime antes de tocar nada.
 * Las filas sin ningún vehículo reconocido no se tocan.
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

register("../lib/ts-alias-hooks.mjs", import.meta.url);
const { cargarDiccionario, soloConfianzaAlta, traducirDescripcion } =
  await import("../../src/lib/catalogo/traducir-descripcion.ts");

const PAGINA = 1000;
const CONCURRENCIA = 25;

function leerArgumentos(argv) {
  const opciones = {
    aplicar: false,
    dryRun: false,
    sobrescribir: false,
    archivo: null,
    diccionario: "docs/catalogo/diccionario-modelos-sugerido.csv",
    limite: Infinity,
  };
  for (const arg of argv) {
    if (arg === "--aplicar") opciones.aplicar = true;
    else if (arg === "--dry-run") opciones.dryRun = true;
    else if (arg === "--sobrescribir") opciones.sobrescribir = true;
    else if (arg.startsWith("--archivo=")) opciones.archivo = arg.slice("--archivo=".length);
    else if (arg.startsWith("--diccionario="))
      opciones.diccionario = arg.slice("--diccionario=".length);
    else if (arg.startsWith("--limite=")) opciones.limite = Number(arg.slice("--limite=".length));
    else fallar(`Argumento desconocido: ${arg}`);
  }
  if (opciones.aplicar && opciones.dryRun) fallar("--aplicar y --dry-run son excluyentes.");
  if (opciones.aplicar && opciones.archivo)
    fallar("--aplicar necesita la base: no se combina con --archivo.");
  if (!(opciones.limite > 0)) fallar("--limite debe ser un número mayor que 0.");
  return opciones;
}

function fallar(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

function crearCliente() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !clave)
    fallar("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  console.log(`Base: ${new URL(url).host}`);
  return createClient(url, clave, { auth: { persistSession: false } });
}

/** Lee `productos` en páginas de 1000 por id (keyset: estable aunque se actualicen filas). */
async function* filasDeLaBase(cliente) {
  let ultimoId = null;
  for (;;) {
    let consulta = cliente
      .from("productos")
      .select("id, nombre, compatibilidad")
      .order("id", { ascending: true })
      .limit(PAGINA);
    if (ultimoId) consulta = consulta.gt("id", ultimoId);
    const { data, error } = await consulta;
    if (error) fallar(`Error leyendo productos: ${error.message}`);
    if (!data || data.length === 0) return;
    yield data;
    ultimoId = data[data.length - 1].id;
    if (data.length < PAGINA) return;
  }
}

async function* filasDeArchivo(ruta) {
  const nombres = readFileSync(resolve(ruta), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  for (let i = 0; i < nombres.length; i += PAGINA) {
    yield nombres
      .slice(i, i + PAGINA)
      .map((nombre) => ({ id: null, nombre, compatibilidad: null }));
  }
}

function contar(mapa, clave) {
  mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
}

function top(mapa, n) {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function porcentaje(parte, total) {
  return total === 0 ? "0.0%" : `${((parte / total) * 100).toFixed(1)}%`;
}

async function actualizarEnLotes(cliente, cambios) {
  let escritas = 0;
  let fallidas = 0;
  for (let i = 0; i < cambios.length; i += CONCURRENCIA) {
    const lote = cambios.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.all(
      lote.map(({ id, compatibilidad }) =>
        cliente.from("productos").update({ compatibilidad }).eq("id", id),
      ),
    );
    for (const r of resultados) {
      if (r.error) {
        fallidas += 1;
        if (fallidas <= 5) console.error(`  fallo al actualizar: ${r.error.message}`);
      } else escritas += 1;
    }
  }
  return { escritas, fallidas };
}

const opciones = leerArgumentos(process.argv.slice(2));

if (opciones.aplicar && process.env.CONFIRMO_ESCRITURA !== "1") {
  fallar(
    "--aplicar escribe en la base: exige CONFIRMO_ESCRITURA=1 en el entorno. No se hizo nada.",
  );
}

const completo = cargarDiccionario(readFileSync(resolve(opciones.diccionario), "utf8"));
const diccionario = soloConfianzaAlta(completo);
const siglas = new Set(completo.map((m) => m.marcaSigla));
console.log(
  `Diccionario: ${diccionario.length} entradas de confianza alta (de ${completo.length}). Modo: ${opciones.aplicar ? "APLICAR" : "dry-run"}.`,
);

const cliente = opciones.archivo ? null : crearCliente();
const origen = opciones.archivo ? filasDeArchivo(opciones.archivo) : filasDeLaBase(cliente);

const stats = { total: 0, conVehiculo: 0, conAnio: 0, conCc: 0, conComb: 0, elementos: 0 };
const sinResultadoPrimero = new Map();
const sinResultadoMarcaYSegundo = new Map();
let aEscribir = 0;
let yaTenian = 0;
let escritas = 0;
let fallidas = 0;

lectura: for await (const pagina of origen) {
  const cambios = [];
  for (const fila of pagina) {
    if (stats.total >= opciones.limite) break lectura;
    stats.total += 1;
    const resultado = traducirDescripcion(fila.nombre, diccionario);
    if (resultado.length === 0) {
      const tokens = fila.nombre.toUpperCase().split(/\s+/).filter(Boolean);
      contar(sinResultadoPrimero, tokens[0] ?? "(vacío)");
      if (tokens[0] && siglas.has(tokens[0]))
        contar(sinResultadoMarcaYSegundo, `${tokens[0]} ${tokens[1] ?? ""}`.trim());
      continue;
    }
    stats.conVehiculo += 1;
    stats.elementos += resultado.length;
    if (resultado.some((c) => c.anio_desde !== null || c.anio_hasta !== null)) stats.conAnio += 1;
    if (resultado.some((c) => c.cilindrada !== null)) stats.conCc += 1;
    if (resultado.some((c) => c.combustible !== null)) stats.conComb += 1;

    if (opciones.aplicar) {
      const existente = fila.compatibilidad;
      if (Array.isArray(existente) && existente.length > 0 && !opciones.sobrescribir) {
        yaTenian += 1;
      } else {
        cambios.push({ id: fila.id, compatibilidad: resultado });
      }
    }
  }
  if (opciones.aplicar && cambios.length > 0) {
    aEscribir += cambios.length;
    const r = await actualizarEnLotes(cliente, cambios);
    escritas += r.escritas;
    fallidas += r.fallidas;
    console.log(`  ... ${stats.total} filas leídas, ${escritas} escritas`);
  }
}

console.log("\n=== Cobertura ===");
console.log(`Filas leídas:                     ${stats.total}`);
console.log(
  `Con >= 1 vehículo reconocido:     ${stats.conVehiculo} (${porcentaje(stats.conVehiculo, stats.total)})`,
);
console.log(
  `  con año (desde y/o hasta):      ${stats.conAnio} (${porcentaje(stats.conAnio, stats.total)} del total, ${porcentaje(stats.conAnio, stats.conVehiculo)} de las traducidas)`,
);
console.log(
  `  con cilindrada:                 ${stats.conCc} (${porcentaje(stats.conCc, stats.total)})`,
);
console.log(
  `  con combustible:                ${stats.conComb} (${porcentaje(stats.conComb, stats.total)})`,
);
console.log(
  `Elementos de compatibilidad:      ${stats.elementos} (${(stats.elementos / Math.max(stats.conVehiculo, 1)).toFixed(2)} por fila traducida)`,
);
console.log(
  `Sin ningún vehículo reconocido:   ${stats.total - stats.conVehiculo} (${porcentaje(stats.total - stats.conVehiculo, stats.total)})`,
);

console.log("\nPrimer token de las filas sin vehículo (top 25):");
for (const [token, n] of top(sinResultadoPrimero, 25))
  console.log(`  ${String(n).padStart(5)}  ${token}`);
console.log("\nSigla de marca + segundo token de las filas sin vehículo (top 25):");
for (const [clave, n] of top(sinResultadoMarcaYSegundo, 25))
  console.log(`  ${String(n).padStart(5)}  ${clave}`);

if (opciones.aplicar) {
  console.log(
    `\nAplicado: ${escritas} escritas de ${aEscribir} a escribir; ${yaTenian} ya tenían compatibilidad y se saltearon; ${fallidas} fallidas.`,
  );
  if (fallidas > 0) process.exit(1);
}
