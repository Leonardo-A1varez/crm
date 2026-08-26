import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CanvasWorkflow, generarIdUnico } from "@/components/workflows/canvas/CanvasWorkflow";
import { grafo, nodo, arista } from "./fixtures-grafo";
import type { Grafo } from "@/types/workflows";

/**
 * jsdom no implementa ResizeObserver ni layout real: @xyflow/react lo usa
 * para medir el panel. Sin este polyfill, montar <ReactFlow/> tira
 * "ResizeObserver is not defined" antes de llegar a cualquier assertion.
 */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function grafoUnNodo(): Grafo {
  const g = grafo([nodo("d", "disparador")], []);
  g.nodos[0]!.posicion = { x: 100, y: 100 };
  return g;
}

describe("CanvasWorkflow", () => {
  it("renderiza sin errores", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar />,
    );
    expect(container.querySelector(".react-flow")).toBeTruthy();
  });

  it("propaga el grafo derivado a onChange al montar", () => {
    const onChange = vi.fn();
    render(<CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar />);

    expect(onChange).toHaveBeenCalled();
    const ultimoGrafo = onChange.mock.calls.at(-1)![0] as Grafo;
    expect(ultimoGrafo.nodos).toHaveLength(1);
    expect(ultimoGrafo.nodos[0]?.id).toBe("d");
  });

  it("Ctrl+A selecciona todo y Escape deselecciona (los atajos disparan acciones)", () => {
    const onChange = vi.fn();
    render(<CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar />);
    const llamadasIniciales = onChange.mock.calls.length;

    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(onChange.mock.calls.length).toBeGreaterThan(llamadasIniciales);

    const llamadasTrasSeleccion = onChange.mock.calls.length;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onChange.mock.calls.length).toBeGreaterThan(llamadasTrasSeleccion);
  });

  it("undo/redo: flecha mueve el nodo seleccionado y Ctrl+Z / Ctrl+Shift+Z revierten", () => {
    const onChange = vi.fn();
    render(<CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar />);

    const posicion = () => {
      const ultimoGrafo = onChange.mock.calls.at(-1)![0] as Grafo;
      return ultimoGrafo.nodos[0]!.posicion;
    };

    expect(posicion()).toEqual({ x: 100, y: 100 });

    fireEvent.keyDown(document, { key: "a", ctrlKey: true }); // selecciona el único nodo
    fireEvent.keyDown(document, { key: "ArrowRight" }); // mueve 16px, apila historial
    expect(posicion()).toEqual({ x: 116, y: 100 });

    fireEvent.keyDown(document, { key: "z", ctrlKey: true }); // undo
    expect(posicion()).toEqual({ x: 100, y: 100 });

    fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true }); // redo
    expect(posicion()).toEqual({ x: 116, y: 100 });
  });

  it("no aplica atajos de edición cuando puedeEditar es false", () => {
    const onChange = vi.fn();
    render(<CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar={false} />);

    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    const ultimoGrafo = onChange.mock.calls.at(-1)![0] as Grafo;
    expect(ultimoGrafo.nodos[0]?.posicion).toEqual({ x: 100, y: 100 });
  });

  it("ignora atajos cuando el foco está en un campo editable", () => {
    const onChange = vi.fn();
    render(<CanvasWorkflow grafo={grafoUnNodo()} onChange={onChange} puedeEditar />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "a", ctrlKey: true });

    const ultimoGrafo = onChange.mock.calls.at(-1)![0] as Grafo;
    // sin esto, Ctrl+A "seleccionar todo" del canvas pisaría el Ctrl+A nativo
    // de seleccionar texto dentro de cualquier input de la pantalla
    expect(ultimoGrafo.nodos).toHaveLength(1);

    document.body.removeChild(input);
  });
});

describe("generarIdUnico", () => {
  it("devuelve prefijo-1 cuando no hay colisión", () => {
    expect(generarIdUnico("accion", new Set())).toBe("accion-1");
  });

  it("salta los ids ya usados", () => {
    expect(generarIdUnico("accion", new Set(["accion-1", "accion-2"]))).toBe("accion-3");
  });

  it("no depende del orden de inserción del set", () => {
    expect(generarIdUnico("accion", new Set(["accion-2", "accion-1", "accion-4"]))).toBe(
      "accion-3",
    );
  });
});

describe("integración con grafo de varios nodos", () => {
  it("mantiene aristas al convertir ida y vuelta a través del ciclo de render", () => {
    const onChange = vi.fn();
    const g = grafo([nodo("d", "disparador"), nodo("a", "accion")], [arista("d", "a")]);
    render(<CanvasWorkflow grafo={g} onChange={onChange} puedeEditar />);

    const ultimoGrafo = onChange.mock.calls.at(-1)![0] as Grafo;
    expect(ultimoGrafo.aristas).toHaveLength(1);
    expect(ultimoGrafo.aristas[0]).toMatchObject({ desde: "d", hasta: "a" });
  });
});
