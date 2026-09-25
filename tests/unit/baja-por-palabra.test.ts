import { describe, expect, test } from "vitest";
import { palabraDeBaja } from "@/lib/difusion/baja-por-palabra";

/**
 * La regla que convierte un mensaje entrante en una baja propia. Tiene que ser
 * estricta: una baja es irreversible por escritura automática, así que un falso
 * positivo le corta el marketing a alguien que no lo pidió.
 */
describe("palabraDeBaja", () => {
  test.each([
    ["BAJA", "BAJA"],
    ["baja", "BAJA"],
    ["Salir", "SALIR"],
    ["PARAR", "PARAR"],
    ["sair", "SAIR"],
  ])("la palabra sola da de baja: %s", (texto, esperada) => {
    expect(palabraDeBaja(texto)).toBe(esperada);
  });

  test("no importan las tildes ni las mayúsculas", () => {
    expect(palabraDeBaja("Salír")).toBe("SALIR");
    expect(palabraDeBaja("SAÍR")).toBe("SAIR");
    expect(palabraDeBaja("bAjA")).toBe("BAJA");
  });

  test("tolera espacios, puntuación y emojis alrededor de la palabra", () => {
    expect(palabraDeBaja("  baja  ")).toBe("BAJA");
    expect(palabraDeBaja("BAJA.")).toBe("BAJA");
    expect(palabraDeBaja("¡Baja!")).toBe("BAJA");
    expect(palabraDeBaja("¿salir?")).toBe("SALIR");
    expect(palabraDeBaja("PARAR 🙏")).toBe("PARAR");
    expect(palabraDeBaja("\nsair\n")).toBe("SAIR");
  });

  test("la palabra dentro de una frase no cuenta", () => {
    expect(palabraDeBaja("no quiero salir de la promo")).toBeNull();
    expect(palabraDeBaja("baja por favor")).toBeNull();
    expect(palabraDeBaja("quiero la baja")).toBeNull();
    expect(palabraDeBaja("BAJA BAJA")).toBeNull();
    expect(palabraDeBaja("salir, gracias")).toBeNull();
  });

  test("una palabra parecida no cuenta", () => {
    expect(palabraDeBaja("bajar")).toBeNull();
    expect(palabraDeBaja("bajas")).toBeNull();
    expect(palabraDeBaja("sairam")).toBeNull();
    expect(palabraDeBaja("B.A.J.A")).toBeNull();
    expect(palabraDeBaja("pa rar")).toBeNull();
  });

  test("vacío, en blanco o ausente no es una baja", () => {
    expect(palabraDeBaja("")).toBeNull();
    expect(palabraDeBaja("   ")).toBeNull();
    expect(palabraDeBaja("!!!")).toBeNull();
    expect(palabraDeBaja(null)).toBeNull();
    expect(palabraDeBaja(undefined)).toBeNull();
  });
});
