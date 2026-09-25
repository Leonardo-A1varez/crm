#!/usr/bin/env node
// Regenera src/server/db/types.gen.ts con el CLI de Supabase sin arriesgar el
// archivo real. Uso: npm run db:gen-types
//
// La versión anterior era `supabase gen types ... > types.gen.ts`: la shell
// trunca el destino antes de que el comando corra, así que un fallo del CLI
// (p. ej. `Unauthorized`) dejaba el archivo vacío o con el error adentro y
// rompía el typecheck de todo el proyecto. Acá la salida va a un temporal en
// el mismo directorio y solo reemplaza al real si el CLI terminó con 0 y lo
// que escribió parece un archivo de tipos.
import { closeSync, openSync, readFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const destino = "src/server/db/types.gen.ts";
const temporal = `${destino}.tmp`;

const fd = openSync(temporal, "w");
const resultado = spawnSync("supabase", ["gen", "types", "typescript", "--linked"], {
  stdio: ["inherit", fd, "inherit"],
  // En Windows el CLI puede estar instalado como shim .cmd (npm, scoop), que
  // spawn no resuelve sin shell. Los argumentos son fijos, no hay input externo.
  shell: process.platform === "win32",
});
closeSync(fd);

function abortar(motivo) {
  // El CLI escribe algunos errores (p. ej. `Unauthorized`) en stdout, que acá
  // va al temporal: se muestra antes de borrarlo para no perder el diagnóstico.
  let salida = "";
  try {
    salida = readFileSync(temporal, "utf8").trim();
  } catch {}
  if (salida) console.error(salida.slice(0, 2000));
  rmSync(temporal, { force: true });
  console.error(`db:gen-types: ${motivo}. ${destino} no se tocó.`);
  process.exit(1);
}

if (resultado.error) abortar(`no se pudo ejecutar el CLI (${resultado.error.message})`);
if (resultado.status !== 0) abortar(`el CLI terminó con código ${resultado.status}`);

const contenido = readFileSync(temporal, "utf8");
if (!contenido.includes("export type Database")) {
  abortar("la salida del CLI no contiene `export type Database`");
}

renameSync(temporal, destino);
console.error(`db:gen-types: ${destino} actualizado.`);
