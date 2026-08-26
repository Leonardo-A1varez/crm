import { describe, expect, test } from "vitest";
import { resumenPasos } from "@/lib/workflows/pasos";
import type { Grafo, Nodo, Puerto } from "@/types/workflows";

const nodo = (id: string, tipo: Nodo["tipo"], config: Record<string, unknown> = {}): Nodo => ({
  id,
  tipo,
  config,
  posicion: { x: 0, y: 0 },
});

const arista = (desde: string, hasta: string, puerto: Puerto = "salida") => ({
  desde,
  hasta,
  puerto,
});

describe("resumenPasos", () => {
  test("un disparador y una accion conocidos se leen en español, no como el string crudo", () => {
    const grafo: Grafo = {
      nodos: [
        nodo("d", "disparador", { disparador: "mensaje_recibido" }),
        nodo("a", "accion", { accion: "enviar_mensaje" }),
        nodo("f", "fin"),
      ],
      aristas: [arista("d", "a"), arista("a", "f")],
    };

    expect(resumenPasos(grafo)).toEqual(["Llega un mensaje", "Enviar un mensaje", "Fin"]);
  });

  test("un disparador o accion con un valor desconocido cae al nombre genérico del tipo de nodo", () => {
    const grafo: Grafo = {
      nodos: [
        nodo("d", "disparador", { disparador: "algo_que_todavia_no_existe" }),
        nodo("a", "accion", { accion: "algo_inventado" }),
      ],
      aristas: [arista("d", "a")],
    };

    expect(resumenPasos(grafo)).toEqual(["Disparador", "Acción"]);
  });

  test("respeta el tope `max` sin recorrer el resto del grafo", () => {
    const grafo: Grafo = {
      nodos: [
        nodo("d", "disparador"),
        nodo("a1", "accion"),
        nodo("a2", "accion"),
        nodo("a3", "accion"),
      ],
      aristas: [arista("d", "a1"), arista("a1", "a2"), arista("a2", "a3")],
    };

    expect(resumenPasos(grafo, 2)).toEqual(["Disparador", "Acción"]);
  });

  test("un grafo sin disparador (todo inalcanzable) da una lista vacía", () => {
    const grafo: Grafo = { nodos: [nodo("a", "accion")], aristas: [] };

    expect(resumenPasos(grafo)).toEqual([]);
  });
});
