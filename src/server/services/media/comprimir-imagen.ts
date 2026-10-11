import sharp from "sharp";

/** El lado más largo de la imagen guardada. WhatsApp ya recomprime a ~1600 px. */
export const LADO_MAXIMO_PX = 1600;

/** Calidad de WebP: visualmente equivalente para fotos de repuestos y capturas. */
const CALIDAD_WEBP = 80;

/**
 * Tope de píxeles que se decodifican (~100 Mpx). Un PNG de pocos KB puede
 * declarar 20000 x 20000 y agotar la memoria al abrirlo (bomba de descompresión);
 * sharp lo corta antes de decodificar.
 */
const MAX_PIXELES = 100_000_000;

const COMPRIMIBLES = new Set(["image/jpeg", "image/png"]);

export interface ImagenComprimida {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Achica una imagen entrante antes de guardarla: lado máximo 1600 px, WebP a
 * calidad 80, sin EXIF (sale la ubicación y el modelo de cámara de la foto) y con
 * la orientación aplicada.
 *
 * Devuelve `null` — y el llamador conserva el original — cuando no hay nada que
 * ganar o algo salió mal: el tipo no es JPEG/PNG (los stickers WebP y los GIF no
 * se tocan, perderían la animación), la imagen no se pudo leer, declara demasiados
 * píxeles, o la versión comprimida no pesa menos. Nunca lanza: perder la
 * compresión es un detalle; perder el archivo no.
 */
export async function comprimirImagen(
  bytes: Uint8Array,
  mime: string,
): Promise<ImagenComprimida | null> {
  if (!COMPRIMIBLES.has(mime) || bytes.length === 0) return null;
  try {
    const salida = await sharp(bytes, { limitInputPixels: MAX_PIXELES, failOn: "error" })
      // `rotate()` sin argumentos aplica la orientación EXIF y, como sharp no
      // conserva metadatos por defecto, el EXIF no llega a la salida.
      .rotate()
      .resize({
        width: LADO_MAXIMO_PX,
        height: LADO_MAXIMO_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer();
    if (salida.length >= bytes.length) return null;
    return { bytes: new Uint8Array(salida), mime: "image/webp" };
  } catch {
    return null;
  }
}
