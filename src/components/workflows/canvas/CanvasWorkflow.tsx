"use client";

import { useCallback, useMemo, useState, useRef } from "react";
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
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodos";
import { grafoToFlow, flowToGrafo, type NodoFlow, type AristaFlow } from "./tipos";
import type { Grafo, NodoTipo } from "@/types/workflows";

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

function configPorDefecto(tipo: NodoTipo): Record<string, unknown> {
  switch (tipo) {
    case "disparador":
      return { disparador: "mensaje_recibido" };
    case "accion":
      return { accion: "enviar_mensaje", texto: "" };
    case "condicion":
      return { campo: "lead.etapa", operador: "es", valor: "" };
    case "espera":
      return { minutos: 60 };
    case "fin":
      return {};
  }
}

export function CanvasWorkflow({
  grafo,
  onChange,
  puedeEditar,
  onNodoSeleccionado,
}: CanvasWorkflowProps) {
  const inicial = useMemo(() => grafoToFlow(grafo), [grafo]);
  const [nodes, setNodes, onNodesChange] = useNodesState<NodoFlow>(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AristaFlow>(inicial.edges);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    NodoFlow,
    AristaFlow
  > | null>(null);

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

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!puedeEditar || !reactFlowInstance || !reactFlowWrapper.current) return;

      const tipo = event.dataTransfer.getData("application/reactflow") as NodoTipo;
      if (!tipo) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      let n = 1;
      while (nodes.some((x) => x.id === `${tipo}-${n}`)) n += 1;
      const id = `${tipo}-${n}`;

      const newNode: NodoFlow = {
        id,
        type: tipo,
        position,
        data: { config: configPorDefecto(tipo) },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [puedeEditar, reactFlowInstance, nodes, setNodes],
  );

  return (
    <div
      ref={reactFlowWrapper}
      className="h-[600px] w-full rounded-lg border border-gray-200 dark:border-gray-700"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        onNodeDragStop={sincronizar}
        onInit={setReactFlowInstance}
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
