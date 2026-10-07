import { describe, expect, test, vi } from "vitest";
import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeWaClient(fetchImpl: typeof fetch) {
  return new GraphApiMetaClient({
    graphApiVersion: "v21.0",
    whatsappPhoneNumberId: "12345",
    whatsappAccessToken: "wa-token",
    baseUrl: "https://graph.example.test",
    fetchImpl,
  });
}

function makeFullClient(fetchImpl: typeof fetch) {
  return new GraphApiMetaClient({
    graphApiVersion: "v21.0",
    whatsappPhoneNumberId: "12345",
    whatsappAccessToken: "wa-token",
    igPageId: "ig_page_999",
    igAccessToken: "ig-token",
    fbPageId: "fb_page_888",
    fbAccessToken: "fb-token",
    baseUrl: "https://graph.example.test",
    fetchImpl,
  });
}

// ============================================================================
// WA (sin cambios — regression suite del 7.6 inicial)
// ============================================================================
describe("GraphApiMetaClient — WA send", () => {
  test("sendText WA construye request correcto + parsea meta_message_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.ABC123" }],
      }),
    );

    const client = makeWaClient(fetchMock);
    const result = await client.sendText({ canal: "wa", to: "+5491100000", text: "hola" });

    expect(result.meta_message_id).toBe("wamid.ABC123");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.example.test/v21.0/12345/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer wa-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("+5491100000");
    expect(body.type).toBe("text");
    expect((body.text as { body: string }).body).toBe("hola");
  });

  test("sendText 429 rate-limit → RateLimitError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(
        {
          error: { message: "Too many messages", code: 80007, fbtrace_id: "trace-abc" },
        },
        429,
      ),
    );

    const client = makeWaClient(fetchMock);
    try {
      await client.sendText({ canal: "wa", to: "+59", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
    }
  });

  test("sendText 400 invalid → ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeErrorResponse(
          { error: { message: "Recipient phone number not in allowed list", code: 131030 } },
          400,
        ),
      );

    const client = makeWaClient(fetchMock);
    await expect(
      client.sendText({ canal: "wa", to: "+invalid", text: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("sendText 401 auth error → ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeErrorResponse({ error: { message: "Invalid token", code: 190 } }, 401),
      );

    const client = makeWaClient(fetchMock);
    await expect(client.sendText({ canal: "wa", to: "+59", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("sendText 500 server error → InfraError reintentable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "Internal" } }, 500));

    const client = makeWaClient(fetchMock);
    try {
      await client.sendText({ canal: "wa", to: "+59", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InfraError);
      expect((e as Error).message).toContain("500");
    }
  });

  test("sendText response sin messages[0].id → ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeOkResponse({ messaging_product: "whatsapp", messages: [] }));

    const client = makeWaClient(fetchMock);
    await expect(client.sendText({ canal: "wa", to: "+59", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("baseUrl con trailing slash se normaliza", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse({ messages: [{ id: "wamid.X" }] }));

    const client = new GraphApiMetaClient({
      graphApiVersion: "v21.0",
      whatsappPhoneNumberId: "999",
      whatsappAccessToken: "t",
      baseUrl: "https://graph.example.test///",
      fetchImpl: fetchMock,
    });
    await client.sendText({ canal: "wa", to: "+59", text: "x" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://graph.example.test/v21.0/999/messages");
  });
});

// ============================================================================
// IG Messenger send (Slice 1 7.6 IG completion)
// ============================================================================
describe("GraphApiMetaClient — IG send", () => {
  test("sendText IG construye request Messenger Platform correcto + parsea message_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        recipient_id: "ig_user_123",
        message_id: "mid.IG_ABC",
      }),
    );

    const client = makeFullClient(fetchMock);
    const result = await client.sendText({ canal: "ig", to: "ig_user_123", text: "hola ig" });

    expect(result.meta_message_id).toBe("mid.IG_ABC");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.example.test/v21.0/ig_page_999/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ig-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.recipient as { id: string }).id).toBe("ig_user_123");
    expect((body.message as { text: string }).text).toBe("hola ig");
  });

  test("sendText IG sin igAccessToken → ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = makeWaClient(fetchMock); // WA-only config, IG fields ausentes
    await expect(
      client.sendText({ canal: "ig", to: "ig_user_123", text: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText IG sin igPageId → ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = new GraphApiMetaClient({
      graphApiVersion: "v21.0",
      whatsappPhoneNumberId: "1",
      whatsappAccessToken: "wa",
      igAccessToken: "ig-token", // pero NO igPageId
      baseUrl: "https://graph.example.test",
      fetchImpl: fetchMock,
    });
    await expect(client.sendText({ canal: "ig", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText IG 429 → RateLimitError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeErrorResponse(
          { error: { message: "IG rate limit", code: 4, fbtrace_id: "trace-ig" } },
          429,
        ),
      );

    const client = makeFullClient(fetchMock);
    try {
      await client.sendText({ canal: "ig", to: "u", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
    }
  });

  test("sendText IG 400 invalid → ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeErrorResponse(
          { error: { message: "User cannot be reached (IG 24h window)", code: 10 } },
          400,
        ),
      );

    const client = makeFullClient(fetchMock);
    await expect(client.sendText({ canal: "ig", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("sendText IG response sin message_id → ValidationError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse({ recipient_id: "u" }));

    const client = makeFullClient(fetchMock);
    await expect(client.sendText({ canal: "ig", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

// ============================================================================
// FB Messenger send (Slice 1 7.6 FB completion)
// ============================================================================
describe("GraphApiMetaClient — FB Messenger send", () => {
  test("sendText FB construye request Messenger Platform correcto + parsea message_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        recipient_id: "fb_user_456",
        message_id: "mid.FB_XYZ",
      }),
    );

    const client = makeFullClient(fetchMock);
    const result = await client.sendText({ canal: "fb", to: "fb_user_456", text: "hola fb" });

    expect(result.meta_message_id).toBe("mid.FB_XYZ");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.example.test/v21.0/fb_page_888/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fb-token");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.recipient as { id: string }).id).toBe("fb_user_456");
    expect((body.message as { text: string }).text).toBe("hola fb");
  });

  test("sendText FB sin fbAccessToken → ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = makeWaClient(fetchMock);
    await expect(
      client.sendText({ canal: "fb", to: "fb_user_456", text: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText FB sin fbPageId → ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = new GraphApiMetaClient({
      graphApiVersion: "v21.0",
      whatsappPhoneNumberId: "1",
      whatsappAccessToken: "wa",
      fbAccessToken: "fb-token", // pero NO fbPageId
      baseUrl: "https://graph.example.test",
      fetchImpl: fetchMock,
    });
    await expect(client.sendText({ canal: "fb", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText FB 429 → RateLimitError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "FB rate limit" } }, 429));

    const client = makeFullClient(fetchMock);
    try {
      await client.sendText({ canal: "fb", to: "u", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
    }
  });

  test("sendText FB 400 invalid (24h window) → ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeErrorResponse({ error: { message: "Outside 24h messaging window", code: 10 } }, 400),
      );

    const client = makeFullClient(fetchMock);
    await expect(client.sendText({ canal: "fb", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("sendText FB response sin message_id → ValidationError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse({}));

    const client = makeFullClient(fetchMock);
    await expect(client.sendText({ canal: "fb", to: "u", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("un fallo de red sale como InfraError y no como TypeError", async () => {
    const client = makeWaClient(() => Promise.reject(new TypeError("fetch failed")));

    await expect(
      client.sendText({ canal: "wa", to: "5491155550000", text: "hola" }),
    ).rejects.toBeInstanceOf(InfraError);
  });
});

// ============================================================================
// WA — plantillas aprobadas
// ============================================================================
describe("GraphApiMetaClient — plantilla WA", () => {
  test("manda type=template con nombre, idioma y los parámetros del cuerpo en orden", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ messaging_product: "whatsapp", messages: [{ id: "wamid.TPL1" }] }),
      );

    const r = await makeWaClient(fetchMock).sendTemplate({
      to: "+5491100000",
      plantilla: { nombre: "seguimiento", idioma: "es_AR", parametrosCuerpo: ["Ana", "filtro"] },
    });

    expect(r.meta_message_id).toBe("wamid.TPL1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.example.test/v21.0/12345/messages");
    expect(init.headers.Authorization).toBe("Bearer wa-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5491100000",
      type: "template",
      template: {
        name: "seguimiento",
        language: { code: "es_AR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "filtro" },
            ],
          },
        ],
      },
    });
  });

  test("sin parámetros no manda components: una plantilla sin variables no los lleva", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse({ messages: [{ id: "wamid.X" }] }));

    await makeWaClient(fetchMock).sendTemplate({
      to: "+1",
      plantilla: { nombre: "hello_world", idioma: "en_US", parametrosCuerpo: [] },
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.template).toEqual({ name: "hello_world", language: { code: "en_US" } });
  });

  test("un 400 de Meta (plantilla inexistente, parámetros de más) es ValidationError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "template not found" } }, 400));
    await expect(
      makeWaClient(fetchMock).sendTemplate({
        to: "+1",
        plantilla: { nombre: "x", idioma: "es", parametrosCuerpo: [] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("429 es RateLimitError y 5xx InfraError, igual que el texto", async () => {
    const plantilla = { nombre: "x", idioma: "es", parametrosCuerpo: [] };
    await expect(
      makeWaClient(vi.fn().mockResolvedValue(makeErrorResponse({}, 429))).sendTemplate({
        to: "+1",
        plantilla,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    await expect(
      makeWaClient(vi.fn().mockResolvedValue(makeErrorResponse({}, 503))).sendTemplate({
        to: "+1",
        plantilla,
      }),
    ).rejects.toBeInstanceOf(InfraError);
  });
});

// ============================================================================
// WA — mensajes interactivos y multimedia (formatos: doc de Meta, 2026-09-26)
// ============================================================================
describe("GraphApiMetaClient — sendRico WA", () => {
  const ok = () =>
    vi
      .fn()
      .mockResolvedValue(
        makeOkResponse({ messaging_product: "whatsapp", messages: [{ id: "wamid.R1" }] }),
      );

  test("botones: interactive.type button con action.buttons de tipo reply", async () => {
    const fetchMock = ok();
    const r = await makeWaClient(fetchMock).sendRico({
      to: "+1",
      contenido: {
        tipo: "botones",
        cuerpo: "¿Te lo reservo?",
        botones: [
          { id: "si", titulo: "Sí" },
          { id: "no", titulo: "No" },
        ],
      },
    });
    expect(r.meta_message_id).toBe("wamid.R1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.example.test/v21.0/12345/messages");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+1",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "¿Te lo reservo?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ],
        },
      },
    });
  });

  test("lista: header, body, footer y secciones con filas; lo vacío no viaja", async () => {
    const fetchMock = ok();
    await makeWaClient(fetchMock).sendRico({
      to: "+1",
      contenido: {
        tipo: "lista",
        encabezado: "Repuestos",
        cuerpo: "¿Qué buscás?",
        pie: null,
        boton: "Ver opciones",
        secciones: [
          {
            titulo: "Motor",
            filas: [
              { id: "f1", titulo: "Filtro", descripcion: "De aceite" },
              { id: "f2", titulo: "Bujía", descripcion: null },
            ],
          },
        ],
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).interactive).toEqual({
      type: "list",
      header: { type: "text", text: "Repuestos" },
      body: { text: "¿Qué buscás?" },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Motor",
            rows: [
              { id: "f1", title: "Filtro", description: "De aceite" },
              { id: "f2", title: "Bujía" },
            ],
          },
        ],
      },
    });
  });

  test("imagen: image.link con caption", async () => {
    const fetchMock = ok();
    await makeWaClient(fetchMock).sendRico({
      to: "+1",
      contenido: { tipo: "imagen", url: "https://x.test/a.jpg", caption: "Mirá" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.type).toBe("image");
    expect(body.image).toEqual({ link: "https://x.test/a.jpg", caption: "Mirá" });
  });

  test("ubicación: latitud y longitud como texto, como el ejemplo oficial", async () => {
    const fetchMock = ok();
    await makeWaClient(fetchMock).sendRico({
      to: "+1",
      contenido: { tipo: "ubicacion", lat: -2.17, lon: -79.92, nombre: "Local", direccion: null },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.type).toBe("location");
    expect(body.location).toEqual({ latitude: "-2.17", longitude: "-79.92", name: "Local" });
  });

  test("un 400 es ValidationError y un 429 RateLimitError, igual que el texto", async () => {
    const contenido = { tipo: "imagen" as const, url: "https://x.test/a.jpg", caption: null };
    await expect(
      makeWaClient(vi.fn().mockResolvedValue(makeErrorResponse({}, 400))).sendRico({
        to: "+1",
        contenido,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      makeWaClient(vi.fn().mockResolvedValue(makeErrorResponse({}, 429))).sendRico({
        to: "+1",
        contenido,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("GraphApiMetaClient — typing indicator WA", () => {
  // Cuerpo de la doc de Meta (developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators,
  // leída el 2026-10-07): marca el mensaje como leído y muestra «escribiendo…» hasta 25 s.
  test("POST /{phone_number_id}/messages con status read y typing_indicator text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse({ success: true }));

    await makeWaClient(fetchMock).sendTypingIndicator({ messageId: "wamid.IN-1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.example.test/v21.0/12345/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wa-token");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN-1",
      typing_indicator: { type: "text" },
    });
  });

  test("mapea los errores de Graph como el resto del cliente", async () => {
    const pedir = (status: number) =>
      makeWaClient(vi.fn().mockResolvedValue(makeErrorResponse({}, status))).sendTypingIndicator({
        messageId: "wamid.IN-1",
      });
    await expect(pedir(400)).rejects.toBeInstanceOf(ValidationError);
    await expect(pedir(429)).rejects.toBeInstanceOf(RateLimitError);
    await expect(pedir(503)).rejects.toBeInstanceOf(InfraError);
  });

  test("un fallo de red es InfraError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      makeWaClient(fetchMock).sendTypingIndicator({ messageId: "wamid.IN-1" }),
    ).rejects.toBeInstanceOf(InfraError);
  });
});
