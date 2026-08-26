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

    expect(screen.getByText("Mi Nodo")).toBeTruthy();
    expect(screen.getByTestId("contenido")).toBeTruthy();
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
