import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  DifusionProgramadaSchema,
  EVENTO_DIFUSION_PROGRAMADA,
  eventoDifusionProgramada,
  idEventoDifusionProgramada,
} from "@/lib/difusion/eventos";

const ID = "3f2b8c1a-9d4e-4f6a-8b7c-1e2d3c4b5a69";

describe("evento difusion/programada", () => {
  test("arma nombre, id idempotente y datos serializables", () => {
    const e = eventoDifusionProgramada({
      difusionId: ID,
      programadaPara: new Date("2026-09-14T13:00:00.000Z"),
      audienciaInicial: 120,
      destinatarios: 98,
    });

    expect(e).toEqual({
      name: EVENTO_DIFUSION_PROGRAMADA,
      id: `difusion-programada:${ID}`,
      data: {
        difusionId: ID,
        programadaPara: "2026-09-14T13:00:00.000Z",
        audienciaInicial: 120,
        destinatarios: 98,
      },
    });
    expect(EVENTO_DIFUSION_PROGRAMADA).toBe("difusion/programada");
    expect(idEventoDifusionProgramada(ID)).toBe(`difusion-programada:${ID}`);
  });

  test("los destinatarios nunca superan la audiencia inicial (invariante M ≤ N)", () => {
    expect(() =>
      eventoDifusionProgramada({
        difusionId: ID,
        programadaPara: new Date(),
        audienciaInicial: 10,
        destinatarios: 11,
      }),
    ).toThrow(ValidationError);
  });

  test("una audiencia vacía no se programa", () => {
    expect(() =>
      eventoDifusionProgramada({
        difusionId: ID,
        programadaPara: new Date(),
        audienciaInicial: 0,
        destinatarios: 0,
      }),
    ).toThrow(ValidationError);
  });

  test("el schema rechaza un id que no es UUID y claves que no conoce", () => {
    const valido = {
      difusionId: ID,
      programadaPara: "2026-09-14T13:00:00.000Z",
      audienciaInicial: 1,
      destinatarios: 1,
    };
    expect(DifusionProgramadaSchema.safeParse(valido).success).toBe(true);
    expect(DifusionProgramadaSchema.safeParse({ ...valido, difusionId: "d-1" }).success).toBe(
      false,
    );
    expect(DifusionProgramadaSchema.safeParse({ ...valido, extra: true }).success).toBe(false);
  });

  // El outbox lo escribe la base con to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'): tiene
  // que parsear igual que lo que produce `toISOString()` del lado de la app.
  test("acepta la fecha en el formato que escribe la base y rechaza uno sin zona", () => {
    const base = { difusionId: ID, audienciaInicial: 1, destinatarios: 1 };
    expect(
      DifusionProgramadaSchema.safeParse({ ...base, programadaPara: "2026-09-14T13:00:00.123Z" })
        .success,
    ).toBe(true);
    expect(
      DifusionProgramadaSchema.safeParse({ ...base, programadaPara: "2026-09-14 13:00:00" })
        .success,
    ).toBe(false);
  });
});
