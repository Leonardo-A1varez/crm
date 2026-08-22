import type { Arista, Grafo, Nodo, NodoTipo, Puerto } from "@/types/workflows";

export function nodo(id: string, tipo: NodoTipo): Nodo {
  return { id, tipo, config: {}, posicion: { x: 0, y: 0 } };
}

export function arista(desde: string, hasta: string, puerto: Puerto = "salida"): Arista {
  return { desde, hasta, puerto };
}

export function grafo(nodos: Nodo[], aristas: Arista[]): Grafo {
  return { nodos, aristas };
}

/**
 * Grafo mínimo válido: disparador → acción → fin.
 * Cada test parte de acá y rompe UNA cosa, para que el problema reportado
 * sea inequívocamente el de esa regla.
 */
export function grafoValido(): Grafo {
  return grafo(
    [nodo("d", "disparador"), nodo("a", "accion"), nodo("f", "fin")],
    [arista("d", "a"), arista("a", "f")],
  );
}
