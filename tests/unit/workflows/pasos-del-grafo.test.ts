import { describe, expect, test } from "vitest";
import { pasosDelGrafo } from "@/lib/workflows/pasos";
import type { Grafo, Nodo, Puerto } from "@/types/workflows";

/*
 * La pantalla de un workflow tiene que mostrar el grafo sin dibujarlo. El
 * recorrido no es trivial por dos motivos que el propio dominio ya declara:
 *
 *   - un `condicion` tiene DOS salidas (`verdadero` y `falso`), así que el
 *     grafo se abre en árbol y no en lista;
 *   - `ciclo_sin_espera` es una de las siete reglas de validación, o sea que
 *     los ciclos existen y son legales cuando hay una espera en el medio. Un
 *     recorrido ingenuo se cuelga.
 *
 * Y los nodos inalcanzables tienen que verse igual: son una regla de
 * validación (`nodo_inalcanzable`), y esconderlos sería esconder el error.
 */
const nodo = (id: string, tipo: Nodo["tipo"]): Nodo => ({
  id,
  tipo,
  config: {},
  posicion: { x: 0, y: 0 },
});

const arista = (desde: string, hasta: string, puerto: Puerto = "salida") => ({
  desde,
  hasta,
  puerto,
});

describe("pasosDelGrafo", () => {
  test("un grafo vacío no tiene pasos ni huérfanos", () => {
    const r = pasosDelGrafo({ nodos: [], aristas: [] });

    expect(r.pasos).toEqual([]);
    expect(r.inalcanzables).toEqual([]);
  });

  test("una cadena simple sale en orden y con profundidad creciente", () => {
    const grafo: Grafo = {
      nodos: [nodo("d", "disparador"), nodo("a", "accion"), nodo("f", "fin")],
      aristas: [arista("d", "a"), arista("a", "f")],
    };

    const { pasos } = pasosDelGrafo(grafo);

    expect(pasos.map((p) => p.nodo.id)).toEqual(["d", "a", "f"]);
    expect(pasos.map((p) => p.profundidad)).toEqual([0, 1, 2]);
  });

  test("al disparador se llega sin puerto", () => {
    const grafo: Grafo = { nodos: [nodo("d", "disparador")], aristas: [] };

    expect(pasosDelGrafo(grafo).pasos[0]?.puerto).toBeNull();
  });

  test("una condición abre sus dos ramas y marca por qué puerto se llegó", () => {
    const grafo: Grafo = {
      nodos: [
        nodo("d", "disparador"),
        nodo("c", "condicion"),
        nodo("si", "accion"),
        nodo("no", "fin"),
      ],
      aristas: [arista("d", "c"), arista("c", "si", "verdadero"), arista("c", "no", "falso")],
    };

    const { pasos } = pasosDelGrafo(grafo);

    expect(pasos.map((p) => p.nodo.id)).toEqual(["d", "c", "si", "no"]);
    expect(pasos.find((p) => p.nodo.id === "si")?.puerto).toBe("verdadero");
    expect(pasos.find((p) => p.nodo.id === "no")?.puerto).toBe("falso");
    // Las dos ramas cuelgan de la condición: misma profundidad.
    expect(pasos.find((p) => p.nodo.id === "si")?.profundidad).toBe(2);
    expect(pasos.find((p) => p.nodo.id === "no")?.profundidad).toBe(2);
  });

  test("un ciclo no cuelga: el nodo que vuelve se marca repetido y ahí corta", () => {
    // Legal cuando hay una espera en el medio — `ciclo_sin_espera` es la regla
    // que prohíbe el otro caso, no este.
    const grafo: Grafo = {
      nodos: [nodo("d", "disparador"), nodo("e", "espera"), nodo("a", "accion")],
      aristas: [arista("d", "e"), arista("e", "a"), arista("a", "e")],
    };

    const { pasos } = pasosDelGrafo(grafo);

    expect(pasos.map((p) => p.nodo.id)).toEqual(["d", "e", "a", "e"]);
    expect(pasos.at(-1)?.repetido).toBe(true);
    expect(pasos.filter((p) => !p.repetido)).toHaveLength(3);
  });

  test("los nodos a los que no se llega se devuelven aparte", () => {
    // `nodo_inalcanzable` es una regla de validación: esconderlos escondería
    // el error que el usuario tiene que corregir.
    const grafo: Grafo = {
      nodos: [nodo("d", "disparador"), nodo("a", "accion"), nodo("suelto", "accion")],
      aristas: [arista("d", "a")],
    };

    const r = pasosDelGrafo(grafo);

    expect(r.pasos.map((p) => p.nodo.id)).toEqual(["d", "a"]);
    expect(r.inalcanzables.map((n) => n.id)).toEqual(["suelto"]);
  });

  test("sin disparador todo queda como inalcanzable en vez de perderse", () => {
    const grafo: Grafo = {
      nodos: [nodo("a", "accion"), nodo("f", "fin")],
      aristas: [arista("a", "f")],
    };

    const r = pasosDelGrafo(grafo);

    expect(r.pasos).toEqual([]);
    expect(r.inalcanzables.map((n) => n.id)).toEqual(["a", "f"]);
  });

  test("una arista que apunta a un nodo que no existe no rompe el recorrido", () => {
    // `arista_a_nodo_inexistente` es otra de las siete reglas: el grafo puede
    // estar roto y la pantalla igual tiene que dibujarse para poder arreglarlo.
    const grafo: Grafo = {
      nodos: [nodo("d", "disparador")],
      aristas: [arista("d", "fantasma")],
    };

    expect(pasosDelGrafo(grafo).pasos.map((p) => p.nodo.id)).toEqual(["d"]);
  });
});
