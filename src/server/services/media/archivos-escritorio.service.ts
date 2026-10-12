import { codificarCursor, decodificarCursor } from "@/lib/media/cursor";
import { extensionDeMime, tipoDeMime } from "@/lib/media/limites";
import { sanearNombreArchivo } from "@/lib/media/sanear-nombre";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { Mensaje } from "@/types/entities";

/**
 * Qué archivos nuevos hay para guardar en la PC (app de escritorio, docs/meta/media.md §4).
 * La app consulta esto por HTTP con la sesión del CRM; baja cada archivo por
 * `/api/media/<mensajeId>`. Lee con el cliente de esa sesión: lo que la RLS no le
 * deja ver al usuario no aparece.
 */

const LIMITE_MAXIMO = 50;
const NOMBRE_DE_TIPO = { image: "imagen", video: "video", audio: "audio", doc: "archivo" } as const;

export interface ArchivoParaEscritorio {
  mensajeId: string;
  /** Nombre del cliente (o su teléfono si no tiene): la carpeta del archivo. */
  cliente: string;
  /** Cuándo llegó el mensaje (ISO). La app arma `YYYY-MM-DD` con su zona horaria. */
  fecha: string;
  /** Nombre sugerido, ya saneado. La app lo sanea de nuevo. */
  archivo: string;
  mime: string;
  bytes: number | null;
}

export interface PaginaDeArchivos {
  items: ArchivoParaEscritorio[];
  /** Cursor para pedir lo siguiente; igual al recibido si no hubo nada nuevo. */
  siguiente: string | null;
}

export interface ArchivosEscritorioService {
  /** `cursor` es el `siguiente` de la página anterior (o `null` la primera vez). */
  listar(input: { cursor: string | null; limite: number }): Promise<PaginaDeArchivos>;
}

export interface ArchivosEscritorioDeps {
  messages: Pick<MessagesRepository, "listMediaDescargada">;
  convs: Pick<ConversationsRepository, "findById">;
  leads: Pick<LeadsRepository, "findById">;
}

export class DefaultArchivosEscritorioService implements ArchivosEscritorioService {
  constructor(private readonly deps: ArchivosEscritorioDeps) {}

  async listar(input: { cursor: string | null; limite: number }): Promise<PaginaDeArchivos> {
    const limite = Math.min(Math.max(1, Math.trunc(input.limite)), LIMITE_MAXIMO);
    const despuesDe = input.cursor === null ? undefined : decodificarCursor(input.cursor);
    const filas = await this.deps.messages.listMediaDescargada({
      limit: limite,
      ...(despuesDe ? { despuesDe } : {}),
    });

    const items: ArchivoParaEscritorio[] = [];
    const clientePorConv = new Map<string, string>();
    for (const m of filas) {
      const item = await this.aItem(m, clientePorConv);
      if (item) items.push(item);
    }

    const ultimo = filas.at(-1);
    const siguiente = ultimo?.media?.descargadoAt
      ? codificarCursor({ at: ultimo.media.descargadoAt, id: ultimo.id })
      : null;
    return { items, siguiente };
  }

  private async aItem(
    m: Mensaje,
    cache: Map<string, string>,
  ): Promise<ArchivoParaEscritorio | null> {
    const media = m.media;
    if (!media || media.estado !== "descargado") return null;
    let cliente = cache.get(m.conversacion_id);
    if (cliente === undefined) {
      cliente = await this.nombreDelCliente(m.conversacion_id);
      cache.set(m.conversacion_id, cliente);
    }
    const mime = media.mime ?? "application/octet-stream";
    const ext = extensionDeMime(mime);
    const tipo = tipoDeMime(mime);
    const archivo = media.nombre
      ? sanearNombreArchivo(media.nombre)
      : `${tipo ? NOMBRE_DE_TIPO[tipo] : "archivo"}-${m.id.slice(0, 8)}.${ext}`;
    return {
      mensajeId: m.id,
      cliente,
      fecha: m.created_at.toISOString(),
      archivo,
      mime,
      bytes: media.bytes,
    };
  }

  private async nombreDelCliente(conversacionId: string): Promise<string> {
    const conv = await this.deps.convs.findById(conversacionId);
    const lead = conv ? await this.deps.leads.findById(conv.lead_id) : null;
    if (!lead) return "Sin cliente";
    return lead.nombre.trim() || lead.nombre_perfil?.trim() || lead.telefono;
  }
}
