import { describe, expect, test } from "vitest";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";

describe("normalizarTelefonoWhatsApp", () => {
  test.each([
    ["593991234567", "593991234567"],
    ["+593 99 123 4567", "593991234567"],
    ["+54 9 11 5555-0002", "5491155550002"],
    ["(593) 99-123.4567", "593991234567"],
    ["  593991234567  ", "593991234567"],
  ])("%s → %s", (crudo, esperado) => {
    expect(normalizarTelefonoWhatsApp(crudo)).toBe(esperado);
  });

  // Es la razón de existir de esta función: la deduplicación y la lista de
  // bajas comparan por esta clave. Si el `+` sobrevive, "+5939…" y "5939…"
  // son dos personas y la baja de una no alcanza a la otra.
  test("el mismo número con y sin + cae en la misma clave", () => {
    expect(normalizarTelefonoWhatsApp("+593991234567")).toBe(
      normalizarTelefonoWhatsApp("593991234567"),
    );
  });

  test.each([[null], [undefined], [""], ["   "]])("vacío (%j) → null", (crudo) => {
    expect(normalizarTelefonoWhatsApp(crudo)).toBeNull();
  });

  // Los leads de Instagram y Messenger guardan `ig:<id>` en la columna
  // `telefono` (`buildPlaceholderLead`). Sacarle las letras dejaría un número
  // de 17 dígitos que parece un teléfono y no lo es.
  test.each([["ig:17841400000000"], ["fb:1234567890"], ["ERASED:5f2a9c"], ["abc"]])(
    "un placeholder (%s) no es un teléfono",
    (crudo) => {
      expect(normalizarTelefonoWhatsApp(crudo)).toBeNull();
    },
  );

  test("un número local sin código de país no es alcanzable por WhatsApp", () => {
    // E.164: ningún código de país empieza con 0.
    expect(normalizarTelefonoWhatsApp("0991234567")).toBeNull();
  });

  test("menos de 7 dígitos no es un E.164", () => {
    expect(normalizarTelefonoWhatsApp("123456")).toBeNull();
  });

  test("más de 15 dígitos no es un E.164", () => {
    expect(normalizarTelefonoWhatsApp("1234567890123456")).toBeNull();
  });

  test("un + en el medio no es un separador", () => {
    expect(normalizarTelefonoWhatsApp("593+991234567")).toBeNull();
  });
});
