import { describe, expect, it } from "vitest";
import { describirFallo } from "@/lib/difusion/codigos-meta";

describe("describirFallo", () => {
  it("un código de la tabla de §4.4 trae qué significa y si se reintenta", () => {
    const baja = describirFallo("131050");
    expect(baja?.reintentable).toBe(false);
    expect(baja?.reintento).toMatch(/nunca/i);
    expect(baja?.significado).toMatch(/baja/i);
  });

  it("los reintentables de la tabla lo dicen", () => {
    for (const codigo of ["130429", "131056", "131064"]) {
      expect(describirFallo(codigo)?.reintentable).toBe(true);
    }
  });

  it("los que no se reintentan, también", () => {
    for (const codigo of [
      "131047",
      "131049",
      "131050",
      "131048",
      "132015",
      "132016",
      "368",
      "131031",
    ]) {
      expect(describirFallo(codigo)?.reintentable).toBe(false);
    }
  });

  it("pausada y deshabilitada se distinguen aunque la tabla las junte en una fila", () => {
    expect(describirFallo("132015")?.significado).not.toBe(describirFallo("132016")?.significado);
  });

  it("un código fuera de la tabla vuelve null: no se inventa qué significa", () => {
    expect(describirFallo("100")).toBeNull();
    expect(describirFallo("")).toBeNull();
  });
});
