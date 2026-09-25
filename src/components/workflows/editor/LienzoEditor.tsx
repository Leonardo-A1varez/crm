"use client";

import { useCallback, useEffect, useRef, type DragEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
  type OnConnectEnd,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import { categoriaColor } from "./contrato-nodos";
import { EncuadreInicial, useEncuadrarTodo } from "./EncuadreInicial";
import { CURVA, DURACION, FOCO, MEDIDAS, TRANSICION_CONTROL } from "./tokens-editor";
import {
  EVENTO_BORRAR_NODO,
  EVENTO_PREVISUALIZAR_BORRADO,
  TIPOS_NODO_EDITOR,
  type DetalleBorrado,
  type NodoEditor,
} from "./NodoConPuertos";
import {
  AristaInsertable,
  EVENTO_INSERTAR_EN_ARISTA,
  type AristaEditor,
  type DetalleInsercion,
} from "./AristaInsertable";

/**
 * Declarados a nivel de módulo, jamás en línea.
 *
 * `nodeTypes`/`edgeTypes` nuevos en cada render desmontan y vuelven a montar
 * todos los nodos y todas las aristas. Con 80 nodos eso es un parpadeo visible
 * en cada tecla que se toca en el panel de la derecha.
 */
const TIPOS_ARISTA = { insertable: AristaInsertable } as const;

export interface LienzoEditorProps {
  nodos: NodoEditor[];
  aristas: AristaEditor[];
  onNodosChange: (cambios: NodeChange<NodoEditor>[]) => void;
  onAristasChange: (cambios: EdgeChange<AristaEditor>[]) => void;
  onConectar: OnConnect;
  /** Soltar un bloque en el vacío. La posición viene en coordenadas del lienzo. */
  onSoltarBloque?: (tipo: string, posicion: XYPosition) => void;
  /** Soltar un bloque sobre una línea: se inserta entre esos dos pasos. */
  onInsertarEnArista?: (tipo: string, aristaId: string) => void;
  /**
   * Arrastrar un cable y soltarlo en el vacío. El lienzo no decide qué pasa:
   * avisa dónde y desde qué puerto, y quien lo usa abre la paleta filtrada por
   * lo que puede seguir a ese puerto.
   */
  onConectarAlVacio?: (origen: { nodoId: string; puerto: string }, pantalla: XYPosition) => void;
  onBorrarNodo?: (nodoId: string) => void;
  /**
   * El mouse entró o salió del botón de borrar de un nodo. `null` = salió.
   * Con esto el contenedor marca las aristas que se van a coser y las que se
   * van a cortar, **antes** de que se borre nada.
   */
  onPrevisualizarBorrado?: (nodoId: string | null) => void;
  onSeleccionar?: (nodoId: string | null) => void;
  /** Overlays anclados al lienzo: el globo de un problema, la previa de reanudación. */
  children?: ReactNode;
  /** `false` en el diff y en la corrida. Apaga arrastre, conexión y borrado. */
  editable?: boolean;
  className?: string;
}

/**
 * El lienzo del editor.
 *
 * ## Presupuesto: 80 nodos a 60 fps
 *
 * n8n se degrada cerca de los 50 nodos y se congela pasados los 100. Las causas
 * son siempre las mismas tres, y las tres están cerradas acá:
 *
 *  1. **Nada por frame pasa por estado de React.** El resaltado de la línea
 *     donde vas a soltar un bloque se escribe en el DOM desde el handler
 *     (`AristaInsertable`), y el modo "hay un arrastre en curso" se marca con
 *     un atributo en la raíz del lienzo, no con un `useState`. Un `useState`
 *     en `dragover` repinta el grafo entero ~60 veces por segundo.
 *  2. **El indicador de zoom está aislado en su propio componente.** Suscribirse
 *     al viewport desde acá volvería a renderizar `<ReactFlow>` en cada píxel
 *     de desplazamiento. Vive en `IndicadorZoom`, que es un `<span>`.
 *  3. **`onlyRenderVisibleElements`**: React Flow monta sólo lo que entra en
 *     pantalla. Con 80 nodos y un viewport típico se dibujan entre 10 y 20.
 *
 * Queda un límite honesto que no depende de este archivo: el `<MiniMap>`
 * recorre los nodos en cada cambio del grafo. Con 80 es despreciable; si algún
 * día hay 500, el minimapa es lo primero que hay que hacer virtual o apagar.
 */
export function LienzoEditor({
  nodos,
  aristas,
  onNodosChange,
  onAristasChange,
  onConectar,
  onSoltarBloque,
  onInsertarEnArista,
  onConectarAlVacio,
  onBorrarNodo,
  onPrevisualizarBorrado,
  onSeleccionar,
  children,
  editable = true,
  className,
}: LienzoEditorProps) {
  const raizRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  /**
   * Marca el lienzo mientras hay un arrastre en curso.
   *
   * Los chips de inserción de las líneas se revelan con
   * `group-data-[arrastrando]/lienzo:opacity-100`, o sea con CSS. El atributo
   * se escribe directo sobre el nodo del DOM: son dos escrituras por arrastre
   * (una al empezar, otra al terminar) en lugar de dos renders del grafo.
   *
   * Escucha en `document` porque `dragend` se dispara sobre el elemento
   * **origen** —la fila de la paleta— y no sobre el lienzo. Un `onDragLeave`
   * del lienzo se dispara además cada vez que el cursor cruza un hijo, así que
   * no sirve como señal de fin.
   */
  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;

    const abrir = () => {
      raiz.dataset.arrastrando = "";
    };
    const cerrar = () => {
      delete raiz.dataset.arrastrando;
    };

    document.addEventListener("dragstart", abrir);
    document.addEventListener("dragend", cerrar);
    document.addEventListener("drop", cerrar);
    return () => {
      document.removeEventListener("dragstart", abrir);
      document.removeEventListener("dragend", cerrar);
      document.removeEventListener("drop", cerrar);
    };
  }, []);

  /**
   * Los gestos de los nodos y las aristas suben como eventos del DOM que
   * burbujean, y se escuchan una vez acá. La alternativa —un callback por nodo
   * dentro de `data`— cambiaría la identidad de `data` en cada render del
   * contenedor y anularía el memo de los 80 nodos.
   */
  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;

    const alInsertar = (e: Event) => {
      const { aristaId, tipo } = (e as CustomEvent<DetalleInsercion>).detail;
      onInsertarEnArista?.(tipo, aristaId);
    };
    const alBorrar = (e: Event) => {
      const { nodoId } = (e as CustomEvent<DetalleBorrado>).detail;
      if (nodoId) onBorrarNodo?.(nodoId);
    };
    const alPrevisualizar = (e: Event) => {
      onPrevisualizarBorrado?.((e as CustomEvent<DetalleBorrado>).detail.nodoId);
    };

    raiz.addEventListener(EVENTO_INSERTAR_EN_ARISTA, alInsertar);
    raiz.addEventListener(EVENTO_BORRAR_NODO, alBorrar);
    raiz.addEventListener(EVENTO_PREVISUALIZAR_BORRADO, alPrevisualizar);
    return () => {
      raiz.removeEventListener(EVENTO_INSERTAR_EN_ARISTA, alInsertar);
      raiz.removeEventListener(EVENTO_BORRAR_NODO, alBorrar);
      raiz.removeEventListener(EVENTO_PREVISUALIZAR_BORRADO, alPrevisualizar);
    };
  }, [onInsertarEnArista, onBorrarNodo, onPrevisualizarBorrado]);

  const alSoltar = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const tipo = e.dataTransfer.getData("application/reactflow");
      if (!tipo) return;
      onSoltarBloque?.(tipo, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [onSoltarBloque, screenToFlowPosition],
  );

  /**
   * Arrastrar un cable y soltarlo donde no hay nada.
   *
   * En vez de descartar el gesto —lo que hacen casi todas las herramientas— se
   * abre la paleta filtrada por lo que puede seguir a ese puerto. La persona ya
   * dijo dos cosas con el gesto: de dónde sale y dónde lo quiere. Pedirle que
   * ahora vaya a buscar el bloque a la paleta y lo arrastre de vuelta es
   * ignorar las dos.
   */
  const alTerminarConexion = useCallback<OnConnectEnd>(
    (evento, estado) => {
      if (estado.toNode || !estado.fromNode) return;
      const puerto = estado.fromHandle?.id ?? "salida";
      const punto =
        "clientX" in evento
          ? { x: evento.clientX, y: evento.clientY }
          : {
              x: evento.changedTouches[0]?.clientX ?? 0,
              y: evento.changedTouches[0]?.clientY ?? 0,
            };
      onConectarAlVacio?.({ nodoId: estado.fromNode.id, puerto }, punto);
    },
    [onConectarAlVacio],
  );

  return (
    <div
      ref={raizRef}
      className={cn("group/lienzo bg-surface-root relative min-w-0 flex-1", className)}
    >
      <ReactFlow<NodoEditor, AristaEditor>
        nodes={nodos}
        edges={aristas}
        nodeTypes={TIPOS_NODO_EDITOR}
        edgeTypes={TIPOS_ARISTA}
        onNodesChange={onNodosChange}
        onEdgesChange={onAristasChange}
        onConnect={onConectar}
        onConnectEnd={alTerminarConexion}
        onDrop={alSoltar}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onNodeClick={(_, n) => onSeleccionar?.(n.id)}
        onPaneClick={() => onSeleccionar?.(null)}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: false }}
        minZoom={0.3}
        maxZoom={2}
        // Sin `fitView`: el encuadre al abrir lo hace `<EncuadreInicial>`, que
        // cuenta también los nodos que todavía no se midieron.
        defaultEdgeOptions={{ type: "insertable" }}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          className="!text-line-layout"
        />
        <MiniMap
          pannable
          zoomable
          ariaLabel="Mapa del flujo"
          nodeColor={(n) => categoriaColor((n as NodoEditor).data.categoria)}
          nodeStrokeWidth={0}
          maskColor="color-mix(in srgb, var(--surface-root) 78%, transparent)"
          style={{ width: MEDIDAS.MINIMAPA_ANCHO, height: MEDIDAS.MINIMAPA_ALTO }}
          // `!m-0` no es layout con márgenes: anula el margen propio que React
          // Flow le inyecta al minimapa, que sumado al `bottom-3.5` lo dejaría
          // a una distancia distinta de la de los controles de la izquierda.
          className="!border-line-card !bg-surface-panel/90 !right-3.5 !bottom-3.5 !m-0 rounded-lg !border backdrop-blur-sm"
        />
        <EncuadreInicial />
      </ReactFlow>

      <ControlesLienzo />

      {children}
    </div>
  );
}

/**
 * Zoom, encuadre y porcentaje, abajo a la izquierda.
 *
 * **Está aislado en su propio componente por rendimiento, no por prolijidad.**
 * `useViewport()` vuelve a renderizar a quien lo llame en cada frame de
 * desplazamiento o de zoom. Llamándolo desde `LienzoEditor` se volvería a
 * renderizar `<ReactFlow>` sesenta veces por segundo mientras se navega el
 * lienzo; acá adentro sólo se vuelve a pintar un `<span>` de cuatro
 * caracteres.
 */
function ControlesLienzo() {
  const { zoomIn, zoomOut } = useReactFlow();
  const encuadrarTodo = useEncuadrarTodo();

  return (
    <div
      role="toolbar"
      aria-label="Controles del lienzo"
      // 12 px entre botones: las áreas de toque extendidas de cada uno miden
      // 40 px y con menos separación se pisarían, y el clic caería en el vecino.
      className="absolute bottom-3.5 left-3.5 flex items-center gap-3"
    >
      <BotonLienzo etiqueta="Alejar" onClick={() => zoomOut({ duration: 160 })}>
        −
      </BotonLienzo>
      <BotonLienzo etiqueta="Acercar" onClick={() => zoomIn({ duration: 160 })}>
        +
      </BotonLienzo>
      <BotonLienzo
        etiqueta="Encuadrar todo el flujo"
        // El encuadre es un movimiento de cámara, no una respuesta a un
        // control: 240 ms lo hace seguible sin que se sienta lento.
        onClick={() =>
          encuadrarTodo({ duration: prefiereMenosMovimiento() ? 0 : ENCUADRE.duration })
        }
      >
        ⛶
      </BotonLienzo>
      <IndicadorZoom />
    </div>
  );
}

function BotonLienzo({
  etiqueta,
  onClick,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        "border-line-control bg-surface-panel text-ink-secondary hover:bg-surface-hover grid size-7 place-items-center rounded-lg border font-mono text-[12px] shadow-sm",
        // El botón se ve de 28 px y se clickea como de 40: WCAG SC 2.5.8 pide
        // 24 mínimo, pero 28 con trackpad sigue siendo incómodo y agrandar la
        // caja visible arruinaría la densidad del lienzo.
        "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        TRANSICION_CONTROL,
        "active:scale-[0.94] motion-reduce:active:scale-100",
        FOCO,
      )}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

function IndicadorZoom() {
  const { zoom } = useViewport();
  return (
    <span
      // `tabular-nums` para que el número no sacuda la caja mientras se hace
      // zoom: sin ancho fijo de dígito, "82%" y "100%" ocupan distinto y el
      // control se mueve bajo el cursor.
      className="border-line-control bg-surface-panel text-ink-faint grid h-7 place-items-center rounded-lg border px-2.5 font-mono text-[11.5px] tabular-nums shadow-sm"
      aria-live="off"
    >
      {Math.round(zoom * 100)}%
    </span>
  );
}

/**
 * El lienzo, con el proveedor de React Flow ya puesto.
 *
 * `useReactFlow()` y `useViewport()` fallan sin el proveedor por encima, y el
 * error que tiran no dice eso. Esta es la exportación que hay que usar salvo
 * que ya haya un `ReactFlowProvider` más arriba —caso en el que conviene el
 * `LienzoEditor` pelado, porque dos proveedores anidados dan dos instancias del
 * store y el zoom de una no mueve a la otra.
 */
export function LienzoConProveedor(props: LienzoEditorProps) {
  return (
    <ReactFlowProvider>
      <LienzoEditor {...props} />
    </ReactFlowProvider>
  );
}

/** Transición del encuadre. Se exporta para que el diff y la corrida usen la misma. */
export const ENCUADRE = { padding: 0.2, duration: 240 } as const;

/**
 * Mueve la cámara hasta un nodo y lo deja en el centro del lienzo.
 *
 * No usa `fitView({ nodes })` a propósito. En la versión instalada
 * (`getFitViewNodes` de `@xyflow/system` 0.0.81) esa opción descarta los nodos
 * sin `measured.width/height`, y con `onlyRenderVisibleElements` un nodo que
 * nunca entró en pantalla —uno agregado con doble clic debajo de todo— no se
 * midió nunca: el encuadre se calcularía sobre un conjunto vacío. `setCenter`
 * sólo necesita la posición; si falta la medida, se usa la del diseño.
 *
 * El zoom no baja de 1, que es el máximo con el que el lienzo encuadra al
 * abrir (`fitViewOptions`): llegar a un nodo al 30 % es llegar sin poder
 * leerlo. Si ya se estaba mirando más de cerca, se respeta.
 *
 * Tiene que llamarse debajo del mismo `ReactFlowProvider` que el lienzo.
 */
export function useEncuadrarNodo(): (nodoId: string) => void {
  const { getInternalNode, getZoom, setCenter } = useReactFlow();

  return useCallback(
    (nodoId: string) => {
      const nodo = getInternalNode(nodoId);
      if (!nodo) return;
      const ancho = nodo.measured.width ?? MEDIDAS.NODO_ANCHO;
      const alto = nodo.measured.height ?? MEDIDAS.NODO_HEADER;
      const { x, y } = nodo.internals.positionAbsolute;
      void setCenter(x + ancho / 2, y + alto / 2, {
        zoom: Math.max(getZoom(), 1),
        // El viaje de la cámara es decorativo: quien pidió menos movimiento
        // llega al mismo nodo, sólo que sin el recorrido.
        duration: prefiereMenosMovimiento() ? 0 : ENCUADRE.duration,
      });
    },
    [getInternalNode, getZoom, setCenter],
  );
}

function prefiereMenosMovimiento(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Clases de animación reutilizables por los overlays anclados al lienzo. */
export const ENTRADA_OVERLAY = cn(
  "animate-in fade-in slide-in-from-top-1",
  DURACION.FLOTANTE,
  CURVA.SALIDA,
);
