import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InterruptorModo } from "@/components/inbox/copiloto/InterruptorModo";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => {
  cleanup();
  toastError.mockClear();
});

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

function montar(
  props: Partial<React.ComponentProps<typeof InterruptorModo>> = {},
  resultado: { ok: true } | { ok: false; error: string } = { ok: true },
) {
  const onCambiar = vi.fn().mockResolvedValue(resultado);
  render(
    <InterruptorModo
      leadId={LEAD}
      conversacionId={CONV}
      override={null}
      modoEfectivo="copiloto"
      onCambiar={onCambiar}
      {...props}
    />,
  );
  return { onCambiar, disparador: screen.getByRole("combobox", { name: "Modo de respuesta" }) };
}

async function elegir(disparador: HTMLElement, nombre: string) {
  fireEvent.mouseDown(disparador);
  const opcion = await screen.findByRole("option", { name: nombre });
  fireEvent.keyDown(opcion, { key: "Shift" });
  fireEvent.click(opcion);
}

describe("InterruptorModo", () => {
  it("en Según horario muestra el modo efectivo", () => {
    const { disparador } = montar();
    expect(disparador.textContent).toContain("Según horario · ahora Copiloto");
  });

  it("con un override fijo muestra solo ese modo", () => {
    const { disparador } = montar({ override: "automatico", modoEfectivo: "automatico" });
    expect(disparador.textContent).toContain("Automático");
    expect(disparador.textContent).not.toContain("Según horario");
  });

  it("elegir Automático llama a la action con el modo nombrado", async () => {
    const { onCambiar, disparador } = montar();
    await elegir(disparador, "Automático");
    await waitFor(() =>
      expect(onCambiar).toHaveBeenCalledWith({
        leadId: LEAD,
        conversacionId: CONV,
        modo: "automatico",
      }),
    );
  });

  it("volver a Según horario manda segun_horario (no null)", async () => {
    const { onCambiar, disparador } = montar({ override: "copiloto" });
    await elegir(disparador, "Según horario · ahora Copiloto");
    await waitFor(() =>
      expect(onCambiar).toHaveBeenCalledWith({
        leadId: LEAD,
        conversacionId: CONV,
        modo: "segun_horario",
      }),
    );
  });

  it("si la action falla avisa con un toast", async () => {
    const { disparador } = montar({}, { ok: false, error: "No se pudo completar la acción." });
    await elegir(disparador, "Copiloto");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo completar la acción."));
    expect(disparador.textContent).toContain("Según horario · ahora Copiloto");
  });

  it("si la promesa rechaza avisa con un toast genérico", async () => {
    const onCambiar = vi.fn().mockRejectedValue(new Error("red"));
    const { disparador } = montar({ onCambiar });
    await elegir(disparador, "Automático");
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No se pudo cambiar el modo. Reintentá."),
    );
  });

  it("mientras hay un cambio pendiente no deja disparar otro", async () => {
    const onCambiar = vi.fn().mockReturnValue(new Promise(() => {}));
    const { disparador } = montar({ onCambiar });
    await elegir(disparador, "Automático");
    await waitFor(() => expect(disparador.hasAttribute("data-disabled")).toBe(true));
    fireEvent.mouseDown(disparador);
    expect(screen.queryByRole("option", { name: "Copiloto" })).toBeNull();
    expect(onCambiar).toHaveBeenCalledTimes(1);
  });
});
