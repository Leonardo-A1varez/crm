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
});
