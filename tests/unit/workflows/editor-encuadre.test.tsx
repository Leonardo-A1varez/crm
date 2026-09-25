import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorWorkflow, type EditorWorkflowProps } from "@/components/workflows/editor";
import type { NodoEditor, ProblemaNodo } from "@/components/workflows/editor";

/**
 * El contador de problemas de la barra lleva al nodo culpable: lo selecciona
 * y además mueve la cámara hasta él. Antes sólo seleccionaba, y con el nodo
 * fuera de vista el panel se abría sobre algo que no se veía en el lienzo.
 *
 * `useReactFlow` se reemplaza por una cámara falsa. Todo lo demás de React Flow
 * es el de verdad: los componentes internos de la librería usan sus propias
 * referencias, no la exportación que se reemplaza acá.
 */

const camara = vi.hoisted(() => ({
  setCenter: vi.fn(async () => true),
  getZoom: vi.fn(() => 0.4),
  getInternalNode: vi.fn(),
  getNodes: vi.fn((): unknown[] => []),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...real,
    useReactFlow: () => ({
      ...camara,
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
    }),
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ROTO: readonly ProblemaNodo[] = [
  { severidad: "error", mensaje: "Falta conectar la salida." },
];

function nodo(id: string, over: Partial<NodoEditor> = {}): NodoEditor {
  return {
    id,
    type: "editor",
    position: { x: 0, y: 0 },
    data: { nombre: id, categoria: "logica" },
    ...over,
  };
}

function montar(over: Partial<EditorWorkflowProps> = {}) {
  const props: EditorWorkflowProps = {
    nombreFlujo: "Seguimiento",
    versionPublicada: null,
    cambiosSinPublicar: 0,
    nodos: [nodo("n1", { selected: true }), nodo("n2", { position: { x: 400, y: 900 } })],
    aristas: [],
    onNodosChange: vi.fn(),
    onAristasChange: vi.fn(),
    onConectar: vi.fn(),
    categorias: [],
    problemasPorNodo: new Map([["n2", ROTO]]),
    nodoSeleccionado: null,
    onSeleccionar: vi.fn(),
    onAgregarBloque: vi.fn(),
    onInsertarEnArista: vi.fn(),
    onBorrarNodo: vi.fn(),
    onPrevisualizarBorrado: vi.fn(),
    onProbar: vi.fn(),
    onGuardar: vi.fn(),
    onPublicar: vi.fn(),
    onVolver: vi.fn(),
    ...over,
  };
  camara.getNodes.mockReturnValue(props.nodos);
  render(<EditorWorkflow {...props} />);
  return props;
}

function clicEnElContador() {
  fireEvent.click(screen.getByRole("button", { name: /error bloquea publicar/ }));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  camara.setCenter.mockClear();
  camara.getZoom.mockReturnValue(0.4);
  camara.getInternalNode.mockImplementation((id: string) =>
    id === "n2"
      ? {
          internals: { positionAbsolute: { x: 400, y: 900 } },
          measured: { width: 200, height: 80 },
        }
      : undefined,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EditorWorkflow — el contador de problemas", () => {
  it("centra la cámara en el nodo culpable, a un zoom legible", () => {
    montar();
    clicEnElContador();

    // Centro del nodo: posición + la mitad de lo medido. Con el lienzo alejado
    // al 40 %, la cámara acerca hasta 1: el zoom con el que el lienzo encuadra.
    expect(camara.setCenter).toHaveBeenCalledWith(500, 940, { zoom: 1, duration: 240 });
  });

  it("si ya se estaba mirando de cerca, no aleja", () => {
    camara.getZoom.mockReturnValue(1.5);
    montar();
    clicEnElContador();

    expect(camara.setCenter).toHaveBeenCalledWith(500, 940, { zoom: 1.5, duration: 240 });
  });

  it("encuadra también un nodo que nunca se dibujó y por eso no tiene medidas", () => {
    // Con `onlyRenderVisibleElements`, un bloque agregado fuera de vista no se
    // mide nunca. `fitView({ nodes })` lo descarta; el encuadre no puede.
    camara.getInternalNode.mockReturnValue({
      internals: { positionAbsolute: { x: 400, y: 900 } },
      measured: {},
    });
    montar();
    clicEnElContador();

    expect(camara.setCenter).toHaveBeenCalledTimes(1);
    const [x, y] = camara.setCenter.mock.calls[0] as unknown as [number, number];
    expect(x).toBeGreaterThan(400);
    expect(y).toBeGreaterThan(900);
  });

  it("selecciona el nodo en el panel y en el lienzo, y suelta el que estaba seleccionado", () => {
    const props = montar();
    clicEnElContador();

    expect(props.onSeleccionar).toHaveBeenCalledWith("n2");
    expect(props.onNodosChange).toHaveBeenCalledWith([
      { type: "select", id: "n1", selected: false },
      { type: "select", id: "n2", selected: true },
    ]);
  });

  it("con movimiento reducido, la cámara salta en vez de viajar", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({ matches: q.includes("reduce"), media: q })),
    );
    montar();
    clicEnElContador();

    expect(camara.setCenter).toHaveBeenCalledWith(500, 940, { zoom: 1, duration: 0 });
  });
});
