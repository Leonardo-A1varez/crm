import type { Grafo, Nodo, Puerto } from "@/types/workflows";

/**
 * El grafo de un workflow leído como una lista de pasos encadenados.
 *
 * Es lo que permite mostrar un workflow sin dibujarlo. El recorrido tiene tres
 * complicaciones que no son de esta función sino del dominio, y por eso están
 * acá y no en el componente:
 *
 *   - un `condicion` tiene DOS salidas, así que el grafo se abre en árbol;
 *   - los ciclos son legales cuando hay una espera en el medio (`ciclo_sin_espera`
 *     prohíbe solo el caso sin espera), así que un recorrido ingenuo se cuelga;
 *   - el grafo puede estar roto —aristas a nodos que no existen, nodos
 *     inalcanzables— y la pantalla igual tiene que dibujarse, porque es donde
 *     el usuario va a ir a arreglarlo.
 */

/** El orden en que se recorren las salidas de un nodo. */
const ORDEN_PUERTOS: readonly Puerto[] = ["salida", "verdadero", "falso"];

export interface PasoDelGrafo {
  nodo: Nodo;
  /** Cuántos saltos desde el disparador. Es la sangría de la lista. */
  profundidad: number;
  /** Por qué salida del nodo anterior se llegó. `null` en el disparador. */
  puerto: Puerto | null;
  /**
   * `true` cuando este nodo ya apareció antes en el recorrido: se lista para
   * que se vea que el flujo vuelve ahí, pero no se sigue.
   */
  repetido: boolean;
}

export interface LecturaDelGrafo {
  /** Los nodos alcanzables desde el disparador, en orden de recorrido. */
  pasos: PasoDelGrafo[];
  /**
   * Los que quedaron sueltos. Se devuelven aparte en vez de descartarse:
   * `nodo_inalcanzable` es una de las siete reglas de validación y esconderlos
   * sería esconder el error.
   */
  inalcanzables: Nodo[];
}

export function pasosDelGrafo(grafo: Grafo): LecturaDelGrafo {
  const porId = new Map(grafo.nodos.map((n) => [n.id, n]));
  const raiz = grafo.nodos.find((n) => n.tipo === "disparador");

  if (!raiz) {
    // Sin disparador no hay por dónde empezar. Todo queda como inalcanzable en
    // vez de devolver vacío: el usuario tiene que ver los nodos que cargó.
    return { pasos: [], inalcanzables: [...grafo.nodos] };
  }

  const pasos: PasoDelGrafo[] = [];
  const visitados = new Set<string>();

  const recorrer = (nodo: Nodo, profundidad: number, puerto: Puerto | null): void => {
    if (visitados.has(nodo.id)) {
      pasos.push({ nodo, profundidad, puerto, repetido: true });
      return;
    }
    visitados.add(nodo.id);
    pasos.push({ nodo, profundidad, puerto, repetido: false });

    const salientes = grafo.aristas
      .filter((a) => a.desde === nodo.id)
      .sort((a, b) => ORDEN_PUERTOS.indexOf(a.puerto) - ORDEN_PUERTOS.indexOf(b.puerto));

    for (const arista of salientes) {
      const destino = porId.get(arista.hasta);
      // Arista colgada (`arista_a_nodo_inexistente`): se ignora en el recorrido
      // y la reporta la validación, que es quien sabe explicarla.
      if (destino) recorrer(destino, profundidad + 1, arista.puerto);
    }
  };

  recorrer(raiz, 0, null);

  return {
    pasos,
    inalcanzables: grafo.nodos.filter((n) => !visitados.has(n.id)),
  };
}
