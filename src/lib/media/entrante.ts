import { normalizarMime } from "@/lib/media/limites";
import { sanearNombreArchivo } from "@/lib/media/sanear-nombre";
import type { MediaEntrante } from "@/lib/meta/parse-webhook";
import type { MensajeMedia } from "@/types/entities";

/**
 * El archivo de un mensaje recién llegado, antes de bajarlo: `pendiente`, con el
 * id de Meta para pedirlo y lo que el webhook dijo del tipo. El tipo y el nombre
 * son datos del cliente: el tipo se normaliza y el nombre se sanea acá, y el tipo
 * REAL lo decide después la descarga (`resolverMimeEntrante`).
 */
export function mediaPendienteDe(media: MediaEntrante): MensajeMedia {
  const mime = media.mime ? normalizarMime(media.mime) : "";
  return {
    estado: "pendiente",
    metaId: media.id,
    path: null,
    mime: mime === "" ? null : mime,
    bytes: null,
    nombre: media.nombre ? sanearNombreArchivo(media.nombre) : null,
    error: null,
    descargadoAt: null,
  };
}

/** Lo que el hilo necesita saber del archivo y no cabe en las columnas `media_*`. */
export function marcasDeMedia(media: MediaEntrante | undefined): {
  sticker?: true;
  animado?: true;
  voz?: true;
} {
  if (!media) return {};
  return {
    ...(media.sticker ? { sticker: true as const } : {}),
    ...(media.sticker && media.animado ? { animado: true as const } : {}),
    ...(media.voz ? { voz: true as const } : {}),
  };
}
