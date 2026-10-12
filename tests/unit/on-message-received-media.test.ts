import { describe, expect, test } from "vitest";
import { onMessageReceivedHandler } from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { makePipelineDeps } from "../helpers/pipeline-deps";

const TELEFONO = "5491122334455";

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: TELEFONO,
    meta_user_id: TELEFONO,
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "hola",
    media_url: null,
    nombre_perfil: null,
    platform_created_at: new Date("2026-10-12T14:30:00.000Z"),
    raw: { type: "text" },
    ...overrides,
  };
}

/** Un turno sin agente: lo que se prueba es qué se emite, no qué se contesta. */
function turno(ctx: ReturnType<typeof makePipelineDeps>, p: ParsedMessage) {
  ctx.agentLLM.enqueueText("ok");
  return onMessageReceivedHandler({ parsed: p }, ctx);
}

describe("on-message-received: media entrante", () => {
  test("un entrante con archivo deja el mensaje pendiente y encola la descarga con su numero", async () => {
    const ctx = makePipelineDeps();
    const r = await turno(
      ctx,
      parsed({
        tipo: "image",
        contenido: null,
        meta_message_id: "wamid.IMG-1",
        numero_negocio_id: "PHONE_COEX",
        media: { id: "MEDIA-1", mime: "image/jpeg", nombre: null },
      }),
    );

    const entrante = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    );
    expect(entrante?.media).toMatchObject({ estado: "pendiente", metaId: "MEDIA-1" });

    const descargas = ctx.emitted.filter((e) => e.name === "meta/media.descargar");
    expect(descargas).toEqual([
      {
        name: "meta/media.descargar",
        id: `media-descargar:${entrante!.id}`,
        data: { mensajeId: entrante!.id, phoneNumberId: "PHONE_COEX", fecha: "2026-10-12" },
      },
    ]);
  });

  test("un texto no encola nada", async () => {
    const ctx = makePipelineDeps();
    await turno(ctx, parsed());
    expect(ctx.emitted.some((e) => e.name === "meta/media.descargar")).toBe(false);
  });

  test("sin hora de Meta usa la fecha de hoy para la clave del paso", async () => {
    const ctx = makePipelineDeps();
    await turno(
      ctx,
      parsed({
        tipo: "audio",
        contenido: null,
        platform_created_at: null,
        meta_message_id: "wamid.AUD-1",
        media: { id: "A", mime: "audio/ogg", nombre: null, voz: true },
      }),
    );
    const ev = ctx.emitted.find((e) => e.name === "meta/media.descargar");
    expect(ev?.name === "meta/media.descargar" && ev.data.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ev?.name === "meta/media.descargar" && ev.data.phoneNumberId).toBeNull();
  });

  test("el reintento del mismo entrante no duplica el mensaje y vuelve a encolar con el mismo id", async () => {
    const ctx = makePipelineDeps();
    const p = parsed({
      tipo: "image",
      contenido: null,
      meta_message_id: "wamid.IMG-2",
      media: { id: "MEDIA-2", mime: "image/png", nombre: null },
    });
    await turno(ctx, p);
    await turno(ctx, p);

    const ids = ctx.emitted
      .filter((e) => e.name === "meta/media.descargar")
      .map((e) => ("id" in e ? e.id : null));
    // Mismo `id`: Inngest descarta el segundo; el servicio igual es idempotente.
    expect(new Set(ids).size).toBe(1);
  });
});
