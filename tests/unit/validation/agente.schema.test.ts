import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { OPENAI_PRICING } from "@/lib/agente/modelos";
import { GuardarConfigSchema, RollbackConfigSchema } from "@/lib/validation/agente.schema";
import type { AgenteConfigValores } from "@/types/agente";

function valores(patch: Partial<AgenteConfigValores> = {}): AgenteConfigValores {
  return { ...CONFIG_DE_FABRICA, ...patch };
}

describe("GuardarConfigSchema", () => {
  test("acepta la config de fabrica tal cual", () => {
    expect(GuardarConfigSchema.safeParse(valores()).success).toBe(true);
  });

  describe("modelo", () => {
    test("acepta cualquier modelo presente en OPENAI_PRICING", () => {
      for (const modelo of Object.keys(OPENAI_PRICING)) {
        expect(GuardarConfigSchema.safeParse(valores({ modelo })).success).toBe(true);
      }
    });

    test("rechaza un modelo sin pricing y el mensaje nombra los validos", () => {
      const r = GuardarConfigSchema.safeParse(valores({ modelo: "gpt-inexistente" }));
      expect(r.success).toBe(false);
      if (r.success) return;
      const mensaje = r.error.issues.map((i) => i.message).join(" ");
      expect(mensaje).toContain("gpt-inexistente");
      for (const modelo of Object.keys(OPENAI_PRICING)) {
        expect(mensaje).toContain(modelo);
      }
    });
  });

  describe("instrucciones (<= 4000 chars)", () => {
    test("acepta instrucciones vacias", () => {
      expect(GuardarConfigSchema.safeParse(valores({ instrucciones: "" })).success).toBe(true);
    });

    test("acepta exactamente 4000 caracteres", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ instrucciones: "a".repeat(4000) })).success,
      ).toBe(true);
    });

    test("rechaza mas de 4000 caracteres", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ instrucciones: "a".repeat(4001) })).success,
      ).toBe(false);
    });
  });

  describe("tono / largo / emojis / politica_tope (enums)", () => {
    test("rechaza un tono fuera del catalogo", () => {
      expect(GuardarConfigSchema.safeParse(valores({ tono: "agresivo" as never })).success).toBe(
        false,
      );
    });

    test("rechaza un largo fuera del catalogo", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ largo: "kilometrico" as never })).success,
      ).toBe(false);
    });

    test("rechaza un emojis fuera del catalogo", () => {
      expect(GuardarConfigSchema.safeParse(valores({ emojis: "excesivo" as never })).success).toBe(
        false,
      );
    });

    test("rechaza una politica_tope fuera del catalogo", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ politica_tope: "ignorar" as never })).success,
      ).toBe(false);
    });
  });

  describe("descuento_max_pct (0-20)", () => {
    test("acepta los bordes 0 y 20", () => {
      expect(GuardarConfigSchema.safeParse(valores({ descuento_max_pct: 0 })).success).toBe(true);
      expect(GuardarConfigSchema.safeParse(valores({ descuento_max_pct: 20 })).success).toBe(true);
    });

    test("rechaza por debajo de 0", () => {
      expect(GuardarConfigSchema.safeParse(valores({ descuento_max_pct: -1 })).success).toBe(false);
    });

    test("rechaza por encima de 20", () => {
      expect(GuardarConfigSchema.safeParse(valores({ descuento_max_pct: 20.1 })).success).toBe(
        false,
      );
    });
  });

  describe("max_pasos_tool (1-10)", () => {
    test("acepta los bordes 1 y 10", () => {
      expect(GuardarConfigSchema.safeParse(valores({ max_pasos_tool: 1 })).success).toBe(true);
      expect(GuardarConfigSchema.safeParse(valores({ max_pasos_tool: 10 })).success).toBe(true);
    });

    test("rechaza fuera de rango", () => {
      expect(GuardarConfigSchema.safeParse(valores({ max_pasos_tool: 0 })).success).toBe(false);
      expect(GuardarConfigSchema.safeParse(valores({ max_pasos_tool: 11 })).success).toBe(false);
    });
  });

  describe("ventana_contexto_mensajes (4-40)", () => {
    test("acepta los bordes 4 y 40", () => {
      expect(GuardarConfigSchema.safeParse(valores({ ventana_contexto_mensajes: 4 })).success).toBe(
        true,
      );
      expect(
        GuardarConfigSchema.safeParse(valores({ ventana_contexto_mensajes: 40 })).success,
      ).toBe(true);
    });

    test("rechaza fuera de rango", () => {
      expect(GuardarConfigSchema.safeParse(valores({ ventana_contexto_mensajes: 3 })).success).toBe(
        false,
      );
      expect(
        GuardarConfigSchema.safeParse(valores({ ventana_contexto_mensajes: 41 })).success,
      ).toBe(false);
    });
  });

  describe("umbral_resumen_turnos (10-100)", () => {
    test("acepta los bordes 10 y 100", () => {
      expect(GuardarConfigSchema.safeParse(valores({ umbral_resumen_turnos: 10 })).success).toBe(
        true,
      );
      expect(GuardarConfigSchema.safeParse(valores({ umbral_resumen_turnos: 100 })).success).toBe(
        true,
      );
    });

    test("rechaza fuera de rango", () => {
      expect(GuardarConfigSchema.safeParse(valores({ umbral_resumen_turnos: 9 })).success).toBe(
        false,
      );
      expect(GuardarConfigSchema.safeParse(valores({ umbral_resumen_turnos: 101 })).success).toBe(
        false,
      );
    });
  });

  describe("tope_gasto_diario_usd (0.5-1000)", () => {
    test("acepta los bordes 0.5 y 1000", () => {
      expect(GuardarConfigSchema.safeParse(valores({ tope_gasto_diario_usd: 0.5 })).success).toBe(
        true,
      );
      expect(GuardarConfigSchema.safeParse(valores({ tope_gasto_diario_usd: 1000 })).success).toBe(
        true,
      );
    });

    test("rechaza fuera de rango", () => {
      expect(GuardarConfigSchema.safeParse(valores({ tope_gasto_diario_usd: 0.49 })).success).toBe(
        false,
      );
      expect(
        GuardarConfigSchema.safeParse(valores({ tope_gasto_diario_usd: 1000.01 })).success,
      ).toBe(false);
    });
  });

  describe("plantilla_fuera_horario (<= 1000 chars)", () => {
    test("acepta hasta 1000 caracteres", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ plantilla_fuera_horario: "a".repeat(1000) }))
          .success,
      ).toBe(true);
    });

    test("rechaza mas de 1000 caracteres", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ plantilla_fuera_horario: "a".repeat(1001) }))
          .success,
      ).toBe(false);
    });
  });

  describe("horario_timezone", () => {
    test("acepta una timezone valida", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ horario_timezone: "America/Santiago" })).success,
      ).toBe(true);
    });

    test("rechaza una timezone invalida", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ horario_timezone: "Marte/Colonia" })).success,
      ).toBe(false);
    });

    test("rechaza timezone vacia", () => {
      expect(GuardarConfigSchema.safeParse(valores({ horario_timezone: "" })).success).toBe(false);
    });
  });

  describe("horario", () => {
    test("normaliza rangos solapados al parsear", () => {
      const horario = {
        ...CONFIG_DE_FABRICA.horario,
        lun: [
          { desde: "08:00", hasta: "12:00" },
          { desde: "11:00", hasta: "18:00" },
        ],
      };
      const resultado = GuardarConfigSchema.parse(valores({ horario }));
      expect(resultado.horario.lun).toEqual([{ desde: "08:00", hasta: "18:00" }]);
    });

    test("descarta un rango invertido (cruza medianoche)", () => {
      const horario = {
        ...CONFIG_DE_FABRICA.horario,
        mar: [{ desde: "22:00", hasta: "02:00" }],
      };
      const resultado = GuardarConfigSchema.parse(valores({ horario }));
      expect(resultado.horario.mar).toEqual([]);
    });

    test("exige las 7 claves del horario", () => {
      const horarioIncompleto = { ...CONFIG_DE_FABRICA.horario } as Record<string, unknown>;
      delete horarioIncompleto.dom;
      const r = GuardarConfigSchema.safeParse(valores({ horario: horarioIncompleto } as never));
      expect(r.success).toBe(false);
    });
  });

  describe("escalar_umbral_intents (1-5, §4.2)", () => {
    test("acepta los dos extremos del rango", () => {
      for (const escalar_umbral_intents of [1, 5]) {
        expect(GuardarConfigSchema.safeParse(valores({ escalar_umbral_intents })).success).toBe(
          true,
        );
      }
    });

    test("rechaza fuera de rango y no entero", () => {
      for (const escalar_umbral_intents of [0, 6, 2.5]) {
        expect(GuardarConfigSchema.safeParse(valores({ escalar_umbral_intents })).success).toBe(
          false,
        );
      }
    });
  });

  describe("escalar_palabras", () => {
    test("normaliza y deduplica: lo guardado es lo que el agente va a comparar", () => {
      const r = GuardarConfigSchema.parse(
        valores({ escalar_palabras: ["Devolución", "  FACTURA   A ", "devolucion", ""] }),
      );
      expect(r.escalar_palabras).toEqual(["devolucion", "factura a"]);
    });

    test("acepta la lista vacia (condicion apagada)", () => {
      expect(GuardarConfigSchema.safeParse(valores({ escalar_palabras: [] })).success).toBe(true);
    });

    test("rechaza una palabra mas larga que el maximo", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ escalar_palabras: ["a".repeat(61)] })).success,
      ).toBe(false);
    });

    test("la cota de cantidad se aplica DESPUES de deduplicar", () => {
      // 60 entradas pero una sola palabra distinta: no consume 60 de cupo.
      const repetida = Array.from({ length: 60 }, () => "reclamo");
      expect(GuardarConfigSchema.safeParse(valores({ escalar_palabras: repetida })).success).toBe(
        true,
      );

      const distintas = Array.from({ length: 51 }, (_, i) => `palabra${i}`);
      expect(GuardarConfigSchema.safeParse(valores({ escalar_palabras: distintas })).success).toBe(
        false,
      );
    });
  });

  describe("escalar_cotizacion_desde", () => {
    test("null es la condicion apagada y se acepta", () => {
      expect(
        GuardarConfigSchema.safeParse(valores({ escalar_cotizacion_desde: null })).success,
      ).toBe(true);
    });

    test("acepta los extremos del rango del handoff", () => {
      for (const escalar_cotizacion_desde of [100_000, 2_000_000]) {
        expect(GuardarConfigSchema.safeParse(valores({ escalar_cotizacion_desde })).success).toBe(
          true,
        );
      }
    });

    test("rechaza montos fuera del rango", () => {
      for (const escalar_cotizacion_desde of [0, 99_999, 2_000_001]) {
        expect(GuardarConfigSchema.safeParse(valores({ escalar_cotizacion_desde })).success).toBe(
          false,
        );
      }
    });
  });

  describe("timeout_tool_ms (§4.4)", () => {
    test("acepta los extremos del CHECK", () => {
      for (const timeout_tool_ms of [500, 30_000]) {
        expect(GuardarConfigSchema.safeParse(valores({ timeout_tool_ms })).success).toBe(true);
      }
    });

    test("rechaza fuera del CHECK", () => {
      for (const timeout_tool_ms of [499, 30_001]) {
        expect(GuardarConfigSchema.safeParse(valores({ timeout_tool_ms })).success).toBe(false);
      }
    });
  });
});

describe("RollbackConfigSchema", () => {
  test("acepta un uuid valido", () => {
    expect(
      RollbackConfigSchema.safeParse({ configId: "11111111-1111-4111-8111-111111111111" }).success,
    ).toBe(true);
  });

  test("rechaza un id que no es uuid", () => {
    expect(RollbackConfigSchema.safeParse({ configId: "no-es-un-uuid" }).success).toBe(false);
  });
});
