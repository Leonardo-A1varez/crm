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

function makeClient(fetchImpl: typeof fetch) {
  return new GraphApiMetaClient({
    graphApiVersion: "v21.0",
    whatsappPhoneNumberId: "12345",
    whatsappAccessToken: "test-token",
    baseUrl: "https://graph.example.test",
    fetchImpl,
  });
}

describe("GraphApiMetaClient", () => {
  test("sendText WA construye request correcto + parsea meta_message_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.ABC123" }],
      }),
    );

    const client = makeClient(fetchMock);
    const result = await client.sendText({ canal: "wa", to: "+5491100000", text: "hola" });

    expect(result.meta_message_id).toBe("wamid.ABC123");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.example.test/v21.0/12345/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("+5491100000");
    expect(body.type).toBe("text");
    expect((body.text as { body: string }).body).toBe("hola");
  });

  test("sendText IG throws ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock);
    await expect(
      client.sendText({ canal: "ig", to: "ig_user_123", text: "hola" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText FB throws ValidationError sin tocar fetch", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock);
    await expect(
      client.sendText({ canal: "fb", to: "fb_user_456", text: "hola" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendText 429 rate-limit → ConflictError meta_rate_limited", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(
        {
          error: {
            message: "Too many messages",
            code: 80007,
            fbtrace_id: "trace-abc",
          },
        },
        429,
      ),
    );

    const client = makeClient(fetchMock);
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

    const client = makeClient(fetchMock);
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

    const client = makeClient(fetchMock);
    await expect(client.sendText({ canal: "wa", to: "+59", text: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("sendText 500 server error → generic Error (Inngest retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeErrorResponse({ error: { message: "Internal" } }, 500));

    const client = makeClient(fetchMock);
    try {
      await client.sendText({ canal: "wa", to: "+59", text: "x" });
      expect.fail("expected throw");
    } catch (e) {
      // Generic Error (not domain) → Inngest retry layer maneja.
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

    const client = makeClient(fetchMock);
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
