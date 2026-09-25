import { describe, expect, test } from "vitest";
import { parsearClavesBajas } from "@/lib/difusion/claves-bajas";
import { IllegalStateError, ValidationError, isNonRetriable } from "@/lib/errors";
import {
  HasherTelefonoBajas,
  hasherBajasDesde,
  hasherBajasEfimero,
} from "@/server/repositories/difusion-supresiones.hash";

// Claves de prueba: 32 bytes cada una, en base64. No son secretos de ningún entorno.
const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const TELEFONO = "593991234567";

function hasher(claves: string, activa: number): HasherTelefonoBajas {
  return new HasherTelefonoBajas(parsearClavesBajas(claves, activa));
}

describe("parsearClavesBajas", () => {
  test("lee versión:clave separadas por coma y marca la activa", () => {
    const c = parsearClavesBajas(`1:${K1}, 2:${K2}`, "2");

    expect(c.activa).toBe(2);
    expect([...c.claves.keys()]).toEqual([1, 2]);
  });

  test.each([
    ["vacío", ""],
    ["sin versión", K1],
    ["versión no entera", `x:${K1}`],
    ["versión cero", `0:${K1}`],
    ["clave corta", `1:${Buffer.alloc(16, 1).toString("base64")}`],
    ["clave que no es base64", "1:no-es-base64-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"],
    ["versión repetida", `1:${K1},1:${K2}`],
  ])("rechaza %s", (_caso, claves) => {
    expect(() => parsearClavesBajas(claves, 1)).toThrow(ValidationError);
  });

  test("rechaza una versión activa que no está entre las claves", () => {
    expect(() => parsearClavesBajas(`1:${K1}`, 2)).toThrow(ValidationError);
  });

  // Un error de configuración termina en el log del boot: no puede llevar la clave.
  test("el error no incluye el material de la clave", () => {
    const corta = Buffer.alloc(16, 7).toString("base64");
    try {
      parsearClavesBajas(`1:${corta}`, 1);
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(corta);
    }
  });
});

describe("HasherTelefonoBajas", () => {
  test("el mismo número escrito de dos formas da el mismo hash", () => {
    const h = hasher(`1:${K1}`, 1);

    const a = h.alta("+593 99 123 4567");
    const b = h.alta(TELEFONO);

    expect(a).toEqual(b);
    expect(a.clave_version).toBe(1);
    expect(a.telefono_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("el hash no es el SHA-256 plano del número: depende de la clave", () => {
    const conK1 = hasher(`1:${K1}`, 1).alta(TELEFONO).telefono_hash;
    const conK2 = hasher(`1:${K2}`, 1).alta(TELEFONO).telefono_hash;

    expect(conK1).not.toBe(conK2);
    expect(conK1).not.toContain(TELEFONO);
  });

  test("las altas usan la versión activa", () => {
    const h = hasher(`1:${K1},2:${K2}`, 2);

    expect(h.alta(TELEFONO).clave_version).toBe(2);
  });

  test("la búsqueda calcula el hash con todas las versiones vigentes", () => {
    const soloV1 = hasher(`1:${K1}`, 1);
    const ambas = hasher(`1:${K1},2:${K2}`, 2);

    const buscados = ambas.busqueda(TELEFONO);

    expect(buscados).toHaveLength(2);
    expect(buscados).toContainEqual(soloV1.alta(TELEFONO));
    expect(buscados).toContainEqual(ambas.alta(TELEFONO));
  });

  test("un teléfono que no es de WhatsApp no tiene hash", () => {
    const h = hasher(`1:${K1}`, 1);

    expect(h.busqueda("ig:17841400000000")).toEqual([]);
    expect(() => h.alta("ig:17841400000000")).toThrow(ValidationError);
  });

  test("el error de un teléfono inválido no lo repite", () => {
    const h = hasher(`1:${K1}`, 1);
    try {
      h.alta("12345");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("12345");
    }
  });

  test("sin claves configuradas, pedir el hasher tira un error de dominio que no se reintenta", () => {
    expect(() => hasherBajasDesde({})).toThrow(IllegalStateError);
    let error: unknown;
    try {
      hasherBajasDesde({});
    } catch (e) {
      error = e;
    }
    expect(isNonRetriable(error)).toBe(true);
    expect(() => hasherBajasDesde({ DIFUSION_BAJAS_HMAC_CLAVES: `1:${K1}` })).toThrow(
      IllegalStateError,
    );
  });

  test("con claves configuradas, el hasher usa la versión activa", () => {
    const h = hasherBajasDesde({
      DIFUSION_BAJAS_HMAC_CLAVES: `1:${K1},2:${K2}`,
      DIFUSION_BAJAS_HMAC_VERSION_ACTIVA: 2,
    });
    expect(h.versionActiva).toBe(2);
  });

  test("el hasher efímero hashea con una clave al azar distinta en cada instancia", () => {
    expect(hasherBajasEfimero().alta(TELEFONO)).not.toEqual(hasherBajasEfimero().alta(TELEFONO));
  });
});
