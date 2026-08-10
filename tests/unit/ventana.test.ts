import { describe, expect, test } from "vitest";
import { AVISO_MS, estadoVentana, restanteLegible, VENTANA_MS } from "@/lib/ventana";

const AHORA = new Date("2026-08-10T12:00:00.000Z");

function haceHoras(h: number): Date {
  return new Date(AHORA.getTime() - h * 60 * 60 * 1000);
}

describe("estadoVentana", () => {
  test("sin mensajes del cliente no hay ventana que medir", () => {
    expect(estadoVentana(null, AHORA)).toEqual({
      estado: "sin-mensajes",
      vence: null,
      restanteMs: 0,
    });
  });

  test("recién escrito deja la ventana abierta 24 h", () => {
    const v = estadoVentana(AHORA, AHORA);
    expect(v.estado).toBe("abierta");
    expect(v.restanteMs).toBe(VENTANA_MS);
    expect(v.vence).toEqual(new Date(AHORA.getTime() + VENTANA_MS));
  });

  test("a menos de dos horas avisa", () => {
    expect(estadoVentana(haceHoras(23), AHORA).estado).toBe("por-vencer");
  });

  test("justo en el umbral de aviso ya avisa", () => {
    const limite = new Date(AHORA.getTime() - (VENTANA_MS - AVISO_MS));
    expect(estadoVentana(limite, AHORA).estado).toBe("por-vencer");
  });

  test("a las 24 h exactas está cerrada", () => {
    const v = estadoVentana(haceHoras(24), AHORA);
    expect(v.estado).toBe("cerrada");
    expect(v.restanteMs).toBe(0);
  });

  test("pasadas las 24 h sigue cerrada y no devuelve restante negativo", () => {
    expect(estadoVentana(haceHoras(50), AHORA).restanteMs).toBe(0);
  });
});

describe("restanteLegible", () => {
  test("por debajo de la hora habla en minutos", () => {
    expect(restanteLegible(45 * 60_000)).toBe("45 min");
  });

  test("las horas exactas no arrastran minutos", () => {
    expect(restanteLegible(3 * 60 * 60_000)).toBe("3 h");
  });

  test("mezcla horas y minutos", () => {
    expect(restanteLegible((3 * 60 + 20) * 60_000)).toBe("3 h 20 min");
  });

  test("un restante negativo no imprime signo", () => {
    expect(restanteLegible(-5000)).toBe("0 min");
  });
});
