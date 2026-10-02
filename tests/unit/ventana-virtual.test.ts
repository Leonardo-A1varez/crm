import { describe, expect, test } from "vitest";
import {
  ALTO_FILA,
  calcularVentana,
  indiceAriaDeFila,
  SOBRELECTURA,
} from "@/lib/ui/ventana-virtual";

describe("calcularVentana", () => {
  test("arriba de todo: dibuja las visibles más la sobrelectura de abajo, sin espaciador arriba", () => {
    const v = calcularVentana(21_009, 0, 600);
    expect(v.inicio).toBe(0);
    expect(v.fin).toBe(Math.ceil(600 / ALTO_FILA) + SOBRELECTURA * 2);
    expect(v.altoAntes).toBe(0);
    expect(v.altoDespues).toBe((21_009 - v.fin) * ALTO_FILA);
  });

  test("el alto total siempre es el de la lista entera: los espaciadores completan lo que no se dibuja", () => {
    for (const scrollTop of [0, 1, 37, 38, 5_000, 123_456, 797_000]) {
      const v = calcularVentana(21_009, scrollTop, 730);
      expect(v.altoAntes + (v.fin - v.inicio) * ALTO_FILA + v.altoDespues).toBe(21_009 * ALTO_FILA);
    }
  });

  test("en el medio dibuja la fila que está a la vista, con sobrelectura a los dos lados", () => {
    const scrollTop = 38 * 1_000;
    const v = calcularVentana(21_009, scrollTop, 380);
    expect(v.inicio).toBe(1_000 - SOBRELECTURA);
    expect(v.fin - v.inicio).toBe(10 + SOBRELECTURA * 2);
    expect(v.inicio * ALTO_FILA).toBe(v.altoAntes);
  });

  test("al final no se pasa del total y no deja espaciador de abajo", () => {
    const total = 500;
    const v = calcularVentana(total, total * ALTO_FILA, 600);
    expect(v.fin).toBe(total);
    expect(v.altoDespues).toBe(0);
    expect(v.inicio).toBeLessThanOrEqual(total);
  });

  test("con menos filas que la pantalla las dibuja todas", () => {
    const v = calcularVentana(5, 0, 900);
    expect([v.inicio, v.fin, v.altoAntes, v.altoDespues]).toEqual([0, 5, 0, 0]);
  });

  test("sin filas no dibuja nada", () => {
    expect(calcularVentana(0, 0, 900)).toEqual({ inicio: 0, fin: 0, altoAntes: 0, altoDespues: 0 });
  });

  test("un scrollTop negativo o un alto negativo (rebote del navegador) no rompen la cuenta", () => {
    const v = calcularVentana(100, -50, -10);
    expect(v.inicio).toBe(0);
    expect(v.fin).toBe(SOBRELECTURA * 2);
  });

  test("la sobrelectura y el alto de fila se pueden cambiar", () => {
    const v = calcularVentana(1000, 200, 100, 20, 2);
    expect(v.inicio).toBe(8);
    expect(v.fin).toBe(8 + 5 + 4);
    expect(v.altoAntes).toBe(160);
  });
});

describe("indiceAriaDeFila", () => {
  test("la 1 es el encabezado: la primera fila de datos es la 2", () => {
    expect(indiceAriaDeFila(0)).toBe(2);
    expect(indiceAriaDeFila(21_008)).toBe(21_010);
  });
});
