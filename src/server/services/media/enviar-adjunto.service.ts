import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { verificarContenido } from "@/lib/media/detectar-mime";
import { mimeDeExtension, validarAdjuntoSaliente } from "@/lib/media/limites";
import { esRutaDeMedia, rutaDeMedia } from "@/lib/media/ruta";
import { sanearNombreArchivo } from "@/lib/media/sanear-nombre";
import { estadoVentana } from "@/lib/ventana";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MediaStorage } from "@/server/repositories/media-storage.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { MetaMediaClient } from "@/server/services/meta/graph-api-media";
import type { Canal } from "@/types/domain";
import type { Mensaje, UUID } from "@/types/entities";

/**
 * Mandar un archivo desde el composer del Inbox (docs/meta/media.md §3).
 *
 *   1. `preparar`: valida tipo y tamaño contra la tabla de Meta, la sesión y la
 *      ventana de 24 h, y autoriza al navegador a subir DIRECTO a Storage (una
 *      función de Vercel no recibe más de 4,5 MB, y los archivos llegan a 16 MB).
 *   2. el navegador sube.
 *   3. `enviar`: baja el objeto, **vuelve a validar** (no se le cree al
 *      navegador), sube el archivo a Meta (`POST /{phone_number_id}/media`),
 *      manda el mensaje con su id y lo deja en el hilo con la copia propia.
 *
 * El número y el token son los de la conversación, igual que el texto.
 */

const MAX_CAPTION = 1024;

export interface PrepararAdjuntoInput {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  nombre: string;
  mime: string;
  bytes: number;
}

export interface PreparacionAdjunto {
  /** Dónde sube el navegador. Vuelve en `enviar`. */
  ruta: string;
  token: string;
}

export interface EnviarAdjuntoInput {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  ruta: string;
  nombre: string;
  caption: string | null;
  userId: UUID | null;
}

export interface EnviarAdjuntoService {
  preparar(input: PrepararAdjuntoInput): Promise<PreparacionAdjunto>;
  enviar(input: EnviarAdjuntoInput): Promise<Mensaje>;
}

export interface EnviarAdjuntoDeps {
  sessions: Pick<LeadSessionRepository, "findById">;
  convs: Pick<ConversationsRepository, "findByLeadId">;
  messages: Pick<MessagesRepository, "findUltimoEntranteAt" | "findByIdempotencyKey">;
  metaApi: Pick<MetaApiService, "sendMedia">;
  metaMedia: Pick<MetaMediaClient, "subir">;
  storage: Pick<MediaStorage, "crearSubida" | "descargar" | "subir" | "borrar">;
  /** Deja un JPEG/PNG de más de 5 MB en un JPEG de 5 MB o menos; `null` si no puede. */
  reducirImagen: (
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  ahora?: () => Date;
}

export class DefaultEnviarAdjuntoService implements EnviarAdjuntoService {
  private readonly ahora: () => Date;

  constructor(private readonly deps: EnviarAdjuntoDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
  }

  async preparar(input: PrepararAdjuntoInput): Promise<PreparacionAdjunto> {
    soloWhatsApp(input.canal);
    const v = validarAdjuntoSaliente({
      mime: input.mime,
      bytes: input.bytes,
      nombre: input.nombre,
    });
    if (!v.ok) throw new ValidationError(v.mensaje, v.motivo);

    const { sesionId } = await this.contexto(input);
    const ruta = rutaDeMedia(sesionId, crypto.randomUUID(), v.ext);
    const { token } = await this.deps.storage.crearSubida(ruta);
    return { ruta, token };
  }

  async enviar(input: EnviarAdjuntoInput): Promise<Mensaje> {
    soloWhatsApp(input.canal);
    const caption = input.caption?.trim() ? input.caption.trim() : null;
    if (caption !== null && caption.length > MAX_CAPTION) {
      throw new ValidationError(
        `El texto del archivo no puede pasar de ${MAX_CAPTION} caracteres.`,
      );
    }

    const { sesionId, conv } = await this.contexto(input);
    const { objetoId, ext } = leerRuta(input.ruta, sesionId);

    // Doble clic o reintento: el mensaje ya salió, no se sube ni se manda de nuevo.
    const clave = `adjunto:${objetoId}`;
    const yaEnviado = await this.deps.messages.findByIdempotencyKey(clave);
    if (yaEnviado) return yaEnviado;

    let bytes = await this.bajar(input.ruta);

    // El tipo sale de la extensión de la ruta (la puso `preparar` desde un tipo ya
    // validado) y se comprueba contra los bytes: el navegador pudo subir otra cosa.
    const declarado = mimeDeExtension(`archivo.${ext}`);
    const verificado = declarado === "" ? null : verificarContenido(declarado, bytes);
    if (!verificado?.ok) {
      throw new ValidationError(
        "El contenido del archivo no coincide con su tipo. Adjuntalo de nuevo.",
        "media_contenido",
      );
    }

    const v = validarAdjuntoSaliente({
      mime: verificado.mime,
      bytes: bytes.length,
      nombre: input.nombre,
    });
    if (!v.ok) throw new ValidationError(v.mensaje, v.motivo);
    if (v.tipo === "audio" && caption !== null) {
      throw new ValidationError("WhatsApp no admite texto en un audio. Mandalo por separado.");
    }

    let mime = v.mime;
    let path = input.ruta;
    let reducida = false;
    if (v.reducir) {
      const r = await this.deps.reducirImagen(bytes, mime);
      if (!r) {
        throw new ValidationError(
          "No se pudo achicar la foto a 5 MB para WhatsApp. Mandá una más liviana.",
          "media_reducir",
        );
      }
      bytes = r.bytes;
      mime = r.mime;
      reducida = true;
      // La copia que ve el hilo es la que se manda: se guarda aparte y la
      // original se borra recién cuando el envío salió.
      path = rutaDeMedia(sesionId, crypto.randomUUID(), "jpg");
      await this.deps.storage.subir(path, bytes, mime);
    }

    const nombre = sanearNombreArchivo(input.nombre);
    const desde = conv.whatsapp_phone_number_id ?? undefined;
    const subida = await this.deps.metaMedia.subir({
      bytes,
      mime,
      nombre,
      ...(desde ? { desde } : {}),
    });

    const mensaje = await this.deps.metaApi.sendMedia({
      conversacionId: conv.id,
      leadSessionId: sesionId,
      to: conv.canal_thread_id,
      media: {
        tipo: v.tipo,
        mediaId: subida.id,
        caption,
        filename: v.tipo === "doc" ? nombre : null,
      },
      archivo: { path, mime, bytes: bytes.length, nombre },
      sender: "humano",
      ...(input.userId ? { senderUserId: input.userId } : {}),
      idempotencyKey: clave,
    });

    if (reducida) await this.deps.storage.borrar([input.ruta]).catch(() => undefined);
    return mensaje;
  }

  private async bajar(ruta: string): Promise<Uint8Array> {
    try {
      return await this.deps.storage.descargar(ruta);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new ValidationError(
          "No se encontró el archivo subido. Adjuntalo de nuevo.",
          "media_no_subido",
        );
      }
      throw error;
    }
  }

  /** Sesión abierta del lead, conversación de WhatsApp y ventana de 24 h abierta. */
  private async contexto(input: { leadId: UUID; sessionId: UUID }) {
    const sesion = await this.deps.sessions.findById(input.sessionId);
    if (!sesion)
      throw new NotFoundError(
        `sesión no encontrada: ${input.sessionId}`,
        "lead_session",
        input.sessionId,
      );
    if (sesion.lead_id !== input.leadId) {
      throw new ValidationError(
        `sesión ${input.sessionId} no pertenece al lead ${input.leadId}`,
        "session_lead_mismatch",
      );
    }
    if (sesion.resultado !== null) {
      throw new ConflictError("La sesión ya está cerrada. Refrescá la página.", "session_cerrada");
    }

    const conv = (await this.deps.convs.findByLeadId(input.leadId)).find((c) => c.canal === "wa");
    if (!conv) {
      throw new NotFoundError(
        `lead ${input.leadId} sin conversación en canal wa`,
        "conversacion",
        "wa",
      );
    }

    const ultimo = await this.deps.messages.findUltimoEntranteAt(conv.id);
    if (estadoVentana(ultimo, this.ahora()).estado === "cerrada") {
      throw new ValidationError(
        "La ventana de 24 h está cerrada: Meta no deja mandar archivos hasta que el cliente vuelva a escribir.",
        "ventana_cerrada",
      );
    }
    return { sesionId: sesion.id, conv };
  }
}

function soloWhatsApp(canal: Canal): void {
  if (canal !== "wa") {
    throw new ValidationError("Por ahora solo se pueden mandar archivos por WhatsApp.", "canal");
  }
}

/** La ruta tiene que ser de esta sesión y con la forma exacta que arma `rutaDeMedia`. */
function leerRuta(ruta: string, sesionId: UUID): { objetoId: string; ext: string } {
  if (!esRutaDeMedia(ruta) || !ruta.startsWith(`sesiones/${sesionId}/`)) {
    throw new ValidationError(
      "El archivo no es de esta conversación. Adjuntalo de nuevo.",
      "media_ruta",
    );
  }
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return { objetoId: nombre.slice(0, punto), ext: nombre.slice(punto + 1) };
}
