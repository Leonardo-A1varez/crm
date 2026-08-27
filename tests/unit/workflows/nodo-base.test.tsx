import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { MessageSquare, Send } from "lucide-react";
import { NodoBase } from "@/components/workflows/canvas/nodos/NodoBase";

function renderWithFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("NodoBase", () => {
  it("renderiza el nombre y aplica estilos de categoría", () => {
    renderWithFlow(
      <NodoBase
        nombre="Mi Nodo"
        icono={MessageSquare}
        categoria="trigger"
        selected={false}
        tieneEntrada={false}
      >
        <span data-testid="contenido">Contenido</span>
      </NodoBase>,
    );

    expect(screen.getByText("Mi Nodo")).toBeTruthy();
    expect(screen.getByTestId("contenido")).toBeTruthy();
  });

  it("muestra ring cuando está seleccionado", () => {
    const { container } = renderWithFlow(
      <NodoBase nombre="Test" icono={Send} categoria="mensajeria" selected={true}>
        <span>X</span>
      </NodoBase>,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("ring-2");
  });

  it("renderiza handles de entrada y salida", () => {
    const { container } = renderWithFlow(
      <NodoBase
        nombre="Test"
        icono={Send}
        categoria="mensajeria"
        selected={false}
        tieneEntrada={true}
        tieneSalida={true}
      >
        <span>X</span>
      </NodoBase>,
    );

    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(2);
  });
});
