import { describe, expect, test, vi } from "vitest";
import { ConflictError, ValidationError } from "@/lib/errors";
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

  test("sendText 429 rate-limit → ConflictError meta_rate_limited", async () => {
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
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).conflictType).toBe("meta_rate_limited");
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

  test("sendText 500 server error → generic Error (Inngest retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "Internal" } }, 500));

    const client = makeWaClient(fetchMock);
    try {
      await client.sendText({ canal: "wa", to: "+59", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(ConflictError);
      expect(e).not.toBeInstanceOf(ValidationError);
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

  test("sendText IG 429 → ConflictError meta_rate_limited", async () => {
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
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).conflictType).toBe("meta_rate_limited");
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

  test("sendText FB 429 → ConflictError meta_rate_limited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "FB rate limit" } }, 429));

    const client = makeFullClient(fetchMock);
    try {
      await client.sendText({ canal: "fb", to: "u", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
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
});
