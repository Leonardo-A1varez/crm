import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VistaPreviaContraLead } from "@/components/workflows/canvas/config/VistaPreviaContraLead";
import type { LeadListItem } from "@/types/leads";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LEAD: LeadListItem = {
  leadId: "11111111-1111-4111-8111-111111111111",
  nombre: "Juan Pérez",
  telefono: "+54911",
  canalOrigen: "wa",
  vehiculo: "Toyota Hilux 2018",
  sesionActiva: true,
  currentStage: "cotizado",
  resultado: null,
  motivoPerdida: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function elegirLead(ultimoEntranteAt: string | null) {
  const onBuscar = vi.fn(async () => ({ ok: true as const, items: [LEAD] }));
  const onLeer = vi.fn(async () => ({
    ok: true as const,
    data: {
      datos: { lead: { nombre: "Juan", email: null } },
      ventana: { canal: "wa", ultimoEntranteAt },
    },
  }));
  render(
    <VistaPreviaContraLead
      mensaje="Hola {{lead.nombre}}, te escribo a {{lead.email}}"
      onBuscarLeads={onBuscar}
      onLeer={onLeer}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "juan" } });
  fireEvent.click(await screen.findByRole("button", { name: /Juan Pérez/ }, { timeout: 2000 }));
  return { onLeer };
}

describe("VistaPreviaContraLead", () => {
  it("resuelve las variables con el interpolador del motor y avisa cuáles salen vacías", async () => {
    const { onLeer } = await elegirLead(new Date().toISOString());
    expect(onLeer).toHaveBeenCalledWith({ leadId: LEAD.leadId });
    expect(await screen.findByText("Hola Juan, te escribo a")).toBeTruthy();
    expect(screen.getByText(/sale vacía/).textContent).toContain("email");
  });

  it("dentro de la ventana de 24 h lo dice", async () => {
    await elegirLead(new Date().toISOString());
    expect(
      (await screen.findAllByRole("status")).some((s) => /dentro/.test(s.textContent ?? "")),
    ).toBe(true);
  });

  it("fuera de la ventana avisa que el motor salta el paso", async () => {
    await elegirLead(new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());
    const avisos = await screen.findAllByRole("status");
    expect(avisos.some((s) => /sin_ventana/.test(s.textContent ?? ""))).toBe(true);
  });
});
