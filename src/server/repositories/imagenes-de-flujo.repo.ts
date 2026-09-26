import { NotFoundError } from "@/lib/errors";

/** Lo único que Meta acepta como imagen: JPEG y PNG, hasta 5 MB (doc de Meta, 2026-09-26). */
export const TIPOS_IMAGEN_DE_FLUJO = ["image/jpeg", "image/png"] as const;
export type TipoImagenDeFlujo = (typeof TIPOS_IMAGEN_DE_FLUJO)[number];

/**
 * Las imágenes que un admin sube para el bloque "Enviar imagen". Viven en el
 * bucket privado `mensajes_media`, bajo `flujos/<uuid>.<jpg|png>`
 * (`RUTA_IMAGEN_DE_FLUJO`), y salen hacia Meta con una URL firmada.
 */
export interface ImagenesDeFlujoRepository {
  subir(ruta: string, bytes: Uint8Array, tipo: TipoImagenDeFlujo): Promise<void>;
  /**
   * Una URL que vence. Meta descarga la imagen al mandar y la cachea 10
   * minutos, así que no hace falta que dure más que el envío.
   */
  urlFirmada(ruta: string): Promise<string>;
}

export class InMemoryImagenesDeFlujoRepository implements ImagenesDeFlujoRepository {
  readonly archivos = new Map<string, { bytes: Uint8Array; tipo: TipoImagenDeFlujo }>();

  async subir(ruta: string, bytes: Uint8Array, tipo: TipoImagenDeFlujo): Promise<void> {
    this.archivos.set(ruta, { bytes, tipo });
  }

  async urlFirmada(ruta: string): Promise<string> {
    if (!this.archivos.has(ruta)) {
      throw new NotFoundError(`imagen de flujo no encontrada: ${ruta}`, "imagen_de_flujo", ruta);
    }
    return `memoria://mensajes_media/${ruta}?firmada=1`;
  }
}
