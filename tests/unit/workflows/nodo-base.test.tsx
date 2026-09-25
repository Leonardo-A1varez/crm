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

  /**
   * El ring de selección se afirma por su token, no por su grosor.
   *
   * La versión anterior de este test pedía `ring-2`, que era el grosor del
   * diseño pre-tokens (`ring-2 ring-blue-500`). Hoy la selección es `ring-1
   * ring-ink-primary` sobre un borde de 1px del mismo color, y el cambio es
   * deliberado: `clasesTarjetaNodo` documenta que el borde se queda en 1px en
   * TODOS los estados para que un nodo que entra en ejecución no corra el
   * contenido un cuarto de píxel, cosa que sobre decenas de nodos se ve como un
   * temblor. Pedir un grosor concreto ataba el test a esa decisión de layout.
   *
   * Se afirman las dos mitades del contrato —aparece seleccionado y NO aparece
   * sin seleccionar—, que es más de lo que verificaba la versión vieja: con un
   * solo `toContain` un componente que pintara el ring siempre pasaba igual.
   */
  it("marca la selección con el ring acromático, y sólo cuando está seleccionado", () => {
    const { container: sinSeleccionar } = renderWithFlow(
      <NodoBase nombre="Test" icono={Send} categoria="mensajeria" selected={false}>
        <span>X</span>
      </NodoBase>,
    );
    expect((sinSeleccionar.firstChild as HTMLElement).className).not.toContain("ring-ink-primary");

    const { container } = renderWithFlow(
      <NodoBase nombre="Test" icono={Send} categoria="mensajeria" selected={true}>
        <span>X</span>
      </NodoBase>,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("ring-1");
    expect(wrapper.className).toContain("ring-ink-primary");
    expect(wrapper.className).toContain("border-ink-primary");
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
