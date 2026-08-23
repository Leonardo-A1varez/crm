import { describe, expect, it, vi } from "vitest";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { BudgetExceededError } from "@/lib/errors";

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 7, contexto: {} };
const nodo = {
  id: "env",
  tipo: "accion" as const,
  config: { accion: "enviar_mensaje", texto: "hola" },
  posicion: { x: 0, y: 0 },
};

function deps(salientesPrevios: number) {
  return {
    messages: { contarSalientesAutomaticos: vi.fn(async () => salientesPrevios) },
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m1" })) },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "whatsapp",
        ultimo_entrante_at: new Date(),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
    configProvider: { activa: vi.fn(async () => ({ max_salientes_automaticos_24h: 3 })) },
  } as never;
}

describe("enviar_mensaje", () => {
  it("manda cuando esta bajo el tope, con idempotency key derivada del paso", async () => {
    const d = deps(1);
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.puerto).toBe("salida");
    // La key es lo que evita el duplicado si Inngest reentrega el step.
    expect(
      (d as never as { metaApi: { sendOutbound: { mock: { calls: unknown[][] } } } }).metaApi
        .sendOutbound.mock.calls[0]![0],
    ).toMatchObject({ idempotencyKey: "wf:r1:7", sender: "sistema" });
  });

  it("al topar NO manda, y falla en voz alta", async () => {
    const d = deps(3);
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(
      (d as never as { metaApi: { sendOutbound: { mock: { calls: unknown[][] } } } }).metaApi
        .sendOutbound.mock.calls,
    ).toHaveLength(0);
  });
});
