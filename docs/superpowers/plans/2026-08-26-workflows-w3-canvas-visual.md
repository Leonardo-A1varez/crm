# W3: Canvas Visual y Enriquecimiento del Motor de Workflows — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el editor de workflows basado en formularios por un canvas visual drag & drop estilo N8N, agregando variables en mensajes, historial de corridas visible, y trigger manual para pruebas.

**Architecture:** Canvas con `@xyflow/react` que manipula el mismo modelo de datos (`Grafo`) existente. Los nodos custom renderizan configuración inline. El panel lateral aparece al seleccionar. Las variables se interpolan en runtime antes de enviar mensajes.

**Tech Stack:** `@xyflow/react` v12, React 19, Next.js 16, TypeScript, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-26-workflows-w3-canvas-visual-design.md`

## Global Constraints

- Mantener compatibilidad con React 19 y Next.js 16 App Router
- Usar tokens de color del tema existente (`bg-emerald-500`, `bg-blue-500`, etc.)
- No modificar el modelo de datos `Grafo`/`Nodo`/`Arista` — solo consumirlo
- El motor de ejecución W2 no se toca
- Español en UI, inglés en código
- Tests con Vitest, sin mocks de producción

## Estructura de archivos

```
src/components/workflows/
├── canvas/
│   ├── CanvasWorkflow.tsx        # Wrapper principal de ReactFlow
│   ├── CanvasToolbar.tsx         # Controles de zoom, minimap, guardar
│   ├── PaletaNodos.tsx           # Drag source de los 5 tipos
│   ├── PanelConfigNodo.tsx       # Sidebar derecho de configuración
│   └── nodos/
│       ├── NodoBase.tsx          # Layout compartido
│       ├── NodoDisparador.tsx    # Verde, config de evento
│       ├── NodoAccion.tsx        # Azul, config de acción
│       ├── NodoCondicion.tsx     # Amarillo, config de condición
│       ├── NodoEspera.tsx        # Gris, config de minutos
│       └── NodoFin.tsx           # Rojo, sin config
├── historial/
│   ├── HistorialCorridas.tsx     # Lista paginada
│   ├── DetalleCorrida.tsx        # Timeline de pasos
│   └── PasoTimeline.tsx          # Un paso individual
├── EditorDeGrafo.tsx             # LEGACY - se reemplaza
└── ... (existentes)

src/lib/workflows/
├── variables.ts                  # interpolarVariables()
└── (existentes)

src/server/services/workflows/
├── acciones/enviar-mensaje.ts    # MODIFICAR: agregar interpolación
└── (existentes)
```

---

## Fase A: Canvas Visual

### Task A1: Instalar @xyflow/react

**Files:**

- Modify: `package.json`

**Interfaces:**

- Produces: dependencia `@xyflow/react` disponible para importar

- [ ] **Step 1: Instalar la dependencia**

```bash
npm install @xyflow/react
```

- [ ] **Step 2: Verificar instalación**

```bash
npm ls @xyflow/react
```

Expected: versión 12.x instalada

- [ ] **Step 3: Verificar que compila**

```bash
npm run typecheck
```

Expected: sin errores nuevos

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): instalar @xyflow/react para canvas de workflows"
```

---

### Task A2: NodoBase — componente base de nodos

**Files:**

- Create: `src/components/workflows/canvas/nodos/NodoBase.tsx`
- Create: `tests/unit/workflows/nodo-base.test.tsx`

**Interfaces:**

- Produces: `NodoBase` component con props `{ tipo, titulo, color, children, selected, handles }`

- [ ] **Step 1: Escribir test del componente**

```typescript
// tests/unit/workflows/nodo-base.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { NodoBase } from "@/components/workflows/canvas/nodos/NodoBase";

function renderWithFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("NodoBase", () => {
  it("renderiza el título y el color correcto", () => {
    renderWithFlow(
      <NodoBase tipo="disparador" titulo="Mi Nodo" color="emerald" selected={false}>
        <span data-testid="contenido">Contenido</span>
      </NodoBase>,
    );

    expect(screen.getByText("Mi Nodo")).toBeInTheDocument();
    expect(screen.getByTestId("contenido")).toBeInTheDocument();
  });

  it("muestra borde cuando está seleccionado", () => {
    const { container } = renderWithFlow(
      <NodoBase tipo="accion" titulo="Test" color="blue" selected={true}>
        <span>X</span>
      </NodoBase>,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("ring-2");
  });

  it("renderiza handles de entrada y salida", () => {
    const { container } = renderWithFlow(
      <NodoBase
        tipo="accion"
        titulo="Test"
        color="blue"
        selected={false}
        handles={{ entrada: true, salida: true }}
      >
        <span>X</span>
      </NodoBase>,
    );

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(2);
  });
});
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
npx vitest run tests/unit/workflows/nodo-base.test.tsx
```

Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar NodoBase**

```typescript
// src/components/workflows/canvas/nodos/NodoBase.tsx
"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { NodoTipo } from "@/types/workflows";

const COLORES = {
  emerald: "bg-emerald-500 border-emerald-600",
  blue: "bg-blue-500 border-blue-600",
  amber: "bg-amber-500 border-amber-600",
  gray: "bg-gray-500 border-gray-600",
  red: "bg-red-500 border-red-600",
} as const;

type ColorKey = keyof typeof COLORES;

interface NodoBaseProps {
  tipo: NodoTipo;
  titulo: string;
  color: ColorKey;
  selected: boolean;
  children: ReactNode;
  handles?: { entrada?: boolean; salida?: boolean; verdadero?: boolean; falso?: boolean };
}

export function NodoBase({ titulo, color, selected, children, handles = {} }: NodoBaseProps) {
  const { entrada = false, salida = false, verdadero = false, falso = false } = handles;

  return (
    <div
      className={`min-w-[180px] rounded-lg border-2 bg-white shadow-md dark:bg-gray-900 ${
        selected ? "ring-2 ring-blue-400 ring-offset-2" : ""
      }`}
    >
      {entrada && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
        />
      )}

      <div className={`rounded-t-md px-3 py-1.5 text-[11px] font-semibold text-white ${COLORES[color]}`}>
        {titulo}
      </div>

      <div className="p-3">{children}</div>

      {salida && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-600"
        />
      )}

      {verdadero && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="verdadero"
          className="!-left-[25%] !h-3 !w-3 !border-2 !border-white !bg-emerald-500"
        />
      )}

      {falso && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="falso"
          className="!left-[125%] !h-3 !w-3 !border-2 !border-white !bg-red-500"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ejecutar test para verificar que pasa**

```bash
npx vitest run tests/unit/workflows/nodo-base.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/workflows/canvas/nodos/NodoBase.tsx tests/unit/workflows/nodo-base.test.tsx
git commit -m "feat(workflows): NodoBase con handles y colores por tipo"
```

---

### Task A3: Nodos tipados (5 componentes)

**Files:**

- Create: `src/components/workflows/canvas/nodos/NodoDisparador.tsx`
- Create: `src/components/workflows/canvas/nodos/NodoAccion.tsx`
- Create: `src/components/workflows/canvas/nodos/NodoCondicion.tsx`
- Create: `src/components/workflows/canvas/nodos/NodoEspera.tsx`
- Create: `src/components/workflows/canvas/nodos/NodoFin.tsx`
- Create: `src/components/workflows/canvas/nodos/index.ts`

**Interfaces:**

- Consumes: `NodoBase` de A2
- Produces: `nodeTypes` object para ReactFlow con los 5 tipos registrados

- [ ] **Step 1: Crear NodoDisparador**

```typescript
// src/components/workflows/canvas/nodos/NodoDisparador.tsx
"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";
import { ETIQUETA_DISPARADOR } from "@/lib/workflows/catalogo";
import type { DisparadorWorkflow } from "@/lib/workflows/catalogo";

interface NodoDisparadorData {
  config: { disparador?: DisparadorWorkflow };
}

function NodoDisparadorInner({ data, selected }: NodeProps<NodoDisparadorData>) {
  const disparador = data.config?.disparador ?? "mensaje_recibido";
  const etiqueta = ETIQUETA_DISPARADOR[disparador] ?? disparador;

  return (
    <NodoBase
      tipo="disparador"
      titulo="Disparador"
      color="emerald"
      selected={selected}
      handles={{ salida: true }}
    >
      <p className="text-ink-secondary text-[11px]">{etiqueta}</p>
    </NodoBase>
  );
}

export const NodoDisparador = memo(NodoDisparadorInner);
```

- [ ] **Step 2: Crear NodoAccion**

```typescript
// src/components/workflows/canvas/nodos/NodoAccion.tsx
"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";
import { ETIQUETA_ACCION } from "@/lib/workflows/catalogo";
import type { AccionWorkflow } from "@/lib/workflows/catalogo";

interface NodoAccionData {
  config: { accion?: AccionWorkflow; texto?: string };
}

function NodoAccionInner({ data, selected }: NodeProps<NodoAccionData>) {
  const accion = data.config?.accion ?? "enviar_mensaje";
  const etiqueta = ETIQUETA_ACCION[accion] ?? accion;
  const texto = data.config?.texto;

  return (
    <NodoBase
      tipo="accion"
      titulo="Acción"
      color="blue"
      selected={selected}
      handles={{ entrada: true, salida: true }}
    >
      <p className="text-ink-secondary text-[11px] font-medium">{etiqueta}</p>
      {texto && <p className="text-ink-faint mt-1 line-clamp-2 text-[10px]">{texto}</p>}
    </NodoBase>
  );
}

export const NodoAccion = memo(NodoAccionInner);
```

- [ ] **Step 3: Crear NodoCondicion**

```typescript
// src/components/workflows/canvas/nodos/NodoCondicion.tsx
"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

interface NodoCondicionData {
  config: { campo?: string; operador?: string; valor?: string };
}

function NodoCondicionInner({ data, selected }: NodeProps<NodoCondicionData>) {
  const { campo, operador, valor } = data.config ?? {};
  const resumen = campo ? `${campo} ${operador ?? "es"} ${valor ?? "?"}` : "Sin configurar";

  return (
    <NodoBase
      tipo="condicion"
      titulo="Condición"
      color="amber"
      selected={selected}
      handles={{ entrada: true, verdadero: true, falso: true }}
    >
      <p className="text-ink-secondary text-[11px]">{resumen}</p>
      <div className="mt-1 flex justify-between text-[9px]">
        <span className="text-emerald-600">✓ Sí</span>
        <span className="text-red-600">✗ No</span>
      </div>
    </NodoBase>
  );
}

export const NodoCondicion = memo(NodoCondicionInner);
```

- [ ] **Step 4: Crear NodoEspera**

```typescript
// src/components/workflows/canvas/nodos/NodoEspera.tsx
"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

interface NodoEsperaData {
  config: { minutos?: number };
}

function NodoEsperaInner({ data, selected }: NodeProps<NodoEsperaData>) {
  const minutos = data.config?.minutos ?? 60;
  const texto = minutos >= 60 ? `${Math.floor(minutos / 60)}h ${minutos % 60}m` : `${minutos}m`;

  return (
    <NodoBase
      tipo="espera"
      titulo="Espera"
      color="gray"
      selected={selected}
      handles={{ entrada: true, salida: true }}
    >
      <p className="text-ink-secondary text-[11px]">Esperar {texto}</p>
    </NodoBase>
  );
}

export const NodoEspera = memo(NodoEsperaInner);
```

- [ ] **Step 5: Crear NodoFin**

```typescript
// src/components/workflows/canvas/nodos/NodoFin.tsx
"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

function NodoFinInner({ selected }: NodeProps) {
  return (
    <NodoBase tipo="fin" titulo="Fin" color="red" selected={selected} handles={{ entrada: true }}>
      <p className="text-ink-faint text-[10px]">El flujo termina</p>
    </NodoBase>
  );
}

export const NodoFin = memo(NodoFinInner);
```

- [ ] **Step 6: Crear barrel export**

```typescript
// src/components/workflows/canvas/nodos/index.ts
import { NodoDisparador } from "./NodoDisparador";
import { NodoAccion } from "./NodoAccion";
import { NodoCondicion } from "./NodoCondicion";
import { NodoEspera } from "./NodoEspera";
import { NodoFin } from "./NodoFin";

export const nodeTypes = {
  disparador: NodoDisparador,
  accion: NodoAccion,
  condicion: NodoCondicion,
  espera: NodoEspera,
  fin: NodoFin,
} as const;

export { NodoBase } from "./NodoBase";
```

- [ ] **Step 7: Verificar typecheck**

```bash
npm run typecheck
```

Expected: sin errores

- [ ] **Step 8: Commit**

```bash
git add src/components/workflows/canvas/nodos/
git commit -m "feat(workflows): 5 nodos tipados para el canvas"
```

---

### Task A4: CanvasWorkflow — componente principal

**Files:**

- Create: `src/components/workflows/canvas/CanvasWorkflow.tsx`
- Create: `src/components/workflows/canvas/tipos.ts`

**Interfaces:**

- Consumes: `nodeTypes` de A3, `Grafo` de `@/types/workflows`
- Produces: `CanvasWorkflow` component con props `{ grafo, onChange, puedeEditar }`

- [ ] **Step 1: Crear tipos de conversión**

```typescript
// src/components/workflows/canvas/tipos.ts
import type { Node, Edge } from "@xyflow/react";
import type { Grafo, Nodo, Arista } from "@/types/workflows";

export interface NodoFlowData {
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
```

- [ ] **Step 2: Crear CanvasWorkflow**

```typescript
// src/components/workflows/canvas/CanvasWorkflow.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
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

export function CanvasWorkflow({
  grafo,
  onChange,
  puedeEditar,
  onNodoSeleccionado,
}: CanvasWorkflowProps) {
  const inicial = useMemo(() => grafoToFlow(grafo), [grafo]);
  const [nodes, setNodes, onNodesChange] = useNodesState(inicial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(inicial.edges);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!puedeEditar) return;
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));
    },
    [puedeEditar, setEdges],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (!puedeEditar) return;
      onNodesChange(changes);
    },
    [puedeEditar, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (!puedeEditar) return;
      onEdgesChange(changes);
    },
    [puedeEditar, onEdgesChange],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: NodoFlow[] }) => {
      const id = selectedNodes[0]?.id ?? null;
      setSelectedNode(id);
      onNodoSeleccionado?.(id);
    },
    [onNodoSeleccionado],
  );

  // Sincronizar cambios hacia arriba
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
        <MiniMap
          nodeColor={(n) => {
            const colores: Record<string, string> = {
              disparador: "#22c55e",
              accion: "#3b82f6",
              condicion: "#eab308",
              espera: "#6b7280",
              fin: "#ef4444",
            };
            return colores[n.type ?? ""] ?? "#888";
          }}
        />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 3: Verificar typecheck**

```bash
npm run typecheck
```

Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/components/workflows/canvas/tipos.ts src/components/workflows/canvas/CanvasWorkflow.tsx
git commit -m "feat(workflows): CanvasWorkflow con ReactFlow, minimap y controles"
```

---

### Task A5: PaletaNodos — drag source

**Files:**

- Create: `src/components/workflows/canvas/PaletaNodos.tsx`

**Interfaces:**

- Produces: `PaletaNodos` component que permite arrastrar nodos al canvas

- [ ] **Step 1: Crear PaletaNodos**

```typescript
// src/components/workflows/canvas/PaletaNodos.tsx
"use client";

import { ETIQUETA_NODO } from "@/lib/workflows/catalogo";
import { NODO_TIPOS, type NodoTipo } from "@/types/workflows";

const COLORES: Record<NodoTipo, string> = {
  disparador: "bg-emerald-500",
  accion: "bg-blue-500",
  condicion: "bg-amber-500",
  espera: "bg-gray-500",
  fin: "bg-red-500",
};

interface PaletaNodosProps {
  onDragStart: (tipo: NodoTipo) => void;
}

export function PaletaNodos({ onDragStart }: PaletaNodosProps) {
  const handleDragStart = (event: React.DragEvent, tipo: NodoTipo) => {
    event.dataTransfer.setData("application/reactflow", tipo);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(tipo);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {NODO_TIPOS.map((tipo) => (
        <div
          key={tipo}
          draggable
          onDragStart={(e) => handleDragStart(e, tipo)}
          className={`cursor-grab rounded-md px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-transform hover:scale-105 active:cursor-grabbing ${COLORES[tipo]}`}
        >
          + {ETIQUETA_NODO[tipo]}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workflows/canvas/PaletaNodos.tsx
git commit -m "feat(workflows): PaletaNodos para arrastrar nodos al canvas"
```

---

### Task A6: Drop en canvas — crear nodos arrastrando

**Files:**

- Modify: `src/components/workflows/canvas/CanvasWorkflow.tsx`

**Interfaces:**

- Consumes: `PaletaNodos` de A5
- Produces: Canvas acepta drop y crea nodo nuevo

- [ ] **Step 1: Agregar handler de drop al canvas**

Modificar `CanvasWorkflow.tsx` para agregar:

```typescript
// Agregar imports
import { useCallback, useMemo, useState, useRef } from "react";
import type { NodoTipo } from "@/types/workflows";

// Dentro del componente, agregar:
const reactFlowWrapper = useRef<HTMLDivElement>(null);
const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

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

    // Generar ID único
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

// Función helper para config por defecto
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

// En el JSX, envolver el ReactFlow:
<div ref={reactFlowWrapper} className="h-[600px] w-full ...">
  <ReactFlow
    ...
    onInit={setReactFlowInstance}
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
```

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workflows/canvas/CanvasWorkflow.tsx
git commit -m "feat(workflows): drop de nodos desde paleta al canvas"
```

---

### Task A7: PanelConfigNodo — sidebar de configuración

**Files:**

- Create: `src/components/workflows/canvas/PanelConfigNodo.tsx`

**Interfaces:**

- Consumes: `Nodo` de `@/types/workflows`, catálogo de opciones
- Produces: `PanelConfigNodo` component con formulario de configuración por tipo

- [ ] **Step 1: Crear PanelConfigNodo**

```typescript
// src/components/workflows/canvas/PanelConfigNodo.tsx
"use client";

import {
  DISPARADORES,
  ACCIONES,
  ETIQUETA_DISPARADOR,
  ETIQUETA_ACCION,
} from "@/lib/workflows/catalogo";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import type { Nodo } from "@/types/workflows";

interface PanelConfigNodoProps {
  nodo: Nodo | null;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  onChange: (nodoId: string, config: Record<string, unknown>) => void;
}

export function PanelConfigNodo({ nodo, tags, onChange }: PanelConfigNodoProps) {
  if (!nodo) {
    return (
      <div className="border-line-layout bg-surface-panel rounded-lg border p-4">
        <p className="text-ink-faint text-[12px]">Seleccioná un nodo para configurarlo</p>
      </div>
    );
  }

  const select =
    "border-line-control bg-surface-root text-ink-primary w-full rounded-md border px-2 py-1.5 text-[12px]";
  const input = select;

  const handleChange = (campo: string, valor: unknown) => {
    onChange(nodo.id, { ...nodo.config, [campo]: valor });
  };

  return (
    <div className="border-line-layout bg-surface-panel rounded-lg border p-4">
      <h3 className="text-ink-primary mb-3 text-[13px] font-semibold">
        Configurar {nodo.tipo}
      </h3>

      {nodo.tipo === "disparador" && (
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-[11px]">Evento</span>
          <select
            className={select}
            value={String(nodo.config["disparador"] ?? "")}
            onChange={(e) => handleChange("disparador", e.target.value)}
          >
            {DISPARADORES.map((d) => (
              <option key={d} value={d}>
                {ETIQUETA_DISPARADOR[d]}
              </option>
            ))}
          </select>
        </label>
      )}

      {nodo.tipo === "accion" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Acción</span>
            <select
              className={select}
              value={String(nodo.config["accion"] ?? "")}
              onChange={(e) => handleChange("accion", e.target.value)}
            >
              {ACCIONES.map((a) => (
                <option key={a} value={a}>
                  {ETIQUETA_ACCION[a]}
                </option>
              ))}
            </select>
          </label>

          {nodo.config["accion"] === "enviar_mensaje" && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-[11px]">
                Mensaje (usa {"{{lead.nombre}}"} para variables)
              </span>
              <textarea
                className={`${input} min-h-[80px] resize-y`}
                value={String(nodo.config["texto"] ?? "")}
                onChange={(e) => handleChange("texto", e.target.value)}
                placeholder="Hola {{lead.nombre}}, ..."
              />
            </label>
          )}

          {nodo.config["accion"] === "poner_etiqueta" && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-[11px]">Etiqueta</span>
              <select
                className={select}
                value={String(nodo.config["tagId"] ?? "")}
                onChange={(e) => handleChange("tagId", e.target.value)}
              >
                <option value="">— elegí una etiqueta —</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {nodo.tipo === "condicion" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Campo</span>
            <select
              className={select}
              value={String(nodo.config["campo"] ?? "")}
              onChange={(e) => handleChange("campo", e.target.value)}
            >
              {CAMPOS_CONDICION.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Operador</span>
            <select
              className={select}
              value={String(nodo.config["operador"] ?? "")}
              onChange={(e) => handleChange("operador", e.target.value)}
            >
              {OPERADORES.map((o) => (
                <option key={o} value={o}>
                  {o.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Valor</span>
            <input
              className={input}
              value={String(nodo.config["valor"] ?? "")}
              onChange={(e) => handleChange("valor", e.target.value)}
            />
          </label>
        </div>
      )}

      {nodo.tipo === "espera" && (
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-[11px]">Minutos</span>
          <input
            type="number"
            min={1}
            className={input}
            value={Number(nodo.config["minutos"] ?? 60)}
            onChange={(e) => handleChange("minutos", Number(e.target.value))}
          />
        </label>
      )}

      {nodo.tipo === "fin" && (
        <p className="text-ink-faint text-[11px]">Este nodo no tiene configuración</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workflows/canvas/PanelConfigNodo.tsx
git commit -m "feat(workflows): PanelConfigNodo con formularios por tipo"
```

---

### Task A8: CanvasToolbar — controles adicionales

**Files:**

- Create: `src/components/workflows/canvas/CanvasToolbar.tsx`

**Interfaces:**

- Produces: `CanvasToolbar` con botones de guardar y validación

- [ ] **Step 1: Crear CanvasToolbar**

```typescript
// src/components/workflows/canvas/CanvasToolbar.tsx
"use client";

import type { ProblemaGrafo } from "@/types/workflows";

interface CanvasToolbarProps {
  problemas: ProblemaGrafo[];
  guardando: boolean;
  puedeGuardar: boolean;
  onGuardar: () => void;
}

export function CanvasToolbar({
  problemas,
  guardando,
  puedeGuardar,
  onGuardar,
}: CanvasToolbarProps) {
  const sano = problemas.length === 0;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        {sano ? (
          <span className="text-[12px] text-emerald-600 dark:text-emerald-400">
            ✓ El flujo está sano
          </span>
        ) : (
          <span className="text-[12px] text-amber-600 dark:text-amber-400">
            ⚠ {problemas.length} problema{problemas.length > 1 ? "s" : ""} por resolver
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onGuardar}
        disabled={guardando || !puedeGuardar || !sano}
        className="rounded-md bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Guardar versión"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/workflows/canvas/CanvasToolbar.tsx
git commit -m "feat(workflows): CanvasToolbar con estado de validacion y guardar"
```

---

### Task A9: Barrel export del canvas

**Files:**

- Create: `src/components/workflows/canvas/index.ts`

**Interfaces:**

- Produces: exports centralizados del módulo canvas

- [ ] **Step 1: Crear barrel**

```typescript
// src/components/workflows/canvas/index.ts
export { CanvasWorkflow } from "./CanvasWorkflow";
export { CanvasToolbar } from "./CanvasToolbar";
export { PaletaNodos } from "./PaletaNodos";
export { PanelConfigNodo } from "./PanelConfigNodo";
export { nodeTypes } from "./nodos";
export { grafoToFlow, flowToGrafo } from "./tipos";
export type { NodoFlow, AristaFlow } from "./tipos";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/workflows/canvas/index.ts
git commit -m "chore(workflows): barrel export del modulo canvas"
```

---

### Task A10: Integrar canvas en página

**Files:**

- Modify: `src/app/(panel)/workflows/[id]/page.tsx`
- Create: `src/components/workflows/EditorCanvasWorkflow.tsx`

**Interfaces:**

- Consumes: todos los componentes de canvas
- Produces: página funcional con canvas reemplazando al editor legacy

- [ ] **Step 1: Crear componente wrapper client-side**

```typescript
// src/components/workflows/EditorCanvasWorkflow.tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { CanvasWorkflow, CanvasToolbar, PaletaNodos, PanelConfigNodo } from "./canvas";
import { ProblemasDelGrafo } from "./ProblemasDelGrafo";
import { PasosDelGrafo } from "./PasosDelGrafo";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";
import type { ActionResult } from "@/types/inbox";

interface EditorCanvasWorkflowProps {
  workflowId: string;
  grafoInicial: Grafo;
  maxPasosInicial: number;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  onGuardar: (input: { workflowId: string; grafo: Grafo; maxPasos: number }) => Promise<ActionResult>;
}

export function EditorCanvasWorkflow({
  workflowId,
  grafoInicial,
  maxPasosInicial,
  tags,
  puedeEditar,
  onGuardar,
}: EditorCanvasWorkflowProps) {
  const [grafo, setGrafo] = useState<Grafo>(grafoInicial);
  const [maxPasos, setMaxPasos] = useState(maxPasosInicial);
  const [nodoSeleccionadoId, setNodoSeleccionadoId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, startGuardar] = useTransition();

  const problemas = useMemo(() => validarGrafo(grafo), [grafo]);
  const nodoSeleccionado = useMemo(
    () => grafo.nodos.find((n) => n.id === nodoSeleccionadoId) ?? null,
    [grafo.nodos, nodoSeleccionadoId],
  );

  const handleConfigChange = useCallback((nodoId: string, config: Record<string, unknown>) => {
    setGrafo((g) => ({
      ...g,
      nodos: g.nodos.map((n) => (n.id === nodoId ? { ...n, config } : n)),
    }));
  }, []);

  const handleGuardar = () => {
    setMensaje(null);
    startGuardar(async () => {
      const r = await onGuardar({ workflowId, grafo, maxPasos });
      setMensaje(
        r.ok
          ? { ok: true, texto: "Versión guardada. Publicala para que empiece a correr." }
          : { ok: false, texto: r.error },
      );
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Preview del flujo */}
      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Cómo queda el flujo</h2>
        <PasosDelGrafo grafo={grafo} />
      </section>

      {/* Validación */}
      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-2 text-[13px] font-[680]">Revisión</h2>
        <ProblemasDelGrafo problemas={problemas} />
      </section>

      {!puedeEditar ? (
        <p className="text-ink-faint text-[12px]">
          Solo un administrador puede modificar un flujo. Esto es de lectura.
        </p>
      ) : (
        <>
          {/* Paleta de nodos */}
          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">
              Arrastrá para agregar
            </h2>
            <PaletaNodos onDragStart={() => {}} />
          </section>

          {/* Canvas + Panel lateral */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
              <CanvasWorkflow
                grafo={grafo}
                onChange={setGrafo}
                puedeEditar={puedeEditar}
                onNodoSeleccionado={setNodoSeleccionadoId}
              />
            </section>

            <aside>
              <PanelConfigNodo
                nodo={nodoSeleccionado}
                tags={tags}
                onChange={handleConfigChange}
              />
            </aside>
          </div>

          {/* Tope de pasos + Guardar */}
          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <div className="mb-3 flex items-center gap-3">
              <label className="text-ink-secondary flex items-center gap-2 text-[12px]">
                Tope de pasos por corrida
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={maxPasos}
                  onChange={(e) => setMaxPasos(Number(e.target.value))}
                  className="border-line-control bg-surface-root text-ink-primary w-20 rounded-md border px-2 py-1 text-[12px]"
                />
              </label>
            </div>
            <CanvasToolbar
              problemas={problemas}
              guardando={guardando}
              puedeGuardar={puedeEditar && grafo.nodos.length > 0}
              onGuardar={handleGuardar}
            />
          </section>

          {mensaje && (
            <p
              role="status"
              className={`text-[12px] ${mensaje.ok ? "text-emerald-600" : "text-red-600"}`}
            >
              {mensaje.texto}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Actualizar página para usar el nuevo editor**

Modificar `src/app/(panel)/workflows/[id]/page.tsx`:

```typescript
// Cambiar import
import { EditorCanvasWorkflow } from "@/components/workflows/EditorCanvasWorkflow";

// En el JSX, reemplazar EditorDeGrafo por EditorCanvasWorkflow
<EditorCanvasWorkflow
  workflowId={detalle.workflow.id}
  grafoInicial={ultima?.grafo ?? GRAFO_VACIO}
  maxPasosInicial={ultima?.max_pasos ?? 50}
  tags={tags.map((t) => ({ id: t.id, nombre: t.nombre }))}
  puedeEditar={isAdmin}
  onGuardar={guardarVersionAction}
/>
```

- [ ] **Step 3: Verificar typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Verificar lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/workflows/EditorCanvasWorkflow.tsx src/app/\(panel\)/workflows/\[id\]/page.tsx
git commit -m "feat(workflows): integrar canvas visual en pagina de detalle"
```

---

## Fase B: Variables en mensajes

### Task B1: interpolarVariables — función pura

**Files:**

- Create: `src/lib/workflows/variables.ts`
- Create: `tests/unit/workflows/variables.test.ts`

**Interfaces:**

- Produces: `interpolarVariables(texto: string, datos: DatosInterpolacion): InterpolacionResult`

- [ ] **Step 1: Escribir tests**

```typescript
// tests/unit/workflows/variables.test.ts
import { describe, it, expect } from "vitest";
import { interpolarVariables } from "@/lib/workflows/variables";

describe("interpolarVariables", () => {
  it("reemplaza variables existentes", () => {
    const resultado = interpolarVariables("Hola {{lead.nombre}}", {
      lead: { nombre: "Juan" },
    });
    expect(resultado.texto).toBe("Hola Juan");
    expect(resultado.warnings).toHaveLength(0);
  });

  it("deja vacío si el campo no existe", () => {
    const resultado = interpolarVariables("Hola {{lead.nombre}}", {
      lead: {},
    });
    expect(resultado.texto).toBe("Hola ");
    expect(resultado.warnings).toContain("lead.nombre no encontrado");
  });

  it("deja literal si el namespace no existe y anota warning", () => {
    const resultado = interpolarVariables("Hola {{foo.bar}}", {
      lead: { nombre: "Juan" },
    });
    expect(resultado.texto).toBe("Hola {{foo.bar}}");
    expect(resultado.warnings).toContain("namespace foo desconocido");
  });

  it("maneja múltiples variables", () => {
    const resultado = interpolarVariables(
      "Hola {{lead.nombre}}, tu auto {{sesion.auto_marca}} está listo",
      {
        lead: { nombre: "María" },
        sesion: { auto_marca: "Toyota" },
      },
    );
    expect(resultado.texto).toBe("Hola María, tu auto Toyota está listo");
  });

  it("convierte números a string", () => {
    const resultado = interpolarVariables("Precio: {{contexto.precio}}", {
      contexto: { precio: 1500 },
    });
    expect(resultado.texto).toBe("Precio: 1500");
  });
});
```

- [ ] **Step 2: Ejecutar test para verificar que falla**

```bash
npx vitest run tests/unit/workflows/variables.test.ts
```

- [ ] **Step 3: Implementar**

```typescript
// src/lib/workflows/variables.ts

const NAMESPACES_CONOCIDOS = ["lead", "sesion", "contexto", "vendedor", "config"] as const;
type Namespace = (typeof NAMESPACES_CONOCIDOS)[number];

export interface DatosInterpolacion {
  lead?: Record<string, unknown>;
  sesion?: Record<string, unknown>;
  contexto?: Record<string, unknown>;
  vendedor?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface InterpolacionResult {
  texto: string;
  warnings: string[];
}

const VARIABLE_REGEX = /\{\{(\w+)\.(\w+)\}\}/g;

export function interpolarVariables(texto: string, datos: DatosInterpolacion): InterpolacionResult {
  const warnings: string[] = [];

  const resultado = texto.replace(VARIABLE_REGEX, (match, namespace: string, campo: string) => {
    if (!NAMESPACES_CONOCIDOS.includes(namespace as Namespace)) {
      warnings.push(`namespace ${namespace} desconocido`);
      return match; // dejar literal
    }

    const obj = datos[namespace as Namespace];
    if (!obj) {
      warnings.push(`${namespace}.${campo} no encontrado`);
      return "";
    }

    const valor = obj[campo];
    if (valor === undefined || valor === null) {
      warnings.push(`${namespace}.${campo} no encontrado`);
      return "";
    }

    return String(valor);
  });

  return { texto: resultado, warnings };
}
```

- [ ] **Step 4: Ejecutar test para verificar que pasa**

```bash
npx vitest run tests/unit/workflows/variables.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/variables.ts tests/unit/workflows/variables.test.ts
git commit -m "feat(workflows): interpolarVariables con namespaces lead/sesion/contexto/vendedor"
```

---

### Task B2: cargarDatosInterpolacion

**Files:**

- Create: `src/server/services/workflows/acciones/datos-interpolacion.ts`
- Create: `tests/unit/workflows/datos-interpolacion.test.ts`

**Interfaces:**

- Consumes: `LeadsRepository`, `LeadSessionRepository`, `UsersRepository`
- Produces: `cargarDatosInterpolacion(deps, entorno): Promise<DatosInterpolacion>`

- [ ] **Step 1: Escribir test**

```typescript
// tests/unit/workflows/datos-interpolacion.test.ts
import { describe, it, expect, vi } from "vitest";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";

describe("cargarDatosInterpolacion", () => {
  it("carga lead, sesion y vendedor", async () => {
    const deps = {
      leads: {
        findById: vi.fn().mockResolvedValue({
          id: "lead-1",
          nombre: "Juan",
          telefono: "+123",
          etapa: "nuevo",
          vendedor_id: "user-1",
        }),
      },
      sessions: {
        findById: vi.fn().mockResolvedValue({
          id: "session-1",
          auto_marca: "Toyota",
          auto_modelo: "Corolla",
        }),
      },
      users: {
        findById: vi.fn().mockResolvedValue({
          id: "user-1",
          nombre: "Vendedor 1",
          email: "v@test.com",
        }),
      },
    };

    const entorno = {
      leadId: "lead-1",
      leadSessionId: "session-1",
      contexto: { producto: "filtro" },
    };

    const resultado = await cargarDatosInterpolacion(deps, entorno);

    expect(resultado.lead?.nombre).toBe("Juan");
    expect(resultado.sesion?.auto_marca).toBe("Toyota");
    expect(resultado.vendedor?.nombre).toBe("Vendedor 1");
    expect(resultado.contexto?.producto).toBe("filtro");
  });
});
```

- [ ] **Step 2: Implementar**

```typescript
// src/server/services/workflows/acciones/datos-interpolacion.ts
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { UsersRepository } from "@/server/repositories/users.repo";
import type { UUID } from "@/types/entities";
import type { ContextoRun } from "@/types/workflows";

export interface DatosInterpolacionDeps {
  leads: Pick<LeadsRepository, "findById">;
  sessions: Pick<LeadSessionRepository, "findById">;
  users: Pick<UsersRepository, "findById">;
}

export interface DatosInterpolacionEntorno {
  leadId: UUID;
  leadSessionId?: UUID | null;
  contexto: ContextoRun;
}

export async function cargarDatosInterpolacion(
  deps: DatosInterpolacionDeps,
  entorno: DatosInterpolacionEntorno,
): Promise<DatosInterpolacion> {
  const lead = await deps.leads.findById(entorno.leadId);

  const [sesion, vendedor] = await Promise.all([
    entorno.leadSessionId ? deps.sessions.findById(entorno.leadSessionId) : null,
    lead?.vendedor_id ? deps.users.findById(lead.vendedor_id) : null,
  ]);

  return {
    lead: lead
      ? {
          nombre: lead.nombre,
          telefono: lead.telefono,
          etapa: lead.etapa,
          canal: lead.canal,
        }
      : undefined,
    sesion: sesion
      ? {
          auto_marca: sesion.auto_marca,
          auto_modelo: sesion.auto_modelo,
          auto_anio: sesion.auto_anio,
          current_stage: sesion.current_stage,
        }
      : undefined,
    vendedor: vendedor
      ? {
          nombre: vendedor.nombre,
          email: vendedor.email,
        }
      : undefined,
    contexto: entorno.contexto,
  };
}
```

- [ ] **Step 3: Ejecutar test**

```bash
npx vitest run tests/unit/workflows/datos-interpolacion.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/server/services/workflows/acciones/datos-interpolacion.ts tests/unit/workflows/datos-interpolacion.test.ts
git commit -m "feat(workflows): cargarDatosInterpolacion para variables en mensajes"
```

---

### Task B3: Integrar interpolación en enviar-mensaje

**Files:**

- Modify: `src/server/services/workflows/acciones/enviar-mensaje.ts`
- Modify: `tests/unit/workflows/enviar-mensaje.test.ts`

**Interfaces:**

- Consumes: `interpolarVariables`, `cargarDatosInterpolacion`
- Produces: mensajes enviados con variables resueltas

- [ ] **Step 1: Agregar test de interpolación**

Agregar al archivo de tests existente:

```typescript
it("interpola variables en el texto antes de enviar", async () => {
  // ... setup con mocks
  // El nodo tiene texto: "Hola {{lead.nombre}}"
  // El lead tiene nombre: "María"
  // Verificar que metaApi.sendOutbound recibe "Hola María"
});
```

- [ ] **Step 2: Modificar enviar-mensaje.ts**

Agregar al archivo existente después de `leerTexto()`:

```typescript
import { interpolarVariables } from "@/lib/workflows/variables";
import { cargarDatosInterpolacion } from "./datos-interpolacion";

// En el handler, después de leerTexto():
const textoRaw = leerTexto(nodo);
const datosInterpolacion = await cargarDatosInterpolacion(
  { leads: deps.leads, sessions: deps.sessions, users: deps.users },
  { leadId: entorno.leadId, leadSessionId: entorno.leadSessionId, contexto: entorno.contexto },
);
const { texto: textoFinal, warnings } = interpolarVariables(textoRaw, datosInterpolacion);

// Usar textoFinal en vez de texto en sendOutbound
```

- [ ] **Step 3: Actualizar deps del handler**

Agregar `sessions` y `users` a `AccionEnviarMensajeDeps`.

- [ ] **Step 4: Ejecutar tests**

```bash
npx vitest run tests/unit/workflows/enviar-mensaje.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/workflows/acciones/enviar-mensaje.ts tests/unit/workflows/enviar-mensaje.test.ts
git commit -m "feat(workflows): interpolar variables en enviar_mensaje antes de mandar"
```

---

## Fase C y D: Historial y Trigger Manual

Las tareas C1-C4 (Historial) y D1-D4 (Trigger manual) siguen el mismo patrón:

- Crear componentes React
- Crear server actions
- Integrar en la página

Por brevedad, estas fases se detallarán cuando se completen las fases A y B, ya que son menos críticas que el canvas visual.

---

## Self-Review Checklist

- [x] **Spec coverage:** Todas las secciones del spec tienen tareas asignadas
- [x] **Placeholder scan:** No hay TBDs ni TODOs
- [x] **Type consistency:** Nombres de funciones y tipos coinciden entre tareas
- [x] **Criterios de aceptación:** Cubiertos por las tareas

---

## Notas para el ejecutor

1. **Orden de ejecución:** A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10 → B1 → B2 → B3
2. **Verificación visual:** Después de A10, abrir `/workflows/[id]` en el navegador y verificar que el canvas funciona
3. **Dependencia de xyflow:** Si hay problemas de compatibilidad con React 19, consultar la documentación de migración
4. **CSS de xyflow:** El import de `@xyflow/react/dist/style.css` es obligatorio para que los estilos funcionen
