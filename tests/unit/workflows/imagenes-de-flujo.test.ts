import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { RUTA_IMAGEN_DE_FLUJO } from "@/lib/workflows/config-nodos";
import { InMemoryImagenesDeFlujoRepository } from "@/server/repositories/imagenes-de-flujo.repo";
import {
  MAX_BYTES_IMAGEN_DE_FLUJO,
  subirImagenDeFlujo,
} from "@/server/services/workflows/imagenes-de-flujo.service";

/**
 * La subida de "Enviar imagen": sólo JPEG o PNG de hasta 5 MB (lo que Meta
 * acepta), reconocidos por su contenido y no por lo que dice el navegador.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

describe("subirImagenDeFlujo", () => {
  it("un JPEG se guarda bajo flujos/ con una ruta que el schema del bloque acepta", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    const { ruta } = await subirImagenDeFlujo(repo, { bytes: JPEG, tipo: "image/jpeg" });
    expect(ruta).toMatch(RUTA_IMAGEN_DE_FLUJO);
    expect(ruta.endsWith(".jpg")).toBe(true);
    expect(repo.archivos.get(ruta)?.tipo).toBe("image/jpeg");
  });

  it("un PNG termina en .png", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    const { ruta } = await subirImagenDeFlujo(repo, { bytes: PNG, tipo: "image/png" });
    expect(ruta.endsWith(".png")).toBe(true);
  });

  it("rechaza un tipo que Meta no manda como imagen", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    await expect(
      subirImagenDeFlujo(repo, { bytes: GIF, tipo: "image/gif" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.archivos.size).toBe(0);
  });

  it("rechaza un archivo cuyo contenido no es el tipo que declara", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    await expect(
      subirImagenDeFlujo(repo, { bytes: GIF, tipo: "image/png" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      subirImagenDeFlujo(repo, { bytes: PNG, tipo: "image/jpeg" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rechaza más de 5 MB", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    const grande = new Uint8Array(MAX_BYTES_IMAGEN_DE_FLUJO + 1);
    grande.set(JPEG);
    await expect(subirImagenDeFlujo(repo, { bytes: grande, tipo: "image/jpeg" })).rejects.toThrow(
      /5 MB/,
    );
  });

  it("rechaza un archivo vacío", async () => {
    const repo = new InMemoryImagenesDeFlujoRepository();
    await expect(
      subirImagenDeFlujo(repo, { bytes: new Uint8Array(), tipo: "image/jpeg" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
