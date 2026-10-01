import { describe, expect, test } from "vitest";
import {
  CambiarModoRespuestaSchema,
  RegenerarBorradorSchema,
  UsarBorradorSchema,
} from "@/lib/validation/copiloto.schema";

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const BORRADOR = "33333333-3333-4333-8333-333333333333";

describe("CambiarModoRespuestaSchema", () => {
  test.each(["segun_horario", "copiloto", "automatico"] as const)("acepta %s", (modo) => {
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: LEAD, conversacionId: CONV, modo }).success,
    ).toBe(true);
  });

  test("rechaza un modo inventado y ids que no son uuid", () => {
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: LEAD, conversacionId: CONV, modo: "manual" })
        .success,
    ).toBe(false);
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: "x", conversacionId: CONV, modo: "copiloto" })
        .success,
    ).toBe(false);
  });
});

describe("UsarBorradorSchema", () => {
  test("acepta el texto editado y lo trimea", () => {
    const r = UsarBorradorSchema.parse({
      leadId: LEAD,
      borradorId: BORRADOR,
      via: "insertar",
      texto: "  Hola  ",
    });
    expect(r.texto).toBe("Hola");
  });

  test("rechaza texto vacío, de más de 4096 caracteres y una vía inventada", () => {
    const base = { leadId: LEAD, borradorId: BORRADOR, via: "copiar" as const };
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "   " }).success).toBe(false);
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "a".repeat(4097) }).success).toBe(false);
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "a".repeat(4096) }).success).toBe(true);
    expect(UsarBorradorSchema.safeParse({ ...base, via: "telepatia", texto: "hola" }).success).toBe(
      false,
    );
  });
});

describe("RegenerarBorradorSchema", () => {
  test("pide lead y borrador", () => {
    expect(RegenerarBorradorSchema.safeParse({ leadId: LEAD, borradorId: BORRADOR }).success).toBe(
      true,
    );
    expect(RegenerarBorradorSchema.safeParse({ leadId: LEAD }).success).toBe(false);
  });
});
