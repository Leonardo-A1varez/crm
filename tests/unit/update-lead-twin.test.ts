import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import {
  updateLeadTwinHandler,
  type UpdateLeadTwinDeps,
} from "@/inngest/functions/update-lead-twin";
import { FakeTwinExtractorLLM } from "../mocks/llm";

async function setup() {
  const sessions = new InMemoryLeadSessionRepository();
  const llm = new FakeTwinExtractorLLM();
  const extractor = new DefaultTwinExtractorService(sessions, llm);
  const deps: UpdateLeadTwinDeps = { twinExtractor: extractor };
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
    expect(result.current_stage).toBe("identificando");
  });

  test("sesion cerrada no llama LLM (short-circuit del extractor)", async () => {
    const s = await seedSession(ctx.sessions);
    await ctx.sessions.close(s.id, { resultado: "exito" });

    const result = await updateLeadTwinHandler(
      { leadSessionId: s.id, conversationTurn: ["x"] },
      ctx.deps,
    );

    expect(ctx.llm.calls).toHaveLength(0);
    expect(result.resultado).toBe("exito");
  });

  test("sesion inexistente lanza error", async () => {
    await expect(
      updateLeadTwinHandler({ leadSessionId: "fake", conversationTurn: [] }, ctx.deps),
    ).rejects.toThrow(/no encontrada/i);
  });
});
