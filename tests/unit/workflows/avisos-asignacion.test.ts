import { describe, expect, it, vi } from "vitest";
import { makeAvisosDeAsignacion } from "@/inngest/callbacks/workflow-adapters";
import { sesionSimulada } from "@/server/services/workflows/simulador.service";

describe("aviso «vendedor asignado»", () => {
  const sesion = {
    ...sesionSimulada("lead-1", new Date("2026-09-25T10:00:00Z")),
    id: "ses-1",
    current_stage: "cotizado" as const,
    vendedor_asignado_id: "ven-1",
    asignado_at: new Date("2026-09-25T10:05:00Z"),
  };

  it("emite el disparo vendedor_asignado del lead, con id por asignación", async () => {
    const emitir = vi.fn(async () => {});
    await makeAvisosDeAsignacion(emitir).vendedorAsignado({
      leadId: "lead-1",
      sesion,
      vendedorId: "ven-1",
      runId: "run-1",
      orden: 4,
      profundidad: 1,
    });

    expect(emitir).toHaveBeenCalledWith({
      id: "workflow-disparo:vendedor-asignado:ses-1:ven-1:2026-09-25T10:05:00.000Z",
      data: {
        disparador: "vendedor_asignado",
        leadId: "lead-1",
        leadSessionId: "ses-1",
        contexto: { lead: { etapa: "cotizado" }, sesion: { tiene_cotizacion: false } },
        profundidad: 1,
      },
    });
  });

  it("sin la hora de la asignación, el id sale del paso de la corrida", async () => {
    const emitir = vi.fn(async () => {});
    await makeAvisosDeAsignacion(emitir).vendedorAsignado({
      leadId: "lead-1",
      sesion: { ...sesion, asignado_at: null },
      vendedorId: "ven-1",
      runId: "run-1",
      orden: 4,
      profundidad: 1,
    });
    expect(emitir).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workflow-disparo:vendedor-asignado:ses-1:ven-1:run-1:4" }),
    );
  });
});
