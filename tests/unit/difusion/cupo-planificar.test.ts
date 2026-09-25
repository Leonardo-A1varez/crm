import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  RESERVA_CONVERSACIONES_PCT,
  SIN_TECHO,
  cupoParaPlanificar,
  reservaDelTope,
} from "@/lib/difusion/cupo";

describe("reservaDelTope", () => {
  test("aparta el porcentaje del tope, redondeado hacia arriba", () => {
    expect(RESERVA_CONVERSACIONES_PCT).toBe(15);
    expect(reservaDelTope(2000)).toBe(300);
    // 37,5 → 38: la reserva protege conversaciones vivas; se redondea a su favor.
    expect(reservaDelTope(250)).toBe(38);
  });

  test("sin techo no hay nada que reservar", () => {
    expect(reservaDelTope("ilimitado")).toBe(0);
  });
});

describe("cupoParaPlanificar", () => {
  test("restante es el tope menos lo usado en 24 h, y la reserva va aparte", () => {
    expect(cupoParaPlanificar({ tope: 2000, usado24h: 1150 })).toEqual({
      restante: 850,
      reserva: 300,
    });
  });

  test("lo usado de más no da un restante negativo", () => {
    expect(cupoParaPlanificar({ tope: 250, usado24h: 400 })).toEqual({
      restante: 0,
      reserva: 38,
    });
  });

  test("ilimitado se planifica con un entero sin techo, que el planificador acepta", () => {
    const c = cupoParaPlanificar({ tope: "ilimitado", usado24h: 10 });
    expect(c).toEqual({ restante: SIN_TECHO, reserva: 0 });
    expect(Number.isInteger(c.restante)).toBe(true);
  });

  test("un tope o un uso que no son enteros no negativos se rechazan", () => {
    expect(() => cupoParaPlanificar({ tope: -1, usado24h: 0 })).toThrow(ValidationError);
    expect(() => cupoParaPlanificar({ tope: 250, usado24h: Number.NaN })).toThrow(ValidationError);
    expect(() => cupoParaPlanificar({ tope: 2.5, usado24h: 0 })).toThrow(ValidationError);
  });
});
