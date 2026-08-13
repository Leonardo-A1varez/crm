import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { NoopLogger } from "@/lib/observability/logger";
import { NoopRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { makeMetaWebhookHandlers } from "@/app/api/webhooks/meta/route";

const TEST_SECRET = "test-app-secret";
const TEST_TOKEN = "test-verify-token-xyz";

function signBody(body: string, secret = TEST_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function makeDeps(overrides: Partial<Parameters<typeof makeMetaWebhookHandlers>[0]> = {}) {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    appSecret: TEST_SECRET,
    verifyToken: TEST_TOKEN,
    inngest: { send } as never,
    rateLimiter: new NoopRateLimiter() as RateLimiter,
    logger: new NoopLogger(),
    ...overrides,
  };
}

// ============================================================================
// GET handshake — Meta verify endpoint
// ============================================================================
describe("meta webhook GET handshake", () => {
  test("hub.mode=subscribe + verify_token matches → 200 plaintext challenge", async () => {
    const { GET } = makeMetaWebhookHandlers(makeDeps());
    const url = `http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${TEST_TOKEN}&hub.challenge=nonce123`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("nonce123");
  });

  test("verify_token mismatch → 403", async () => {
    const { GET } = makeMetaWebhookHandlers(makeDeps());
    const url = `http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=nonce123`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });

  test("hub.mode not subscribe → 403", async () => {
    const { GET } = makeMetaWebhookHandlers(makeDeps());
    const url = `http://localhost/api/webhooks/meta?hub.mode=unsubscribe&hub.verify_token=${TEST_TOKEN}&hub.challenge=nonce123`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });

  test("sin query params → 403", async () => {
    const { GET } = makeMetaWebhookHandlers(makeDeps());
    const res = await GET(new Request("http://localhost/api/webhooks/meta"));
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// POST HMAC verify — security critical (regla §0.9.2)
// ============================================================================
describe("meta webhook POST — HMAC verify", () => {
  test("sin signature header → 401", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
    expect((deps.inngest as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
  });

  test("signature invalida → 401", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "sha256=deadbeef",
        },
      }),
    );
    expect(res.status).toBe(401);
    expect((deps.inngest as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
  });

  test("firma inválida no consume cuota del rate limiter", async () => {
    const limit = vi.fn();
    const deps = makeDeps({ rateLimiter: { limit } as unknown as RateLimiter });
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": "sha256=deadbeef" },
      }),
    );
    expect(res.status).toBe(401);
    expect(limit).not.toHaveBeenCalled();
  });

  test("signature válida con secret incorrecto → 401", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signBody(body, "wrong-secret"),
        },
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// POST happy path — emit Inngest events
// ============================================================================
describe("meta webhook POST — emit pipeline", () => {
  const WA_PAYLOAD = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WBA-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PNI-1" },
              messages: [
                {
                  from: "5491155550000",
                  id: "wamid.ABC",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "hola" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  test("payload WA single message → 200 + emit 1 event meta/message.received", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify(WA_PAYLOAD);
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signBody(body),
        },
      }),
    );
    expect(res.status).toBe(200);
    const send = (deps.inngest as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      name: "meta/message.received",
      data: expect.objectContaining({
        parsed: expect.objectContaining({
          canal: "wa",
          canal_thread_id: "5491155550000",
          meta_message_id: "wamid.ABC",
          tipo: "text",
          contenido: "hola",
        }),
      }),
    });
  });

  test("payload multi-message → emit N events", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const multi = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WBA-1",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  { from: "+1", id: "wamid.A", type: "text", text: { body: "a" } },
                  { from: "+2", id: "wamid.B", type: "text", text: { body: "b" } },
                  { from: "+3", id: "wamid.C", type: "text", text: { body: "c" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(multi);
    await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": signBody(body) },
      }),
    );
    const send = (deps.inngest as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).toHaveBeenCalledTimes(3);
  });

  test("payload object desconocido → 200 + 0 emits", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "unknown_kind", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": signBody(body) },
      }),
    );
    expect(res.status).toBe(200);
    const send = (deps.inngest as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).not.toHaveBeenCalled();
  });

  test("body no JSON-parseable → 400 sin emit", async () => {
    const deps = makeDeps();
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = "not json {{{";
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": signBody(body) },
      }),
    );
    expect(res.status).toBe(400);
    const send = (deps.inngest as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).not.toHaveBeenCalled();
  });
});

// ============================================================================
// POST rate-limit
// ============================================================================
describe("meta webhook POST — rate-limit", () => {
  test("rate-limit exceeded → 429 después de verificar HMAC y sin emit", async () => {
    const exceeded: RateLimiter = {
      async limit() {
        return { success: false, remaining: 0, limit: 100, reset: Date.now() + 60000 };
      },
    };
    const deps = makeDeps({ rateLimiter: exceeded });
    const { POST } = makeMetaWebhookHandlers(deps);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const res = await POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": signBody(body) },
      }),
    );
    expect(res.status).toBe(429);
    const send = (deps.inngest as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).not.toHaveBeenCalled();
  });
});
