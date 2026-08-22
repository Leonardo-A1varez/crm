import type { Grafo, Nodo, Puerto } from "@/types/workflows";

export function nodoPorId(grafo: Grafo, id: string): Nodo | undefined {
  return grafo.nodos.find((n) => n.id === id);
}

export function disparadorDe(grafo: Grafo): Nodo | undefined {
  return grafo.nodos.find((n) => n.tipo === "disparador");
}

/**
 * Cuál nodo sigue al salir de `nodoId` por `puerto`.
 *
 * `undefined` significa que el puerto no tiene arista. En un grafo que pasó el
 * validador eso sólo puede pasar en un `fin`, que no tiene puertos: el resto
 * los tiene todos conectados por la regla `salida_sin_conectar`.
 */
export function siguienteNodo(grafo: Grafo, nodoId: string, puerto: Puerto): string | undefined {
  return grafo.aristas.find((a) => a.desde === nodoId && a.puerto === puerto)?.hasta;
}
