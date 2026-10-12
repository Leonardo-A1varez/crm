import { describe, expect, test } from "vitest";
import { mediaPendienteDe, marcasDeMedia } from "@/lib/media/entrante";

describe("mediaPendienteDe", () => {
  test("arma el archivo pendiente: id, tipo normalizado y nombre saneado", () => {
    expect(
      mediaPendienteDe({
        id: "123",
        mime: "Audio/OGG; codecs=opus",
        nombre: "../../etc/passwd",
      }),
    ).toEqual({
      estado: "pendiente",
      metaId: "123",
      path: null,
      mime: "audio/ogg",
      bytes: null,
      nombre: "passwd",
      error: null,
      descargadoAt: null,
    });
  });

  test("sin tipo ni nombre quedan null, no se inventan", () => {
    expect(mediaPendienteDe({ id: "9", mime: null, nombre: null })).toMatchObject({
      mime: null,
      nombre: null,
    });
  });
});

describe("marcasDeMedia", () => {
  test("sticker y nota de voz viajan en la metadata del mensaje", () => {
    expect(
      marcasDeMedia({ id: "1", mime: null, nombre: null, sticker: true, animado: true }),
    ).toEqual({
      sticker: true,
      animado: true,
    });
    expect(marcasDeMedia({ id: "1", mime: null, nombre: null, voz: true })).toEqual({ voz: true });
  });
  test("un archivo comun no agrega marcas", () => {
    expect(marcasDeMedia({ id: "1", mime: "image/jpeg", nombre: null })).toEqual({});
    expect(marcasDeMedia(undefined)).toEqual({});
  });
});
