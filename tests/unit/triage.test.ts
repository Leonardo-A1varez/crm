import { describe, expect, test } from "vitest";
import { esperaLegible, triage, UMBRAL_ESPERA_ALTA_MS } from "@/lib/triage";
import type { EntradaTriage } from "@/lib/triage";

const AHORA = new Date("2026-08-10T12:00:00.000Z");

function entrada(over: Partial<EntradaTriage> = {}): EntradaTriage {
  return {
    stage: "identificando",
    urgencia: "media",
    iaPausada: false,
    bloqueador: null,
    sinResponder: 0,
    esperandoDesde: null,
    ahora: AHORA,
    ...over,
  };
}

function haceMinutos(min: number): Date {
  return new Date(AHORA.getTime() - min * 60_000);
}

describe("esperaLegible", () => {
  test("por debajo del minuto dice 'recién'", () => {
    expect(esperaLegible(30_000)).toBe("recién");
  });

  test("redondea hacia abajo y no hacia arriba", () => {
    // 119 segundos son 1m y monedas: decir 2m exagera la espera.
    expect(esperaLegible(119_000)).toBe("hace 1m");
    expect(esperaLegible(59 * 60_000 + 59_000)).toBe("hace 59m");
  });

  test("escala a horas y días", () => {
    expect(esperaLegible(60 * 60_000)).toBe("hace 1h");
    expect(esperaLegible(23 * 60 * 60_000)).toBe("hace 23h");
    expect(esperaLegible(25 * 60 * 60_000)).toBe("hace 1d");
  });
});

describe("triage", () => {
  test("sin nada que atender es baja y sin motivo", () => {
    expect(triage(entrada())).toEqual({ prioridad: "baja", motivo: null });
  });

  test("requiere_humano gana sobre todo lo demás", () => {
    const r = triage(
      entrada({
        stage: "requiere_humano",
        iaPausada: true,
        sinResponder: 3,
        esperandoDesde: haceMinutos(300),
      }),
    );
    expect(r).toEqual({ prioridad: "alta", motivo: "Escalado a un humano" });
  });

  test("IA pausada gana sobre el tiempo de espera", () => {
    const r = triage({
      ...entrada({ iaPausada: true, sinResponder: 1, esperandoDesde: haceMinutos(300) }),
    });
    expect(r).toEqual({ prioridad: "alta", motivo: "IA pausada, contesta un vendedor" });
  });

  test("una hora sin responder escala a alta", () => {
    const justo = triage(
      entrada({
        sinResponder: 1,
        esperandoDesde: new Date(AHORA.getTime() - UMBRAL_ESPERA_ALTA_MS),
      }),
    );
    expect(justo).toEqual({ prioridad: "alta", motivo: "Sin responder hace 1h" });
  });

  test("un minuto antes del umbral todavía es media", () => {
    const r = triage(entrada({ sinResponder: 1, esperandoDesde: haceMinutos(59) }));
    expect(r).toEqual({ prioridad: "media", motivo: "Sin responder hace 59m" });
  });

  test("urgencia alta escala aunque la espera sea corta", () => {
    const r = triage(
      entrada({ urgencia: "alta", sinResponder: 1, esperandoDesde: haceMinutos(2) }),
    );
    expect(r).toEqual({ prioridad: "alta", motivo: "Urgencia alta sin responder" });
  });

  test("urgencia alta sin mensajes pendientes NO escala", () => {
    // El lead urgente al que ya le contestamos no tiene por qué encabezar la
    // lista: lo que prioriza es que esté esperando, no que sea importante.
    expect(triage(entrada({ urgencia: "alta" })).prioridad).toBe("baja");
  });

  test("el bloqueador prioriza a media aunque no haya nada sin responder", () => {
    const r = triage(entrada({ bloqueador: "no tiene la factura" }));
    expect(r).toEqual({ prioridad: "media", motivo: "Con bloqueador" });
  });

  test("un bloqueador en blanco no cuenta como bloqueador", () => {
    expect(triage(entrada({ bloqueador: "   " })).prioridad).toBe("baja");
  });

  test("esperando_pago es media aunque nadie esté esperando respuesta", () => {
    const r = triage(entrada({ stage: "esperando_pago" }));
    expect(r).toEqual({ prioridad: "media", motivo: "Esperando pago" });
  });

  test("sin responder gana sobre esperando_pago porque describe mejor", () => {
    const r = triage(
      entrada({ stage: "esperando_pago", sinResponder: 2, esperandoDesde: haceMinutos(5) }),
    );
    expect(r).toEqual({ prioridad: "media", motivo: "Sin responder hace 5m" });
  });

  test("esperandoDesde null con sinResponder 0 no calcula espera", () => {
    expect(triage(entrada({ esperandoDesde: null, sinResponder: 0 })).motivo).toBeNull();
  });
});
