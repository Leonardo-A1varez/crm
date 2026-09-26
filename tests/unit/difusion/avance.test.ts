import { describe, expect, test } from "vitest";
import { estimarFin, ritmoMedido, tandaActual } from "@/lib/difusion/avance";

const T0 = new Date("2026-09-25T12:00:00.000Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

describe("tandaActual", () => {
  test("es la primera tanda que todavía tiene algo en cola", () => {
    expect(
      tandaActual([
        { tanda: 0, desde: min(0), total: 100, enCola: 0 },
        { tanda: 1, desde: min(1440), total: 100, enCola: 40 },
        { tanda: 2, desde: min(2880), total: 50, enCola: 50 },
      ]),
    ).toEqual({ numero: 2, de: 3 });
  });

  test("con todo salido es la última", () => {
    expect(tandaActual([{ tanda: 0, desde: min(0), total: 5, enCola: 0 }])).toEqual({
      numero: 1,
      de: 1,
    });
  });

  test("sin plan no hay tanda", () => {
    expect(tandaActual([])).toBeNull();
  });
});

describe("ritmoMedido", () => {
  test("mensajes por segundo en la ventana", () => {
    expect(ritmoMedido(600, 5 * 60_000)).toBe(2);
  });
  test("sin nada reservado en la ventana no hay ritmo medido", () => {
    expect(ritmoMedido(0, 5 * 60_000)).toBeNull();
  });
});

describe("estimarFin", () => {
  test("lo que queda de la tanda en curso al ritmo medido", () => {
    const fin = estimarFin({
      tandas: [{ tanda: 0, desde: min(-10), total: 1000, enCola: 120 }],
      ahora: T0,
      ritmoPorSeg: 2,
    });
    expect(fin).toEqual(min(1));
  });

  test("una tanda de mañana empieza a su hora, no ahora", () => {
    const fin = estimarFin({
      tandas: [
        { tanda: 0, desde: min(-10), total: 100, enCola: 0 },
        { tanda: 1, desde: min(1440), total: 120, enCola: 120 },
      ],
      ahora: T0,
      ritmoPorSeg: 2,
    });
    expect(fin).toEqual(min(1441));
  });

  test("sin ritmo o sin nada en cola no se estima", () => {
    const tandas = [{ tanda: 0, desde: min(0), total: 10, enCola: 10 }];
    expect(estimarFin({ tandas, ahora: T0, ritmoPorSeg: null })).toBeNull();
    expect(
      estimarFin({
        tandas: [{ tanda: 0, desde: min(0), total: 10, enCola: 0 }],
        ahora: T0,
        ritmoPorSeg: 2,
      }),
    ).toBeNull();
  });
});
