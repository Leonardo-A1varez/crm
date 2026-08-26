"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodos";
import { grafoToFlow, flowToGrafo, type NodoFlow, type AristaFlow } from "./tipos";
import type { Grafo } from "@/types/workflows";

interface CanvasWorkflowProps {
  grafo: Grafo;
  onChange: (grafo: Grafo) => void;
  puedeEditar: boolean;
  onNodoSeleccionado?: (nodoId: string | null) => void;
}

const COLORES_MINIMAPA: Record<string, string> = {
  disparador: "#10b981",
  accion: "#3b82f6",
  condicion: "#f59e0b",
  espera: "#6b7280",
  fin: "#ef4444",
};

export function CanvasWorkflow({
  grafo,
  onChange,
  puedeEditar,
  onNodoSeleccionado,
}: CanvasWorkflowProps) {
  const inicial = useMemo(() => grafoToFlow(grafo), [grafo]);
  const [nodes, , onNodesChange] = useNodesState<NodoFlow>(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AristaFlow>(inicial.edges);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!puedeEditar) return;
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));
    },
    [puedeEditar, setEdges],
  );

  const handleNodesChange: OnNodesChange<NodoFlow> = useCallback(
    (changes) => {
      if (!puedeEditar) return;
      onNodesChange(changes);
    },
    [puedeEditar, onNodesChange],
  );

  const handleEdgesChange: OnEdgesChange<AristaFlow> = useCallback(
    (changes) => {
      if (!puedeEditar) return;
      onEdgesChange(changes);
    },
    [puedeEditar, onEdgesChange],
  );

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      const id = selectedNodes[0]?.id ?? null;
      onNodoSeleccionado?.(id);
    },
    [onNodoSeleccionado],
  );

  const sincronizar = useCallback(() => {
    const nuevoGrafo = flowToGrafo(nodes, edges);
    onChange(nuevoGrafo);
  }, [nodes, edges, onChange]);

  return (
    <div className="h-[600px] w-full rounded-lg border border-gray-200 dark:border-gray-700">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        onNodeDragStop={sincronizar}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={puedeEditar ? "Backspace" : null}
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap nodeColor={(n) => COLORES_MINIMAPA[n.type ?? ""] ?? "#888"} />
      </ReactFlow>
    </div>
  );
}
