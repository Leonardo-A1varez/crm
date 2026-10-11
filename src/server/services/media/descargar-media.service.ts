import { InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import { resolverMimeEntrante } from "@/lib/media/detectar-mime";
import { extensionDeMime, MAX_BYTES_ALMACENABLE } from "@/lib/media/limites";
import { rutaDeMedia } from "@/lib/media/ruta";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { MediaStorage } from "@/server/repositories/media-storage.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import { MediaDemasiadoGrande } from "@/server/services/meta/graph-api-media";
import type { MediaRemota, MetaMediaClient } from "@/server/services/meta/graph-api-media";
import type { UUID } from "@/types/entities";

/**
 * Baja el archivo de un mensaje entrante de WhatsApp y lo deja en el bucket
 * propio (docs/meta/media.md). Corre en segundo plano (Inngest) porque la URL
 * que da Meta vive 5 minutos y el id de media 7 días: lo que no se baja a
 * tiempo se pierde para siempre.
 *
 * Idempotencia: la clave es el mensaje. Sólo actúa sobre `pendiente`; la ruta
 * del objeto sale de ids (`sesiones/<sesion>/<mensaje>.<ext>`), así que un
 * reintento sobrescribe el mismo archivo y no deja huérfanos.
 *
 * Lo que NO hace: no loguea nombres ni contenido de archivos, y no confía en el
 * tipo que declara Meta: el contenido se verifica y lo que no coincide se guarda
 * como binario sin tipo (`resolverMimeEntrante`).
 */

/** Meta sólo da media de historial de los últimos 14 días (doc de coexistencia). */
export const HISTORIAL_MAX_DIAS = 14;
const DIA_MS = 24 * 3600_000;

export type ResultadoDescarga = "descargado" | "ya_resuelto" | "omitida" | "fallida";

export interface DescargarMediaInput {
  mensajeId: UUID;
  /** El número de negocio por el que llegó: su token pide el archivo. */
  phoneNumberId: string | null;
}

export interface ImagenReducida {
  bytes: Uint8Array;
  mime: string;
}

export interface DescargarMediaDeps {
  messages: Pick<
    MessagesRepository,
    "findById" | "registrarMediaDescargada" | "marcarMediaSinCopia"
  >;
  meta: Pick<MetaMediaClient, "obtenerMedia" | "descargar">;
  storage: Pick<MediaStorage, "subir">;
  /** `null` = no hay nada que ganar; el original se guarda tal cual. */
  comprimir: (bytes: Uint8Array, mime: string) => Promise<ImagenReducida | null>;
  ahora?: () => Date;
  logger?: Logger;
}

export interface DescargarMediaService {
  descargar(input: DescargarMediaInput): Promise<ResultadoDescarga>;
  /** Se agotaron los reintentos de Inngest: lo deja visible en el hilo. */
  marcarFallida(mensajeId: UUID, motivo: string): Promise<void>;
}

const COMPRIMIBLES = new Set(["image/jpeg", "image/png"]);

export class DefaultDescargarMediaService implements DescargarMediaService {
  private readonly ahora: () => Date;
  private readonly logger: Logger;

  constructor(private readonly deps: DescargarMediaDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
    this.logger = deps.logger ?? new NoopLogger();
  }

  async descargar(input: DescargarMediaInput): Promise<ResultadoDescarga> {
    const mensaje = await this.deps.messages.findById(input.mensajeId);
    const media = mensaje?.media;
    if (!mensaje || !media || media.estado !== "pendiente") return "ya_resuelto";

    if (!media.metaId) return this.sinCopia(mensaje.id, "fallido", "sin_id_de_media");

    if (this.esHistorialViejo(mensaje)) {
      return this.sinCopia(mensaje.id, "omitido", "historial_viejo");
    }

    const desde = input.phoneNumberId ?? undefined;
    const opcionesMeta = desde ? { desde } : {};

    let remota: MediaRemota;
    try {
      remota = await this.deps.meta.obtenerMedia(media.metaId, opcionesMeta);
    } catch (error) {
      // Id vencido (7 días) o inexistente: reintentar no lo arregla.
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        return this.sinCopia(mensaje.id, "fallido", "media_no_disponible");
      }
      throw error;
    }

    if (remota.bytes !== null && remota.bytes > MAX_BYTES_ALMACENABLE) {
      return this.sinCopia(mensaje.id, "omitido", "demasiado_grande");
    }

    let crudo: Uint8Array;
    try {
      crudo = await this.bajar(media.metaId, remota, {
        ...opcionesMeta,
        maxBytes: MAX_BYTES_ALMACENABLE,
      });
    } catch (error) {
      if (error instanceof MediaDemasiadoGrande) {
        return this.sinCopia(mensaje.id, "omitido", "demasiado_grande");
      }
      throw error;
    }

    const declarado = remota.mime ?? media.mime ?? "";
    const reconocido = resolverMimeEntrante(declarado, crudo);

    let bytes = crudo;
    let mime = reconocido.mime;
    if (COMPRIMIBLES.has(mime)) {
      const reducida = await this.comprimirSinRomper(crudo, mime, mensaje.id);
      if (reducida) {
        bytes = reducida.bytes;
        mime = reducida.mime;
      }
    }

    const path = rutaDeMedia(mensaje.lead_session_id, mensaje.id, extensionDeMime(mime));
    await this.deps.storage.subir(path, bytes, mime);

    const hecho = await this.deps.messages.registrarMediaDescargada(
      mensaje.id,
      { path, mime, bytes: bytes.length },
      this.ahora(),
    );
    this.logger.info("media.descargada", {
      mensaje_id: mensaje.id,
      mime,
      bytes: bytes.length,
      reconocido: reconocido.mime !== "application/octet-stream",
    });
    // `null`: otro reintento llegó primero. El objeto es el mismo; no hay nada que deshacer.
    return hecho ? "descargado" : "ya_resuelto";
  }

  async marcarFallida(mensajeId: UUID, motivo: string): Promise<void> {
    await this.deps.messages.marcarMediaSinCopia(mensajeId, "fallido", motivo);
  }

  /**
   * Baja el archivo. La URL de Meta vence a los 5 minutos y un 404 significa
   * «pedí otra» (doc de Meta): se pide una vez más. Si tampoco sirve, falla
   * reintentable y Inngest vuelve a empezar con un intento nuevo.
   */
  private async bajar(
    mediaId: string,
    remota: MediaRemota,
    opciones: { desde?: string; maxBytes: number },
  ): Promise<Uint8Array> {
    try {
      return await this.deps.meta.descargar(remota.url, opciones);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    const nueva = await this.deps.meta.obtenerMedia(
      mediaId,
      opciones.desde ? { desde: opciones.desde } : {},
    );
    try {
      return await this.deps.meta.descargar(nueva.url, opciones);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new InfraError("Meta no entregó la media ni con una URL nueva", "meta", error);
      }
      throw error;
    }
  }

  private async comprimirSinRomper(
    bytes: Uint8Array,
    mime: string,
    mensajeId: UUID,
  ): Promise<ImagenReducida | null> {
    try {
      return await this.deps.comprimir(bytes, mime);
    } catch (error) {
      // Perder la compresión es un detalle; perder el archivo no.
      this.logger.warn("media.compresion_fallo", {
        mensaje_id: mensajeId,
        error_name: error instanceof Error ? error.name : "desconocido",
      });
      return null;
    }
  }

  private esHistorialViejo(mensaje: {
    metadata: { origen?: string };
    platform_created_at?: Date | null;
    created_at: Date;
  }): boolean {
    if (mensaje.metadata.origen !== "historial_app_business") return false;
    const desde = mensaje.platform_created_at ?? mensaje.created_at;
    return this.ahora().getTime() - desde.getTime() > HISTORIAL_MAX_DIAS * DIA_MS;
  }

  private async sinCopia(
    mensajeId: UUID,
    estado: "fallido" | "omitido",
    motivo: string,
  ): Promise<ResultadoDescarga> {
    await this.deps.messages.marcarMediaSinCopia(mensajeId, estado, motivo);
    this.logger.info("media.sin_copia", { mensaje_id: mensajeId, estado, motivo });
    return estado === "omitido" ? "omitida" : "fallida";
  }
}
