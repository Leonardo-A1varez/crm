import { describe, expect, it } from "vitest";
import type { Grupo } from "@/lib/ui/condiciones";
import { presentacionDe } from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import type { Nodo } from "@/types/workflows";

// Ids y nombres armados a mano para el test: no salen de ningún dato real.
const ARBOL: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "sesion.intent",
      comparador: "es",
      valor: { tipo: "opcion", valor: "intent-precio" },
    },
    {
      id: "r2",
      clase: "regla",
      campoId: "lead.etiquetas",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["tag-factura"] },
    },
  ],
};

const NODO: Nodo = {
  id: "c",
  tipo: "logica_condicion",
  config: { arbol: ARBOL },
  posicion: { x: 0, y: 0 },
};

describe("el nodo de condición nombra intents y etiquetas", () => {
  it("con los catálogos, dice el nombre real", () => {
    const p = presentacionDe(NODO, {
      intents: [{ id: "intent-precio", nombre: "Pide precio" }],
      etiquetas: [{ id: "tag-factura", nombre: "Pide factura" }],
    });
    expect(p.resumen).toContain("Pide precio");
    expect(p.resumen).toContain("Pide factura");
    expect(p.resumen).not.toContain("un intent");
  });

  it("sin catálogos, no inventa: dice «un intent» y «1 etiqueta»", () => {
    const p = presentacionDe(NODO);
    expect(p.resumen).toContain("un intent");
    expect(p.resumen).toContain("1 etiqueta");
  });
});
