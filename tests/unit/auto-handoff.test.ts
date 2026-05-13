import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { autoHandoffHandler, type AutoHandoffDeps } from "@/inngest/functions/auto-handoff";
import type { IntentClassification } from "@/lib/validation/ai";

function cls(n: string | null): IntentClassification {
  return { intent_nombre: n, confidence: n ? 0.9 : 0 };
}

async function setup() {
  const sessions = new InMemoryLeadSessionRepository();
  const handoff = new DefaultHandoffService(sessions);
  const deps: AutoHandoffDeps = { handoff };
  const session = await sessions.create({
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
  return { sessions, handoff, deps, session };
}

describe("autoHandoffHandler", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  test("decision no pausar deja sesion sin cambios", async () => {
    const result = await autoHandoffHandler(
      { leadSessionId: ctx.session.id, recentClassifications: [cls("saludo")] },
      ctx.deps,
    );

    expect(result.paused).toBe(false);
    const s = await ctx.sessions.findById(ctx.session.id);
    expect(s!.ia_pausada).toBe(false);
  });

  test("decision pausar invoca handoff.pause con motivo", async () => {
    const result = await autoHandoffHandler(
      {
        leadSessionId: ctx.session.id,
        recentClassifications: [cls(null), cls(null), cls(null)],
      },
      ctx.deps,
    );

    expect(result.paused).toBe(true);
    expect(result.motivo).toMatch(/3 intents desconocidos/i);
    const s = await ctx.sessions.findById(ctx.session.id);
    expect(s!.ia_pausada).toBe(true);
  });

  test("threshold custom propagado", async () => {
    const result = await autoHandoffHandler(
      {
        leadSessionId: ctx.session.id,
        recentClassifications: [cls(null), cls(null)],
        threshold: 2,
      },
      ctx.deps,
    );

    expect(result.paused).toBe(true);
  });

  test("sesion cerrada no pausa (handoff.pause rechaza)", async () => {
    await ctx.sessions.close(ctx.session.id, { resultado: "exito" });

    await expect(
      autoHandoffHandler(
        {
          leadSessionId: ctx.session.id,
          recentClassifications: [cls(null), cls(null), cls(null)],
        },
        ctx.deps,
      ),
    ).rejects.toThrow(/cerrada/i);
  });
});
