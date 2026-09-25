import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaletaNodos } from "@/components/workflows/canvas/PaletaNodos";
import { CATEGORIAS_NODOS } from "@/lib/workflows/nodos-catalogo";
import { NODO_TIPOS, NODO_TIPOS_LEGACY } from "@/types/workflows";

function crearDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: vi.fn((tipo: string, valor: string) => {
      data[tipo] = valor;
    }),
    getData: (tipo: string) => data[tipo] ?? "",
    effectAllowed: "",
  };
}

describe("PaletaNodos", () => {
  it("renderiza las 7 categorías con su cantidad de nodos", () => {
    const { container } = render(<PaletaNodos onDragStart={() => {}} />);

    for (const categoria of CATEGORIAS_NODOS) {
      const header = screen.getByRole("button", { name: new RegExp(categoria.nombre) });
      expect(header).toBeTruthy();
      expect(header.textContent).toContain(String(categoria.nodos.length));
    }

    // Todo tipo del dominio salvo los cinco legacy está en la paleta.
    const esperado = NODO_TIPOS.length - NODO_TIPOS_LEGACY.length;
    const total = CATEGORIAS_NODOS.reduce((acc, c) => acc + c.nodos.length, 0);
    expect(total).toBe(esperado);
    expect(container.querySelectorAll("[data-tipo]").length).toBe(esperado);
  });

  it("Triggers está expandida por defecto y las demás colapsadas", () => {
    render(<PaletaNodos onDragStart={() => {}} />);

    const headerTriggers = screen.getByRole("button", { name: /Triggers/ });
    const headerCrm = screen.getByRole("button", { name: /CRM/ });
    expect(headerTriggers.getAttribute("aria-expanded")).toBe("true");
    expect(headerCrm.getAttribute("aria-expanded")).toBe("false");
  });

  it("expande y colapsa una categoría al hacer click en el header", () => {
    render(<PaletaNodos onDragStart={() => {}} />);

    const headerMensajeria = screen.getByRole("button", { name: /Mensajería/ });
    expect(headerMensajeria.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(headerMensajeria);
    expect(headerMensajeria.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(headerMensajeria);
    expect(headerMensajeria.getAttribute("aria-expanded")).toBe("false");
  });

  it("la búsqueda filtra por nombre o descripción, case-insensitive, y esconde las categorías", () => {
    const { container } = render(<PaletaNodos onDragStart={() => {}} />);
    const input = screen.getByPlaceholderText("Buscar nodos...");

    fireEvent.change(input, { target: { value: "WEBHOOK" } });

    // "Webhook" (trigger, matchea nombre) + "Webhook saliente" (integración, matchea nombre)
    expect(container.querySelector('[data-tipo="trigger_webhook"]')).toBeTruthy();
    expect(container.querySelector('[data-tipo="int_webhook_out"]')).toBeTruthy();
    expect(container.querySelectorAll("[data-tipo]").length).toBe(2);

    // Sin categorías visibles mientras se busca
    expect(screen.queryByRole("button", { name: /Triggers/ })).toBeNull();
  });

  it("la búsqueda también matchea por descripción", () => {
    const { container } = render(<PaletaNodos onDragStart={() => {}} />);
    const input = screen.getByPlaceholderText("Buscar nodos...");

    // "Cuando pierde etiqueta" es la descripción de trigger_etiqueta_removida
    fireEvent.change(input, { target: { value: "pierde etiqueta" } });

    expect(container.querySelector('[data-tipo="trigger_etiqueta_removida"]')).toBeTruthy();
    expect(container.querySelectorAll("[data-tipo]").length).toBe(1);
  });

  it("muestra un mensaje cuando la búsqueda no matchea ningún nodo", () => {
    render(<PaletaNodos onDragStart={() => {}} />);
    const input = screen.getByPlaceholderText("Buscar nodos...");

    fireEvent.change(input, { target: { value: "xyz-no-existe" } });

    expect(screen.getByText("Sin resultados")).toBeTruthy();
  });

  it("el drag inicia con el tipo correcto y lo manda por dataTransfer", () => {
    const onDragStart = vi.fn();
    const { container } = render(<PaletaNodos onDragStart={onDragStart} />);

    const nodo = container.querySelector('[data-tipo="trigger_mensaje"]') as HTMLElement;
    expect(nodo).toBeTruthy();

    const dataTransfer = crearDataTransfer();
    fireEvent.dragStart(nodo, { dataTransfer });

    expect(onDragStart).toHaveBeenCalledWith("trigger_mensaje");
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/reactflow", "trigger_mensaje");
  });
});
