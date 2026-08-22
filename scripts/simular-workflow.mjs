#!/usr/bin/env node
// Simula un workflow sin tocar nada. Uso:
//   node scripts/simular-workflow.mjs ruta/al/grafo.json [maxPasos]
//
// El proyecto no tiene tsx/ts-node/vite-node: Node stripea los tipos solo
// (22.18+, sin flag) pero no resuelve el alias "@/" ni las extensiones .ts
// que faltan en los imports relativos de src/. `lib/ts-alias-hooks.mjs`
// registra un resolver ESM que hace esas dos cosas con node:module puro, sin
// agregar dependencia.
//
// Ese stripping "solo borra tipos" no alcanza: `src/lib/errors.ts` usa
// parameter properties (`constructor(message: string, public readonly
// resource: string)`), que no es sintaxis erasable — hace falta transformarla,
// no sólo borrarla. Por eso el proceso se relanza con
// `--experimental-transform-types` si no arrancó con el flag, en vez de
// pedirle al que corre el script que se acuerde de ponerlo.
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { spawnSync } from "node:child_process";

const FLAG = "--experimental-transform-types";
if (!process.execArgv.includes(FLAG)) {
  const resultado = spawnSync(process.execPath, [FLAG, ...process.argv.slice(1)], {
    stdio: "inherit",
  });
  process.exit(resultado.status ?? 1);
}

register("./lib/ts-alias-hooks.mjs", import.meta.url);

const [, , ruta, maxArg] = process.argv;
if (!ruta) {
  console.error("uso: node scripts/simular-workflow.mjs <grafo.json> [maxPasos]");
  process.exit(1);
}
const grafo = JSON.parse(readFileSync(ruta, "utf8"));
const maxPasos = Number(maxArg ?? 500);

const { simular } = await import("../src/server/services/workflows/simulador.service.ts");
const r = await simular(grafo, { maxPasos, desde: new Date("2026-01-01T00:00:00Z") });

for (const p of r.pasos) {
  const dia = Math.round((p.reloj - new Date("2026-01-01T00:00:00Z")) / 86400000);
  console.log(`dia ${String(dia).padStart(4)}  ${p.nodoId.padEnd(16)} ${p.accion ?? ""}`);
}
console.log(`\ndesenlace: ${r.desenlace}${r.error ? ` -- ${r.error}` : ""}`);
console.log(`salientes al lead: ${r.salientes}`);
