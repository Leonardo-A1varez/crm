import { describe, expect, test } from "vitest";
import { detectarMime, resolverMimeEntrante, verificarContenido } from "@/lib/media/detectar-mime";

/** Los primeros bytes de cada formato (firmas publicadas, no archivos completos). */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const relleno = (n = 32) => new Array<number>(n).fill(0x41);
const b = (...partes: number[][]) => new Uint8Array(partes.flat());

const JPEG = b([0xff, 0xd8, 0xff, 0xe0], relleno());
const PNG = b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], relleno());
const GIF = b(ascii("GIF89a"), relleno());
const WEBP = b(ascii("RIFF"), [0, 0, 0, 0], ascii("WEBP"), relleno());
const WAV = b(ascii("RIFF"), [0, 0, 0, 0], ascii("WAVE"), relleno());
const PDF = b(ascii("%PDF-1.7\n"), relleno());
const OGG = b(ascii("OggS"), [0, 2], relleno());
const MP3_ID3 = b(ascii("ID3"), [3, 0, 0], relleno());
const MP3_FRAME = b([0xff, 0xfb, 0x90, 0x00], relleno());
const AAC_ADTS = b([0xff, 0xf1, 0x50, 0x80], relleno());
const AMR = b(ascii("#!AMR\n"), relleno());
const ftyp = (marca: string) => b([0, 0, 0, 0x18], ascii("ftyp"), ascii(marca), relleno());
const MP4 = ftyp("isom");
const GP3 = ftyp("3gp4");
const M4A = ftyp("M4A ");
const MOV = ftyp("qt  ");
const WEBM = b([0x1a, 0x45, 0xdf, 0xa3], relleno());
const ZIP = b(ascii("PK"), [3, 4], relleno());
const OLE = b([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], relleno());
const TEXTO = new TextEncoder().encode("Pastillas de freno\nCorolla 2018\n");
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const EXE = b(ascii("MZ"), [0x90, 0, 3, 0, 0, 0], relleno());

describe("detectarMime", () => {
  test.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["GIF", GIF, "image/gif"],
    ["WebP", WEBP, "image/webp"],
    ["WAV", WAV, "audio/wav"],
    ["PDF", PDF, "application/pdf"],
    ["OGG", OGG, "audio/ogg"],
    ["MP3 con ID3", MP3_ID3, "audio/mpeg"],
    ["MP3 sin etiqueta", MP3_FRAME, "audio/mpeg"],
    ["AAC ADTS", AAC_ADTS, "audio/aac"],
    ["AMR", AMR, "audio/amr"],
    ["MP4", MP4, "video/mp4"],
    ["3GP", GP3, "video/3gpp"],
    ["M4A", M4A, "audio/mp4"],
    ["MOV", MOV, "video/quicktime"],
    ["WebM", WEBM, "video/webm"],
    ["ZIP (OOXML)", ZIP, "application/zip"],
    ["OLE (Office viejo)", OLE, "application/x-ole-storage"],
  ])("%s", (_nombre, bytes, esperado) => {
    expect(detectarMime(bytes)).toBe(esperado);
  });

  test("texto plano y binarios sin firma conocida", () => {
    expect(detectarMime(TEXTO)).toBe("text/plain");
    expect(detectarMime(HTML)).toBe("text/plain"); // se ve como texto: nunca como imagen
    expect(detectarMime(EXE)).toBeNull();
    expect(detectarMime(new Uint8Array(0))).toBeNull();
    expect(detectarMime(new Uint8Array([0xff]))).toBeNull();
  });
});

describe("verificarContenido: el tipo que dice el cliente tiene que ser el que es", () => {
  test("coincide", () => {
    expect(verificarContenido("image/jpeg", JPEG)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(verificarContenido("audio/ogg", OGG)).toEqual({ ok: true, mime: "audio/ogg" });
    expect(verificarContenido("video/mp4", MP4)).toEqual({ ok: true, mime: "video/mp4" });
    expect(verificarContenido("application/pdf", PDF)).toEqual({
      ok: true,
      mime: "application/pdf",
    });
  });

  test("la familia MP4 acepta audio/mp4 y video/mp4 intercambiados", () => {
    expect(verificarContenido("audio/mp4", MP4)).toEqual({ ok: true, mime: "audio/mp4" });
    expect(verificarContenido("video/mp4", M4A)).toEqual({ ok: true, mime: "video/mp4" });
  });

  test("OOXML y Office viejo se reconocen por familia", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(verificarContenido(docx, ZIP)).toEqual({ ok: true, mime: docx });
    expect(verificarContenido("application/msword", OLE)).toEqual({
      ok: true,
      mime: "application/msword",
    });
    expect(verificarContenido("application/msword", ZIP)).toMatchObject({ ok: false });
  });

  test("un ejecutable o HTML disfrazado de imagen se rechaza", () => {
    expect(verificarContenido("image/png", EXE)).toEqual({ ok: false, detectado: null });
    expect(verificarContenido("image/jpeg", HTML)).toEqual({ ok: false, detectado: "text/plain" });
    expect(verificarContenido("application/pdf", PNG)).toEqual({
      ok: false,
      detectado: "image/png",
    });
  });

  test("text/plain no acepta binarios", () => {
    expect(verificarContenido("text/plain", TEXTO)).toEqual({ ok: true, mime: "text/plain" });
    expect(verificarContenido("text/plain", EXE)).toMatchObject({ ok: false });
    expect(verificarContenido("text/plain", PNG)).toMatchObject({ ok: false });
  });
});

describe("resolverMimeEntrante: que se guarda y si se puede mostrar en linea", () => {
  test("lo verificado se guarda con su tipo y las imagenes, audio y video se muestran", () => {
    expect(resolverMimeEntrante("image/jpeg", JPEG)).toEqual({
      mime: "image/jpeg",
      enLinea: true,
    });
    expect(resolverMimeEntrante("audio/ogg; codecs=opus", OGG)).toEqual({
      mime: "audio/ogg",
      enLinea: true,
    });
  });

  test("un documento verificado se descarga, no se muestra en linea", () => {
    expect(resolverMimeEntrante("application/pdf", PDF)).toEqual({
      mime: "application/pdf",
      enLinea: false,
    });
  });

  test("si el contenido no es lo que dice, se guarda como binario y no se muestra", () => {
    expect(resolverMimeEntrante("image/png", HTML)).toEqual({
      mime: "application/octet-stream",
      enLinea: false,
    });
  });

  test("tipo desconocido (zip, csv): binario, sin mostrar", () => {
    expect(resolverMimeEntrante("application/zip", ZIP)).toEqual({
      mime: "application/octet-stream",
      enLinea: false,
    });
    expect(resolverMimeEntrante("", EXE)).toEqual({
      mime: "application/octet-stream",
      enLinea: false,
    });
  });

  test("sin tipo declarado pero con firma conocida, manda la firma", () => {
    expect(resolverMimeEntrante("", PNG)).toEqual({ mime: "image/png", enLinea: true });
  });
});
