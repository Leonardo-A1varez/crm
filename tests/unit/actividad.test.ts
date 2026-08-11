import { describe, expect, test } from "vitest";
import { cotasActividad } from "@/lib/actividad";

const DIA_MS = 24 * 60 * 60 * 1000;
// Media tarde, para que el corte de "hoy" quede claramente antes de `ahora`.
const AHORA = new Date(2026, 2, 10, 15, 30, 0);

describe("cotasActividad", () => {
  test("sin ventana no pone cotas", () => {
    expect(cotasActividad(undefined, AHORA)).toEqual({});
  });

  test("hoy arranca en la medianoche local, no 24 h atrás", () => {
    const { actualizadoDesde, actualizadoHasta } = cotasActividad("hoy", AHORA);
    expect(actualizadoHasta).toBeUndefined();
    expect(actualizadoDesde?.getFullYear()).toBe(2026);
    expect(actualizadoDesde?.getMonth()).toBe(2);
    expect(actualizadoDesde?.getDate()).toBe(10);
    expect(actualizadoDesde?.getHours()).toBe(0);
    expect(actualizadoDesde?.getMinutes()).toBe(0);
  });

  test("semana son los últimos 7 días móviles", () => {
    const { actualizadoDesde } = cotasActividad("semana", AHORA);
    expect(actualizadoDesde?.getTime()).toBe(AHORA.getTime() - 7 * DIA_MS);
  });

  test("mas_30 es una cota superior: mira hacia atrás", () => {
    const { actualizadoDesde, actualizadoHasta } = cotasActividad("mas_30", AHORA);
    expect(actualizadoDesde).toBeUndefined();
    expect(actualizadoHasta?.getTime()).toBe(AHORA.getTime() - 30 * DIA_MS);
  });

  test("no lee el reloj por su cuenta: dos llamadas con el mismo `ahora` dan lo mismo", () => {
    expect(cotasActividad("semana", AHORA)).toEqual(cotasActividad("semana", AHORA));
  });
});
