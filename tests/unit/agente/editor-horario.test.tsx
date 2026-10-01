import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EditorHorario } from "@/app/(panel)/agente/_components/EditorHorario";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";

afterEach(cleanup);

describe("EditorHorario", () => {
  it("por defecto muestra y edita la zona horaria", () => {
    render(
      <EditorHorario
        horario={CONFIG_DE_FABRICA.horario}
        timezone="America/Guayaquil"
        onChange={vi.fn()}
      />,
    );
    const zona = screen.getByPlaceholderText("America/Argentina/Buenos_Aires") as HTMLInputElement;
    expect(zona.value).toBe("America/Guayaquil");
  });

  it("con mostrarZona={false} no hay campo de zona (la zona es una sola para los dos horarios)", () => {
    render(
      <EditorHorario
        horario={CONFIG_DE_FABRICA.horario_equipo}
        timezone="America/Guayaquil"
        mostrarZona={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText("America/Argentina/Buenos_Aires")).toBeNull();
    expect(screen.getAllByText("Cerrado")).toHaveLength(7);
  });
});
