import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import type { Grupo, NodoCondicion } from "@/lib/ui/condiciones";
import { AudienciaSchema, validarAudiencia } from "@/lib/validation/difusion.schema";

// Árbol de prueba, armado a mano para este test: no sale de ningún dato real.
const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "etapa",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["cotizado", "negociando"] },
    },
    {
      id: "r2",
      clase: "regla",
      campoId: "ultima_actividad",
      comparador: "mayor_que",
      valor: { tipo: "numero", valor: 45 },
    },
    {
      id: "g1",
      clase: "grupo",
      operador: "o",
      hijos: [
        {
          id: "r3",
          clase: "regla",
          campoId: "vehiculo",
          comparador: "contiene",
          valor: { tipo: "texto", valor: "Aveo" },
        },
        {
          id: "r4",
          clase: "regla",
          campoId: "campo_twin",
          comparador: "esta_vacio",
          valor: { tipo: "ninguno" },
        },
      ],
    },
  ],
};

function regla(id: string): NodoCondicion {
  return {
    id,
    clase: "regla",
    campoId: "vehiculo",
    comparador: "contiene",
    valor: { tipo: "texto", valor: "x" },
  };
}

describe("AudienciaSchema", () => {
  test("acepta el árbol de condiciones y lo devuelve igual", () => {
    expect(validarAudiencia(structuredClone(ARBOL))).toEqual(ARBOL);
  });

  // Un borrador puede guardarse a medio armar; que esté completa lo exige el
  // planificador antes de mandar, no el guardado.
  test("acepta una fila a medio terminar", () => {
    const borrador: Grupo = {
      id: "raiz",
      clase: "grupo",
      operador: "y",
      hijos: [
        { id: "r", clase: "regla", campoId: null, comparador: null, valor: { tipo: "ninguno" } },
      ],
    };
    expect(validarAudiencia(borrador)).toEqual(borrador);
  });

  test("rechaza una raíz que no es grupo", () => {
    expect(AudienciaSchema.safeParse(regla("r")).success).toBe(false);
  });

  // PROFUNDIDAD_MAX = 3 en `condiciones.ts`: la interfaz no deja crear el
  // cuarto nivel, pero un árbol que llega de afuera no pasó por la interfaz.
  test("rechaza un cuarto nivel de anidado", () => {
    const profundo: Grupo = {
      id: "n1",
      clase: "grupo",
      operador: "y",
      hijos: [
        {
          id: "n2",
          clase: "grupo",
          operador: "o",
          hijos: [
            {
              id: "n3",
              clase: "grupo",
              operador: "y",
              hijos: [{ id: "n4", clase: "grupo", operador: "o", hijos: [regla("r")] }],
            },
          ],
        },
      ],
    };
    expect(AudienciaSchema.safeParse(profundo).success).toBe(false);
  });

  test("acepta exactamente tres niveles", () => {
    const tres: Grupo = {
      id: "n1",
      clase: "grupo",
      operador: "y",
      hijos: [
        {
          id: "n2",
          clase: "grupo",
          operador: "o",
          hijos: [{ id: "n3", clase: "grupo", operador: "y", hijos: [regla("r")] }],
        },
      ],
    };
    expect(AudienciaSchema.safeParse(tres).success).toBe(true);
  });

  test("rechaza un comparador que no existe", () => {
    const malo = structuredClone(ARBOL) as unknown as { hijos: { comparador: string }[] };
    malo.hijos[0]!.comparador = "parece";
    expect(AudienciaSchema.safeParse(malo).success).toBe(false);
  });

  test("rechaza un valor cuyo contenido no corresponde a su tipo", () => {
    const malo = structuredClone(ARBOL) as unknown as { hijos: { valor: unknown }[] };
    malo.hijos[1]!.valor = { tipo: "numero", valor: "45" };
    expect(AudienciaSchema.safeParse(malo).success).toBe(false);
  });

  test("rechaza un número no finito", () => {
    const malo = structuredClone(ARBOL) as unknown as { hijos: { valor: unknown }[] };
    malo.hijos[1]!.valor = { tipo: "numero", valor: Number.POSITIVE_INFINITY };
    expect(AudienciaSchema.safeParse(malo).success).toBe(false);
  });

  // Un campo que el modelo no conoce se rechaza en vez de descartarse callado:
  // si el árbol compartido crece, este schema tiene que crecer con él.
  test("rechaza una propiedad que el modelo no tiene", () => {
    const malo = { ...structuredClone(ARBOL), negado: true };
    expect(AudienciaSchema.safeParse(malo).success).toBe(false);
  });

  test("rechaza más de 50 filas", () => {
    const enorme: Grupo = {
      id: "raiz",
      clase: "grupo",
      operador: "o",
      hijos: Array.from({ length: 51 }, (_, i) => regla(`r${i}`)),
    };
    expect(AudienciaSchema.safeParse(enorme).success).toBe(false);
  });

  test("validarAudiencia lanza ValidationError con el detalle", () => {
    expect(() => validarAudiencia({ clase: "grupo" })).toThrow(ValidationError);
  });
});
