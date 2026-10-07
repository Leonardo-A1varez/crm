import { describe, expect, test } from "vitest";
import { procedenciaDe } from "@/lib/catalogo/procedencia";

describe("procedenciaDe", () => {
  test.each([
    ["MOBIS", "MOBIS"],
    ["KOREA", "KOREA"],
    ["CHINA", "CHINA"],
    ["GM", "GM"],
    ["  mobis ", "MOBIS"],
    ["KIA AE", "KIA AE"],
    ["SUPER-MAX", "SUPER-MAX"],
    ["HY INDIA", "HY INDIA"],
  ])("%j es una procedencia: %j", (entrada, esperada) => {
    expect(procedenciaDe(entrada)).toBe(esperada);
  });

  // Los valores de abajo existen en `productos.descripcion` del catálogo real
  // (consulta por frecuencia, 2026-10-07): medidas, sobremedidas y restos.
  test.each([
    "52*88C",
    "54*82C",
    "54*88°",
    "555",
    "+20",
    "0",
    "A2(b) 7  C/U",
    "C/U",
    "STD",
    "",
    "   ",
  ])("%j parece basura, no una procedencia", (entrada) => {
    expect(procedenciaDe(entrada)).toBeNull();
  });

  test("null y undefined no tienen procedencia", () => {
    expect(procedenciaDe(null)).toBeNull();
    expect(procedenciaDe(undefined)).toBeNull();
  });
});
