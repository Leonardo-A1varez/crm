#!/usr/bin/env node
/**
 * Migraciones del stack LOCAL de Supabase (Docker). Nunca toca remoto: todo
 * comando al CLI lleva `--local` y las consultas entran por `docker exec` al
 * contenedor `supabase_db_<project_id>`.
 *
 *   node scripts/stack-local-db.mjs migrar      aplica las pendientes
 *   node scripts/stack-local-db.mjs reset       base vacía + todas desde cero
 *   node scripts/stack-local-db.mjs verificar   ledger local == archivos del repo
 *
 * Por qué no alcanza con `supabase db reset --local` (CLI 2.111.0, verificado
 * el 2026-09-25 corriéndolo tres veces): el reset manda la primera sentencia de
 * cada migración fuera de una transacción, y
 * `20260925040000_difusion_supresiones_telefono_hash.sql` abre con
 * `lock table ... in access exclusive mode`, que Postgres solo acepta dentro de
 * una (SQLSTATE 25P01). El reset corta ahí con la base en la migración 74.
 * `supabase migration up --local` sí la aplica (queda con sus 14 sentencias en
 * el ledger). En crm-dev entró por el MCP, que también la envuelve en una
 * transacción: el archivo está bien y no se reescribe.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirMigraciones = join(raiz, "supabase", "migrations");
const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(
  readFileSync(join(raiz, "supabase", "config.toml"), "utf8"),
)?.[1];
if (!projectId) throw new Error("no encontré project_id en supabase/config.toml");
const CONTENEDOR = `supabase_db_${projectId}`;

function supabaseLocal(args) {
  if (!args.includes("--local")) throw new Error("todo comando al CLI va con --local");
  if (args.some((a) => a === "--linked" || a.startsWith("--db-url") || a === "push")) {
    throw new Error(`argumento prohibido contra remoto: ${args.join(" ")}`);
  }
  const r = spawnSync("supabase", args, { cwd: raiz, encoding: "utf8", shell: true });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function psql(sql) {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTENEDOR,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qtA",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`psql falló: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function archivos() {
  return readdirSync(dirMigraciones)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort();
}

function aplicadas() {
  const s = psql("select version from supabase_migrations.schema_migrations order by version;");
  return new Set(s.split("\n").filter(Boolean));
}

function pendientes() {
  const hechas = aplicadas();
  return archivos().filter((f) => !hechas.has(f.slice(0, 14)));
}

function migrar() {
  if (pendientes().length === 0) return;
  const r = supabaseLocal(["migration", "up", "--local"]);
  if (!r.ok) {
    console.error(r.salida);
    throw new Error("supabase migration up --local falló");
  }
}

function verificar() {
  const enRepo = archivos().map((f) => f.slice(0, 14));
  const hechas = aplicadas();
  const faltan = enRepo.filter((v) => !hechas.has(v));
  const sobran = [...hechas].filter((v) => !enRepo.includes(v));
  console.log(`repo: ${enRepo.length} · ledger local: ${hechas.size}`);
  if (faltan.length || sobran.length) {
    console.error(`faltan: ${faltan.join(", ") || "-"} · sobran: ${sobran.join(", ") || "-"}`);
    process.exit(1);
  }
}

const orden = process.argv[2];
if (orden === "migrar") {
  migrar();
  verificar();
} else if (orden === "reset") {
  // Corta con 25P01 en 040000 (ver arriba) y deja la base en la anterior.
  const r = supabaseLocal(["db", "reset", "--local", "--no-seed", "--yes"]);
  if (!r.ok && !/SQLSTATE 25P01/.test(r.salida)) {
    console.error(r.salida);
    throw new Error("db reset --local falló por algo que no es 25P01");
  }
  migrar();
  verificar();
} else if (orden === "verificar") {
  verificar();
} else {
  console.error("uso: node scripts/stack-local-db.mjs <migrar|reset|verificar>");
  process.exit(2);
}
