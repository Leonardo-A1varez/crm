import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PruebaAMiNumero } from "@/components/difusion/PruebaAMiNumero";
import type { Destinatario } from "@/components/difusion/tipos";

afterEach(cleanup);

const DEST: Destinatario[] = [
  {
    leadId: "l1",
    nombre: "Ana",
    telefono: "+549 ••• ••• 000",
    vehiculo: null,
    ruta: "plantilla",
    contenido: "plantilla",
    tanda: 0,
    diff: null,
  },
  {
    leadId: "l2",
    nombre: "Beto",
    telefono: "+549 ••• ••• 111",
    vehiculo: null,
    ruta: "plantilla",
    contenido: "plantilla",
    tanda: 0,
    diff: null,
  },
];

describe("PruebaAMiNumero", () => {
  it("manda al número escrito con el lead elegido y dice cuántas quedan", async () => {
    const onEnviar = vi.fn(async () => ({ ok: true as const, restantes: 4 }));
    render(<PruebaAMiNumero destinatarios={DEST} onEnviar={onEnviar} />);

    fireEvent.change(screen.getByLabelText("Número, con código de país"), {
      target: { value: "+54 9 11 5555 0000" },
    });
    fireEvent.change(screen.getByLabelText("Variables de"), { target: { value: "l2" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar de prueba" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Te quedan 4"));
    expect(onEnviar).toHaveBeenCalledWith({ telefono: "+54 9 11 5555 0000", leadId: "l2" });
  });

  it("sin número no deja mandar", () => {
    render(<PruebaAMiNumero destinatarios={DEST} onEnviar={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: "Enviar de prueba" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("muestra el error del servidor", async () => {
    const onEnviar = vi.fn(async () => ({ ok: false as const, error: "Ya mandaste 5 pruebas" }));
    render(<PruebaAMiNumero destinatarios={DEST} onEnviar={onEnviar} />);
    fireEvent.change(screen.getByLabelText("Número, con código de país"), {
      target: { value: "+5491155550000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar de prueba" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Ya mandaste 5 pruebas"),
    );
  });
});
