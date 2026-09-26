import { describe, expect, it } from "vitest";
import {
  CAMPOS_DE_CONDICION,
  camposDeCondicion,
  resumenDeCondicion,
} from "@/app/(panel)/workflows/[id]/_lib/campos-condicion";
import type { Grupo } from "@/lib/ui/condiciones";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
const CATALOGOS = {
  intents: [{ id: "i1", nombre: "consulta_producto", activo: true }],
  etiquetas: [{ id: "t1", nombre: "Mayorista", color: "#aa3300" }],
};

const ARBOL: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "a",
      clase: "regla",
      campoId: "sesion.intent",
      comparador: "es",
      valor: { tipo: "opcion", valor: "i1" },
    },
    {
      id: "b",
      clase: "regla",
      campoId: "lead.etiquetas",
      comparador: "no_tiene",
      valor: { tipo: "opciones", valores: ["t1"] },
    },
  ],
};

describe("los campos de la condición con sus catálogos", () => {
  it("intent y etiquetas ofrecen las filas de la base, con su nombre y color", () => {
    const campos = camposDeCondicion(CATALOGOS);
    expect(campos.find((c) => c.id === "sesion.intent")).toMatchObject({
      etiqueta: "Intent detectado",
      tipo: "lista",
      opciones: [{ valor: "i1", etiqueta: "consulta_producto" }],
    });
    expect(campos.find((c) => c.id === "lead.etiquetas")).toMatchObject({
      etiqueta: "Etiquetas del lead",
      tipo: "multilista",
      opciones: [{ valor: "t1", etiqueta: "Mayorista", color: "#aa3300" }],
    });
    expect(campos.find((c) => c.id === "vehiculo.marca")).toMatchObject({
      etiqueta: "Marca del vehículo",
      grupo: "Vehículo",
      tipo: "texto",
    });
    expect(campos.find((c) => c.id === "lead.ultimo_mensaje")).toMatchObject({
      tipo: "fecha",
      unidad: "días",
    });
  });

  it("sin catálogos cargados, intent y etiquetas quedan sin opciones, no con inventadas", () => {
    expect(CAMPOS_DE_CONDICION.find((c) => c.id === "sesion.intent")?.opciones).toEqual([]);
  });

  it("la frase usa los nombres si los tiene, y si no dice cuántas sin mostrar ids", () => {
    expect(resumenDeCondicion(ARBOL, CATALOGOS)).toBe(
      "Intent detectado es consulta_producto y Etiquetas del lead no tiene Mayorista",
    );
    expect(resumenDeCondicion(ARBOL)).toBe(
      "Intent detectado es un intent y Etiquetas del lead no tiene 1 etiqueta",
    );
  });
});
