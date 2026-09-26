#!/usr/bin/env node
/**
 * Corre un comando con el entorno del stack local (`.env.stack-local`) y con
 * `.env.local` del dueño NEUTRALIZADO, sin leer sus valores.
 *
 *   node scripts/con-stack-local.mjs [--perfil app|test] [--resembrar] -- <comando> [args...]
 *
 * Precedencia (verificada en el código instalado el 2026-09-25):
 *   - Next (`@next/env`, processEnv): una clave de un archivo .env solo se carga
 *     si `typeof process.env[k] === "undefined"`. Ya definida —aunque sea ""—,
 *     gana el proceso.
 *   - Vitest (`loadEnv` de Vite con prefijo ""): copia `process.env` encima de
 *     lo leído de los archivos. También gana el proceso.
 *
 * Entonces: (1) cada variable de `.env.stack-local` va al proceso hijo, y
 * (2) toda clave que aparezca en algún `.env*` que Next o Vite leerían y que NO
 * esté en `.env.stack-local` se define como "" en el hijo. `env.ts` trata ""
 * como ausente (`stripEmpty`), el SDK de Inngest también (`||`), así que nada
 * del `.env.local` real —ni una key de OpenAI, ni Upstash, ni Sentry, ni la
 * URL de crm-dev— llega a este proceso. De esos archivos solo se leen los
 * NOMBRES de las claves; los valores no se parsean ni se imprimen.
 *
 * Perfil `test` (integration tests): además
 *   - OPENAI_API_KEY="" → la suite de contrato contra OpenAI se saltea sola.
 *   - NEXT_PUBLIC_SUPABASE_URL="" → no hay "app" en este proceso. La guarda
 *     `assertBaseDeTestsAislada` protege a crm-dev de un TRUNCATE; acá esa
 *     protección la da el chequeo de loopback de abajo, que es más estricto.
 *     OJO: los tests vacían 17 tablas del stack local, incluido el seed de
 *     `dev:local`. `--resembrar` (lo usa `npm run test:integration:local`)
 *     corre el seed al terminar, pasen o fallen los tests.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivoStack = resolve(raiz, ".env.stack-local");

const args = process.argv.slice(2);
let perfil = "app";
let resembrar = false;
while (args[0] === "--perfil" || args[0] === "--resembrar") {
  if (args[0] === "--resembrar") {
    resembrar = true;
    args.shift();
  } else {
    perfil = args[1];
    args.splice(0, 2);
  }
}
if (args[0] === "--") args.shift();
if (!["app", "test"].includes(perfil) || args.length === 0) {
  console.error("uso: node scripts/con-stack-local.mjs [--perfil app|test] -- <comando> [args...]");
  process.exit(2);
}
if (!existsSync(archivoStack)) {
  console.error("Falta .env.stack-local: corré `npm run stack:env` con el stack arriba.");
  process.exit(1);
}

const stack = parseEnv(readFileSync(archivoStack, "utf8"));

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
for (const k of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_TEST_URL",
  "META_GRAPH_API_BASE_URL",
  "INNGEST_DEV",
  "MOCK_META_WEBHOOK_URL",
]) {
  const v = stack[k];
  let host = null;
  try {
    host = v ? new URL(v).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !LOOPBACK.has(host)) {
    console.error(`${k} en .env.stack-local no es una URL local: aborto sin correr nada.`);
    process.exit(1);
  }
}

// Solo nombres de clave. Los archivos que Next (development/production) y
// Vite (cualquier modo) pueden leer.
const ARCHIVOS_DOTENV = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
];
const CLAVE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const clavesAjenas = new Set();
for (const nombre of ARCHIVOS_DOTENV) {
  const ruta = resolve(raiz, nombre);
  if (!existsSync(ruta)) continue;
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = CLAVE.exec(linea);
    if (m && !(m[1] in stack)) clavesAjenas.add(m[1]);
  }
}

const envHijo = { ...process.env };
for (const k of clavesAjenas) envHijo[k] = "";
Object.assign(envHijo, stack);
// Next 16 bloquea su distDir con un lockfile: `next dev` del stack local usa el
// suyo para convivir con el `npm run dev` del dueño (ver next.config.ts). Con
// otro distDir, Next además reescribe el tsconfig para sumarle esos tipos: se
// le da uno propio, ignorado por git, que extiende el trackeado.
const DIST_DIR_LOCAL = ".next-local";
const TSCONFIG_LOCAL = "tsconfig.stack-local.json";
const base = JSON.parse(readFileSync(resolve(raiz, "tsconfig.json"), "utf8"));
writeFileSync(
  resolve(raiz, TSCONFIG_LOCAL),
  JSON.stringify(
    {
      extends: "./tsconfig.json",
      include: [
        ...(base.include ?? []).filter((p) => !p.startsWith(".next/")),
        `${DIST_DIR_LOCAL}/types/**/*.ts`,
        `${DIST_DIR_LOCAL}/dev/types/**/*.ts`,
      ],
    },
    null,
    2,
  ) + "\n",
);
envHijo.NEXT_DIST_DIR = DIST_DIR_LOCAL;
envHijo.NEXT_TSCONFIG_PATH = TSCONFIG_LOCAL;
if (perfil === "test") {
  envHijo.OPENAI_API_KEY = "";
  envHijo.NEXT_PUBLIC_SUPABASE_URL = "";
}

console.error(
  `[stack-local] perfil=${perfil} · ${Object.keys(stack).length} variables de .env.stack-local · ` +
    `${clavesAjenas.size} claves de otros .env anuladas`,
);

const hijo = spawn(args[0], args.slice(1), {
  cwd: raiz,
  env: envHijo,
  stdio: "inherit",
  shell: process.platform === "win32",
});
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => hijo.kill(senal));
hijo.on("exit", (codigo, senal) => {
  const salida = codigo ?? (senal ? 1 : 0);
  if (!resembrar) process.exit(salida);
  // Los integration tests vacían el stack local: se re-siembra pase lo que pase
  // y se devuelve el código de los tests, no el del seed.
  const seed = spawn(process.execPath, [resolve(raiz, "scripts", "stack-local-seed.mjs")], {
    cwd: raiz,
    stdio: "inherit",
  });
  seed.on("exit", (c) => {
    if (c !== 0) console.error("[stack-local] el re-seed falló: npm run stack:seed");
    process.exit(salida);
  });
});
