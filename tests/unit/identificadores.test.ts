import { describe, expect, test } from "vitest";
import {
  LARGO_MAX_IDENTIFICADOR,
  LARGO_VIN,
  esVinValido,
  normalizarIdentificador,
} from "@/lib/identificadores";
import { IDENTIFICADOR_TIPO } from "@/types/domain";

describe("normalizarIdentificador", () => {
  test("dos formas del mismo teléfono caen en la misma cadena", () => {
    // Es la razón de existir de la función: si no coincidieran, el detector de
    // duplicados nunca propondría el par.
    expect(normalizarIdentificador("telefono", "+54 9 11 5555-0002")).toBe("+5491155550002");
    expect(normalizarIdentificador("telefono", "(54) 9 11 5555.0002")).toBe("5491155550002");
    expect(normalizarIdentificador("telefono", "  5491155550002  ")).toBe("5491155550002");
  });

  test("el email va a minúscula y conserva el arroba y el punto", () => {
    expect(normalizarIdentificador("email", "  Compras@Taller.COM ")).toBe("compras@taller.com");
  });

  test("placa, RUC y VIN pierden separadores y suben a mayúscula", () => {
    expect(normalizarIdentificador("placa", "ab-123-cd")).toBe("AB123CD");
    expect(normalizarIdentificador("placa", "AB 123 CD")).toBe("AB123CD");
    expect(normalizarIdentificador("ruc", "20-100.123.456")).toBe("20100123456");
    expect(normalizarIdentificador("vin", "1hg bh41j-xmn109186")).toBe("1HGBH41JXMN109186");
  });

  test("un valor de puros separadores queda vacío", () => {
    // Lo que el schema usa para rechazar: pasa cualquier min(1) sobre el crudo
    // y sin embargo no identifica a nadie.
    expect(normalizarIdentificador("placa", "---")).toBe("");
    expect(normalizarIdentificador("telefono", " () - ")).toBe("");
  });
});

describe("esVinValido", () => {
  test("acepta 17 alfanuméricos y rechaza cualquier otro largo", () => {
    expect(esVinValido("1HGBH41JXMN109186")).toBe(true);
    expect(esVinValido("1HGBH41JXMN10918")).toBe(false); // 16
    expect(esVinValido("1HGBH41JXMN1091866")).toBe(false); // 18
    expect(esVinValido("")).toBe(false);
  });

  test("se mide sobre el normalizado, no sobre lo tipeado", () => {
    // "1HG-BH41J-XMN109186" tiene 19 caracteres; el VIN son 17.
    expect(esVinValido("1HG-BH41J-XMN109186")).toBe(false);
    expect(esVinValido(normalizarIdentificador("vin", "1HG-BH41J-XMN109186"))).toBe(true);
  });
});

describe("topes de largo", () => {
  test("hay un tope para cada tipo del enum", () => {
    // Un tipo nuevo sin tope dejaría pasar cualquier largo en silencio.
    for (const tipo of IDENTIFICADOR_TIPO) {
      expect(LARGO_MAX_IDENTIFICADOR[tipo]).toBeGreaterThan(0);
    }
  });

  test("el tope del VIN es su largo exacto", () => {
    expect(LARGO_MAX_IDENTIFICADOR.vin).toBe(LARGO_VIN);
  });

  test("los topes de la región entran holgados", () => {
    // CNPJ brasileño (14 dígitos) es el documento fiscal más largo del mercado;
    // E.164 admite 15 dígitos de teléfono.
    expect(LARGO_MAX_IDENTIFICADOR.ruc).toBeGreaterThanOrEqual(14);
    expect(LARGO_MAX_IDENTIFICADOR.telefono).toBeGreaterThanOrEqual(16);
  });
});
