import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ESPEC_CONFIG_POR_TIPO, LISTA_VARIABLES_DE_TEXTO } from "@/lib/workflows/config-nodos";

/**
 * Los ejemplos que ve quien arma un flujo —los textos que un bloque trae
 * escritos y los placeholders de los formularios— sólo usan variables que el
 * motor resuelve. Los bloques de IA arrancaban con `{{contexto.mensaje}}`, que
 * nada carga: el ejemplo enseñaba a escribir un hueco.
 */

const VARIABLE = /\{\{(\w+\.\w+)\}\}/g;
const CONOCIDAS = new Set<string>(LISTA_VARIABLES_DE_TEXTO);

function variablesDe(texto: string): string[] {
  return [...texto.matchAll(VARIABLE)].map((m) => m[1]!);
}

describe("variables en los ejemplos", () => {
  it("ningún texto que un bloque trae por defecto usa una variable que no se resuelve", () => {
    const malas: string[] = [];
    for (const [tipo, espec] of Object.entries(ESPEC_CONFIG_POR_TIPO)) {
      for (const [clave, campo] of Object.entries(espec.schema.shape)) {
        const porDefecto = z.safeParse(campo as z.ZodType, undefined);
        if (!porDefecto.success || typeof porDefecto.data !== "string") continue;
        for (const v of variablesDe(porDefecto.data)) {
          if (!CONOCIDAS.has(v)) malas.push(`${tipo}.${clave}: {{${v}}}`);
        }
      }
    }
    expect(malas).toEqual([]);
  });

  it("ningún formulario del panel muestra de ejemplo una variable que no se resuelve", () => {
    const dir = join(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "components",
      "workflows",
      "canvas",
      "config",
    );
    const malas: string[] = [];
    for (const archivo of readdirSync(dir).filter((a) => a.endsWith(".tsx"))) {
      for (const v of variablesDe(readFileSync(join(dir, archivo), "utf8"))) {
        if (!CONOCIDAS.has(v)) malas.push(`${archivo}: {{${v}}}`);
      }
    }
    expect(malas).toEqual([]);
  });
});
