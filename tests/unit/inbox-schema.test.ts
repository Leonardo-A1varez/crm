import { describe, expect, test } from "vitest";
import {
  CloseSessionSchema,
  SendMessageSchema,
  ToggleHandoffSchema,
} from "@/lib/validation/inbox.schema";

// v4 RFC 4122 válidos: zod 4 `.uuid()` valida version+variant bits.
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("SendMessageSchema", () => {
  test("acepta input válido y trimea body", () => {
    const parsed = SendMessageSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "  hola  ",
    });
    expect(parsed.body).toBe("hola");
    expect(parsed.canal).toBe("wa");
  });

  test("rechaza body vacío post-trim", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "   ",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza body > 4096 chars", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "x".repeat(4097),
    });
    expect(result.success).toBe(false);
  });

  test("rechaza canal fuera de enum", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "sms",
      body: "hola",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza leadId no-uuid", () => {
    const result = SendMessageSchema.safeParse({
      leadId: "no-uuid",
      sessionId: SESSION_ID,
      canal: "wa",
      body: "hola",
    });
    expect(result.success).toBe(false);
  });
});

describe("ToggleHandoffSchema", () => {
  test("acepta pause y resume", () => {
    for (const action of ["pause", "resume"] as const) {
      const parsed = ToggleHandoffSchema.parse({
        leadId: LEAD_ID,
        sessionId: SESSION_ID,
        action,
      });
      expect(parsed.action).toBe(action);
    }
  });

  test("rechaza action desconocida", () => {
    const result = ToggleHandoffSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      action: "stop",
    });
    expect(result.success).toBe(false);
  });
});

describe("CloseSessionSchema", () => {
  test("acepta exito sin motivo", () => {
    const parsed = CloseSessionSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "exito",
    });
    expect(parsed.resultado).toBe("exito");
    expect(parsed.motivoPerdida).toBeUndefined();
  });

  test("acepta perdido con motivo enum", () => {
    const parsed = CloseSessionSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
      motivoPerdida: "precio",
    });
    expect(parsed.motivoPerdida).toBe("precio");
  });

  test("rechaza motivo fuera del enum", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
      motivoPerdida: "caro",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza resultado fuera del enum", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "cancelado",
    });
    expect(result.success).toBe(false);
  });
});
