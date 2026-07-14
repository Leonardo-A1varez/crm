import { describe, expect, test } from "vitest";
import { redactSentryEvent } from "@/lib/observability/sentry-redact";

type AnyEvent = Parameters<typeof redactSentryEvent>[0];

describe("redactSentryEvent", () => {
  test("redacta PII en extra y contexts", () => {
    const event = {
      extra: { telefono: "+595981123456", leadId: "abc" },
      contexts: { lead: { email: "x@y.com", vehiculo_marca: "Toyota" } },
    } as unknown as AnyEvent;

    const out = redactSentryEvent(event);

    expect(out?.extra?.["telefono"]).not.toBe("+595981123456");
    expect(out?.extra?.["leadId"]).toBe("abc");
    const lead = out?.contexts?.["lead"] as Record<string, unknown>;
    expect(lead["email"]).not.toBe("x@y.com");
  });

  test("elimina request.data (bodies webhook con PII)", () => {
    const event = {
      request: { url: "https://crm/api/webhooks/meta", data: { mensaje: "hola" } },
    } as unknown as AnyEvent;

    const out = redactSentryEvent(event);

    expect(out?.request?.data).toBeUndefined();
    expect(out?.request?.url).toBe("https://crm/api/webhooks/meta");
  });
});
