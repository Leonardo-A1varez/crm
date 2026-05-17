import { describe, expect, test } from "vitest";
import { redactPii } from "@/lib/observability/redact";

describe("redactPii — primitives passthrough", () => {
  test("string sin contexto retorna igual", () => {
    expect(redactPii("hello")).toBe("hello");
  });

  test("number retorna igual", () => {
    expect(redactPii(42)).toBe(42);
  });

  test("boolean retorna igual", () => {
    expect(redactPii(true)).toBe(true);
  });

  test("null retorna null", () => {
    expect(redactPii(null)).toBeNull();
  });

  test("undefined retorna undefined", () => {
    expect(redactPii(undefined)).toBeUndefined();
  });
});

describe("redactPii — redaccion key-based en flat object", () => {
  test("telefono redacted", () => {
    expect(redactPii({ telefono: "+5491155550000" })).toEqual({
      telefono: "[REDACTED]",
    });
  });

  test("email redacted", () => {
    expect(redactPii({ email: "foo@bar.com" })).toEqual({
      email: "[REDACTED]",
    });
  });

  test("non-PII key kept intact", () => {
    const input = { id: "uuid-1", telefono: "+5491155550000", stage: "nuevo" };
    expect(redactPii(input)).toEqual({
      id: "uuid-1",
      telefono: "[REDACTED]",
      stage: "nuevo",
    });
  });
});

describe("redactPii — default keys cubren schema CRM", () => {
  const DEFAULT_KEYS_SCHEMA = [
    // Contact
    "telefono",
    "phone",
    "email",
    "direccion",
    "address",
    // Identity
    "nombre",
    "name",
    "ruc_nit",
    "tax_id",
    // Content (free text con PII embedded)
    "body",
    "text",
    "content",
    "mensaje",
    "message",
    "consulta",
    "bloqueador",
    // Meta IDs (traceback)
    "meta_user_ids",
    "meta_message_id",
    // Storage links
    "comprobante_pago_url",
    // Secrets
    "access_token",
    "password",
    "api_key",
    "secret",
  ];

  test.each(DEFAULT_KEYS_SCHEMA)("redacta key '%s' por default", (key) => {
    const input: Record<string, unknown> = { [key]: "real-value-123" };
    const out = redactPii(input) as Record<string, unknown>;
    expect(out[key]).toBe("[REDACTED]");
  });
});

describe("redactPii — case-insensitive + snake/camel normalization", () => {
  test("redacta TELEFONO uppercase", () => {
    expect(redactPii({ TELEFONO: "+1" })).toEqual({ TELEFONO: "[REDACTED]" });
  });

  test("redacta metaUserIds camelCase (= meta_user_ids snake_case)", () => {
    expect(redactPii({ metaUserIds: { wa: "+1" } })).toEqual({
      metaUserIds: "[REDACTED]",
    });
  });

  test("redacta accessToken camelCase", () => {
    expect(redactPii({ accessToken: "tok_xxx" })).toEqual({
      accessToken: "[REDACTED]",
    });
  });

  test("redacta meta_message_id snake_case", () => {
    expect(redactPii({ meta_message_id: "wamid.abc" })).toEqual({
      meta_message_id: "[REDACTED]",
    });
  });
});

describe("redactPii — nested objects", () => {
  test("nested PII en sub-objeto", () => {
    const input = { lead: { id: "1", telefono: "+5491155550000" } };
    expect(redactPii(input)).toEqual({
      lead: { id: "1", telefono: "[REDACTED]" },
    });
  });

  test("nested deep 3 niveles", () => {
    const input = { a: { b: { c: { email: "x@y.com" } } } };
    expect(redactPii(input)).toEqual({
      a: { b: { c: { email: "[REDACTED]" } } },
    });
  });
});

describe("redactPii — arrays", () => {
  test("array de primitives passthrough", () => {
    expect(redactPii([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("array de objetos: cada item procesado", () => {
    const input = [{ telefono: "+1" }, { telefono: "+2" }];
    expect(redactPii(input)).toEqual([{ telefono: "[REDACTED]" }, { telefono: "[REDACTED]" }]);
  });

  test("array nested en objeto", () => {
    const input = { leads: [{ email: "a@a.com" }, { email: "b@b.com" }] };
    expect(redactPii(input)).toEqual({
      leads: [{ email: "[REDACTED]" }, { email: "[REDACTED]" }],
    });
  });
});

describe("redactPii — extraKeys param", () => {
  test("agrega keys custom al set default", () => {
    const input = { telefono: "+1", custom_secret: "xyz" };
    const out = redactPii(input, ["custom_secret"]);
    expect(out).toEqual({
      telefono: "[REDACTED]",
      custom_secret: "[REDACTED]",
    });
  });

  test("extraKeys vacios no afecta defaults", () => {
    expect(redactPii({ telefono: "+1" }, [])).toEqual({
      telefono: "[REDACTED]",
    });
  });

  test("extraKeys case-insensitive", () => {
    const out = redactPii({ MyCustomKey: "v" }, ["mycustomkey"]);
    expect(out).toEqual({ MyCustomKey: "[REDACTED]" });
  });
});

describe("redactPii — immutability", () => {
  test("input flat no muta", () => {
    const input = { telefono: "+5491155550000", id: "1" };
    const snapshot = JSON.stringify(input);
    redactPii(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("input nested no muta", () => {
    const input = { lead: { email: "x@y.com" } };
    const snapshot = JSON.stringify(input);
    redactPii(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("array input no muta", () => {
    const input = [{ telefono: "+1" }];
    const snapshot = JSON.stringify(input);
    redactPii(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("redactPii — cycle detection", () => {
  test("objeto ciclico no causa infinite loop", () => {
    type Cyclic = { telefono: string; self?: Cyclic };
    const cyclic: Cyclic = { telefono: "+1" };
    cyclic.self = cyclic;

    const out = redactPii(cyclic) as { telefono: string; self?: unknown };
    expect(out.telefono).toBe("[REDACTED]");
    expect(out.self).toBe("[CIRCULAR]");
  });

  test("array ciclico no infinite loop", () => {
    const arr: unknown[] = [{ email: "x@y.com" }];
    arr.push(arr);

    const out = redactPii(arr) as unknown[];
    expect(out[0]).toEqual({ email: "[REDACTED]" });
    expect(out[1]).toBe("[CIRCULAR]");
  });
});

describe("redactPii — edge cases", () => {
  test("objeto vacio retorna objeto vacio", () => {
    expect(redactPii({})).toEqual({});
  });

  test("array vacio retorna array vacio", () => {
    expect(redactPii([])).toEqual([]);
  });

  test("PII value null queda null (no redact null)", () => {
    expect(redactPii({ email: null })).toEqual({ email: null });
  });

  test("PII value undefined queda undefined", () => {
    expect(redactPii({ email: undefined })).toEqual({ email: undefined });
  });

  test("meta_user_ids como jsonb (objeto) entera redacted", () => {
    const input = { meta_user_ids: { wa: "+54...", ig: "@user" } };
    expect(redactPii(input)).toEqual({ meta_user_ids: "[REDACTED]" });
  });

  test("nombre redacted (decision recommendacion)", () => {
    expect(redactPii({ nombre: "Juan Perez" })).toEqual({
      nombre: "[REDACTED]",
    });
  });

  test("vehiculo_marca NO redacted (combo identifica, aislado no)", () => {
    const input = { vehiculo_marca: "Toyota", vehiculo_modelo: "Corolla" };
    expect(redactPii(input)).toEqual(input);
  });
});
