import { describe, expect, test } from "vitest";
import {
  MAX_BYTES_ALMACENABLE,
  ACCEPT_DEL_COMPOSER,
  extensionDeMime,
  mimeDeExtension,
  normalizarMime,
  validarAdjuntoSaliente,
} from "@/lib/media/limites";

const MB = 1024 * 1024;

describe("normalizarMime", () => {
  test("saca parametros y mayusculas", () => {
    expect(normalizarMime("Audio/OGG; codecs=opus")).toBe("audio/ogg");
    expect(normalizarMime("  image/jpeg ")).toBe("image/jpeg");
  });
  test("lo que no parece un tipo queda vacio", () => {
    expect(normalizarMime("")).toBe("");
    expect(normalizarMime("jpeg")).toBe("");
    expect(normalizarMime("image/<script>")).toBe("");
  });
});

describe("validarAdjuntoSaliente: limites de Meta por tipo", () => {
  const ok = (mime: string, bytes: number, nombre = "archivo") =>
    validarAdjuntoSaliente({ mime, bytes, nombre });

  test("imagen JPEG/PNG: hasta 5 MB sale tal cual", () => {
    expect(ok("image/jpeg", 5 * MB)).toMatchObject({ ok: true, tipo: "image", reducir: false });
  });

  test("imagen JPEG/PNG de 5 a 25 MB se acepta y se reduce antes de mandar; mas, no", () => {
    expect(ok("image/png", 5 * MB + 1)).toMatchObject({ ok: true, tipo: "image", reducir: true });
    expect(ok("image/jpeg", 25 * MB)).toMatchObject({ ok: true, reducir: true });
    const r = ok("image/jpeg", 25 * MB + 1);
    expect(r).toMatchObject({ ok: false, motivo: "demasiado_grande" });
    if (!r.ok) expect(r.mensaje).toMatch(/25 MB/);
  });

  test("video MP4 y 3GP hasta 16 MB", () => {
    expect(ok("video/mp4", 16 * MB)).toMatchObject({ ok: true, tipo: "video" });
    expect(ok("video/3gpp", 16 * MB)).toMatchObject({ ok: true, tipo: "video" });
    expect(ok("video/mp4", 16 * MB + 1)).toMatchObject({ ok: false, motivo: "demasiado_grande" });
  });

  test("audio AAC/AMR/MP3/M4A/OGG hasta 16 MB", () => {
    for (const mime of ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"]) {
      expect(ok(mime, 16 * MB), mime).toMatchObject({ ok: true, tipo: "audio" });
    }
    expect(ok("audio/ogg", 16 * MB + 1)).toMatchObject({ ok: false, motivo: "demasiado_grande" });
  });

  test("documentos: PDF, Office y TXT; el tope de Meta (100 MB) lo recorta lo que guarda el CRM", () => {
    expect(MAX_BYTES_ALMACENABLE).toBe(50 * MB);
    expect(ok("application/pdf", 50 * MB)).toMatchObject({ ok: true, tipo: "doc" });
    expect(ok("application/pdf", 50 * MB + 1)).toMatchObject({
      ok: false,
      motivo: "demasiado_grande",
    });
    for (const mime of [
      "text/plain",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
      expect(ok(mime, 1000), mime).toMatchObject({ ok: true, tipo: "doc" });
    }
  });

  test("lo que Meta no acepta se rechaza por tipo", () => {
    for (const mime of [
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "video/webm",
      "video/quicktime",
      "audio/wav",
      "text/html",
      "application/zip",
      "application/x-msdownload",
      "application/octet-stream",
    ]) {
      expect(ok(mime, 1000), mime).toMatchObject({ ok: false, motivo: "tipo_no_permitido" });
    }
  });

  test("vacio y tamano invalido se rechazan", () => {
    expect(ok("image/png", 0)).toMatchObject({ ok: false, motivo: "vacio" });
    expect(ok("image/png", -5)).toMatchObject({ ok: false, motivo: "vacio" });
    expect(ok("image/png", Number.NaN)).toMatchObject({ ok: false, motivo: "vacio" });
  });

  test("el mime con parametros y mayusculas se normaliza", () => {
    expect(ok("Image/JPEG; q=1", 10)).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  test("el mensaje de error es legible para el vendedor", () => {
    const r = ok("video/mp4", 20 * MB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/16 MB/);
  });

  test("lo que no es imagen nunca se reduce", () => {
    expect(ok("video/mp4", MB)).toMatchObject({ ok: true, reducir: false });
    expect(ok("application/pdf", MB)).toMatchObject({ ok: true, reducir: false });
  });
});

describe("mimeDeExtension / extensionDeMime", () => {
  test("ida y vuelta para los tipos enviables", () => {
    expect(mimeDeExtension("foto.JPG")).toBe("image/jpeg");
    expect(mimeDeExtension("cotizacion.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeDeExtension("nota.ogg")).toBe("audio/ogg");
    expect(extensionDeMime("image/webp")).toBe("webp");
    expect(extensionDeMime("audio/ogg")).toBe("ogg");
  });
  test("extension desconocida o sin extension", () => {
    expect(mimeDeExtension("virus.exe")).toBe("");
    expect(mimeDeExtension("sin_extension")).toBe("");
  });
  test("un tipo desconocido se guarda como bin", () => {
    expect(extensionDeMime("application/x-loquesea")).toBe("bin");
  });
});

describe("accept del input de archivos del composer", () => {
  test("lista los tipos enviables, no los inventa", () => {
    expect(ACCEPT_DEL_COMPOSER).toContain("image/jpeg");
    expect(ACCEPT_DEL_COMPOSER).toContain("application/pdf");
    expect(ACCEPT_DEL_COMPOSER).not.toContain("image/gif");
  });
});
