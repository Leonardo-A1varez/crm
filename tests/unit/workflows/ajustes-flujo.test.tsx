import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampoTopePasos } from "@/app/(panel)/workflows/[id]/_components/CampoTopePasos";
import { PanelConfig } from "@/components/workflows/editor";

/**
 * El tope de pasos por corrida volvió al editor: vive en el panel de la
 * derecha cuando no hay ningún bloque seleccionado, que es donde van los
 * ajustes del flujo entero.
 */

/** El `ScrollArea` del panel de un bloque mide con ResizeObserver, que jsdom no trae. */
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

describe("PanelConfig — ajustes del flujo", () => {
  it("sin bloque seleccionado muestra los ajustes del flujo y la ayuda de siempre", () => {
    render(<PanelConfig nodo={null} ajustesFlujo={<p>tope</p>} />);

    expect(screen.getByRole("heading", { name: "Ajustes del flujo" })).toBeTruthy();
    expect(screen.getByText("tope")).toBeTruthy();
    expect(screen.getByText("Elegí un bloque del lienzo para configurarlo.")).toBeTruthy();
  });

  it("con un bloque seleccionado, el panel es de ese bloque y los ajustes no aparecen", () => {
    render(
      <PanelConfig
        nodo={{ id: "n2", tipo: "msg_texto", nombre: "Enviar mensaje", categoria: "mensajeria" }}
        ajustesFlujo={<p>tope</p>}
      />,
    );

    expect(screen.queryByText("tope")).toBeNull();
    expect(screen.getByRole("heading", { name: "Enviar mensaje" })).toBeTruthy();
  });

  it("sin ajustes que mostrar, queda el estado vacío de antes", () => {
    render(<PanelConfig nodo={null} />);

    expect(screen.queryByRole("heading", { name: "Ajustes del flujo" })).toBeNull();
    expect(screen.getByText("Elegí un bloque del lienzo para configurarlo.")).toBeTruthy();
  });
});

describe("CampoTopePasos", () => {
  it("el campo tiene su etiqueta y la ayuda asociada", () => {
    render(<CampoTopePasos valor="500" onCambiar={vi.fn()} error={null} />);

    const input = screen.getByLabelText("Tope de pasos por corrida") as HTMLInputElement;
    expect(input.value).toBe("500");
    const ayuda = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(ayuda?.textContent).toContain("1 y 500");
  });

  it("avisa el error recién al salir del campo, no mientras se escribe", () => {
    const onCambiar = vi.fn();
    render(<CampoTopePasos valor="" onCambiar={onCambiar} error="Poné un número entero." />);
    const input = screen.getByLabelText("Tope de pasos por corrida");

    expect(screen.queryByText("Poné un número entero.")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();

    fireEvent.blur(input);

    expect(screen.getByText("Poné un número entero.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describe = input.getAttribute("aria-describedby") ?? "";
    const idsDescritos = describe.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(idsDescritos).toContain("Poné un número entero.");
  });

  it("cada tecla sube el texto tal cual, sin convertirlo", () => {
    const onCambiar = vi.fn();
    render(<CampoTopePasos valor="5" onCambiar={onCambiar} error={null} />);

    fireEvent.change(screen.getByLabelText("Tope de pasos por corrida"), {
      target: { value: "5x" },
    });

    expect(onCambiar).toHaveBeenCalledWith("5x");
  });

  it("de sólo lectura para quien no puede guardar", () => {
    render(<CampoTopePasos valor="500" onCambiar={vi.fn()} error={null} soloLectura />);

    expect((screen.getByLabelText("Tope de pasos por corrida") as HTMLInputElement).readOnly).toBe(
      true,
    );
  });
});
