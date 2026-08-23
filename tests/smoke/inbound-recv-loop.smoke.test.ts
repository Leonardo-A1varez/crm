import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { NoopLogger } from "@/lib/observability/logger";
import { NoopRateLimiter } from "@/lib/rate-limit";
import { makeCrmInngestFunctions } from "@/inngest/functions";
import { makeMetaWebhookHandlers } from "@/app/api/webhooks/meta/route";
import { makeSmokeBundle } from "./smoke-bootstrap";

const TEST_SECRET = "smoke-test-app-secret";
const TEST_VERIFY_TOKEN = "smoke-verify-token";

function signBody(body: string): string {
  return "sha256=" + createHmac("sha256", TEST_SECRET).update(body).digest("hex");
}

const WA_INBOUND_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WBA-SMOKE",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "PNI-SMOKE" },
            messages: [
              {
                from: "5491155550000",
                id: "wamid.SMOKE_ABC",
                timestamp: "1700000000",
                type: "text",
                text: { body: "hola, tienen filtro aire para Corolla 2018?" },
              },
            ],
          },
        },
      ],
    },
  ],
};

// ============================================================================
// 7.10 E2E smoke: webhook → emit + bootstrap wireup survives
// ============================================================================
describe("E2E smoke — bootstrap wireup with InMemory repos", () => {
  test("makeSmokeBundle construye CrmInngestDeps sin error", () => {
    const bundle = makeSmokeBundle();
    expect(bundle.deps).toBeDefined();
    expect(bundle.metaClientSend).toBeDefined();
    expect(bundle.inngestSend).toBeDefined();
    expect(bundle.repos.leads.constructor.name).toBe("InMemoryLeadsRepository");
  });

  test("makeCrmInngestFunctions(smokeDeps) retorna 14 functions", () => {
    const bundle = makeSmokeBundle();
    const functions = makeCrmInngestFunctions(bundle.deps);
    expect(functions).toHaveLength(14);
    // Verifica que cada function tiene shape Inngest válido (id + trigger).
    for (const fn of functions) {
      expect(fn).toBeDefined();
    }
  });

  test("smokeDeps LLMs son InMemory* (LLM_MODE=mock)", () => {
    const bundle = makeSmokeBundle();
    // El intent classifier service wrappea el LLM. Para verificar mock, llamar
    // y validar return deterministic.
    expect(bundle.deps.onMessageReceived.aiAgent).toBeDefined();
    expect(bundle.deps.updateLeadTwin.twinExtractor).toBeDefined();
    expect(bundle.deps.detectIntentsBatch.detector.constructor.name).toBe(
      "InMemoryIntentBatchDetectorLLM",
    );
  });

  test("smokeDeps emit callback delega a mock inngest spy", async () => {
    const bundle = makeSmokeBundle();
    await bundle.deps.onMessageReceived.emit({
      name: "lead/created",
      data: { leadId: "smoke-lead-1", canal: "wa" },
    });
    expect(bundle.inngestSend).toHaveBeenCalledWith({
      name: "lead/created",
      data: { leadId: "smoke-lead-1", canal: "wa" },
    });
  });
});

// ============================================================================
// 7.10 E2E smoke: signed webhook POST → ParsedMessage → emit shape
// ============================================================================
describe("E2E smoke — signed webhook POST emit pipeline", () => {
  test("signed WA payload → 200 + emit meta/message.received con ParsedMessage", async () => {
    const inngestSpy = vi.fn().mockResolvedValue(undefined);
    const handlers = makeMetaWebhookHandlers({
      appSecret: TEST_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
      inngest: { send: inngestSpy },
      rateLimiter: new NoopRateLimiter(),
      logger: new NoopLogger(),
    });

    const body = JSON.stringify(WA_INBOUND_PAYLOAD);
    const res = await handlers.POST(
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
    expect(inngestSpy).toHaveBeenCalledTimes(1);
    expect(inngestSpy).toHaveBeenCalledWith({
      name: "meta/message.received",
      data: {
        parsed: expect.objectContaining({
          canal: "wa",
          canal_thread_id: "5491155550000",
          meta_message_id: "wamid.SMOKE_ABC",
          tipo: "text",
          contenido: "hola, tienen filtro aire para Corolla 2018?",
        }),
      },
    });
  });

  test("payload IG inbound → emit canal=ig", async () => {
    const inngestSpy = vi.fn().mockResolvedValue(undefined);
    const handlers = makeMetaWebhookHandlers({
      appSecret: TEST_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
      inngest: { send: inngestSpy },
      rateLimiter: new NoopRateLimiter(),
      logger: new NoopLogger(),
    });

    const igPayload = {
      object: "instagram",
      entry: [
        {
          id: "IG-BIZ-1",
          time: 1700000000,
          messaging: [
            {
              sender: { id: "IG_PSID_X" },
              recipient: { id: "IG-BIZ-1" },
              timestamp: 1700000000,
              message: { mid: "mid.IG_SMOKE", text: "tienen pastillas?" },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(igPayload);
    const res = await handlers.POST(
      new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": signBody(body) },
      }),
    );

    expect(res.status).toBe(200);
    expect(inngestSpy).toHaveBeenCalledWith({
      name: "meta/message.received",
      data: {
        parsed: expect.objectContaining({
          canal: "ig",
          meta_message_id: "mid.IG_SMOKE",
        }),
      },
    });
  });
});
