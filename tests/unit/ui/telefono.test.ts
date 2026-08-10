import { describe, expect, test } from "vitest";
import { CODIGOS_PAIS, formatearTelefono, separarTelefono } from "@/lib/ui/telefono";

describe("formatearTelefono", () => {
  test("separa el código de país del caso del dueño", () => {
    expect(formatearTelefono("593979932363")).toBe("+593 979932363");
  });

  test("formatea un número de cada país del mercado", () => {
    expect(formatearTelefono("51987654321")).toBe("+51 987654321");
    expect(formatearTelefono("525512345678")).toBe("+52 5512345678");
    expect(formatearTelefono("5491112345678")).toBe("+54 91112345678");
    expect(formatearTelefono("5511987654321")).toBe("+55 11987654321");
    expect(formatearTelefono("56912345678")).toBe("+56 912345678");
    expect(formatearTelefono("573001234567")).toBe("+57 3001234567");
    expect(formatearTelefono("593979932363")).toBe("+593 979932363");
    expect(formatearTelefono("595981123456")).toBe("+595 981123456");
  });

  test("tolera el + y los separadores de escritura", () => {
    expect(formatearTelefono("+593 97 993-2363")).toBe("+593 979932363");
    expect(formatearTelefono("  +5491112345678  ")).toBe("+54 91112345678");
    expect(formatearTelefono("(595) 981 123 456")).toBe("+595 981123456");
  });

  test("un país fuera del mercado vuelve tal cual", () => {
    // 34 = España, 1 = EE.UU./Canadá: no están en la tabla y no se adivinan.
    expect(formatearTelefono("34600123456")).toBe("34600123456");
    expect(formatearTelefono("12125550123")).toBe("12125550123");
  });

  test("el teléfono sintético de Instagram y Messenger vuelve tal cual", () => {
    // Los leads sin WhatsApp guardan `ig:<meta_user_id>` en `telefono`.
    expect(formatearTelefono("ig:17841400000000")).toBe("ig:17841400000000");
    expect(formatearTelefono("fb:9876543210")).toBe("fb:9876543210");
  });

  test("no parte un número demasiado corto para ser E.164", () => {
    // `+54 11` no es un teléfono: mejor el número entero que un corte inventado.
    expect(formatearTelefono("5411")).toBe("5411");
    expect(formatearTelefono("59397")).toBe("59397");
  });

  test("el vacío y la basura vuelven tal cual", () => {
    expect(formatearTelefono("")).toBe("");
    expect(formatearTelefono("   ")).toBe("   ");
    expect(formatearTelefono("sin teléfono")).toBe("sin teléfono");
  });
});

describe("separarTelefono — orden de matcheo", () => {
  test("el código de tres dígitos gana sobre cualquier prefijo más corto", () => {
    // La trampa: 593 y 595 arrancan con 59. Si el matcheo cortara por largo
    // ascendente, un código de dos dígitos que empiece igual los taparía.
    expect(separarTelefono("593979932363")?.codigo).toBe("593");
    expect(separarTelefono("593979932363")?.pais).toBe("Ecuador");
    expect(separarTelefono("595981123456")?.codigo).toBe("595");
    expect(separarTelefono("595981123456")?.pais).toBe("Paraguay");
  });

  test("54 y 55 no se confunden entre sí ni con lo que sigue", () => {
    expect(separarTelefono("5541999998888")).toEqual({
      codigo: "55",
      nacional: "41999998888",
      pais: "Brasil",
    });
    expect(separarTelefono("5451999998888")).toEqual({
      codigo: "54",
      nacional: "51999998888",
      pais: "Argentina",
    });
  });

  test("ningún código de la tabla es prefijo de otro", () => {
    // Invariante de la tabla: si se rompe, el matcheo por largo es lo único que
    // impide que el país devuelto dependa del orden de declaración.
    for (const a of CODIGOS_PAIS) {
      for (const b of CODIGOS_PAIS) {
        if (a.codigo === b.codigo) continue;
        expect(b.codigo.startsWith(a.codigo)).toBe(false);
      }
    }
  });

  test("los ocho países del mercado están y sus códigos son únicos", () => {
    expect(CODIGOS_PAIS).toHaveLength(8);
    expect(new Set(CODIGOS_PAIS.map((c) => c.codigo)).size).toBe(8);
    expect(CODIGOS_PAIS.map((c) => c.pais).sort()).toEqual([
      "Argentina",
      "Brasil",
      "Chile",
      "Colombia",
      "Ecuador",
      "México",
      "Paraguay",
      "Perú",
    ]);
  });

  test("devuelve null en vez de un corte a ciegas", () => {
    expect(separarTelefono("34600123456")).toBeNull();
    expect(separarTelefono("ig:17841400000000")).toBeNull();
    expect(separarTelefono("")).toBeNull();
  });
});
