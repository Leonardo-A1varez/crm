import { describe, expect, test } from "vitest";
import { nombreVisible, sinNombre } from "@/lib/ui/lead";

describe("nombreVisible", () => {
  test("devuelve el nombre trimeado cuando lo hay", () => {
    expect(nombreVisible("  Ramón Díaz  ")).toBe("Ramón Díaz");
  });

  test("nombra el hueco en vez de dejar la fila en blanco", () => {
    expect(nombreVisible("")).toBe("Sin nombre");
    expect(nombreVisible("   ")).toBe("Sin nombre");
  });
});

describe("sinNombre", () => {
  test("solo espacios cuenta como sin identificar", () => {
    expect(sinNombre("")).toBe(true);
    expect(sinNombre("\t \n")).toBe(true);
    expect(sinNombre("Ramón")).toBe(false);
  });
});
