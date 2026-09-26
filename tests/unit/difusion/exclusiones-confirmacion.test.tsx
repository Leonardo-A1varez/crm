import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExclusionesAudiencia } from "@/components/difusion/ExclusionesAudiencia";

afterEach(cleanup);

/**
 * Eximir una exclusión opcional ("en negociación", "tope de frecuencia") pide
 * confirmación explícita; volver a excluir, no.
 */
describe("ExclusionesAudiencia — confirmar antes de eximir", () => {
  it("destildar abre la confirmación y sólo aplica al confirmar", () => {
    const onAlternar = vi.fn();
    render(<ExclusionesAudiencia exclusiones={null} aplicadas={{}} onAlternar={onAlternar} />);

    const casillas = screen.getAllByRole("checkbox");
    fireEvent.click(casillas[0]!);
    expect(onAlternar).not.toHaveBeenCalled();
    expect(screen.getByText("¿Mandarles igual?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mandarles igual" }));
    expect(onAlternar).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("cancelar no cambia nada", () => {
    const onAlternar = vi.fn();
    render(<ExclusionesAudiencia exclusiones={null} aplicadas={{}} onAlternar={onAlternar} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Seguir excluyéndolos" }));
    expect(onAlternar).not.toHaveBeenCalled();
  });

  it("volver a tildar no pregunta", () => {
    const onAlternar = vi.fn();
    render(
      <ExclusionesAudiencia
        exclusiones={null}
        aplicadas={{ cap_frecuencia: false, en_negociacion: false }}
        onAlternar={onAlternar}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(onAlternar).toHaveBeenCalledWith(expect.any(String), true);
    expect(screen.queryByText("¿Mandarles igual?")).toBeNull();
  });
});
