import { ValidationError } from "@/lib/errors";
import {
  TIPOS_IMAGEN_DE_FLUJO,
  type ImagenesDeFlujoRepository,
  type TipoImagenDeFlujo,
} from "@/server/repositories/imagenes-de-flujo.repo";

/** 5 MB: el tope de Meta para JPEG y PNG (doc de Meta, image-messages, 2026-09-26). */
export const MAX_BYTES_IMAGEN_DE_FLUJO = 5 * 1024 * 1024;

const EXTENSION: Readonly<Record<TipoImagenDeFlujo, "jpg" | "png">> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Las primeras bytes de cada formato. El tipo que declara el navegador no se cree. */
const FIRMAS: Readonly<Record<TipoImagenDeFlujo, readonly number[]>> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function esTipoAceptado(tipo: string): tipo is TipoImagenDeFlujo {
  return (TIPOS_IMAGEN_DE_FLUJO as readonly string[]).includes(tipo);
}

function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b);
}

/**
 * Sube la imagen de un bloque "Enviar imagen" y devuelve su ruta, que es lo
 * que guarda el bloque. Sólo JPEG o PNG, reconocidos por su contenido, de
 * hasta 5 MB: lo que Meta manda como imagen. Quién puede subir lo decide quien
 * llama (sólo un admin) y, otra vez, la policy de Storage.
 */
export async function subirImagenDeFlujo(
  repo: ImagenesDeFlujoRepository,
  input: { bytes: Uint8Array; tipo: string },
): Promise<{ ruta: string }> {
  const { bytes, tipo } = input;
  if (!esTipoAceptado(tipo)) {
    throw new ValidationError("La imagen tiene que ser JPG o PNG", "imagen_tipo");
  }
  if (bytes.length === 0) {
    throw new ValidationError("El archivo está vacío", "imagen_vacia");
  }
  if (bytes.length > MAX_BYTES_IMAGEN_DE_FLUJO) {
    throw new ValidationError("La imagen no puede pasar de 5 MB", "imagen_grande");
  }
  if (!empiezaCon(bytes, FIRMAS[tipo])) {
    throw new ValidationError("El archivo no es una imagen JPG o PNG válida", "imagen_contenido");
  }
  const ruta = `flujos/${crypto.randomUUID()}.${EXTENSION[tipo]}`;
  await repo.subir(ruta, bytes, tipo);
  return { ruta };
}
