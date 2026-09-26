import { describe, expect, test } from "vitest";
import {
  historialDeSanciones,
  interpretarAccountUpdate,
  posicionEnLaEscalera,
  type RegistroDeCuenta,
} from "@/lib/meta/account-update";

/**
 * Los payloads son los ejemplos de la referencia de Meta del webhook
 * `account_update` (developers.facebook.com/docs/whatsapp/cloud-api/webhooks/
 * reference/account_update, leída el 2026-09-25), recortados al `value`.
 */
const AHORA = new Date("2026-09-25T12:00:00Z");

function registro(value: Record<string, unknown>, iso: string): RegistroDeCuenta {
  return { evento: interpretarAccountUpdate(value), at: new Date(iso) };
}

function segundos(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe("interpretarAccountUpdate", () => {
  test("ACCOUNT_VIOLATION trae el tipo de infracción", () => {
    expect(
      interpretarAccountUpdate({
        event: "ACCOUNT_VIOLATION",
        violation_info: { violation_type: "ADULT" },
      }),
    ).toEqual({ tipo: "infraccion", violacion: "ADULT" });
  });

  test("ACCOUNT_RESTRICTION lee cada restricción con su vencimiento en segundos Unix", () => {
    expect(
      interpretarAccountUpdate({
        event: "ACCOUNT_RESTRICTION",
        restriction_info: [
          {
            restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING",
            expiration: 1641330498,
          },
        ],
      }),
    ).toEqual({
      tipo: "restriccion",
      restricciones: [
        {
          tipo: "RESTRICTED_BIZ_INITIATED_MESSAGING",
          vence: new Date(1641330498 * 1000),
          remediacion: null,
        },
      ],
    });
  });

  test("DISABLED_UPDATE conserva el estado y la fecha tal cual los manda Meta", () => {
    expect(
      interpretarAccountUpdate({
        event: "DISABLED_UPDATE",
        ban_info: { waba_ban_state: "REINSTATE", waba_ban_date: "April 17, 2025" },
      }),
    ).toEqual({ tipo: "baja", estado: "REINSTATE", fecha: "April 17, 2025" });
  });

  test("ACCOUNT_OFFBOARDED es una desconexión", () => {
    expect(interpretarAccountUpdate({ event: "ACCOUNT_OFFBOARDED" })).toEqual({
      tipo: "desconexion",
      evento: "ACCOUNT_OFFBOARDED",
    });
  });

  test("un evento que no es de política queda como otro, con su nombre", () => {
    expect(interpretarAccountUpdate({ event: "PARTNER_ADDED" })).toEqual({
      tipo: "otro",
      evento: "PARTNER_ADDED",
    });
  });

  test("una forma que no cumple el contrato no se adivina: queda ilegible", () => {
    expect(
      interpretarAccountUpdate({ event: "ACCOUNT_RESTRICTION", restriction_info: "todo" }),
    ).toEqual({ tipo: "ilegible", evento: "ACCOUNT_RESTRICTION" });
    expect(interpretarAccountUpdate({ sin: "evento" })).toEqual({
      tipo: "ilegible",
      evento: null,
    });
  });
});

describe("posicionEnLaEscalera", () => {
  test("sin ningún account_update no hay posición que dar", () => {
    expect(posicionEnLaEscalera([], AHORA)).toEqual({ tipo: "sin-registros" });
  });

  test("con account_update pero ninguno de política, no hay sanción desde el primero", () => {
    const primero = registro({ event: "PARTNER_ADDED" }, "2026-09-01T10:00:00Z");
    expect(posicionEnLaEscalera([primero], AHORA)).toEqual({
      tipo: "sin-sancion",
      observadoDesde: primero.at,
    });
  });

  test("una infracción sin restricción vigente es la advertencia, desde la última", () => {
    const vieja = registro(
      { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SPAM" } },
      "2026-08-01T10:00:00Z",
    );
    const nueva = registro(
      { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "ADULT" } },
      "2026-08-12T10:00:00Z",
    );
    expect(posicionEnLaEscalera([nueva, vieja], AHORA)).toEqual({
      tipo: "en-escalon",
      indice: 0,
      desde: nueva.at,
      inferido: null,
    });
  });

  test("una restricción de mensajes iniciados por el negocio vigente es el bloqueo de plantillas, inferido", () => {
    const r = registro(
      {
        event: "ACCOUNT_RESTRICTION",
        restriction_info: [
          {
            restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING",
            expiration: segundos("2026-09-27T00:00:00Z"),
          },
        ],
      },
      "2026-09-24T10:00:00Z",
    );
    const p = posicionEnLaEscalera([r], AHORA);
    expect(p).toMatchObject({ tipo: "en-escalon", indice: 1, desde: r.at });
    expect(p.tipo === "en-escalon" && p.inferido).toContain("RESTRICTED_BIZ_INITIATED_MESSAGING");
  });

  test("si también se restringe lo iniciado por el cliente, es el bloqueo de mensajes", () => {
    const r = registro(
      {
        event: "ACCOUNT_RESTRICTION",
        restriction_info: [
          {
            restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING",
            expiration: segundos("2026-10-01T00:00:00Z"),
          },
          {
            restriction_type: "RESTRICTED_CUSTOMER_INITIATED_MESSAGING",
            expiration: segundos("2026-10-01T00:00:00Z"),
          },
        ],
      },
      "2026-09-24T10:00:00Z",
    );
    expect(posicionEnLaEscalera([r], AHORA)).toMatchObject({ tipo: "en-escalon", indice: 2 });
  });

  test("una restricción vencida ya no es la posición: vuelve a la infracción que la precedió", () => {
    const infraccion = registro(
      { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SPAM" } },
      "2026-09-01T10:00:00Z",
    );
    const vencida = registro(
      {
        event: "ACCOUNT_RESTRICTION",
        restriction_info: [
          {
            restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING",
            expiration: segundos("2026-09-05T00:00:00Z"),
          },
        ],
      },
      "2026-09-02T10:00:00Z",
    );
    expect(posicionEnLaEscalera([infraccion, vencida], AHORA)).toMatchObject({
      tipo: "en-escalon",
      indice: 0,
      desde: infraccion.at,
    });
  });

  test("una restricción que sólo toca llamadas no es un escalón de mensajería", () => {
    const r = registro(
      {
        event: "ACCOUNT_RESTRICTION",
        restriction_info: [
          {
            restriction_type: "RESTRICTED_BUSINESS_INITIATED_CALLING",
            expiration: segundos("2026-10-01T00:00:00Z"),
          },
        ],
      },
      "2026-09-24T10:00:00Z",
    );
    expect(posicionEnLaEscalera([r], AHORA)).toEqual({
      tipo: "sin-sancion",
      observadoDesde: r.at,
    });
  });

  test("DISABLE es la deshabilitación y le gana a todo lo anterior", () => {
    const infraccion = registro(
      { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SPAM" } },
      "2026-09-01T10:00:00Z",
    );
    const baja = registro(
      { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "DISABLE" } },
      "2026-09-20T10:00:00Z",
    );
    expect(posicionEnLaEscalera([infraccion, baja], AHORA)).toEqual({
      tipo: "en-escalon",
      indice: 4,
      desde: baja.at,
      inferido: null,
    });
  });

  test("REINSTATE después de DISABLE levanta la deshabilitación", () => {
    const baja = registro(
      { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "DISABLE" } },
      "2026-09-20T10:00:00Z",
    );
    const vuelta = registro(
      { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "REINSTATE" } },
      "2026-09-22T10:00:00Z",
    );
    expect(posicionEnLaEscalera([baja, vuelta], AHORA)).toMatchObject({ tipo: "sin-sancion" });
  });
});

describe("historialDeSanciones", () => {
  test("lista sólo lo que es de política, lo más reciente primero, con el valor de Meta", () => {
    const h = historialDeSanciones([
      registro({ event: "PARTNER_ADDED" }, "2026-09-01T10:00:00Z"),
      registro(
        { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "ADULT" } },
        "2026-09-02T10:00:00Z",
      ),
      registro(
        { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "SCHEDULE_FOR_DISABLE" } },
        "2026-09-03T10:00:00Z",
      ),
    ]);
    expect(h.map((e) => e.evento)).toEqual(["DISABLED_UPDATE", "ACCOUNT_VIOLATION"]);
    expect(h[1]?.detalle).toContain("ADULT");
    expect(h[0]?.titulo).toMatch(/programó/i);
  });

  test("un account_update ilegible aparece, para que alguien abra el crudo", () => {
    const h = historialDeSanciones([
      registro({ event: "ACCOUNT_RESTRICTION", restriction_info: 3 }, "2026-09-02T10:00:00Z"),
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]?.titulo).toMatch(/no se pudo leer/i);
  });
});
