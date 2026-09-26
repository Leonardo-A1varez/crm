import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProbarDialog } from "@/components/workflows/canvas/ProbarDialog";
import type { Grafo } from "@/types/workflows";

// Lead y grafo armados a mano para el test: no salen de ningún dato real.
const GRAFO: Grafo = { nodos: [], aristas: [] };
const LEAD = {
  leadId: "00000000-0000-4000-8000-000000000001",
  nombre: "Lead de prueba",
  telefono: "+000",
};

function montar(overrides: Partial<Parameters<typeof ProbarDialog>[0]> = {}) {
  const onProbar = vi.fn(async () => ({
    ok: true as const,
    runId: "r-probar",
    tipo: "completado" as const,
  }));
  const onProbarHastaAca = vi.fn(async () => ({
    ok: true as const,
    runId: "r-hasta",
    tipo: "detenido" as const,
    nodoId: "n3",
  }));
  const onIrACorrida = vi.fn();
  render(
    <ProbarDialog
      open
      onOpenChange={() => {}}
      workflowId="00000000-0000-4000-8000-00000000000f"
      grafo={GRAFO}
      maxPasos={50}
      onBuscarLeads={async () => ({ ok: true, items: [LEAD as never] })}
      onProbar={onProbar}
      onObtenerDetalleRun={async () => ({ ok: true, data: null })}
      hastaNodo={{ id: "n3", nombre: "Enviar texto" }}
      onProbarHastaAca={onProbarHastaAca}
      onIrACorrida={onIrACorrida}
      {...overrides}
    />,
  );
  return { onProbar, onProbarHastaAca, onIrACorrida };
}

async function elegirLead() {
  fireEvent.change(screen.getByPlaceholderText(/buscar lead/i), { target: { value: "lead" } });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
  fireEvent.click(await screen.findByRole("button", { name: /Lead de prueba/ }));
}

describe("Ejecutar hasta acá", () => {
  it("corre hasta el nodo con el mismo input que Probar y abre la corrida", async () => {
    const { onProbar, onProbarHastaAca, onIrACorrida } = montar();
    expect(screen.getByRole("heading", { name: /Ejecutar hasta «Enviar texto»/ })).toBeTruthy();

    await elegirLead();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar hasta acá" }));

    await waitFor(() => expect(onIrACorrida).toHaveBeenCalledWith("r-hasta"));
    expect(onProbarHastaAca).toHaveBeenCalledWith({
      workflowId: "00000000-0000-4000-8000-00000000000f",
      grafo: GRAFO,
      maxPasos: 50,
      leadId: LEAD.leadId,
      hastaNodo: "n3",
    });
    expect(onProbar).not.toHaveBeenCalled();
  });

  it("si la acción falla, lo dice y no navega", async () => {
    const { onIrACorrida } = montar({
      onProbarHastaAca: vi.fn(async () => ({
        ok: false as const,
        error: "El flujo tiene errores.",
      })),
    });
    await elegirLead();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar hasta acá" }));

    expect(await screen.findByText("El flujo tiene errores.")).toBeTruthy();
    expect(onIrACorrida).not.toHaveBeenCalled();
  });
});
