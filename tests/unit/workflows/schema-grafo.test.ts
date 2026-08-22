import { describe, expect, it } from "vitest";
import { GrafoSchema } from "@/lib/validation/workflows.schema";

const nodoMinimo = {
  id: "n1",
  tipo: "disparador",
  config: {},
  posicion: { x: 0, y: 0 },
};

describe("GrafoSchema", () => {
  it("acepta un grafo con la forma correcta", () => {
    const r = GrafoSchema.safeParse({
      nodos: [nodoMinimo],
      aristas: [{ desde: "n1", hasta: "n2", puerto: "salida" }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza un tipo de nodo que no existe", () => {
    const r = GrafoSchema.safeParse({
      nodos: [{ ...nodoMinimo, tipo: "inventado" }],
      aristas: [],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un puerto que no existe", () => {
    const r = GrafoSchema.safeParse({
      nodos: [nodoMinimo],
      aristas: [{ desde: "n1", hasta: "n2", puerto: "quiza" }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un id de nodo vacio: las aristas lo referencian y un id vacio los vuelve ambiguos", () => {
    const r = GrafoSchema.safeParse({ nodos: [{ ...nodoMinimo, id: "" }], aristas: [] });
    expect(r.success).toBe(false);
  });

  it("acepta config con cualquier forma: la validacion por tipo de nodo es de W3", () => {
    const r = GrafoSchema.safeParse({
      nodos: [{ ...nodoMinimo, config: { loQueSea: 1, anidado: { x: true } } }],
      aristas: [],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza un grafo con mas de 200 nodos: un canvas armado a mano no llega a eso", () => {
    const nodos = Array.from({ length: 201 }, (_, i) => ({ ...nodoMinimo, id: `n${i}` }));
    const r = GrafoSchema.safeParse({ nodos, aristas: [] });
    expect(r.success).toBe(false);
  });

  it("rechaza un grafo con mas de 500 aristas", () => {
    const aristas = Array.from({ length: 501 }, (_, i) => ({
      desde: "n1",
      hasta: `destino${i}`,
      puerto: "salida" as const,
    }));
    const r = GrafoSchema.safeParse({ nodos: [nodoMinimo], aristas });
    expect(r.success).toBe(false);
  });
});
