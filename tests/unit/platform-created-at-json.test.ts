import { describe, expect, test } from "vitest";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";

/**
 * La frontera JSON de Inngest, que es donde se rompió el primer WhatsApp real.
 *
 * `ParsedMessage.platform_created_at` está tipado `Date`, pero el evento viaja
 * serializado y del otro lado llega un string ISO. TypeScript sigue creyendo
 * que es una `Date`, así que `.toISOString()` compilaba y explotaba en runtime
 * con `input.platform_created_at?.toISOString is not a function`.
 *
 * El resto de la suite no lo veía porque usa los repos in-memory: sin
 * serialización, la `Date` sobrevive y el bug es invisible. Estos tests simulan
 * el viaje de verdad con `JSON.parse(JSON.stringify(...))`.
 */
function viajePorInngest<T>(evento: T): T {
  return JSON.parse(JSON.stringify(evento)) as T;
}

function parsedDePrueba(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    meta_user_id: "593979932363",
    meta_message_id: "wamid.PRUEBA",
    canal_thread_id: "593979932363",
    tipo: "text",
    contenido: "Hola, tenés pastillas de freno para Corolla?",
    media_url: null,
    platform_created_at: new Date("2026-08-15T16:57:52.000Z"),
    raw: {},
    ...overrides,
  } as ParsedMessage;
}

describe("platform_created_at cruzando el JSON de Inngest", () => {
  test("una Date NO sobrevive el viaje: llega como string", () => {
    // Este es el hecho que hacía fallar todo. Si algún día deja de ser cierto
    // —porque Inngest reviva fechas— el test avisa antes que un cliente real.
    const viajado = viajePorInngest({ parsed: parsedDePrueba() });
    expect(viajado.parsed.platform_created_at).not.toBeInstanceOf(Date);
    expect(typeof viajado.parsed.platform_created_at).toBe("string");
  });

  test("llamar .toISOString() sobre lo que llega revienta", () => {
    const viajado = viajePorInngest({ parsed: parsedDePrueba() });
    const valor = viajado.parsed.platform_created_at as unknown as Date;
    // Reproduce exactamente el error de producción.
    expect(() => valor.toISOString()).toThrow(TypeError);
  });

  test("`new Date(string)` lo devuelve al valor original", () => {
    const original = new Date("2026-08-15T16:57:52.000Z");
    const viajado = viajePorInngest({ parsed: parsedDePrueba({ platform_created_at: original }) });
    const revivido = new Date(viajado.parsed.platform_created_at as unknown as string);
    expect(revivido.getTime()).toBe(original.getTime());
  });

  test("un mensaje sin fecha de plataforma viaja como null y no rompe", () => {
    const viajado = viajePorInngest({
      parsed: parsedDePrueba({ platform_created_at: null }),
    });
    expect(viajado.parsed.platform_created_at).toBeNull();
  });
});
