import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GaleriaPlantillas } from "@/components/workflows/lista/GaleriaPlantillas";

afterEach(cleanup);

/** La galería avisa, antes de abrir una plantilla, qué bloques de su lienzo no corren. */
describe("GaleriaPlantillas: bloques que no corren", () => {
  it("la tarjeta afectada lo dice con el nombre del bloque, y las demás no dicen nada", () => {
    render(
      <GaleriaPlantillas
        hrefVolver="/workflows"
        hrefPlantilla={(id) => `/workflows/nuevo/${id}`}
        hrefEnBlanco="/workflows/nuevo/en-blanco"
        noCorren={{ "escalar-a-humano": ["Notificar vendedor"] }}
      />,
    );
    const avisos = screen.getAllByText(/todavía no se ejecuta/);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.textContent).toContain("«Notificar vendedor»");
  });

  it("sin bloques que no corran, no hay aviso", () => {
    render(
      <GaleriaPlantillas
        hrefVolver="/workflows"
        hrefPlantilla={(id) => `/workflows/nuevo/${id}`}
        hrefEnBlanco="/workflows/nuevo/en-blanco"
        noCorren={{}}
      />,
    );
    expect(screen.queryByText(/todavía no se ejecuta/)).toBeNull();
  });
});
