import type { Node, Edge } from "@xyflow/react";
import type { Grafo, Nodo, Arista } from "@/types/workflows";

export interface NodoFlowData extends Record<string, unknown> {
  config: Record<string, unknown>;
}

export type NodoFlow = Node<NodoFlowData>;
export type AristaFlow = Edge;

/** Convierte nuestro Grafo a nodos/aristas de ReactFlow */
export function grafoToFlow(grafo: Grafo): { nodes: NodoFlow[]; edges: AristaFlow[] } {
  const nodes: NodoFlow[] = grafo.nodos.map((n) => ({
    id: n.id,
    type: n.tipo,
    position: n.posicion,
    data: { config: n.config },
  }));

  const edges: AristaFlow[] = grafo.aristas.map((a, i) => ({
    id: `e-${a.desde}-${a.hasta}-${a.puerto}-${i}`,
    source: a.desde,
    target: a.hasta,
    sourceHandle: a.puerto === "salida" ? undefined : a.puerto,
    animated: true,
    style: { stroke: a.puerto === "falso" ? "#ef4444" : "#22c55e" },
  }));

  return { nodes, edges };
}

/** Convierte nodos/aristas de ReactFlow a nuestro Grafo */
export function flowToGrafo(nodes: NodoFlow[], edges: AristaFlow[]): Grafo {
  const nodos: Nodo[] = nodes.map((n) => ({
    id: n.id,
    tipo: n.type as Nodo["tipo"],
    config: n.data?.config ?? {},
    posicion: n.position,
  }));

  const aristas: Arista[] = edges.map((e) => ({
    desde: e.source,
    hasta: e.target,
    puerto: (e.sourceHandle as Arista["puerto"]) ?? "salida",
  }));

  return { nodos, aristas };
}
