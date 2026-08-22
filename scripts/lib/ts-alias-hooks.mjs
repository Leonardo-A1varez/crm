// Hook de resolución ESM (node:module) que le enseña a Node plano dos cosas
// que sólo Vite/TS conocen: el alias "@/*" -> "src/*" (tsconfig paths) y que
// un import relativo sin extensión ("./ejecutor.service") es un .ts.
//
// Sin esto ningún script en scripts/*.mjs puede importar código de src/,
// porque el type-stripping nativo de Node (22.18+, sin flag) borra las
// anotaciones de tipo pero no resuelve alias ni extensiones — eso es trabajo
// del bundler, y este proyecto no tiene tsx/ts-node/vite-node instalado.
//
// No agrega una dependencia: usa sólo las module customization hooks del
// propio Node (node:module `register`).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC_ROOT = pathToFileURL(path.resolve(process.cwd(), "src") + path.sep);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];
// `path.extname("ejecutor.service")` da ".service": los nombres de archivo
// del proyecto usan puntos como separador semántico (`.service`, `.repo`,
// `.schema`...), no sólo para la extensión. Sólo estas cuentan como "ya
// tiene extensión" — cualquier otra cosa con punto igual necesita el sufijo.
const YA_TIENE_EXTENSION = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);

function conExtension(url) {
  if (YA_TIENE_EXTENSION.has(path.extname(url.pathname))) return url;
  for (const ext of EXTENSIONS) {
    const candidato = new URL(url.href + ext);
    if (existsSync(fileURLToPath(candidato))) return candidato;
  }
  return url;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const url = conExtension(new URL(specifier.slice(2), SRC_ROOT));
    return nextResolve(url.href, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = new URL(specifier, context.parentURL);
    const url = conExtension(base);
    if (url.href !== base.href) return nextResolve(url.href, context);
  }
  return nextResolve(specifier, context);
}
