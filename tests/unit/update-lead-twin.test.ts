import { beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import {
  updateLeadTwinHandler,
  type UpdateLeadTwinDeps,
} from "@/inngest/functions/update-lead-twin";
import { FakeTwinExtractorLLM } from "../mocks/llm";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";

async function setup() {
  const sessions = new InMemoryLeadSessionRepository();
  const llm = new FakeTwinExtractorLLM();
  const extractor = new DefaultTwinExtractorService(
    sessions,
    llm,
    new InMemoryLeadVehiculosRepository(),
  );
  const deps: UpdateLeadTwinDeps = {
    twinExtractor: extractor,
    sessions,
    emitirDisparo: vi.fn(async () => {}),
  };
  return { sessions, llm, deps };
}

async function seedSession(sessions: InMemoryLeadSessionRepository) {
  return sessions.create({
    lead_id: crypto.randomUUID(),
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
}

describe("updateLeadTwinHandler", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  test("invoca twin-extractor con sessionId y turn", async () => {
    const s = await seedSession(ctx.sessions);
    ctx.llm.enqueue({ current_stage: "identificando" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["lead: hola", "ia: hola"] },
      ctx.deps,
    );

    expect(ctx.llm.calls).toHaveLength(1);
    expect(ctx.llm.calls[0].current.id).toBe(s.id);
    expect(ctx.llm.calls[0].conversationTurn).toEqual(["lead: hola", "ia: hola"]);
    expect(result.sesion.current_stage).toBe("identificando");
  });

  test("sesion cerrada no llama LLM (short-circuit del extractor)", async () => {
    const s = await seedSession(ctx.sessions);
    await ctx.sessions.close(s.id, { resultado: "exito" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"] },
      ctx.deps,
    );

    expect(ctx.llm.calls).toHaveLength(0);
    expect(result.sesion.resultado).toBe("exito");
    expect(result.disparo).toBeNull();
  });

  test("sesion inexistente lanza error", async () => {
    await expect(
      updateLeadTwinHandler({ leadSessionId: "fake", conversationTurn: [] }, ctx.deps),
    ).rejects.toThrow(/no encontrada/i);
  });
});

/**
 * Corte 3 de la Fase 0: el cambio de etapa tiene que disparar los workflows
 * con trigger "Etapa cambiada". La etapa la mueve el extractor en cada turno;
 * el disparo sale de acá, comparando la etapa de antes con la de después.
 */
describe("updateLeadTwinHandler — disparo etapa_cambiada", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  test("cuando el extractor mueve la etapa, devuelve el disparo con la anterior y la nueva", async () => {
    const s = await seedSession(ctx.sessions);
    ctx.llm.enqueue({ current_stage: "cotizado" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"], mensajeOrigenId: "msg-1" },
      ctx.deps,
    );

    expect(result.disparo).toEqual({
      id: `workflow-disparo:etapa:${s.id}:cotizado:msg-1`,
      data: {
        disparador: "etapa_cambiada",
        leadId: s.lead_id,
        leadSessionId: s.id,
        contexto: { lead: { etapa: "cotizado" }, sesion: { tiene_cotizacion: false } },
        datos: { etapaAnterior: "nuevo", etapaNueva: "cotizado" },
      },
    });
  });

  test("sin mensaje de origen, el id del disparo usa la clave del evento", async () => {
    const s = await seedSession(ctx.sessions);
    ctx.llm.enqueue({ current_stage: "identificando" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"], claveEvento: "evt-9" },
      ctx.deps,
    );

    expect(result.disparo?.id).toBe(`workflow-disparo:etapa:${s.id}:identificando:evt-9`);
  });

  test("si la etapa no cambia, no hay disparo", async () => {
    const s = await seedSession(ctx.sessions);
    ctx.llm.enqueue({ current_stage: "nuevo" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"] },
      ctx.deps,
    );

    expect(result.disparo).toBeNull();
  });

  test("una etapa fijada a mano no la mueve el extractor, así que tampoco dispara", async () => {
    const s = await seedSession(ctx.sessions);
    await ctx.sessions.moverEtapa(s.id, "negociando", null);
    ctx.llm.enqueue({ current_stage: "cotizado" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"] },
      ctx.deps,
    );

    expect(result.sesion.current_stage).toBe("negociando");
    expect(result.disparo).toBeNull();
  });
});
