import { describe, expect, test } from "vitest";
import { initials } from "@/lib/ui/initials";

describe("initials", () => {
  test("toma primera y ultima palabra", () => {
    expect(initials("Juan Perez")).toBe("JP");
  });

  test("con tres palabras usa primera y ultima, no las dos primeras", () => {
    expect(initials("Maria Jose Garcia")).toBe("MG");
  });

  test("una sola palabra devuelve una sola inicial", () => {
    expect(initials("Juan")).toBe("J");
  });

  test("normaliza a mayuscula", () => {
    expect(initials("juan perez")).toBe("JP");
  });

  test("respeta acentos al pasar a mayuscula", () => {
    expect(initials("angela ruiz")).toBe("AR");
    expect(initials("ángela ruiz")).toBe("ÁR");
  });

  test("tolera espacios de mas", () => {
    expect(initials("  Juan   Perez  ")).toBe("JP");
  });

  test("string vacio o solo espacios devuelve interrogacion", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  test("ignora las palabras que no empiezan con letra: paréntesis, números, signos", () => {
    expect(initials("Lucía Paredes (prueba)")).toBe("LP");
    expect(initials("Tanda Cuatro 12025550180 (prueba)")).toBe("TC");
    expect(initials("Admin (dev)")).toBe("A");
  });

  test("sin ninguna palabra que empiece con letra devuelve interrogacion", () => {
    expect(initials("(prueba)")).toBe("?");
    expect(initials("+1 555 0100")).toBe("?");
  });
});
