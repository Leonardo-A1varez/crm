import { NotFoundError } from "@/lib/errors";
import { esMimeEnLinea } from "@/lib/media/limites";
import { sanearNombreArchivo } from "@/lib/media/sanear-nombre";
import type { MediaStorage } from "@/server/repositories/media-storage.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

/**
 * Cuánto vive la URL firmada que recibe el navegador. Alcanza para bajar una
 * imagen o empezar a reproducir un video (que sigue pidiendo rangos a la misma
 * URL) y es poco para que una URL copiada sirva de algo. El panel nunca guarda
 * ni muestra una URL permanente del bucket.
 */
export const SEGUNDOS_DE_FIRMA = 300;

export interface AccesoMediaService {
  /**
   * La URL firmada del archivo de un mensaje. Se lee con el cliente de la sesión
   * de quien pregunta: si la RLS no le deja ver el mensaje, para este servicio no
   * existe.
   */
  urlDe(mensajeId: UUID, opciones: { descargar: boolean }): Promise<string>;
}

export interface AccesoMediaDeps {
  messages: Pick<MessagesRepository, "findById">;
  storage: Pick<MediaStorage, "firmarUrl">;
}

export class DefaultAccesoMediaService implements AccesoMediaService {
  constructor(private readonly deps: AccesoMediaDeps) {}

  async urlDe(mensajeId: UUID, opciones: { descargar: boolean }): Promise<string> {
    const mensaje = await this.deps.messages.findById(mensajeId);
    const media = mensaje?.media;
    if (!mensaje || !media || media.estado !== "descargado" || !media.path) {
      throw new NotFoundError("el mensaje no tiene archivo disponible", "media", mensajeId);
    }

    // Sólo imagen, audio y video verificados se abren en la página. Todo lo demás
    // (documentos, binarios sin tipo) va como descarga: el navegador nunca lo
    // interpreta, aunque el contenido sea HTML.
    const comoDescarga = opciones.descargar || !esMimeEnLinea(media.mime ?? "");
    return this.deps.storage.firmarUrl(media.path, SEGUNDOS_DE_FIRMA, {
      ...(comoDescarga ? { nombreDescarga: nombreDeDescarga(media.nombre, media.path) } : {}),
    });
  }
}

/** El nombre original saneado, o uno neutro con la extensión de la ruta. */
function nombreDeDescarga(nombre: string | null, path: string): string {
  if (nombre) return sanearNombreArchivo(nombre);
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return `archivo.${ext}`;
}
