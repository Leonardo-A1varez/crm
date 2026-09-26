import { describe, expect, it, vi } from "vitest";
import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";
import { InMemoryWorkflowPlantillasSinSesionRepository } from "@/server/repositories/workflow-plantillas-sin-sesion.repo";
import {
  DefaultEnvioPlantillaSinSesion,
  DefaultAnotarPlantillasSinSesion,
} from "@/server/services/workflows/plantilla-sin-sesion.service";

/**
 * Una plantilla de un flujo a un lead sin sesión: sale por el cliente de Meta
 * con reserva propia, y se anota en el hilo cuando el lead responde.
 */

const AHORA = new Date("2026-09-25T12:00:00Z");

const entrada = {
  idempotencyKey: "wf:r1:3",
  workflowRunId: "r1",
  leadId: "l1",
  conversacionId: "c1",
  to: "+5491155550000",
  plantilla: { nombre: "volvamos", idioma: "es_AR", parametrosCuerpo: ["Ana"] },
};

function armar(sendTemplate = vi.fn(async () => ({ meta_message_id: "wamid.A" }))) {
  const repo = new InMemoryWorkflowPlantillasSinSesionRepository();
  const svc = new DefaultEnvioPlantillaSinSesion({
    repo,
    meta: { sendTemplate },
    ahora: () => AHORA,
  });
  return { repo, svc, sendTemplate };
}

describe("DefaultEnvioPlantillaSinSesion", () => {
  it("reserva, manda por Meta y deja la fila aceptada con el wamid", async () => {
    const { repo, svc, sendTemplate } = armar();
    const r = await svc.enviar(entrada);
    expect(sendTemplate).toHaveBeenCalledWith({ to: entrada.to, plantilla: entrada.plantilla });
    expect(r.meta_message_id).toBe("wamid.A");
    const fila = await repo.findByIdempotencyKey("wf:r1:3");
    expect(fila).toMatchObject({
      estado: "aceptado",
      contenido: "Plantilla «volvamos»: Ana",
      intento_at: AHORA,
      conversacion_id: "c1",
    });
    expect(await repo.contarNoAnotadasDesde("l1", new Date(0))).toBe(1);
  });

  it("un reintento con la misma clave no vuelve a mandar", async () => {
    const { svc, sendTemplate } = armar();
    await svc.enviar(entrada);
    await svc.enviar(entrada);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("un 429 libera la reserva para que el reintento pruebe de verdad", async () => {
    const send = vi.fn(async () => {
      throw new RateLimitError("429", "meta");
    });
    const { repo, svc } = armar(send as never);
    await expect(svc.enviar(entrada)).rejects.toBeInstanceOf(RateLimitError);
    expect(await repo.findByIdempotencyKey("wf:r1:3")).toBeNull();
  });

  it("un rechazo o un desenlace desconocido queda fallido y no se reenvía", async () => {
    const send = vi.fn(async () => {
      throw new InfraError("timeout", "meta");
    });
    const { repo, svc } = armar(send as never);
    await expect(svc.enviar(entrada)).rejects.toBeInstanceOf(InfraError);
    expect((await repo.findByIdempotencyKey("wf:r1:3"))?.estado).toBe("fallido");
    await svc.enviar(entrada);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("un rechazo de Meta guarda su código", async () => {
    const send = vi.fn(async () => {
      throw new ValidationError("rechazo", { status: 400, code: 131026 });
    });
    const { repo, svc } = armar(send as never);
    await expect(svc.enviar(entrada)).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.findByIdempotencyKey("wf:r1:3"))?.error_codigo).toBe("131026");
  });
});

describe("DefaultAnotarPlantillasSinSesion", () => {
  function armarAnotar() {
    const repo = new InMemoryWorkflowPlantillasSinSesionRepository();
    const mensajes = new Map<string, { id: string; lead_session_id: string }>();
    const registrar = vi.fn(async (m: { meta_message_id: string; lead_session_id: string }) => {
      const fila = { id: `m-${mensajes.size + 1}`, lead_session_id: m.lead_session_id };
      mensajes.set(m.meta_message_id, fila);
      return fila;
    });
    const svc = new DefaultAnotarPlantillasSinSesion({
      repo,
      messages: {
        findByMetaMessageId: vi.fn(async (w: string) => mensajes.get(w) ?? null) as never,
        registrarSalienteYaEnviado: registrar as never,
      },
    });
    return { repo, svc, registrar };
  }

  it("cuando el lead responde, la plantilla entra al hilo con la hora en que salió", async () => {
    const { repo, svc, registrar } = armarAnotar();
    const fila = await repo.reservar({
      idempotency_key: "wf:r1:3",
      workflow_run_id: "r1",
      lead_id: "l1",
      conversacion_id: "c1",
      plantilla_nombre: "volvamos",
      plantilla_idioma: "es_AR",
      contenido: "Plantilla «volvamos»: Ana",
      parametros_cuerpo: ["Ana"],
      intento_at: new Date("2026-09-24T09:00:00Z"),
    });
    await repo.marcarAceptado(fila.id, "wamid.A");
    await repo.aplicarEstadoMeta("wamid.A", "leido", new Date("2026-09-24T09:05:00Z"));

    const anotadas = await svc.registrar({
      leadId: "l1",
      conversacionId: "c9",
      leadSessionId: "s-nueva",
      ahora: AHORA,
    });

    expect(anotadas).toBe(1);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        conversacion_id: "c9",
        lead_session_id: "s-nueva",
        direction: "out",
        sender: "sistema",
        tipo: "template",
        contenido: "Plantilla «volvamos»: Ana",
        meta_message_id: "wamid.A",
        created_at: new Date("2026-09-24T09:00:00Z"),
        estado_entrega: "leido",
        metadata: {
          plantilla_meta: { nombre: "volvamos", idioma: "es_AR", parametros_cuerpo: ["Ana"] },
          workflow: { run_id: "r1" },
        },
      }),
    );
    // Ya en el hilo: el tope la cuenta por `mensajes`, no dos veces.
    expect(await repo.contarNoAnotadasDesde("l1", new Date(0))).toBe(0);
    // Un segundo entrante no la vuelve a anotar.
    expect(
      await svc.registrar({
        leadId: "l1",
        conversacionId: "c9",
        leadSessionId: "s-nueva",
        ahora: AHORA,
      }),
    ).toBe(0);
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it("fuera de la ventana de atribución no se anota", async () => {
    const { repo, svc, registrar } = armarAnotar();
    const fila = await repo.reservar({
      idempotency_key: "wf:r1:3",
      workflow_run_id: "r1",
      lead_id: "l1",
      conversacion_id: "c1",
      plantilla_nombre: "volvamos",
      plantilla_idioma: "es",
      contenido: "Plantilla «volvamos»",
      parametros_cuerpo: [],
      intento_at: new Date("2026-09-01T09:00:00Z"),
    });
    await repo.marcarAceptado(fila.id, "wamid.A");
    expect(
      await svc.registrar({
        leadId: "l1",
        conversacionId: "c1",
        leadSessionId: "s1",
        ahora: AHORA,
      }),
    ).toBe(0);
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("InMemoryWorkflowPlantillasSinSesionRepository", () => {
  async function conFila() {
    const repo = new InMemoryWorkflowPlantillasSinSesionRepository();
    const fila = await repo.reservar({
      idempotency_key: "wf:r1:1",
      workflow_run_id: "r1",
      lead_id: "l1",
      conversacion_id: "c1",
      plantilla_nombre: "hola",
      plantilla_idioma: "es",
      contenido: "Plantilla «hola»",
      parametros_cuerpo: [],
      intento_at: AHORA,
    });
    return { repo, fila };
  }

  it("un estado tardío no hace retroceder la fila", async () => {
    const { repo, fila } = await conFila();
    await repo.marcarAceptado(fila.id, "wamid.X");
    await repo.aplicarEstadoMeta("wamid.X", "leido", AHORA);
    expect(await repo.aplicarEstadoMeta("wamid.X", "entregado", AHORA)).toBe(true);
    expect((await repo.findByIdempotencyKey("wf:r1:1"))?.estado).toBe("leido");
  });

  it("un wamid ajeno no es de esta tabla", async () => {
    const { repo } = await conFila();
    expect(await repo.aplicarEstadoMeta("wamid.otro", "entregado", AHORA)).toBe(false);
  });

  it("la misma clave no se reserva dos veces", async () => {
    const { repo } = await conFila();
    await expect(
      repo.reservar({
        idempotency_key: "wf:r1:1",
        workflow_run_id: "r1",
        lead_id: "l1",
        conversacion_id: "c1",
        plantilla_nombre: "hola",
        plantilla_idioma: "es",
        contenido: "x",
        parametros_cuerpo: [],
        intento_at: AHORA,
      }),
    ).rejects.toThrow();
  });

  it("una fallida no cuenta para el tope", async () => {
    const { repo, fila } = await conFila();
    await repo.marcarFallido(fila.id, { codigo: "131026", detalle: null });
    expect(await repo.contarNoAnotadasDesde("l1", new Date(0))).toBe(0);
  });
});
