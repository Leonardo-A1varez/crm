import type { Grafo, Nodo, Puerto } from "@/types/workflows";

export function nodoPorId(grafo: Grafo, id: string): Nodo | undefined {
  return grafo.nodos.find((n) => n.id === id);
}

export function disparadorDe(grafo: Grafo): Nodo | undefined {
  return grafo.nodos.find((n) => n.tipo === "disparador");
}

/**
 * El grafo dispara con este tipo de evento? El disparador vive como
 * `config["disparador"]` del nodo `tipo: "disparador"` -- mismo criterio que
 * `config["accion"]` en las acciones (`acciones/registro.ts`): un string
 * discriminador dentro del objeto opaco, no un campo de primera clase en
 * `Nodo`, porque W1 trata `config` como un objeto que el motor no valida.
 *
 * Vive acá (no en `workflows.repo.ts`) para que las dos impls del repo
 * (InMemory y Supabase) lo compartan en vez de reimplementar el mismo chequeo
 * dos veces con el riesgo de que diverjan.
 */
export function disparadorMatch(grafo: Grafo, disparador: string): boolean {
  const nodo = disparadorDe(grafo);
  return typeof nodo?.config["disparador"] === "string" && nodo.config["disparador"] === disparador;
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
