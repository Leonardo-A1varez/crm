// @vitest-environment node
import { describe, expect, test } from "vitest";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";

const BASE = "https://graph.example.test";

function cliente(opts: { credenciales?: boolean } = {}) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
  }) as typeof fetch;
  const c = new GraphApiMetaClient({
    graphApiVersion: "v26.0",
    whatsappPhoneNumberId: "PHONE_ENV",
    whatsappAccessToken: "TOKEN_ENV",
    baseUrl: BASE,
    fetchImpl,
    ...(opts.credenciales
      ? {
          credenciales: {
            para: async (id: string) =>
              id === "PHONE_COEX" ? { phoneNumberId: id, accessToken: "TOKEN_COEX" } : null,
          },
        }
      : {}),
  });
  return { c, llamadas };
}

const cuerpo = (l: { init: RequestInit }) =>
  JSON.parse(String(l.init.body)) as Record<string, unknown>;

// Formas de la referencia de mensajes de Meta (image/video/audio/document por
// media id), leída el 2026-10-11: docs/meta/media.md §1.
describe("GraphApiMetaClient.sendMedia", () => {
  test("imagen por id con caption", async () => {
    const { c, llamadas } = cliente();
    const r = await c.sendMedia({
      to: "5491122334455",
      media: { tipo: "image", mediaId: "M1", caption: "la pieza", filename: null },
    });
    expect(r).toEqual({ meta_message_id: "wamid.OUT" });
    expect(llamadas[0]!.url).toBe(`${BASE}/v26.0/PHONE_ENV/messages`);
    expect(cuerpo(llamadas[0]!)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5491122334455",
      type: "image",
      image: { id: "M1", caption: "la pieza" },
    });
  });

  test("sin caption no manda la clave (un caption vacio no suma nada)", async () => {
    const { c, llamadas } = cliente();
    await c.sendMedia({
      to: "1",
      media: { tipo: "video", mediaId: "M2", caption: null, filename: null },
    });
    expect(cuerpo(llamadas[0]!)["video"]).toEqual({ id: "M2" });
  });

  test("documento: filename y caption", async () => {
    const { c, llamadas } = cliente();
    await c.sendMedia({
      to: "1",
      media: { tipo: "doc", mediaId: "M3", caption: "la lista", filename: "lista.pdf" },
    });
    expect(cuerpo(llamadas[0]!)).toMatchObject({
      type: "document",
      document: { id: "M3", filename: "lista.pdf", caption: "la lista" },
    });
  });

  test("audio: solo el id (no admite caption)", async () => {
    const { c, llamadas } = cliente();
    await c.sendMedia({
      to: "1",
      media: { tipo: "audio", mediaId: "M4", caption: "ignorado", filename: null },
    });
    expect(cuerpo(llamadas[0]!)).toMatchObject({ type: "audio", audio: { id: "M4" } });
    expect(cuerpo(llamadas[0]!)["audio"]).not.toHaveProperty("caption");
  });

  test("sale por el numero y el token de la conversacion", async () => {
    const { c, llamadas } = cliente({ credenciales: true });
    await c.sendMedia({
      to: "1",
      desde: "PHONE_COEX",
      media: { tipo: "image", mediaId: "M5", caption: null, filename: null },
    });
    expect(llamadas[0]!.url).toBe(`${BASE}/v26.0/PHONE_COEX/messages`);
    expect((llamadas[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer TOKEN_COEX",
    );
  });
});
