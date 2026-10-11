import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  cifrarToken,
  claveDesdeBase64,
  descifrarToken,
  llaveroDesdeEnv,
} from "@/lib/meta/token-cifrado";
import { IllegalStateError, ValidationError } from "@/lib/errors";

const B64 = (n = 32) => randomBytes(n).toString("base64");

describe("token-cifrado (AES-256-GCM)", () => {
  test("ida y vuelta: lo cifrado se descifra igual con la misma clave y el mismo número", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    const cifrado = cifrarToken("EAAG-token-de-negocio", "106540352242922", llavero);
    expect(descifrarToken(cifrado, "106540352242922", llavero)).toBe("EAAG-token-de-negocio");
  });

  test("el cifrado no contiene el token y cumple el formato que exige la base", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    const cifrado = cifrarToken("EAAG-token-de-negocio", "1", llavero);
    expect(cifrado).not.toContain("EAAG");
    expect(cifrado).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test("dos cifrados del mismo token son distintos (IV al azar)", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    expect(cifrarToken("t", "1", llavero)).not.toBe(cifrarToken("t", "1", llavero));
  });

  test("atado al número: el cifrado de un número no descifra para otro", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    const cifrado = cifrarToken("t", "111", llavero);
    expect(() => descifrarToken(cifrado, "222", llavero)).toThrow(ValidationError);
  });

  test("un byte cambiado se rechaza (autenticado)", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    const partes = cifrarToken("token-largo-de-prueba", "1", llavero).split(".");
    const ct = Buffer.from(partes[4]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    partes[4] = ct.toString("base64url");
    expect(() => descifrarToken(partes.join("."), "1", llavero)).toThrow(ValidationError);
  });

  test("rotación: con la clave nueva activa, lo cifrado con la anterior se sigue leyendo", () => {
    const vieja = B64();
    const nueva = B64();
    const antes = llaveroDesdeEnv({ META_TOKENS_CLAVE: vieja });
    const cifradoViejo = cifrarToken("t-viejo", "1", antes);

    const despues = llaveroDesdeEnv({
      META_TOKENS_CLAVE: nueva,
      META_TOKENS_CLAVE_ANTERIOR: vieja,
    });
    expect(descifrarToken(cifradoViejo, "1", despues)).toBe("t-viejo");
    // Lo nuevo sale con la activa: sin la anterior también se lee.
    const cifradoNuevo = cifrarToken("t-nuevo", "1", despues);
    expect(descifrarToken(cifradoNuevo, "1", llaveroDesdeEnv({ META_TOKENS_CLAVE: nueva }))).toBe(
      "t-nuevo",
    );
  });

  test("una clave que no está en el llavero se rechaza con un error que no la nombra", () => {
    const cifrado = cifrarToken("t", "1", llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() }));
    expect(() =>
      descifrarToken(cifrado, "1", llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() })),
    ).toThrow(ValidationError);
  });

  test("sin META_TOKENS_CLAVE no hay llavero: IllegalStateError", () => {
    expect(() => llaveroDesdeEnv({})).toThrow(IllegalStateError);
  });

  test("una clave que no decodifica a 32 bytes se rechaza sin incluirla en el mensaje", () => {
    const corta = B64(16);
    let mensaje = "";
    try {
      claveDesdeBase64(corta);
    } catch (e) {
      mensaje = (e as Error).message;
      expect(e).toBeInstanceOf(IllegalStateError);
    }
    expect(mensaje).not.toBe("");
    expect(mensaje).not.toContain(corta);
  });

  test("un tag de autenticación recortado se rechaza (largo fijo de 16 bytes)", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    const partes = cifrarToken("t", "1", llavero).split(".");
    partes[3] = Buffer.from(partes[3]!, "base64url").subarray(0, 4).toString("base64url");
    expect(() => descifrarToken(partes.join("."), "1", llavero)).toThrow(ValidationError);
  });

  test("un texto con otro formato se rechaza", () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: B64() });
    expect(() => descifrarToken("no-es-un-cifrado", "1", llavero)).toThrow(ValidationError);
  });
});
