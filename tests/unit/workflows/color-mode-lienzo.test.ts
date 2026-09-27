import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorModeDelTema } from "@/components/workflows/editor/color-mode-lienzo";

describe("colorMode del lienzo", () => {
  it("sigue el tema resuelto de la app", () => {
    expect(colorModeDelTema("light", true)).toBe("light");
    expect(colorModeDelTema("dark", true)).toBe("dark");
  });

  it("antes de montar adivina lo mismo que el server: el default oscuro", () => {
    expect(colorModeDelTema("light", false)).toBe("dark");
    expect(colorModeDelTema(undefined, false)).toBe("dark");
  });

  it("nunca devuelve `system`: la app no sigue al sistema operativo", () => {
    expect(colorModeDelTema("system", true)).toBe("dark");
  });
});

describe("variables de React Flow en globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const declaraciones = [...css.matchAll(/(--xy-[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, nombre, valor]) => ({ nombre: nombre!, valor: valor!.trim() }),
  );

  it("fondo, grilla, minimapa y controles están redefinidos", () => {
    const nombres = declaraciones.map((d) => d.nombre);
    for (const clave of [
      "--xy-background-color",
      "--xy-background-pattern-color",
      "--xy-minimap-background-color",
      "--xy-minimap-mask-background-color",
      "--xy-controls-button-background-color",
      "--xy-controls-button-color",
    ]) {
      expect(nombres).toContain(clave);
    }
  });

  it("ningún color es literal: todos salen de un token del tema", () => {
    const literales = declaraciones.filter((d) =>
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i.test(d.valor),
    );
    expect(literales).toEqual([]);
  });
});
