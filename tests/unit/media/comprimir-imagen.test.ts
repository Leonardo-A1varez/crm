// @vitest-environment node
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { comprimirImagen } from "@/server/services/media/comprimir-imagen";

/** Una foto "realista": ruido, que es lo peor que le puede tocar a un compresor. */
async function foto(ancho: number, alto: number, formato: "jpeg" | "png"): Promise<Uint8Array> {
  const crudo = randomBytes(ancho * alto * 3);
  const img = sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } });
  const buf =
    formato === "jpeg" ? await img.jpeg({ quality: 95 }).toBuffer() : await img.png().toBuffer();
  return new Uint8Array(buf);
}

describe("comprimirImagen", () => {
  test("una foto grande se achica a 1600 px como maximo y sale en WebP mas liviana", async () => {
    const original = await foto(3200, 2400, "jpeg");
    const r = await comprimirImagen(original, "image/jpeg");
    expect(r).not.toBeNull();
    expect(r!.mime).toBe("image/webp");
    expect(r!.bytes.length).toBeLessThan(original.length);
    const meta = await sharp(r!.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
    // Conserva la proporcion 4:3.
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 1);
  });

  test("una imagen chica no se agranda", async () => {
    const original = await foto(400, 300, "png");
    const r = await comprimirImagen(original, "image/png");
    if (r !== null) {
      const meta = await sharp(r.bytes).metadata();
      expect(meta.width).toBe(400);
      expect(meta.height).toBe(300);
    }
  });

  test("si la version comprimida no es mas liviana, se queda con la original (null)", async () => {
    // Un JPEG de ruido a calidad 10 ya viene muy comprimido: recomprimirlo a
    // WebP q80 conserva sus artefactos y pesa mas.
    const yaChico = new Uint8Array(
      await sharp(randomBytes(800 * 600 * 3), { raw: { width: 800, height: 600, channels: 3 } })
        .jpeg({ quality: 10 })
        .toBuffer(),
    );
    expect(await comprimirImagen(yaChico, "image/jpeg")).toBeNull();
  });

  test("bytes que no son una imagen: null, sin tirar (el llamador conserva el original)", async () => {
    expect(
      await comprimirImagen(new TextEncoder().encode("esto no es una imagen"), "image/jpeg"),
    ).toBeNull();
    expect(await comprimirImagen(new Uint8Array(0), "image/png")).toBeNull();
  });

  test("solo toca JPEG y PNG: GIF, WebP (stickers) y lo demas pasan sin tocar", async () => {
    const webp = new Uint8Array(
      await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#f00" } })
        .webp()
        .toBuffer(),
    );
    expect(await comprimirImagen(webp, "image/webp")).toBeNull();
    expect(await comprimirImagen(webp, "image/gif")).toBeNull();
    expect(await comprimirImagen(webp, "application/pdf")).toBeNull();
  });

  test("el EXIF (ubicacion de la foto) no sobrevive", async () => {
    const conExif = new Uint8Array(
      await sharp(randomBytes(2000 * 2000 * 3), { raw: { width: 2000, height: 2000, channels: 3 } })
        .jpeg()
        .withExif({ IFD0: { Copyright: "dato-privado" } })
        .toBuffer(),
    );
    const r = await comprimirImagen(conExif, "image/jpeg");
    expect(r).not.toBeNull();
    const meta = await sharp(r!.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });

  test("una imagen con una cantidad absurda de pixeles se rechaza (null) antes de decodificarla", async () => {
    // PNG de 10500x10500 (110 Mpx) casi todo del mismo color: pesa poco, expande mucho.
    const bomba = new Uint8Array(
      await sharp({ create: { width: 10500, height: 10500, channels: 3, background: "#000" } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    expect(await comprimirImagen(bomba, "image/png")).toBeNull();
  }, 60_000);
});
