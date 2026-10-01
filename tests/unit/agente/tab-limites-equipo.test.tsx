import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TabLimites } from "@/app/(panel)/agente/_components/TabLimites";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";

afterEach(cleanup);

function seccion(titulo: string): HTMLElement {
  const h = screen.getByRole("heading", { name: titulo });
  return h.closest("section") as HTMLElement;
}

describe("TabLimites — horario del equipo", () => {
  it("hay dos tarjetas de horario, con los subtítulos de §5", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);

    const equipo = seccion("Horario del equipo");
    expect(
      within(equipo).getByText(
        "Cuándo hay personas para enviar desde WhatsApp Web. En este horario la IA redacta y vos enviás.",
      ),
    ).toBeTruthy();
    expect(within(equipo).getByText(/Vacío = sin equipo: la IA responde sola/)).toBeTruthy();
    expect(seccion("Horario del agente")).toBeTruthy();
  });

  it("la zona horaria se edita una sola vez, en la tarjeta del agente; la del equipo la nombra", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);

    expect(
      within(seccion("Horario del agente")).getByPlaceholderText("America/Argentina/Buenos_Aires"),
    ).toBeTruthy();
    const equipo = seccion("Horario del equipo");
    expect(within(equipo).queryByPlaceholderText("America/Argentina/Buenos_Aires")).toBeNull();
    expect(equipo.textContent).toContain(CONFIG_DE_FABRICA.horario_timezone);
  });

  it("agregar un rango en el equipo emite horario_equipo y NO toca el horario del agente", () => {
    const onChange = vi.fn();
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={onChange} />);
    const equipo = seccion("Horario del equipo");

    const [desde, hasta] = Array.from(
      equipo.querySelectorAll<HTMLInputElement>('input[type="time"]'),
    );
    fireEvent.change(desde!, { target: { value: "09:00" } });
    fireEvent.change(hasta!, { target: { value: "18:00" } });
    fireEvent.click(within(equipo).getAllByRole("button", { name: "Agregar" })[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["horario_equipo"]);
    expect((patch.horario_equipo as { lun: unknown }).lun).toEqual([
      { desde: "09:00", hasta: "18:00" },
    ]);
  });

  it("recomienda dejar el agente 24/7 y explica qué pasa si se cierra de noche", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);
    const texto = seccion("Horario del equipo").textContent ?? "";
    expect(texto).toContain("24/7");
    expect(texto).toContain("plantilla");
  });

  it("la tarjeta del agente aclara que es cuándo la IA puede actuar", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);
    expect(seccion("Horario del agente").textContent).toContain("Cuándo la IA puede actuar");
  });
});
