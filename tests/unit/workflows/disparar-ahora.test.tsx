import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DispararAhora } from "@/app/(panel)/workflows/_components/DispararAhora";
import type { LeadListItem } from "@/types/leads";

/**
 * «Disparar ahora» en la tarjeta de un flujo con disparador manual. La action
 * (`dispararWorkflowManualAction`) pide un id nuevo por cada clic: es la
 * clave de deduplicación, y dos clics tienen que arrancar dos corridas.
 */

afterEach(cleanup);

const LEAD: LeadListItem = {
  leadId: "11111111-1111-4111-8111-111111111111",
  nombre: "Juan Pérez",
  telefono: "+54911",
  canalOrigen: "wa",
  vehiculo: "",
  sesionActiva: true,
  currentStage: "nuevo",
  resultado: null,
  motivoPerdida: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const WF = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function abrirYElegir() {
  fireEvent.click(screen.getByRole("button", { name: "Disparar ahora" }));
  fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "juan" } });
  fireEvent.click(await screen.findByRole("button", { name: /Juan Pérez/ }, { timeout: 2000 }));
}

describe("DispararAhora", () => {
  it("dispara para el lead elegido con un id nuevo por cada clic", async () => {
    const onDisparar = vi.fn(async () => ({ ok: true as const }));
    render(
      <DispararAhora
        workflowId={WF}
        nombreFlujo="Reenvío manual"
        onBuscarLeads={async () => ({ ok: true, items: [LEAD] })}
        onDisparar={onDisparar}
      />,
    );
    await abrirYElegir();
    fireEvent.click(screen.getByRole("button", { name: /Disparar para Juan Pérez/ }));
    await screen.findByText(/arranca en unos segundos/);
    fireEvent.click(screen.getByRole("button", { name: /Disparar otra vez/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Disparar para Juan Pérez/ }));
    await vi.waitFor(() => expect(onDisparar).toHaveBeenCalledTimes(2));

    const [primero, segundo] = onDisparar.mock.calls.map((c) => (c as unknown[])[0]) as Array<{
      workflowId: string;
      leadId: string;
      solicitudId: string;
    }>;
    expect(primero).toMatchObject({ workflowId: WF, leadId: LEAD.leadId });
    expect(primero?.solicitudId).toMatch(UUID);
    expect(segundo?.solicitudId).toMatch(UUID);
    expect(primero?.solicitudId).not.toBe(segundo?.solicitudId);
  });

  it("si la action dice que no, muestra su motivo", async () => {
    render(
      <DispararAhora
        workflowId={WF}
        nombreFlujo="Reenvío manual"
        onBuscarLeads={async () => ({ ok: true, items: [LEAD] })}
        onDisparar={async () => ({
          ok: false,
          error: "El flujo está pausado: reanudalo para dispararlo.",
        })}
      />,
    );
    await abrirYElegir();
    fireEvent.click(screen.getByRole("button", { name: /Disparar para Juan Pérez/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("pausado");
  });
});
