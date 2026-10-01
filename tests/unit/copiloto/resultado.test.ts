import { describe, expect, test } from "vitest";
import { resolverResultadoRegenerado } from "@/lib/copiloto/resultado";

describe("resolverResultadoRegenerado", () => {
  test("una respuesta del LLM es un borrador listo con origen ia", () => {
    expect(resolverResultadoRegenerado({ source: "llm", respuesta_contenido: "Hola" }, 0)).toEqual({
      tipo: "listo",
      contenido: "Hola",
      origen: "ia",
      reglaId: null,
    });
  });

  test("una regla lleva su id y origen regla", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "rule", respuesta_contenido: "Abrimos de 9 a 18", regla_id: "r-1" },
        0,
      ),
    ).toEqual({ tipo: "listo", contenido: "Abrimos de 9 a 18", origen: "regla", reglaId: "r-1" });
  });

  test("handoff (IA pausada o escalada): error ia_no_disponible, no un borrador", () => {
    expect(
      resolverResultadoRegenerado({ source: "handoff", respuesta_contenido: "IA pausada" }, 0),
    ).toEqual({ tipo: "error", codigo: "ia_no_disponible" });
  });

  test("handoff por escalada (soloRedactar): error escalado, distinto de ia_no_disponible", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "handoff", respuesta_contenido: "Palabra sensible", escalada: true },
        0,
      ),
    ).toEqual({ tipo: "error", codigo: "escalado" });
  });

  test("un descuento por encima del tope es error descuento_excedido", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "llm", respuesta_contenido: "Te hago un 20% de descuento." },
        5,
      ),
    ).toEqual({ tipo: "error", codigo: "descuento_excedido" });
  });

  test("un descuento dentro del tope pasa", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "llm", respuesta_contenido: "Te hago un 5% de descuento." },
        5,
      ).tipo,
    ).toBe("listo");
  });
});
