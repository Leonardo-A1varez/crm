import { describe, expect, it } from "vitest";
import { disparadorDe, nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import type { Grafo } from "@/types/workflows";

const grafo: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "c", tipo: "condicion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "si", tipo: "accion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "no", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "c", puerto: "salida" },
    { desde: "c", hasta: "si", puerto: "verdadero" },
    { desde: "c", hasta: "no", puerto: "falso" },
  ],
};

describe("recorrer", () => {
  it("sigue el puerto que se le pide, no el primero que encuentra", () => {
    expect(siguienteNodo(grafo, "c", "verdadero")).toBe("si");
    expect(siguienteNodo(grafo, "c", "falso")).toBe("no");
  });

  it("devuelve undefined cuando el puerto no tiene arista", () => {
    expect(siguienteNodo(grafo, "no", "salida")).toBeUndefined();
  });

  it("encuentra el nodo por id y el disparador", () => {
    expect(nodoPorId(grafo, "si")?.tipo).toBe("accion");
    expect(nodoPorId(grafo, "nope")).toBeUndefined();
    expect(disparadorDe(grafo)?.id).toBe("d");
  });
});
