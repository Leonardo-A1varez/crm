"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useOnSelectionChange,
  useReactFlow,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
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
  /**
   * D1: el layout de 3 paneles (paleta / canvas / config) lo arma
   * `EditorCanvasWorkflow`, no este componente — el canvas siempre ocupa el
   * 100% de su contenedor. Se aceptan estos flags para que quien lo embeba
   * pueda avisar que el ancho disponible cambió (p. ej. para disparar una
   * transición suave), sin que este componente dependa de esos paneles.
   */
  paletaVisible?: boolean;
  panelConfigVisible?: boolean;
}

const COLORES_MINIMAPA: Record<string, string> = {
  disparador: "#10b981",
  accion: "#3b82f6",
  condicion: "#f59e0b",
  espera: "#6b7280",
  fin: "#ef4444",
};

const GRID = 16;
const MAX_HISTORY = 50;
const OFFSET_PEGADO = 20;

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
    default:
      // Los 57 tipos del catálogo nuevo arrancan sin config: el panel
      // (canvas/config/*) completa cada campo con su propio default al abrirse.
      return {};
  }
}

/** Genera el próximo id libre `${prefijo}-N` sin colisionar con `existentes`. */
export function generarIdUnico(prefijo: string, existentes: ReadonlySet<string>): string {
  let n = 1;
  let id = `${prefijo}-${n}`;
  while (existentes.has(id)) {
    n += 1;
    id = `${prefijo}-${n}`;
  }
  return id;
}

function esCampoEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

interface Snapshot {
  nodes: NodoFlow[];
  edges: AristaFlow[];
}

interface Clipboard {
  nodes: NodoFlow[];
  edges: AristaFlow[];
}

function CanvasWorkflowInner({
  grafo,
  onChange,
  puedeEditar,
  onNodoSeleccionado,
}: CanvasWorkflowProps) {
  const inicial = useMemo(() => grafoToFlow(grafo), [grafo]);
  const [nodes, setNodes, onNodesChange] = useNodesState<NodoFlow>(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AristaFlow>(inicial.edges);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const rf = useReactFlow<NodoFlow, AristaFlow>();

  // D8: stacks de deshacer/rehacer. Viven en refs (no state) porque no hay
  // UI que dependa de su longitud — solo los atajos de teclado los leen — y
  // así evitamos un re-render por cada snapshot.
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const clipboardRef = useRef<Clipboard | null>(null);
  // Evita apilar un snapshot por cada evento de arrastre de un mismo gesto.
  const arrastreEnCursoRef = useRef(false);

  const pushHistory = useCallback(() => {
    pastRef.current = [...pastRef.current, { nodes: rf.getNodes(), edges: rf.getEdges() }].slice(
      -MAX_HISTORY,
    );
    futureRef.current = [];
  }, [rf]);

  const undo = useCallback(() => {
    const anterior = pastRef.current.at(-1);
    if (!anterior) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [
      ...futureRef.current,
      { nodes: rf.getNodes(), edges: rf.getEdges() },
    ].slice(-MAX_HISTORY);
    setNodes(anterior.nodes);
    setEdges(anterior.edges);
  }, [rf, setNodes, setEdges]);

  const redo = useCallback(() => {
    const siguiente = futureRef.current.at(-1);
    if (!siguiente) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, { nodes: rf.getNodes(), edges: rf.getEdges() }].slice(
      -MAX_HISTORY,
    );
    setNodes(siguiente.nodes);
    setEdges(siguiente.edges);
  }, [rf, setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!puedeEditar) return;
      pushHistory();
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));
    },
    [puedeEditar, pushHistory, setEdges],
  );

  const handleNodesChange: OnNodesChange<NodoFlow> = useCallback(
    (changes) => {
      if (!puedeEditar) return;
      if (changes.some((c) => c.type === "remove")) pushHistory();
      onNodesChange(changes);
    },
    [puedeEditar, pushHistory, onNodesChange],
  );

  const handleEdgesChange: OnEdgesChange<AristaFlow> = useCallback(
    (changes) => {
      if (!puedeEditar) return;
      if (changes.some((c) => c.type === "remove")) pushHistory();
      onEdgesChange(changes);
    },
    [puedeEditar, pushHistory, onEdgesChange],
  );

  const iniciarGestoDeArrastre = useCallback(() => {
    if (arrastreEnCursoRef.current) return;
    arrastreEnCursoRef.current = true;
    pushHistory();
  }, [pushHistory]);

  const terminarGestoDeArrastre = useCallback(() => {
    arrastreEnCursoRef.current = false;
  }, []);

  // D5: tracking de selección vía el hook dedicado en vez del prop
  // `onSelectionChange` — evita registrar el listener a mano.
  useOnSelectionChange({
    onChange: ({ nodes: seleccionados }) => {
      onNodoSeleccionado?.(seleccionados[0]?.id ?? null);
    },
  });

  // Sincronizar automáticamente cuando cambian nodes o edges
  useEffect(() => {
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
      if (!puedeEditar || !reactFlowWrapper.current) return;

      const tipo = event.dataTransfer.getData("application/reactflow") as NodoTipo;
      if (!tipo) return;

      // screenToFlowPosition en v12 ya resta el offset del contenedor: pasarle
      // coordenadas ya relativas (como hacía la versión anterior) duplicaba la
      // resta y el nodo caía desplazado del punto real de soltado.
      const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const existentes = new Set(rf.getNodes().map((n) => n.id));
      const id = generarIdUnico(tipo, existentes);

      const newNode: NodoFlow = {
        id,
        type: tipo,
        position,
        data: { config: configPorDefecto(tipo) },
      };

      pushHistory();
      setNodes((nds) => [...nds, newNode]);
    },
    [puedeEditar, rf, pushHistory, setNodes],
  );

  // D9: copiar la selección actual (nodos + aristas internas entre ellos).
  const copiarSeleccion = useCallback(() => {
    const seleccionados = rf.getNodes().filter((n) => n.selected);
    if (seleccionados.length === 0) return;
    const ids = new Set(seleccionados.map((n) => n.id));
    const aristasInternas = rf.getEdges().filter((e) => ids.has(e.source) && ids.has(e.target));
    clipboardRef.current = {
      nodes: seleccionados.map((n) => ({ ...n, position: { ...n.position } })),
      edges: aristasInternas.map((e) => ({ ...e })),
    };
  }, [rf]);

  const pegarSeleccion = useCallback(() => {
    if (!puedeEditar) return;
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;

    pushHistory();

    const existentes = new Set(rf.getNodes().map((n) => n.id));
    const idMap = new Map<string, string>();
    const nuevosNodos: NodoFlow[] = clip.nodes.map((n) => {
      const nuevoId = generarIdUnico(n.type ?? "nodo", existentes);
      existentes.add(nuevoId);
      idMap.set(n.id, nuevoId);
      return {
        ...n,
        id: nuevoId,
        selected: true,
        position: { x: n.position.x + OFFSET_PEGADO, y: n.position.y + OFFSET_PEGADO },
        data: { ...n.data, config: { ...n.data.config } },
      };
    });

    const nuevasAristas: AristaFlow[] = clip.edges.flatMap((e, i) => {
      const source = idMap.get(e.source);
      const target = idMap.get(e.target);
      if (!source || !target) return [];
      return [
        {
          ...e,
          id: `e-${source}-${target}-${e.sourceHandle ?? "salida"}-copia-${i}`,
          source,
          target,
          selected: true,
        },
      ];
    });

    setNodes((nds) => [
      ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
      ...nuevosNodos,
    ]);
    setEdges((eds) => [
      ...eds.map((e) => (e.selected ? { ...e, selected: false } : e)),
      ...nuevasAristas,
    ]);
  }, [puedeEditar, rf, pushHistory, setNodes, setEdges]);

  const duplicarSeleccion = useCallback(() => {
    if (!puedeEditar) return;
    copiarSeleccion();
    pegarSeleccion();
  }, [puedeEditar, copiarSeleccion, pegarSeleccion]);

  const seleccionarTodo = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.selected ? n : { ...n, selected: true })));
    setEdges((eds) => eds.map((e) => (e.selected ? e : { ...e, selected: true })));
  }, [setNodes, setEdges]);

  const deseleccionarTodo = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, [setNodes, setEdges]);

  const moverSeleccionados = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", esGestoNuevo: boolean) => {
      if (esGestoNuevo) pushHistory();
      let dx = 0;
      let dy = 0;
      if (key === "ArrowUp") dy = -GRID;
      else if (key === "ArrowDown") dy = GRID;
      else if (key === "ArrowLeft") dx = -GRID;
      else dx = GRID;

      setNodes((nds) =>
        nds.map((n) =>
          n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
        ),
      );
    },
    [pushHistory, setNodes],
  );

  // D8-D10: atajos de teclado. Se ignoran si el foco está en un campo
  // editable (buscador de la paleta, inputs del panel de configuración, etc)
  // para no interferir con la escritura normal del resto de la pantalla.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (esCampoEditable(event.target)) return;

      const ctrlOMeta = event.ctrlKey || event.metaKey;
      const key = event.key;

      if (ctrlOMeta && !event.shiftKey && key.toLowerCase() === "z") {
        event.preventDefault();
        if (puedeEditar) undo();
        return;
      }
      if (
        ctrlOMeta &&
        (key.toLowerCase() === "y" || (event.shiftKey && key.toLowerCase() === "z"))
      ) {
        event.preventDefault();
        if (puedeEditar) redo();
        return;
      }
      if (ctrlOMeta && key.toLowerCase() === "c") {
        event.preventDefault();
        copiarSeleccion();
        return;
      }
      if (ctrlOMeta && key.toLowerCase() === "v") {
        event.preventDefault();
        pegarSeleccion();
        return;
      }
      if (ctrlOMeta && key.toLowerCase() === "d") {
        event.preventDefault();
        duplicarSeleccion();
        return;
      }
      if (ctrlOMeta && key.toLowerCase() === "a") {
        event.preventDefault();
        seleccionarTodo();
        return;
      }
      if (key === "Escape") {
        deseleccionarTodo();
        return;
      }
      if (
        puedeEditar &&
        (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight")
      ) {
        event.preventDefault();
        moverSeleccionados(key, !event.repeat);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    puedeEditar,
    undo,
    redo,
    copiarSeleccion,
    pegarSeleccion,
    duplicarSeleccion,
    seleccionarTodo,
    deseleccionarTodo,
    moverSeleccionados,
  ]);

  return (
    <div
      ref={reactFlowWrapper}
      className="workflow-canvas h-full min-h-[600px] w-full rounded-lg border border-gray-200 transition-[width] duration-300 ease-in-out dark:border-gray-700"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/*
        D4: color por defecto gris y grosor 2px para toda arista que no traiga
        su propio stroke (p. ej. una conexión manual recién creada); las
        aristas de `verdadero`/`falso` de una condición mantienen su color
        semántico de `tipos.ts`. El estado "seleccionada" se superpone en
        azul con !important porque es la única forma de ganarle a un `stroke`
        inline — no hay campo de estado de ejecución en `Grafo` todavía, así
        que "ejecutando"/"error" quedan fuera de este componente.
      */}
      <style>{`
        .workflow-canvas .react-flow__edge-path { stroke-width: 2; stroke: #9ca3af; }
        .workflow-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: #3b82f6 !important; }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={iniciarGestoDeArrastre}
        onNodeDragStop={terminarGestoDeArrastre}
        onSelectionDragStart={iniciarGestoDeArrastre}
        onSelectionDragStop={terminarGestoDeArrastre}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        snapToGrid
        snapGrid={[GRID, GRID]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        deleteKeyCode={puedeEditar ? ["Backspace", "Delete"] : null}
        nodesDraggable={puedeEditar}
        nodesConnectable={puedeEditar}
      >
        <Background gap={GRID} size={1} />
        <Controls position="bottom-left" showZoom showFitView showInteractive />
        <MiniMap
          position="bottom-right"
          style={{ width: 150, height: 100 }}
          pannable
          zoomable
          nodeColor={(n) => COLORES_MINIMAPA[n.type ?? ""] ?? "#888"}
        />
      </ReactFlow>
    </div>
  );
}

export function CanvasWorkflow(props: CanvasWorkflowProps) {
  return (
    <ReactFlowProvider>
      <CanvasWorkflowInner {...props} />
    </ReactFlowProvider>
  );
}
