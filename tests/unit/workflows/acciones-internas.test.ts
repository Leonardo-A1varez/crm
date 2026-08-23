import { describe, expect, it, vi } from "vitest";
import { crearAccionesInternas } from "@/server/services/workflows/acciones/internas";
import { ValidationError } from "@/lib/errors";

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 1, contexto: {} };
const nodo = (config: Record<string, unknown>) => ({
  id: "n",
  tipo: "accion" as const,
  config,
  posicion: { x: 0, y: 0 },
});

describe("acciones internas", () => {
  it("poner_etiqueta escribe con source workflow", async () => {
    const tags = { assignToLead: vi.fn(async () => ({})) };
    const acciones = crearAccionesInternas({ tags, sessions: {}, handoff: {} } as never);
    const r = await acciones["poner_etiqueta"]!(
      nodo({ accion: "poner_etiqueta", tagId: "t1" }),
      entorno,
    );
    // `workflow` es lo que hace que no reviva una etiqueta que una persona saco.
    expect(tags.assignToLead).toHaveBeenCalledWith("l1", "t1", "workflow", null);
    expect(r.puerto).toBe("salida");
  });

  it("poner_etiqueta sin tagId es ValidationError", async () => {
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff: {} } as never);
    await expect(
      acciones["poner_etiqueta"]!(nodo({ accion: "poner_etiqueta" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("poner_etiqueta con tagId no-string es ValidationError", async () => {
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff: {} } as never);
    await expect(
      acciones["poner_etiqueta"]!(nodo({ accion: "poner_etiqueta", tagId: 42 }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("poner_etiqueta refleja en la salida si la fila estaba descartada por una persona", async () => {
    const quitadaAt = new Date("2026-08-20T10:00:00.000Z");
    const tags = { assignToLead: vi.fn(async () => ({ quitada_at: quitadaAt })) };
    const acciones = crearAccionesInternas({ tags, sessions: {}, handoff: {} } as never);
    const r = await acciones["poner_etiqueta"]!(
      nodo({ accion: "poner_etiqueta", tagId: "t1" }),
      entorno,
    );
    expect(r.salida).toEqual({ tag_id: "t1", quitada_at: quitadaAt.toISOString() });
  });

  it("cambiar_etapa escribe current_stage y procedencia por: workflow en la misma operacion", async () => {
    const sesionActual = { current_stage: "cotizado", procedencia: {} };
    const sessions = {
      findById: vi.fn(async () => sesionActual),
      aplicarExtraccion: vi.fn(async () => ({})),
    };
    const acciones = crearAccionesInternas({ tags: {}, sessions, handoff: {} } as never);
    const r = await acciones["cambiar_etapa"]!(
      nodo({ accion: "cambiar_etapa", etapa: "negociando" }),
      entorno,
    );
    expect(sessions.aplicarExtraccion).toHaveBeenCalledWith(
      "s1",
      { current_stage: "negociando" },
      {
        current_stage: expect.objectContaining({
          por: "workflow",
          user_id: null,
          mensaje_origen_id: null,
          valor_anterior: "cotizado",
        }),
      },
    );
    expect(r.puerto).toBe("salida");
    expect(r.salida).toEqual({ current_stage: "negociando" });
  });

  it("cambiar_etapa sobrescribe una etapa fijada a mano y el chip cambia de dueno", async () => {
    // El vendedor habia fijado "negociando" a mano (procedencia.por === "humano").
    // El dueno resolvio: el workflow gana, pero la procedencia tiene que decir
    // la verdad -- "workflow", no seguir mintiendo "humano".
    const sesionConPinHumano = {
      current_stage: "negociando",
      procedencia: {
        current_stage: { por: "humano", at: "2026-08-20T09:00:00.000Z", user_id: "u1" },
      },
    };
    const sessions = {
      findById: vi.fn(async () => sesionConPinHumano),
      aplicarExtraccion: vi.fn(async () => ({})),
    };
    const acciones = crearAccionesInternas({ tags: {}, sessions, handoff: {} } as never);
    await acciones["cambiar_etapa"]!(nodo({ accion: "cambiar_etapa", etapa: "cotizado" }), entorno);
    expect(sessions.aplicarExtraccion).toHaveBeenCalledWith(
      "s1",
      { current_stage: "cotizado" },
      {
        current_stage: expect.objectContaining({ por: "workflow", valor_anterior: "negociando" }),
      },
    );
  });

  it("cambiar_etapa sin etapa es ValidationError", async () => {
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff: {} } as never);
    await expect(
      acciones["cambiar_etapa"]!(nodo({ accion: "cambiar_etapa" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cambiar_etapa con etapa que no es del embudo es ValidationError", async () => {
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff: {} } as never);
    // "perdido" y "requiere_humano" son desvios, no posiciones del embudo: los decide el pipeline.
    await expect(
      acciones["cambiar_etapa"]!(nodo({ accion: "cambiar_etapa", etapa: "perdido" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      acciones["cambiar_etapa"]!(nodo({ accion: "cambiar_etapa", etapa: "no_existe" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cambiar_etapa sin lead_session_id en el entorno es ValidationError", async () => {
    const sessions = {
      findById: vi.fn(async () => ({})),
      aplicarExtraccion: vi.fn(async () => ({})),
    };
    const acciones = crearAccionesInternas({ tags: {}, sessions, handoff: {} } as never);
    await expect(
      acciones["cambiar_etapa"]!(nodo({ accion: "cambiar_etapa", etapa: "cotizado" }), {
        ...entorno,
        leadSessionId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sessions.findById).not.toHaveBeenCalled();
    expect(sessions.aplicarExtraccion).not.toHaveBeenCalled();
  });

  it("escalar_a_humano delega en HandoffService.pause con reason/source de regla", async () => {
    const handoff = {
      pause: vi.fn(async () => ({ id: "s1", current_stage: "requiere_humano" })),
    };
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff } as never);
    const r = await acciones["escalar_a_humano"]!(nodo({ accion: "escalar_a_humano" }), entorno);
    expect(handoff.pause).toHaveBeenCalledWith({
      sessionId: "s1",
      reasonCode: "rule_handoff",
      source: "rule",
      sourceEventKey: "workflow:r1:1",
      notifyCustomer: true,
    });
    expect(r.puerto).toBe("salida");
    expect(r.salida).toEqual({ lead_session_id: "s1", current_stage: "requiere_humano" });
  });

  it("escalar_a_humano sin lead_session_id en el entorno es ValidationError", async () => {
    const handoff = { pause: vi.fn(async () => ({})) };
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff } as never);
    await expect(
      acciones["escalar_a_humano"]!(nodo({ accion: "escalar_a_humano" }), {
        ...entorno,
        leadSessionId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(handoff.pause).not.toHaveBeenCalled();
  });

  it("el sourceEventKey de escalar_a_humano usa runId+orden como idempotencia", async () => {
    const handoff = {
      pause: vi.fn(async () => ({ id: "s1", current_stage: "requiere_humano" })),
    };
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff } as never);
    await acciones["escalar_a_humano"]!(nodo({ accion: "escalar_a_humano" }), {
      ...entorno,
      runId: "run-xyz",
      orden: 7,
    });
    expect(handoff.pause).toHaveBeenCalledWith(
      expect.objectContaining({ sourceEventKey: "workflow:run-xyz:7" }),
    );
  });
});
