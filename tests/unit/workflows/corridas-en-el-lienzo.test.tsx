import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { CorridaEnVivo } from "@/components/workflows/editor/CorridaEnVivo";
import { NodoCorrida, type NodoCorridaFlow } from "@/components/workflows/editor/NodoCorrida";
import { presentacionDe } from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import type { Grafo } from "@/types/workflows";

// Conteos armados a mano para el test: no salen de ningún dato real.

/** React Flow y el ScrollArea miden con ResizeObserver, que jsdom no trae. */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function nodo(data: Partial<NodoCorridaFlow["data"]>) {
  const props = {
    id: "m",
    data: { nombre: "Enviar texto", categoria: "mensajeria", paso: "completado", ...data },
    type: "corrida",
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    draggable: false,
    selectable: false,
    deletable: false,
  } as unknown as NodeProps<NodoCorridaFlow>;
  render(
    <ReactFlowProvider>
      <NodoCorrida {...props} />
    </ReactFlowProvider>,
  );
}

describe("NodoCorrida — por dónde pasan las otras corridas", () => {
  it("dibuja cuántas pasaron por el bloque y cuántas fallaron ahí", () => {
    nodo({ trafico: { corridas: 42, fallaron: 3, esperando: 0 } });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("3 fallaron")).toBeTruthy();
    expect(screen.queryByText(/esperan/)).toBeNull();
  });

  it("las que esperan en el bloque también se dicen", () => {
    nodo({ trafico: { corridas: 5, fallaron: 0, esperando: 2 } });
    expect(screen.getByText("2 esperan")).toBeTruthy();
  });

  it("un bloque donde sólo hay corridas esperando no dice «0 pasaron»", () => {
    nodo({ trafico: { corridas: 0, fallaron: 0, esperando: 1 } });
    expect(screen.getByText("1 espera")).toBeTruthy();
    expect(screen.queryByText("pasaron")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("mientras se previsualiza un plan, el conteo no compite con el plan", () => {
    nodo({ trafico: { corridas: 42, fallaron: 3, esperando: 0 }, plan: "recorre" });
    expect(screen.queryByText("42")).toBeNull();
  });
});

const GRAFO: Grafo = {
  nodos: [{ id: "m", tipo: "msg_texto", config: {}, posicion: { x: 0, y: 0 } }],
  aristas: [],
};

describe("CorridaEnVivo — el chip de corridas visibles", () => {
  it("junto al estado en vivo dice cuántas corridas de la versión se ven en el lienzo", () => {
    render(
      <CorridaEnVivo
        nombreFlujo="Bienvenida"
        grafo={GRAFO}
        pasos={[]}
        resolver={presentacionDe}
        identificacion="#a3f2 · v3"
        onVolver={vi.fn()}
        conexion="conectada"
        trafico={{
          corridas: 42,
          vivas: 3,
          version: 3,
          dias: 30,
          nodos: [{ nodoId: "m", corridas: 42, fallaron: 3, esperando: 0 }],
        }}
      />,
    );
    expect(screen.getByText("En vivo: cada paso aparece al terminar")).toBeTruthy();
    expect(screen.getByText("42 corridas de v3 en 30 días · 3 en marcha")).toBeTruthy();
  });
});

describe("CorridaEnVivo — el cartel sale del estado real de la corrida", () => {
  function conEstado(estado: "corriendo" | "esperando" | "terminado" | "fallado" | "cancelado") {
    render(
      <CorridaEnVivo
        nombreFlujo="Bienvenida"
        grafo={GRAFO}
        pasos={[]}
        resolver={presentacionDe}
        identificacion="#a3f2 · v3"
        onVolver={vi.fn()}
        conexion="conectada"
        estado={estado}
        enVivo={estado === "corriendo" || estado === "esperando"}
      />,
    );
    return screen.getByRole("status").textContent;
  }

  it("corriendo: en vivo", () => {
    expect(conEstado("corriendo")).toBe("En vivo: cada paso aparece al terminar");
  });

  it("esperando: en vivo, y dice que espera", () => {
    expect(conEstado("esperando")).toBe("En vivo: la corrida espera para seguir");
  });

  it("una corrida terminada ya no dice «en vivo»", () => {
    expect(conEstado("terminado")).toBe("Terminó: no quedan pasos por correr");
  });

  it("una fallada dice que sólo cambia si alguien la reanuda", () => {
    expect(conEstado("fallado")).toBe("Falló: si la reanudan, los pasos nuevos aparecen acá");
  });

  it("una cancelada no va a correr más", () => {
    expect(conEstado("cancelado")).toBe("Cancelada: no va a correr más");
  });
});
