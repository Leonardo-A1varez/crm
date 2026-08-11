import { describe, expect, test } from "vitest";
import { filtrarOpciones, normalizarBusqueda } from "@/lib/ui/selector-buscable";

const VEHICULOS = [
  { texto: "Citroën C3 2016" },
  { texto: "Peugeot 208 2020" },
  { texto: "Toyota Corolla 2018" },
];

describe("normalizarBusqueda", () => {
  test("ignora mayúsculas, espacios de borde y tildes", () => {
    expect(normalizarBusqueda("  Citroën ")).toBe("citroen");
    expect(normalizarBusqueda("FRÍO")).toBe("frio");
  });
});

describe("filtrarOpciones", () => {
  test("sin consulta devuelve la lista entera en su orden", () => {
    expect(filtrarOpciones(VEHICULOS, "   ").map((o) => o.texto)).toEqual(
      VEHICULOS.map((o) => o.texto),
    );
  });

  test("busca por cualquier parte del texto, incluido el año", () => {
    expect(filtrarOpciones(VEHICULOS, "corolla").map((o) => o.texto)).toEqual([
      "Toyota Corolla 2018",
    ]);
    // El año es lo que el `<select>` viejo no dejaba buscar: era otra columna.
    expect(filtrarOpciones(VEHICULOS, "2020").map((o) => o.texto)).toEqual(["Peugeot 208 2020"]);
  });

  test("encuentra sin acertar la tilde", () => {
    expect(filtrarOpciones(VEHICULOS, "citroen").map((o) => o.texto)).toEqual(["Citroën C3 2016"]);
  });

  test("lo que no coincide con nada devuelve vacío, no la lista entera", () => {
    expect(filtrarOpciones(VEHICULOS, "ferrari")).toEqual([]);
  });
});
