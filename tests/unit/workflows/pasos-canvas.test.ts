import { describe, expect, it } from "vitest";
import { pasosDelGrafo, resumenPasos } from "@/lib/workflows/pasos";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/**
 * La lectura del grafo busca el disparador con el mismo `disparadorDe` que el
 * motor. Con su búsqueda propia del literal legacy, un grafo del canvas se
 * mostraba entero como "inalcanzable" y la card del listado decía "Todavía no
 * tiene pasos" de un flujo que sí los tenía.
 */
describe("pasosDelGrafo — grafo del canvas", () => {
  const grafo: Grafo = {
    nodos: [
      nodo("t", "trigger_mensaje"),
      nodo("m", "msg_texto", { mensaje: "hola" }),
      nodo("f", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "m", puerto: "salida" },
      { desde: "m", hasta: "f", puerto: "salida" },
    ],
  };

  it("se recorre desde su trigger_*", () => {
    const lectura = pasosDelGrafo(grafo);
    expect(lectura.pasos.map((p) => p.nodo.id)).toEqual(["t", "m", "f"]);
    expect(lectura.inalcanzables).toEqual([]);
  });

  it("el resumen de la card nombra los pasos del canvas", () => {
    expect(resumenPasos(grafo)).toEqual(["Mensaje recibido", "Enviar mensaje", "Detener"]);
  });
});
