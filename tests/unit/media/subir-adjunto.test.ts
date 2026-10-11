import { describe, expect, it, vi } from "vitest";
import { elegirAdjunto, subirYEnviarAdjunto } from "@/lib/media/subir-adjunto";

const MB = 1024 * 1024;
const base = {
  leadId: "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77",
  sessionId: "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1",
  canal: "wa" as const,
};

function archivo(nombre: string, tipo: string, bytes: number) {
  return { name: nombre, type: tipo, size: bytes } as File;
}

describe("elegirAdjunto (validacion del lado del navegador)", () => {
  it("acepta lo que Meta acepta y dice el tipo", () => {
    expect(elegirAdjunto(archivo("lista.pdf", "application/pdf", MB))).toMatchObject({
      ok: true,
      tipo: "doc",
      mime: "application/pdf",
    });
  });

  it("si el navegador no informa el tipo, sale de la extension", () => {
    expect(elegirAdjunto(archivo("cotizacion.docx", "", 1000))).toMatchObject({
      ok: true,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("rechaza con un mensaje que el vendedor entiende", () => {
    expect(elegirAdjunto(archivo("a.exe", "application/x-msdownload", 10))).toMatchObject({
      ok: false,
      mensaje: expect.stringMatching(/no acepta ese tipo/),
    });
    expect(elegirAdjunto(archivo("v.mp4", "video/mp4", 17 * MB))).toMatchObject({
      ok: false,
      mensaje: expect.stringMatching(/16 MB/),
    });
    expect(elegirAdjunto(archivo("vacio.pdf", "application/pdf", 0))).toMatchObject({ ok: false });
  });
});

describe("subirYEnviarAdjunto", () => {
  const file = archivo("lista.pdf", "application/pdf", 2048);

  function deps(over: Partial<Parameters<typeof subirYEnviarAdjunto>[0]> = {}) {
    const orden: string[] = [];
    const preparar = vi.fn(async (input: unknown) => {
      orden.push("preparar");
      return { ok: true as const, ruta: "sesiones/s/o.pdf", token: "tok", input };
    });
    const subir = vi.fn(async () => {
      orden.push("subir");
      return { ok: true as const };
    });
    const enviar = vi.fn(async () => {
      orden.push("enviar");
      return { ok: true as const };
    });
    return {
      orden,
      preparar,
      subir,
      enviar,
      entrada: { ...base, archivo: file, caption: "la lista", preparar, subir, enviar, ...over },
    };
  }

  it("prepara, sube y envia, en ese orden, con los datos del archivo", async () => {
    const d = deps();
    const r = await subirYEnviarAdjunto(d.entrada);
    expect(r).toEqual({ ok: true });
    expect(d.orden).toEqual(["preparar", "subir", "enviar"]);
    expect(d.preparar).toHaveBeenCalledWith({
      ...base,
      nombre: "lista.pdf",
      mime: "application/pdf",
      bytes: 2048,
    });
    expect(d.subir).toHaveBeenCalledWith("sesiones/s/o.pdf", "tok", file, "application/pdf");
    expect(d.enviar).toHaveBeenCalledWith({
      ...base,
      ruta: "sesiones/s/o.pdf",
      nombre: "lista.pdf",
      caption: "la lista",
    });
  });

  it("sin caption manda null", async () => {
    const d = deps({ caption: "   " });
    await subirYEnviarAdjunto(d.entrada);
    expect(d.enviar).toHaveBeenCalledWith(expect.objectContaining({ caption: null }));
  });

  it("si el servidor rechaza al preparar, no sube nada", async () => {
    const d = deps();
    d.preparar.mockResolvedValueOnce({
      ok: false,
      error: "La ventana de 24 h está cerrada",
    } as never);
    const r = await subirYEnviarAdjunto(d.entrada);
    expect(r).toEqual({ ok: false, error: "La ventana de 24 h está cerrada" });
    expect(d.subir).not.toHaveBeenCalled();
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("si falla la subida a Storage, avisa y no manda", async () => {
    const d = deps();
    d.subir.mockResolvedValueOnce({ ok: false } as never);
    const r = await subirYEnviarAdjunto(d.entrada);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/subir el archivo/) });
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("si subir revienta (red), lo devuelve como error, no como excepcion", async () => {
    const d = deps();
    d.subir.mockRejectedValueOnce(new TypeError("fetch failed"));
    const r = await subirYEnviarAdjunto(d.entrada);
    expect(r.ok).toBe(false);
  });

  it("valida de nuevo antes de pedir nada al servidor", async () => {
    const d = deps({ archivo: archivo("a.exe", "application/x-msdownload", 10) });
    const r = await subirYEnviarAdjunto(d.entrada);
    expect(r.ok).toBe(false);
    expect(d.preparar).not.toHaveBeenCalled();
  });

  it("devuelve el error del envio tal cual", async () => {
    const d = deps();
    d.enviar.mockResolvedValueOnce({ ok: false, error: "Meta rechazó el archivo" } as never);
    expect(await subirYEnviarAdjunto(d.entrada)).toEqual({
      ok: false,
      error: "Meta rechazó el archivo",
    });
  });
});
