import { describe, expect, test } from "vitest";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { textoEnviable, urlWhatsAppWeb } from "@/lib/copiloto/whatsapp-web";

describe("urlWhatsAppWeb", () => {
  test("arma la URL de §5: teléfono E.164 sin + y texto codificado", () => {
    expect(urlWhatsAppWeb("593979932363", "Hola, ¿tienen filtro? & más")).toBe(
      "https://web.whatsapp.com/send?phone=593979932363&text=Hola%2C%20%C2%BFtienen%20filtro%3F%20%26%20m%C3%A1s",
    );
  });

  test("los saltos de línea viajan codificados", () => {
    expect(urlWhatsAppWeb("593979932363", "uno\ndos")).toContain("text=uno%0Ados");
  });

  test("un teléfono que no es E.164 (con +, placeholder de Instagram, corto) no produce URL", () => {
    expect(urlWhatsAppWeb("+593979932363", "hola")).toBeNull();
    expect(urlWhatsAppWeb("ig:12345", "hola")).toBeNull();
    expect(urlWhatsAppWeb("12345", "hola")).toBeNull();
  });

  test("el rango es el del puente de escritorio: 8 a 15 dígitos, sin 0 inicial", () => {
    expect(urlWhatsAppWeb("1234567", "hola")).toBeNull();
    expect(urlWhatsAppWeb("12345678", "hola")).not.toBeNull();
    expect(urlWhatsAppWeb("123456789012345", "hola")).not.toBeNull();
    expect(urlWhatsAppWeb("1234567890123456", "hola")).toBeNull();
    expect(urlWhatsAppWeb("0593979932363", "hola")).toBeNull();
  });
});

describe("textoEnviable", () => {
  test("trimea y acepta hasta 4096 caracteres", () => {
    expect(textoEnviable("  hola  ")).toEqual({ ok: true, texto: "hola" });
    expect(textoEnviable("a".repeat(LARGO_MAXIMO_BORRADOR)).ok).toBe(true);
  });

  test("vacío y demasiado largo se rechazan con el motivo y cuánto se pasa", () => {
    expect(textoEnviable("   ")).toEqual({ ok: false, motivo: "vacio", exceso: 0 });
    expect(textoEnviable("a".repeat(LARGO_MAXIMO_BORRADOR + 5))).toEqual({
      ok: false,
      motivo: "largo",
      exceso: 5,
    });
  });
});
