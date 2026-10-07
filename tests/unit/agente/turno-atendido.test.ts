import { describe, expect, test } from "vitest";
import { busquedaConResultados } from "@/lib/agente/escalado";

// Un turno donde el agente buscó en el catálogo y encontró algo está atendido: no
// cuenta como «intent desconocido» para el auto-handoff (§4.2).

const match = { id: "x", codigo_interno: "B-1", nombre: "BOMBA", precio: 10, stock: 1 };

describe("busquedaConResultados", () => {
  test("buscar_repuesto con al menos un candidato", () => {
    expect(busquedaConResultados("buscar_repuesto", { matches: [match], count: 1 }, null)).toBe(
      true,
    );
  });

  test("count > 0 alcanza aunque matches no venga (fila vieja de la auditoría)", () => {
    expect(busquedaConResultados("buscar_repuesto", { count: 3 }, null)).toBe(true);
  });

  test("sin candidatos no está atendido", () => {
    expect(busquedaConResultados("buscar_repuesto", { matches: [], count: 0 }, null)).toBe(false);
  });

  test("una búsqueda que falló no está atendida, aunque traiga un resultado", () => {
    expect(busquedaConResultados("buscar_repuesto", { matches: [match], count: 1 }, "boom")).toBe(
      false,
    );
  });

  test("otra herramienta no cuenta", () => {
    expect(busquedaConResultados("otra", { matches: [match], count: 1 }, null)).toBe(false);
  });

  test.each([null, undefined, "texto", 5, [], {}, { count: "2" }, { count: -1 }, { matches: "x" }])(
    "un resultado que no tiene la forma esperada (%j) no cuenta",
    (r) => {
      expect(busquedaConResultados("buscar_repuesto", r, null)).toBe(false);
    },
  );
});
