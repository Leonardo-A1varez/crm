import { describe, expect, it } from "vitest";
import { COLORES_ATENCION, TRAMOS_RAMPA, escalaSecuencial } from "@/lib/ui/metricas";

/**
 * Las escalas de color de los repartos de `/metricas`.
 *
 * Lo que estos tests protegen NO son los números de contraste —eso lo mide
 * `node scripts/verificar-paleta-clara.mjs`, que simula daltonismo y falla la
 * corrida si una escala se rompe— sino el contrato estructural: que ninguna
 * escala vuelva a meter `--color-brand` ni un `--stage-*` entre los tokens
 * semánticos, que era el defecto exacto de `COLORES_RAZON`.
 */
describe("COLORES_ATENCION", () => {
  const colores = Object.values(COLORES_ATENCION);

  it("son tres tokens semánticos distintos", () => {
    expect(colores).toHaveLength(3);
    expect(new Set(colores).size).toBe(3);
  });

  /**
   * La regla que se rompió: la barra mezclaba la marca y un color de etapa con
   * los semánticos. Las tres paletas están congeladas de a una, así que ningún
   * ajuste de token podía separarlas; la única salida era que el consumidor
   * dejara de mezclarlas.
   */
  it("no incluye la marca ni ningún color de etapa del embudo", () => {
    for (const color of colores) {
      expect(color).not.toContain("--color-brand");
      expect(color).not.toContain("--stage-");
      expect(color).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });
});

describe("escalaSecuencial", () => {
  it("va de más fuerte a más suave, sin repetir un tramo", () => {
    const escala = escalaSecuencial(4);
    expect(escala).toHaveLength(4);
    expect(new Set(escala).size).toBe(4);

    const alfas = escala.map((c) => Number(/ (\d+)%/.exec(c)?.[1]));
    expect(alfas[0]).toBe(100);
    for (let i = 0; i + 1 < alfas.length; i++) {
      expect(alfas[i + 1]).toBeLessThan(alfas[i] as number);
    }
  });

  it("un solo tramo es el tono puro, sin mezcla", () => {
    expect(escalaSecuencial(1)).toEqual(["var(--color-info)"]);
  });

  /**
   * El tope no es estético: al sexto tramo dos contiguos se separan 6,5 en CVD
   * y dejan de distinguirse (el objetivo es 8). Pedir más devuelve el máximo en
   * vez de generar tramos que nadie puede leer, y el consumidor agrupa la cola.
   */
  it("no pasa de TRAMOS_RAMPA aunque le pidan más", () => {
    expect(escalaSecuencial(TRAMOS_RAMPA + 4)).toHaveLength(TRAMOS_RAMPA);
    expect(escalaSecuencial(0)).toHaveLength(1);
  });

  it("mezcla contra transparente, no contra una superficie fija", () => {
    for (const color of escalaSecuencial(TRAMOS_RAMPA)) {
      expect(color === "var(--color-info)" || color.includes("transparent")).toBe(true);
      expect(color).not.toContain("--color-brand");
    }
  });

  it("acepta otro tono sin dejar de ser una rampa de UN solo tono", () => {
    const escala = escalaSecuencial(3, "var(--color-special)");
    expect(escala.every((c) => c.includes("--color-special"))).toBe(true);
  });
});
